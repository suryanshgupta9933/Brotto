package protocol

import (
	"sync"
)

// Tracker tracks sequence numbers for replay protection
type Tracker struct {
	sessions map[string]map[string]*SequenceState
	mu       sync.RWMutex
}

// NewTracker creates a new sequence tracker
func NewTracker() *Tracker {
	return &Tracker{
		sessions: make(map[string]map[string]*SequenceState),
	}
}

// getState gets or creates sequence state for a session/channel
func (t *Tracker) getState(sessionID, channelID string) *SequenceState {
	sessionMap, ok := t.sessions[sessionID]
	if !ok {
		sessionMap = make(map[string]*SequenceState)
		t.sessions[sessionID] = sessionMap
	}

	state, ok := sessionMap[channelID]
	if !ok {
		state = &SequenceState{
			LastSequenceNumber: -1,
			ReceivedSequences:  make(map[int64]bool),
			WindowStart:        0,
		}
		sessionMap[channelID] = state
	}
	return state
}

// ValidateAndProcess validates and processes a sequence number
// Returns true if valid, false if replay attack detected
func (t *Tracker) ValidateAndProcess(sessionID, channelID string, sequenceNumber int64) ValidationResult {
	t.mu.Lock()
	defer t.mu.Unlock()

	state := t.getState(sessionID, channelID)
	var errors []ValidationError

	// First message - accept any sequence number >= 0
	if state.LastSequenceNumber == -1 {
		state.LastSequenceNumber = sequenceNumber
		state.ReceivedSequences[sequenceNumber] = true
		state.WindowStart = sequenceNumber
		return ValidationResult{IsValid: true}
	}

	// Check for replay (duplicate within window)
	if state.ReceivedSequences[sequenceNumber] {
		errors = append(errors, ValidationError{
			Field:   "sequenceNumber",
			Message: "Duplicate sequence number detected - possible replay attack",
			Code:    ErrorSequenceNumberReplay,
		})
		return ValidationResult{IsValid: false, Errors: errors}
	}

	// Check if sequence number is within acceptable window
	windowEnd := state.LastSequenceNumber + MaxSequenceWindow
	windowStart := state.WindowStart

	if sequenceNumber < windowStart {
		errors = append(errors, ValidationError{
			Field:   "sequenceNumber",
			Message: "Sequence number is below window start - too old",
			Code:    ErrorSequenceNumberReplay,
		})
		return ValidationResult{IsValid: false, Errors: errors}
	}

	if sequenceNumber > windowEnd {
		errors = append(errors, ValidationError{
			Field:   "sequenceNumber",
			Message: "Sequence number exceeds window end - gap detected",
			Code:    ErrorSequenceNumberInvalid,
		})
		return ValidationResult{IsValid: false, Errors: errors}
	}

	// Accept the sequence number
	state.LastSequenceNumber = sequenceNumber
	state.ReceivedSequences[sequenceNumber] = true

	// Prune old sequences
	t.pruneWindowLocked(sessionID, channelID)

	return ValidationResult{IsValid: true}
}

// pruneWindow removes sequence numbers outside the sliding window
func (t *Tracker) pruneWindowLocked(sessionID, channelID string) {
	state := t.sessions[sessionID][channelID]
	if state == nil {
		return
	}

	newWindowStart := int64(0)
	if state.LastSequenceNumber > MaxSequenceWindow {
		newWindowStart = state.LastSequenceNumber - MaxSequenceWindow + 1
	}

	if newWindowStart > state.WindowStart {
		state.WindowStart = newWindowStart
		for seq := range state.ReceivedSequences {
			if seq < state.WindowStart {
				delete(state.ReceivedSequences, seq)
			}
		}
	}
}

// GetNextExpected returns the next expected sequence number
func (t *Tracker) GetNextExpected(sessionID, channelID string) int64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	state := t.getState(sessionID, channelID)
	return state.LastSequenceNumber + 1
}

// HasSeen checks if a sequence number has been seen
func (t *Tracker) HasSeen(sessionID, channelID string, sequenceNumber int64) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()

	state := t.sessions[sessionID]
	if state == nil {
		return false
	}
	s := state[channelID]
	if s == nil {
		return false
	}
	return s.ReceivedSequences[sequenceNumber]
}

// Reset resets sequence tracking for a session/channel
func (t *Tracker) Reset(sessionID, channelID string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if sessionMap, ok := t.sessions[sessionID]; ok {
		delete(sessionMap, channelID)
		if len(sessionMap) == 0 {
			delete(t.sessions, sessionID)
		}
	}
}

// ResetAll resets all sequence tracking
func (t *Tracker) ResetAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.sessions = make(map[string]map[string]*SequenceState)
}

// GetStats returns statistics for a session
func (t *Tracker) GetStats(sessionID string) (channelCount int, totalMessages int) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	sessionMap, ok := t.sessions[sessionID]
	if !ok {
		return 0, 0
	}

	channelCount = len(sessionMap)
	for _, state := range sessionMap {
		totalMessages += len(state.ReceivedSequences)
	}
	return
}
