package heartbeat

import (
	"testing"
	"time"
)

func TestManager_RecordSent(t *testing.T) {
	cfg := DefaultConfig()
	cfg.IntervalMs = 100 * time.Millisecond
	mgr := NewManager(cfg)

	mgr.RecordSent()
	state := mgr.GetState()

	if state.LastSent.IsZero() {
		t.Error("LastSent should not be zero after RecordSent")
	}
}

func TestManager_RecordReceived(t *testing.T) {
	cfg := DefaultConfig()
	mgr := NewManager(cfg)

	mgr.RecordReceived()
	state := mgr.GetState()

	if state.LastReceived.IsZero() {
		t.Error("LastReceived should not be zero after RecordReceived")
	}
	if state.MissedHeartbeats != 0 {
		t.Errorf("MissedHeartbeats = %d, want 0", state.MissedHeartbeats)
	}
}

func TestManager_IsStale(t *testing.T) {
	cfg := DefaultConfig()
	cfg.IntervalMs = 50 * time.Millisecond
	cfg.MaxMissedHeartbeats = 2
	mgr := NewManager(cfg)

	// Should not be stale immediately
	if mgr.IsStale() {
		t.Error("New connection should not be stale")
	}

	// Wait for heartbeat to be overdue
	time.Sleep(120 * time.Millisecond)

	// Should be stale
	if !mgr.IsStale() {
		t.Error("Connection should be stale after missed heartbeats")
	}
}

func TestDetermineStatus(t *testing.T) {
	now := time.Now()

	// Active if recent activity
	status := DetermineStatus(now.Add(-time.Second), 60*time.Second)
	if status != StatusActive {
		t.Errorf("Recent activity = %v, want StatusActive", status)
	}

	// Idle if old activity
	status = DetermineStatus(now.Add(-2*time.Minute), 60*time.Second)
	if status != StatusIdle {
		t.Errorf("Old activity = %v, want StatusIdle", status)
	}
}

func TestCreateHeartbeatPayload(t *testing.T) {
	payload := CreateHeartbeatPayload(42, StatusActive)

	if payload.SequenceNumber != 42 {
		t.Errorf("SequenceNumber = %d, want 42", payload.SequenceNumber)
	}
	if payload.Status != string(StatusActive) {
		t.Errorf("Status = %v, want %v", payload.Status, StatusActive)
	}
	if payload.Timestamp == 0 {
		t.Error("Timestamp should not be zero")
	}
}

func TestIsHeartbeatExpired(t *testing.T) {
	interval := 100 * time.Millisecond
	lastHeartbeat := time.Now()

	// Not expired
	if IsHeartbeatExpired(lastHeartbeat, interval, 3) {
		t.Error("Recent heartbeat should not be expired")
	}

	// Expired
	time.Sleep(350 * time.Millisecond)
	if !IsHeartbeatExpired(lastHeartbeat, interval, 3) {
		t.Error("Old heartbeat should be expired")
	}
}

func TestValidateHeartbeatPayload(t *testing.T) {
	validPayload := map[string]any{
		"timestamp":      time.Now().UnixMilli(),
		"sequenceNumber":  42,
		"status":          "active",
	}

	if !ValidateHeartbeatPayload(validPayload) {
		t.Error("Valid payload should pass validation")
	}

	// Missing timestamp
	invalidPayload := map[string]any{
		"sequenceNumber": 42,
		"status":         "active",
	}
	if ValidateHeartbeatPayload(invalidPayload) {
		t.Error("Invalid payload should fail validation")
	}

	// Invalid status
	invalidStatus := map[string]any{
		"timestamp":      time.Now().UnixMilli(),
		"sequenceNumber": 42,
		"status":         "invalid",
	}
	if ValidateHeartbeatPayload(invalidStatus) {
		t.Error("Invalid status should fail validation")
	}
}

func TestManager_TimeUntilNextHeartbeat(t *testing.T) {
	cfg := DefaultConfig()
	cfg.IntervalMs = 100 * time.Millisecond
	mgr := NewManager(cfg)

	mgr.RecordSent()

	remaining := mgr.TimeUntilNextHeartbeat()
	if remaining <= 0 {
		t.Error("TimeUntilNextHeartbeat should be positive after sent")
	}
	if remaining > 100*time.Millisecond {
		t.Errorf("TimeUntilNextHeartbeat = %v, want <= 100ms", remaining)
	}
}

func TestManager_Callbacks(t *testing.T) {
	missedCount := 0
	timeoutCalled := false

	cfg := DefaultConfig()
	cfg.IntervalMs = 10 * time.Millisecond
	cfg.MaxMissedHeartbeats = 2
	cfg.OnMissedHeartbeat = func(count int) {
		missedCount = count
	}
	cfg.OnTimeout = func() {
		timeoutCalled = true
	}

	mgr := NewManager(cfg)
	mgr.RecordSent()

	// Wait for missed heartbeats
	time.Sleep(50 * time.Millisecond)

	if missedCount == 0 {
		t.Error("OnMissedHeartbeat should have been called")
	}
}
