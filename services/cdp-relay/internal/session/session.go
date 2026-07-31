package session

import (
	"errors"
	"sync"
	"time"

	"github.com/fara15/cdp-relay/internal/protocol"
)

// SessionState represents the state of a session
type SessionState string

const (
	SessionStatePending  SessionState = "pending"
	SessionStateActive   SessionState = "active"
	SessionStateRenewing SessionState = "renewing"
	SessionStateRevoked SessionState = "revoked"
	SessionStateExpired  SessionState = "expired"
)

// Session represents a relay session
type Session struct {
	ID          string
	TenantID    string
	DeviceID    string
	State       SessionState
	CreatedAt   time.Time
	ExpiresAt   time.Time
	LastBeat    time.Time
	ChannelIDs  map[string]bool
	Metadata    map[string]string
	SessionKey  string
	mu          sync.RWMutex
}

// Manager manages sessions
type Manager struct {
	sessions       map[string]*Session
	defaultLeaseMs time.Duration
	mu             sync.RWMutex
}

// NewManager creates a new session manager
func NewManager(defaultLeaseMs time.Duration) *Manager {
	if defaultLeaseMs == 0 {
		defaultLeaseMs = protocol.DefaultSessionLease
	}
	return &Manager{
		sessions:       make(map[string]*Session),
		defaultLeaseMs: defaultLeaseMs,
	}
}

// CreateSession creates a new session
func (m *Manager) CreateSession(tenantID, deviceID string, requestedLeaseMs *int64, metadata map[string]string) (*Session, error) {
	sessionID, err := protocol.GenerateSessionID()
	if err != nil {
		return nil, err
	}

	sessionKey, err := protocol.GenerateSessionID()
	if err != nil {
		return nil, err
	}

	leaseMs := m.defaultLeaseMs
	if requestedLeaseMs != nil && *requestedLeaseMs > 0 {
		leaseMs = time.Duration(*requestedLeaseMs) * time.Millisecond
	}

	now := time.Now()
	session := &Session{
		ID:         sessionID,
		TenantID:   tenantID,
		DeviceID:   deviceID,
		State:      SessionStatePending,
		CreatedAt:  now,
		ExpiresAt:  now.Add(leaseMs),
		LastBeat:   now,
		ChannelIDs: make(map[string]bool),
		Metadata:   metadata,
		SessionKey: sessionKey,
	}

	m.mu.Lock()
	m.sessions[sessionID] = session
	m.mu.Unlock()

	return session, nil
}

// ActivateSession activates a pending session
func (m *Manager) ActivateSession(sessionID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok || session.State != SessionStatePending {
		return false
	}
	session.State = SessionStateActive
	return true
}

// GetSession retrieves a session by ID
func (m *Manager) GetSession(sessionID string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[sessionID]
}

// IsSessionValid checks if a session is valid (active and not expired)
func (m *Manager) IsSessionValid(sessionID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}
	if session.State != SessionStateActive && session.State != SessionStateRenewing {
		return false
	}
	if time.Now().After(session.ExpiresAt) {
		return false
	}
	return true
}

// AddChannel adds a channel to a session
func (m *Manager) AddChannel(sessionID, channelID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}
	if session.State == SessionStateRevoked || session.State == SessionStateExpired {
		return false
	}

	session.ChannelIDs[channelID] = true
	return true
}

// RemoveChannel removes a channel from a session
func (m *Manager) RemoveChannel(sessionID, channelID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}
	delete(session.ChannelIDs, channelID)
	return true
}

// HasChannel checks if a session has a specific channel
func (m *Manager) HasChannel(sessionID, channelID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}
	return session.ChannelIDs[channelID]
}

// RenewSession renews a session's lease
func (m *Manager) RenewSession(sessionID string, additionalMs *int64) (time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return time.Time{}, errors.New("session not found")
	}
	if session.State == SessionStateRevoked || session.State == SessionStateExpired {
		return time.Time{}, errors.New("session is revoked or expired")
	}

	leaseMs := m.defaultLeaseMs
	if additionalMs != nil && *additionalMs > 0 {
		leaseMs = time.Duration(*additionalMs) * time.Millisecond
	}

	now := time.Now()
	session.ExpiresAt = now.Add(leaseMs)
	session.LastBeat = now
	session.State = SessionStateActive

	return session.ExpiresAt, nil
}

// RevokeSession revokes a session immediately
func (m *Manager) RevokeSession(sessionID string, reason string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}

	session.State = SessionStateRevoked
	session.ChannelIDs = make(map[string]bool)
	return true
}

// UpdateHeartbeat updates the heartbeat timestamp for a session
func (m *Manager) UpdateHeartbeat(sessionID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok || session.State != SessionStateActive {
		return false
	}
	session.LastBeat = time.Now()
	return true
}

// GetExpiredSessions returns all expired sessions
func (m *Manager) GetExpiredSessions() []*Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	var expired []*Session
	now := time.Now()

	for _, session := range m.sessions {
		if session.State == SessionStateActive && now.After(session.ExpiresAt) {
			session.State = SessionStateExpired
			expired = append(expired, session)
		}
	}
	return expired
}

// CleanupExpired removes expired sessions
func (m *Manager) CleanupExpired() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	count := 0
	for id, session := range m.sessions {
		if session.State == SessionStateExpired || session.State == SessionStateRevoked {
			delete(m.sessions, id)
			count++
		}
	}
	return count
}

// GetTenantSessions returns all sessions for a tenant
func (m *Manager) GetTenantSessions(tenantID string) []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*Session
	for _, session := range m.sessions {
		if session.TenantID == tenantID {
			result = append(result, session)
		}
	}
	return result
}

// GetActiveCount returns the count of active sessions
func (m *Manager) GetActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for _, session := range m.sessions {
		if session.State == SessionStateActive || session.State == SessionStateRenewing || session.State == SessionStatePending {
			count++
		}
	}
	return count
}

// ValidateTenantBinding validates that a message belongs to the correct tenant
func (m *Manager) ValidateTenantBinding(sessionID, tenantID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}
	return session.TenantID == tenantID
}

// GetSessionExpiry returns the expiry time for a session
func (m *Manager) GetSessionExpiry(sessionID string) (time.Time, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return time.Time{}, errors.New("session not found")
	}
	return session.ExpiresAt, nil
}

// GetTimeUntilExpiry returns the time remaining until session expires
func (m *Manager) GetTimeUntilExpiry(sessionID string) (time.Duration, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return 0, errors.New("session not found")
	}
	remaining := session.ExpiresAt.Sub(time.Now())
	if remaining < 0 {
		return 0, nil
	}
	return remaining, nil
}
