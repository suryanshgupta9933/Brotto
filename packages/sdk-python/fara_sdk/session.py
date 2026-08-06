"""
Session management helpers for the Brotto Platform SDK
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from .types import (
    Session,
    SessionState,
    SessionEvent,
    ApprovalRequest,
    ApprovalDecision,
    ApprovalStatus,
)


# Terminal states - no further transitions possible
TERMINAL_STATES = {SessionState.COMPLETED, SessionState.FAILED, SessionState.CANCELLED}

# Active states - session is actively working
ACTIVE_STATES = {
    SessionState.CONNECTED,
    SessionState.OBSERVING,
    SessionState.PLANNING,
    SessionState.POLICY_CHECK,
    SessionState.EXECUTING,
    SessionState.VERIFYING,
}

# Waiting states - session is waiting for user input
WAITING_STATES = {SessionState.WAITING_FOR_APPROVAL, SessionState.WAITING_FOR_CLIENT}

# Human-readable descriptions of session states
SESSION_STATE_DESCRIPTIONS = {
    SessionState.CREATED: "Session has been created but not yet started",
    SessionState.WAITING_FOR_CLIENT: "Waiting for client device to connect",
    SessionState.CONNECTED: "Client device connected",
    SessionState.OBSERVING: "Browser agent is observing the page",
    SessionState.PLANNING: "Agent is planning next action",
    SessionState.POLICY_CHECK: "Action is being checked against policies",
    SessionState.WAITING_FOR_APPROVAL: "Waiting for user approval to proceed",
    SessionState.EXECUTING: "Action is being executed",
    SessionState.VERIFYING: "Verifying action result",
    SessionState.COMPLETED: "Session completed successfully",
    SessionState.FAILED: "Session failed",
    SessionState.CANCELLED: "Session was cancelled",
}


def is_terminal_state(state: SessionState) -> bool:
    """Check if a session state is terminal."""
    return state in TERMINAL_STATES


def is_active_state(state: SessionState) -> bool:
    """Check if a session state indicates the session is active."""
    return state in ACTIVE_STATES


def is_waiting_state(state: SessionState) -> bool:
    """Check if a session state indicates it's waiting for user input."""
    return state in WAITING_STATES


def get_state_description(state: SessionState) -> str:
    """Get a human-readable description of a session state."""
    return SESSION_STATE_DESCRIPTIONS.get(state, "Unknown state")


@dataclass
class SessionLease:
    """Session lease information."""
    session_id: str
    expires_at: datetime
    device_id: Optional[str] = None


@dataclass
class SessionMetrics:
    """Session metrics calculated from events."""
    session_id: str
    started_at: datetime
    last_heartbeat_at: datetime
    state: SessionState
    action_count: int
    approval_count: int
    denied_approval_count: int


def calculate_session_metrics(
    session_id: str,
    started_at: datetime,
    events: list[SessionEvent],
) -> SessionMetrics:
    """Calculate session metrics from events."""
    action_count = 0
    approval_count = 0
    denied_approval_count = 0
    last_heartbeat_at = started_at
    current_state: SessionState = SessionState.CREATED

    for event in events:
        if event.type == "action_executed":
            action_count += 1
        elif event.type == "approval_required":
            approval_count += 1
        elif event.type == "approval_decided":
            if event.payload.get("decision") == "denied":
                denied_approval_count += 1
        elif event.type == "state_changed":
            if new_state := event.payload.get("newState"):
                current_state = SessionState(new_state)
        elif event.type == "heartbeat":
            last_heartbeat_at = datetime.fromtimestamp(event.timestamp / 1000)

    return SessionMetrics(
        session_id=session_id,
        started_at=started_at,
        last_heartbeat_at=last_heartbeat_at,
        state=current_state,
        action_count=action_count,
        approval_count=approval_count,
        denied_approval_count=denied_approval_count,
    )


def filter_events_by_type(
    events: list[SessionEvent], types: set[str]
) -> list[SessionEvent]:
    """Filter events by type."""
    return [e for e in events if e.type in types]


def filter_events_since(events: list[SessionEvent], timestamp: float) -> list[SessionEvent]:
    """Filter events since a timestamp."""
    return [e for e in events if e.timestamp >= timestamp]


def filter_events_until(events: list[SessionEvent], timestamp: float) -> list[SessionEvent]:
    """Filter events until a timestamp."""
    return [e for e in events if e.timestamp <= timestamp]


class SessionReplay:
    """Session replay - replay events to reconstruct session history."""

    def __init__(self, events: Optional[list[SessionEvent]] = None):
        self.events = events or []
        self._current_index = 0

    def add_event(self, event: SessionEvent) -> None:
        """Add an event to the replay."""
        self.events.append(event)

    def get_events(self) -> list[SessionEvent]:
        """Get all events."""
        return list(self.events)

    def get_remaining_events(self) -> list[SessionEvent]:
        """Get events from current position."""
        return self.events[self._current_index :]

    def next(self) -> Optional[SessionEvent]:
        """Advance to next event."""
        if self._current_index >= len(self.events):
            return None
        event = self.events[self._current_index]
        self._current_index += 1
        return event

    def peek(self) -> Optional[SessionEvent]:
        """Peek at next event without advancing."""
        if self._current_index >= len(self.events):
            return None
        return self.events[self._current_index]

    def has_next(self) -> bool:
        """Check if there are more events."""
        return self._current_index < len(self.events)

    def reset(self) -> None:
        """Reset to beginning."""
        self._current_index = 0

    def get_events_by_type(self, event_type: str) -> list[SessionEvent]:
        """Get events by type."""
        return [e for e in self.events if e.type == event_type]


def is_approval_pending(approval: ApprovalRequest) -> bool:
    """Check if an approval request is still pending."""
    if approval.status != ApprovalStatus.PENDING:
        return False
    return approval.expiresAt > datetime.now()


def is_approval_expired(approval: ApprovalRequest) -> bool:
    """Check if an approval request has expired."""
    return approval.status == ApprovalStatus.EXPIRED or approval.expiresAt <= datetime.now()


def format_approval_summary(approval: ApprovalRequest) -> str:
    """Format approval request for display."""
    lines = [
        f"Approval Request: {approval.id}",
        f"Status: {approval.status}",
        f"Action Type: {approval.actionType}",
        f"Created: {approval.createdAt.isoformat()}",
        f"Expires: {approval.expiresAt.isoformat()}",
    ]

    if approval.screenshotUrl:
        lines.append(f"Screenshot: {approval.screenshotUrl}")

    return "\n".join(lines)


def build_approval_decision(
    approval_id: str, approve: bool, reason: Optional[str] = None
) -> ApprovalDecision:
    """Build approval decision options."""
    return ApprovalDecision(
        decision="approved" if approve else "denied",
        reason=reason,
    )
