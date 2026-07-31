package heartbeat

import (
	"sync"
	"time"

	"github.com/fara15/cdp-relay/internal/protocol"
)

// Status represents heartbeat status
type Status string

const (
	StatusActive  Status = "active"
	StatusIdle    Status = "idle"
	StatusClosing Status = "closing"
)

// State tracks heartbeat state
type State struct {
	LastSent            time.Time
	LastReceived        time.Time
	Status              Status
	MissedHeartbeats    int
	ConsecutiveFailures int
}

// Config holds heartbeat configuration
type Config struct {
	IntervalMs        time.Duration
	MaxMissedHeartbeats int
	AckTimeoutMs      time.Duration
	OnMissedHeartbeat  func(count int)
	OnHeartbeatAck     func()
	OnTimeout          func()
}

// DefaultConfig returns the default heartbeat configuration
func DefaultConfig() Config {
	return Config{
		IntervalMs:        protocol.DefaultHeartbeatInterval,
		MaxMissedHeartbeats: 3,
		AckTimeoutMs:      5 * time.Second,
	}
}

// Manager manages heartbeat monitoring for a connection
type Manager struct {
	config Config
	state  State
	mu     sync.RWMutex
}

// NewManager creates a new heartbeat manager
func NewManager(cfg Config) *Manager {
	if cfg.IntervalMs == 0 {
		cfg.IntervalMs = DefaultConfig().IntervalMs
	}
	if cfg.MaxMissedHeartbeats == 0 {
		cfg.MaxMissedHeartbeats = DefaultConfig().MaxMissedHeartbeats
	}
	return &Manager{
		config: cfg,
		state: State{
			Status:       StatusActive,
			LastSent:    time.Now(),
			LastReceived: time.Now(),
		},
	}
}

// RecordSent records that a heartbeat was sent
func (m *Manager) RecordSent() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.LastSent = time.Now()
}

// RecordReceived records that a heartbeat was received
func (m *Manager) RecordReceived() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.LastReceived = time.Now()
	m.state.MissedHeartbeats = 0
}

// UpdateStatus updates the heartbeat status
func (m *Manager) UpdateStatus(status Status) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.Status = status
}

// GetState returns the current heartbeat state
func (m *Manager) GetState() State {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return State{
		LastSent:            m.state.LastSent,
		LastReceived:        m.state.LastReceived,
		Status:              m.state.Status,
		MissedHeartbeats:    m.state.MissedHeartbeats,
		ConsecutiveFailures: m.state.ConsecutiveFailures,
	}
}

// IsStale checks if the connection is considered stale
func (m *Manager) IsStale() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	deadline := m.state.LastReceived.Add(m.config.IntervalMs * time.Duration(m.config.MaxMissedHeartbeats))
	return time.Now().After(deadline)
}

// TimeUntilNextHeartbeat returns the time until the next heartbeat should be sent
func (m *Manager) TimeUntilNextHeartbeat() time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()

	nextHeartbeat := m.state.LastSent.Add(m.config.IntervalMs)
	remaining := nextHeartbeat.Sub(time.Now())
	if remaining < 0 {
		return 0
	}
	return remaining
}

// CheckMissedHeartbeat checks if a heartbeat deadline was missed
func (m *Manager) CheckMissedHeartbeat() bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	timeSinceLastSent := time.Since(m.state.LastSent)
	if timeSinceLastSent > m.config.IntervalMs*150/100 { // 1.5x interval
		m.state.MissedHeartbeats++
		if m.config.OnMissedHeartbeat != nil {
			m.config.OnMissedHeartbeat(m.state.MissedHeartbeats)
		}
		if m.state.MissedHeartbeats >= m.config.MaxMissedHeartbeats {
			if m.config.OnTimeout != nil {
				m.config.OnTimeout()
			}
			return true
		}
	}
	return false
}

// DetermineStatus determines the heartbeat status based on activity
func DetermineStatus(lastActivity time.Time, idleThresholdMs time.Duration) Status {
	if idleThresholdMs == 0 {
		idleThresholdMs = 60 * time.Second
	}
	if time.Since(lastActivity) > idleThresholdMs {
		return StatusIdle
	}
	return StatusActive
}

// CreateHeartbeatPayload creates a heartbeat payload
func CreateHeartbeatPayload(sequenceNumber int64, status Status) protocol.HeartbeatPayload {
	return protocol.HeartbeatPayload{
		Timestamp:      time.Now().UnixMilli(),
		SequenceNumber: sequenceNumber,
		Status:         string(status),
	}
}

// IsHeartbeatExpired checks if a heartbeat has expired
func IsHeartbeatExpired(lastHeartbeat time.Time, intervalMs time.Duration, maxMissed int) bool {
	deadline := lastHeartbeat.Add(intervalMs * time.Duration(maxMissed))
	return time.Now().After(deadline)
}

// ValidateHeartbeatPayload validates a heartbeat payload
func ValidateHeartbeatPayload(payload any) bool {
	p, ok := payload.(map[string]any)
	if !ok {
		return false
	}

	_, hasTimestamp := p["timestamp"]
	_, hasSequence := p["sequenceNumber"]
	statusVal, hasStatus := p["status"]

	if !hasTimestamp || !hasSequence || !hasStatus {
		return false
	}

	status, ok := statusVal.(string)
	if !ok {
		return false
	}

	return status == string(StatusActive) || status == string(StatusIdle) || status == string(StatusClosing)
}
