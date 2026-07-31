package ratelimit

import (
	"testing"
	"time"
)

func TestTokenBucket_Consume(t *testing.T) {
	tb := NewTokenBucket(Config{
		TokensPerSecond: 10,
		BurstSize:       5,
		WindowSizeMs:    1000,
	})

	// Should be able to consume burst
	for i := 0; i < 5; i++ {
		result := tb.Check("key1")
		if !result.IsValid {
			t.Errorf("Check %d should succeed, got error: %v", i, result.Errors)
		}
	}

	// 6th should fail (burst exhausted)
	result := tb.Check("key1")
	if result.IsValid {
		t.Error("Check after burst exhaustion should fail")
	}
}

func TestTokenBucket_Refill(t *testing.T) {
	tb := NewTokenBucket(Config{
		TokensPerSecond: 1000,
		BurstSize:       5,
		WindowSizeMs:    50, // 50ms window
	})

	// Exhaust burst
	for i := 0; i < 5; i++ {
		tb.Check("key1")
	}

	// Should be exhausted
	if tb.GetAvailable("key1") > 0 {
		t.Error("Token bucket should be exhausted after burst")
	}

	// Wait for refill
	time.Sleep(60 * time.Millisecond)

	// Should have refilled
	available := tb.GetAvailable("key1")
	if available <= 0 {
		t.Error("Token bucket should have refilled after window")
	}
}

func TestTokenBucket_DifferentKeys(t *testing.T) {
	tb := NewTokenBucket(Config{
		TokensPerSecond: 10,
		BurstSize:       2,
		WindowSizeMs:    1000,
	})

	// Exhaust key1
	tb.Check("key1")
	tb.Check("key1")

	// key2 should still have tokens
	result := tb.Check("key2")
	if !result.IsValid {
		t.Error("key2 should still have tokens")
	}
}

func TestSessionLimiter_CheckSessionChannel(t *testing.T) {
	sl := NewSessionLimiter(Config{
		TokensPerSecond: 10,
		BurstSize:       2,
		WindowSizeMs:    1000,
	})

	// Exhaust
	sl.CheckSessionChannel("session1", "channel1")
	sl.CheckSessionChannel("session1", "channel1")

	// Should fail
	result := sl.CheckSessionChannel("session1", "channel1")
	if result.IsValid {
		t.Error("Should fail after burst exhaustion")
	}

	// Different channel should work
	result = sl.CheckSessionChannel("session1", "channel2")
	if !result.IsValid {
		t.Error("Different channel should have its own limit")
	}
}

func TestSessionLimiter_ResetSession(t *testing.T) {
	sl := NewSessionLimiter(Config{
		TokensPerSecond: 10,
		BurstSize:       2,
		WindowSizeMs:    1000,
	})

	// Exhaust
	sl.CheckSessionChannel("session1", "channel1")
	sl.CheckSessionChannel("session1", "channel1")

	// Reset session
	sl.ResetSession("session1")

	// Should work again
	result := sl.CheckSessionChannel("session1", "channel1")
	if !result.IsValid {
		t.Error("Should work after reset")
	}
}

func TestCalculateRateLimit(t *testing.T) {
	cfg := CalculateRateLimit(1024, 1024*1024) // 1KB messages, 1MB/s bandwidth

	if cfg.TokensPerSecond < 1 {
		t.Error("TokensPerSecond should be at least 1")
	}
	if cfg.BurstSize < 1 {
		t.Error("BurstSize should be at least 1")
	}
}

func TestTokenBucket_UpdateConfig(t *testing.T) {
	tb := NewTokenBucket(Config{
		TokensPerSecond: 10,
		BurstSize:       5,
		WindowSizeMs:    1000,
	})

	// Get initial config
	cfg := tb.GetConfig()
	if cfg.TokensPerSecond != 10 {
		t.Errorf("Initial TPS = %v, want 10", cfg.TokensPerSecond)
	}

	// Update config
	tb.UpdateConfig(Config{
		TokensPerSecond: 100,
		BurstSize:       50,
		WindowSizeMs:    500,
	})

	cfg = tb.GetConfig()
	if cfg.TokensPerSecond != 100 {
		t.Errorf("Updated TPS = %v, want 100", cfg.TokensPerSecond)
	}
	if cfg.BurstSize != 50 {
		t.Errorf("Updated BurstSize = %v, want 50", cfg.BurstSize)
	}
}

func TestTokenBucket_ResetAll(t *testing.T) {
	tb := NewTokenBucket(Config{
		TokensPerSecond: 10,
		BurstSize:       2,
		WindowSizeMs:    1000,
	})

	// Exhaust multiple keys
	tb.Check("key1")
	tb.Check("key1")
	tb.Check("key2")
	tb.Check("key2")

	// Reset all
	tb.ResetAll()

	// Both should work again
	if !tb.Check("key1").IsValid {
		t.Error("key1 should work after ResetAll")
	}
	if !tb.Check("key2").IsValid {
		t.Error("key2 should work after ResetAll")
	}
}
