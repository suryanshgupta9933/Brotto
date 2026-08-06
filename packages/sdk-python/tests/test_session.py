"""Tests for brotto_sdk.session"""
import pytest
from datetime import datetime, timedelta
from brotto_sdk.session import (
    is_terminal_state,
    is_active_state,
    is_waiting_state,
    get_state_description,
    calculate_session_metrics,
    SessionReplay,
    is_approval_pending,
    format_approval_summary,
    SESSION_STATE_DESCRIPTIONS,
)
from brotto_sdk.types import SessionState, ApprovalStatus, SessionEvent


class TestSessionStateHelpers:
    """Tests for session state helper functions."""

    def test_is_terminal_state(self):
        """Test terminal state detection."""
        assert is_terminal_state(SessionState.COMPLETED) is True
        assert is_terminal_state(SessionState.FAILED) is True
        assert is_terminal_state(SessionState.CANCELLED) is True
        assert is_terminal_state(SessionState.CREATED) is False
        assert is_terminal_state(SessionState.EXECUTING) is False

    def test_is_active_state(self):
        """Test active state detection."""
        assert is_active_state(SessionState.CONNECTED) is True
        assert is_active_state(SessionState.OBSERVING) is True
        assert is_active_state(SessionState.PLANNING) is True
        assert is_active_state(SessionState.EXECUTING) is True
        assert is_active_state(SessionState.VERIFYING) is True
        assert is_active_state(SessionState.CREATED) is False
        assert is_active_state(SessionState.COMPLETED) is False

    def test_is_waiting_state(self):
        """Test waiting state detection."""
        assert is_waiting_state(SessionState.WAITING_FOR_APPROVAL) is True
        assert is_waiting_state(SessionState.WAITING_FOR_CLIENT) is True
        assert is_waiting_state(SessionState.EXECUTING) is False
        assert is_waiting_state(SessionState.PLANNING) is False

    def test_get_state_description(self):
        """Test state description retrieval."""
        assert "created" in get_state_description(SessionState.CREATED).lower()
        assert "completed" in get_state_description(SessionState.COMPLETED).lower()

    def test_session_state_descriptions_complete(self):
        """Test that all states have descriptions."""
        for state in SessionState:
            assert state in SESSION_STATE_DESCRIPTIONS
            assert len(SESSION_STATE_DESCRIPTIONS[state]) > 0


class TestCalculateSessionMetrics:
    """Tests for calculate_session_metrics."""

    def test_calculate_metrics_from_events(self):
        """Test metrics calculation from events."""
        session_id = "test-session"
        started_at = datetime.now()

        events = [
            SessionEvent(
                type="action_executed",
                payload={"actionId": "1", "success": True},
                timestamp=1000,
            ),
            SessionEvent(
                type="action_executed",
                payload={"actionId": "2", "success": True},
                timestamp=2000,
            ),
            SessionEvent(
                type="approval_required",
                payload={"approvalRequest": {}},
                timestamp=3000,
            ),
            SessionEvent(
                type="approval_decided",
                payload={"decision": "denied", "decidedBy": "user-1"},
                timestamp=4000,
            ),
        ]

        metrics = calculate_session_metrics(session_id, started_at, events)

        assert metrics.session_id == session_id
        assert metrics.started_at == started_at
        assert metrics.action_count == 2
        assert metrics.approval_count == 1
        assert metrics.denied_approval_count == 1


class TestSessionReplay:
    """Tests for SessionReplay class."""

    def test_replay_events_in_order(self):
        """Test that events are replayed in order."""
        events = [
            SessionEvent(type="action_executed", payload={"actionId": "1"}, timestamp=1),
            SessionEvent(type="action_executed", payload={"actionId": "2"}, timestamp=2),
            SessionEvent(type="state_changed", payload={"newState": "executing"}, timestamp=3),
        ]

        replay = SessionReplay(events)

        assert replay.has_next() is True
        assert replay.next() == events[0]
        assert replay.next() == events[1]
        assert replay.next() == events[2]
        assert replay.has_next() is False

    def test_peek_without_advancing(self):
        """Test peeking without advancing position."""
        events = [
            SessionEvent(type="action_executed", payload={}, timestamp=1),
        ]

        replay = SessionReplay(events)

        assert replay.peek() == events[0]
        assert replay.peek() == events[0]  # Still at same position

    def test_reset(self):
        """Test resetting to beginning."""
        events = [
            SessionEvent(type="action_executed", payload={}, timestamp=1),
        ]

        replay = SessionReplay(events)
        replay.next()
        assert replay.has_next() is False

        replay.reset()
        assert replay.has_next() is True

    def test_get_events_by_type(self):
        """Test filtering events by type."""
        events = [
            SessionEvent(type="action_executed", payload={}, timestamp=1),
            SessionEvent(type="state_changed", payload={}, timestamp=2),
            SessionEvent(type="action_executed", payload={}, timestamp=3),
        ]

        replay = SessionReplay(events)
        action_events = replay.get_events_by_type("action_executed")

        assert len(action_events) == 2

    def test_add_event(self):
        """Test adding events to replay."""
        replay = SessionReplay()
        assert replay.has_next() is False

        replay.add_event(SessionEvent(type="action_executed", payload={}, timestamp=1))
        assert replay.has_next() is True


class TestApprovalHelpers:
    """Tests for approval helper functions."""

    def test_is_approval_pending(self):
        """Test approval pending detection."""
        from unittest.mock import Mock
        mock_approval = Mock()
        mock_approval.status = ApprovalStatus.PENDING
        mock_approval.expiresAt = datetime.now() + timedelta(hours=1)

        assert is_approval_pending(mock_approval) is True

    def test_is_approval_pending_expired(self):
        """Test approval pending detection for expired."""
        from unittest.mock import Mock
        mock_approval = Mock()
        mock_approval.status = ApprovalStatus.PENDING
        mock_approval.expiresAt = datetime.now() - timedelta(hours=1)

        # is_approval_pending checks status != PENDING first, so this returns False
        assert is_approval_pending(mock_approval) is False

    def test_format_approval_summary(self):
        """Test approval summary formatting."""
        from unittest.mock import Mock
        mock_approval = Mock()
        mock_approval.id = "approval-123"
        mock_approval.actionType = "visit_url"
        mock_approval.status = ApprovalStatus.PENDING
        mock_approval.createdAt = datetime(2024, 1, 1, 0, 0, 0)
        mock_approval.expiresAt = datetime(2024, 1, 1, 0, 5, 0)
        mock_approval.screenshotUrl = None

        summary = format_approval_summary(mock_approval)

        assert "approval-123" in summary
        assert "pending" in summary
        assert "visit_url" in summary
