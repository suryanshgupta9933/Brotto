package ratelimit

import (
	"sync"
	"time"

	"github.com/fara15/cdp-relay/internal/protocol"
)

// Config holds rate limiter configuration
type Config struct {
	TokensPerSecond float64
	BurstSize       int64
	WindowSizeMs    int64
}

// DefaultConfig returns the default rate limiter configuration
func DefaultConfig() Config {
	return Config{
		TokensPerSecond: 1000,
		BurstSize:       100,
		WindowSizeMs:    1000,
	}
}

// State tracks rate limit state for a key
type State struct {
	TokensAvailable float64
	LastRefill     time.Time
	CurrentBurst   int64
}

// TokenBucket implements token bucket rate limiting
type TokenBucket struct {
	config Config
	states map[string]*State
	mu     sync.RWMutex
}

// NewTokenBucket creates a new token bucket rate limiter
func NewTokenBucket(cfg Config) *TokenBucket {
	if cfg.TokensPerSecond == 0 {
		cfg = DefaultConfig()
	}
	return &TokenBucket{
		config: cfg,
		states: make(map[string]*State),
	}
}

// getState gets or creates rate limit state for a key
func (tb *TokenBucket) getState(key string) *State {
	state, ok := tb.states[key]
	if !ok {
		state = &State{
			TokensAvailable: float64(tb.config.BurstSize),
			LastRefill:     time.Now(),
			CurrentBurst:   0,
		}
		tb.states[key] = state
	}
	return state
}

// refillTokens adds tokens based on elapsed time
func (tb *TokenBucket) refillTokens(state *State) {
	now := time.Now()
	elapsed := now.Sub(state.LastRefill)
	windowMs := time.Duration(tb.config.WindowSizeMs) * time.Millisecond

	if elapsed >= windowMs {
		windows := int64(elapsed / windowMs)
		tokensToAdd := float64(windows) * tb.config.TokensPerSecond * (float64(tb.config.WindowSizeMs) / 1000)

		state.TokensAvailable += tokensToAdd
		if state.TokensAvailable > float64(tb.config.BurstSize) {
			state.TokensAvailable = float64(tb.config.BurstSize)
		}
		state.LastRefill = now
		state.CurrentBurst = 0
	}
}

// Check checks if a message is allowed and consumes a token
func (tb *TokenBucket) Check(key string) protocol.ValidationResult {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	state := tb.getState(key)
	tb.refillTokens(state)

	if state.TokensAvailable < 1 {
		return protocol.ValidationResult{
			IsValid: false,
			Errors: []protocol.ValidationError{
				{
					Field:   "rateLimit",
					Message: "Rate limit exceeded",
					Code:    protocol.ErrorRateLimitExceeded,
				},
			},
		}
	}

	state.TokensAvailable -= 1
	state.CurrentBurst++

	return protocol.ValidationResult{IsValid: true}
}

// TryConsume tries to consume tokens without failing
func (tb *TokenBucket) TryConsume(key string, tokens int64) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	state := tb.getState(key)
	tb.refillTokens(state)

	if state.TokensAvailable >= float64(tokens) {
		state.TokensAvailable -= float64(tokens)
		state.CurrentBurst += tokens
		return true
	}
	return false
}

// GetAvailable returns the number of available tokens
func (tb *TokenBucket) GetAvailable(key string) float64 {
	tb.mu.RLock()
	defer tb.mu.RUnlock()

	state := tb.getState(key)
	tb.refillTokens(state)
	return state.TokensAvailable
}

// Reset resets rate limit state for a key
func (tb *TokenBucket) Reset(key string) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	delete(tb.states, key)
}

// ResetAll resets all rate limit states
func (tb *TokenBucket) ResetAll() {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.states = make(map[string]*State)
}

// UpdateConfig updates the rate limiter configuration
func (tb *TokenBucket) UpdateConfig(cfg Config) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.config = cfg
}

// GetConfig returns the current configuration
func (tb *TokenBucket) GetConfig() Config {
	tb.mu.RLock()
	defer tb.mu.RUnlock()
	return tb.config
}

// SessionLimiter is a rate limiter that uses sessionId:channelId as the key
type SessionLimiter struct {
	*TokenBucket
}

// NewSessionLimiter creates a new session-based rate limiter
func NewSessionLimiter(cfg Config) *SessionLimiter {
	return &SessionLimiter{
		TokenBucket: NewTokenBucket(cfg),
	}
}

// CheckSessionChannel checks rate limit for a session/channel
func (sl *SessionLimiter) CheckSessionChannel(sessionID, channelID string) protocol.ValidationResult {
	key := sessionID + ":" + channelID
	return sl.Check(key)
}

// GetAvailableSessionChannel returns available tokens for a session/channel
func (sl *SessionLimiter) GetAvailableSessionChannel(sessionID, channelID string) float64 {
	key := sessionID + ":" + channelID
	return sl.GetAvailable(key)
}

// ResetSession resets all channels for a session
func (sl *SessionLimiter) ResetSession(sessionID string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	keysToDelete := make([]string, 0)
	for key := range sl.states {
		if len(key) > len(sessionID) && key[:len(sessionID)] == sessionID && key[len(sessionID)] == ':' {
			keysToDelete = append(keysToDelete, key)
		}
	}
	for _, key := range keysToDelete {
		delete(sl.states, key)
	}
}

// ResetChannel resets a specific channel
func (sl *SessionLimiter) ResetChannel(sessionID, channelID string) {
	key := sessionID + ":" + channelID
	sl.Reset(key)
}

// CalculateRateLimit calculates rate limit based on bandwidth
func CalculateRateLimit(avgMessageSizeBytes int64, maxBandwidthBytesPerSecond int64) Config {
	if avgMessageSizeBytes <= 0 {
		avgMessageSizeBytes = 1024
	}
	if maxBandwidthBytesPerSecond <= 0 {
		maxBandwidthBytesPerSecond = 1024 * 1024 // 1MB/s default
	}

	messagesPerSecond := maxBandwidthBytesPerSecond / avgMessageSizeBytes
	burstSize := messagesPerSecond / 10
	if burstSize > 100 {
		burstSize = 100
	}
	if burstSize < 1 {
		burstSize = 1
	}
	if messagesPerSecond < 1 {
		messagesPerSecond = 1
	}

	return Config{
		TokensPerSecond: float64(messagesPerSecond),
		BurstSize:       burstSize,
		WindowSizeMs:    1000,
	}
}
