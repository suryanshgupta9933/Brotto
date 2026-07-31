package session

import (
	"testing"
	"time"
)

func TestSessionManager_CreateSession(t *testing.T) {
	mgr := NewManager(time.Minute)

	leaseMs := int64(60000)
	sess, err := mgr.CreateSession("tenant-1", "device-1", &leaseMs, map[string]string{"key": "value"})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	if sess.ID == "" {
		t.Error("Session ID should not be empty")
	}
	if sess.TenantID != "tenant-1" {
		t.Errorf("TenantID = %v, want tenant-1", sess.TenantID)
	}
	if sess.DeviceID != "device-1" {
		t.Errorf("DeviceID = %v, want device-1", sess.DeviceID)
	}
	if sess.State != SessionStatePending {
		t.Errorf("State = %v, want SessionStatePending", sess.State)
	}
	if sess.SessionKey == "" {
		t.Error("SessionKey should not be empty")
	}
}

func TestSessionManager_ActivateSession(t *testing.T) {
	mgr := NewManager(time.Minute)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)

	// Cannot activate twice
	if ok := mgr.ActivateSession(sess.ID); !ok {
		t.Error("First activation should succeed")
	}

	if ok := mgr.ActivateSession(sess.ID); ok {
		t.Error("Second activation should fail")
	}

	// Cannot activate non-existent session
	if ok := mgr.ActivateSession("nonexistent"); ok {
		t.Error("Activation of nonexistent session should fail")
	}
}

func TestSessionManager_IsSessionValid(t *testing.T) {
	mgr := NewManager(time.Minute)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)

	// Pending session is not valid
	if mgr.IsSessionValid(sess.ID) {
		t.Error("Pending session should not be valid")
	}

	mgr.ActivateSession(sess.ID)

	// Active session is valid
	if !mgr.IsSessionValid(sess.ID) {
		t.Error("Active session should be valid")
	}
}

func TestSessionManager_AddChannel(t *testing.T) {
	mgr := NewManager(time.Minute)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)
	mgr.ActivateSession(sess.ID)

	ok := mgr.AddChannel(sess.ID, "channel-1")
	if !ok {
		t.Error("AddChannel should succeed for active session")
	}

	// Check channel exists
	if !mgr.HasChannel(sess.ID, "channel-1") {
		t.Error("Channel should exist after AddChannel")
	}

	// Cannot add channel to revoked session
	mgr.RevokeSession(sess.ID, "test")
	if ok := mgr.AddChannel(sess.ID, "channel-2"); ok {
		t.Error("AddChannel should fail for revoked session")
	}
}

func TestSessionManager_RenewSession(t *testing.T) {
	mgr := NewManager(100 * time.Millisecond)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)
	mgr.ActivateSession(sess.ID)

	originalExpiry := sess.ExpiresAt

	// Wait a bit
	time.Sleep(10 * time.Millisecond)

	newExpiry, err := mgr.RenewSession(sess.ID, nil)
	if err != nil {
		t.Fatalf("RenewSession failed: %v", err)
	}

	if !newExpiry.After(originalExpiry) {
		t.Error("New expiry should be after original expiry")
	}
}

func TestSessionManager_RevokeSession(t *testing.T) {
	mgr := NewManager(time.Minute)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)
	mgr.ActivateSession(sess.ID)
	mgr.AddChannel(sess.ID, "channel-1")

	ok := mgr.RevokeSession(sess.ID, "test")
	if !ok {
		t.Error("RevokeSession should succeed")
	}

	// Session should no longer be valid
	if mgr.IsSessionValid(sess.ID) {
		t.Error("Revoked session should not be valid")
	}

	// Session should no longer have channels
	if mgr.HasChannel(sess.ID, "channel-1") {
		t.Error("Channel should be removed after revocation")
	}
}

func TestSessionManager_GetExpiredSessions(t *testing.T) {
	mgr := NewManager(50 * time.Millisecond)

	sess1, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)
	mgr.ActivateSession(sess1.ID)

	sess2, _ := mgr.CreateSession("tenant-2", "device-2", nil, nil)
	mgr.ActivateSession(sess2.ID)

	// Wait for expiration
	time.Sleep(60 * time.Millisecond)

	expired := mgr.GetExpiredSessions()
	if len(expired) != 2 {
		t.Errorf("Expected 2 expired sessions, got %d", len(expired))
	}
}

func TestSessionManager_GetTenantSessions(t *testing.T) {
	mgr := NewManager(time.Minute)

	sess1, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)
	sess2, _ := mgr.CreateSession("tenant-2", "device-2", nil, nil)
	sess3, _ := mgr.CreateSession("tenant-1", "device-3", nil, nil)

	sessions := mgr.GetTenantSessions("tenant-1")
	if len(sessions) != 2 {
		t.Errorf("Expected 2 sessions for tenant-1, got %d", len(sessions))
	}

	for _, s := range sessions {
		if s.TenantID != "tenant-1" {
			t.Errorf("Expected tenant-1, got %s", s.TenantID)
		}
	}
}

func TestSessionManager_GetActiveCount(t *testing.T) {
	mgr := NewManager(time.Minute)

	if count := mgr.GetActiveCount(); count != 0 {
		t.Errorf("Expected 0 active sessions, got %d", count)
	}

	sess1, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)
	mgr.ActivateSession(sess1.ID)

	if count := mgr.GetActiveCount(); count != 1 {
		t.Errorf("Expected 1 active session, got %d", count)
	}

	sess2, _ := mgr.CreateSession("tenant-2", "device-2", nil, nil)
	mgr.ActivateSession(sess2.ID)

	if count := mgr.GetActiveCount(); count != 2 {
		t.Errorf("Expected 2 active sessions, got %d", count)
	}
}

func TestSessionManager_ValidateTenantBinding(t *testing.T) {
	mgr := NewManager(time.Minute)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)

	// Valid binding
	if !mgr.ValidateTenantBinding(sess.ID, "tenant-1") {
		t.Error("Valid tenant binding should pass")
	}

	// Invalid binding
	if mgr.ValidateTenantBinding(sess.ID, "tenant-2") {
		t.Error("Invalid tenant binding should fail")
	}
}

func TestSessionManager_GetTimeUntilExpiry(t *testing.T) {
	mgr := NewManager(100 * time.Millisecond)

	sess, _ := mgr.CreateSession("tenant-1", "device-1", nil, nil)

	remaining, err := mgr.GetTimeUntilExpiry(sess.ID)
	if err != nil {
		t.Fatalf("GetTimeUntilExpiry failed: %v", err)
	}

	if remaining < 90*time.Millisecond || remaining > 100*time.Millisecond {
		t.Errorf("Expected ~100ms remaining, got %v", remaining)
	}

	// Wait for expiration
	time.Sleep(110 * time.Millisecond)

	remaining, _ = mgr.GetTimeUntilExpiry(sess.ID)
	if remaining != 0 {
		t.Errorf("Expected 0 remaining after expiry, got %v", remaining)
	}
}
