"""
Python types for the Brotto Platform SDK
"""
from enum import Enum
from typing import Any, Generic, List, Literal, Optional, TypeVar, Dict
from datetime import datetime
from pydantic import BaseModel, Field


class ActionType(str, Enum):
    """Enum of all Brotto action types."""
    LEFT_CLICK = "left_click"
    DOUBLE_CLICK = "double_click"
    RIGHT_CLICK = "right_click"
    DRAG = "drag"
    MOUSE_MOVE = "mouse_move"
    SCROLL = "scroll"
    KEY = "key"
    VISIT_URL = "visit_url"
    HISTORY_BACK = "history_back"
    SCREENSHOT = "screenshot"
    WAIT = "wait"
    ASK_USER_QUESTION = "ask_user_question"
    TERMINATE = "terminate"
    PAUSE_AND_MEMORIZE_FACT = "pause_and_memorize_fact"


class Coordinates(BaseModel):
    """Viewport coordinates."""
    x: float
    y: float


class DragCoordinates(BaseModel):
    """Drag start and end coordinates."""
    start: Coordinates
    end: Coordinates


class ScrollDelta(BaseModel):
    """Scroll delta values."""
    deltaX: float
    deltaY: float


class ViewportContext(BaseModel):
    """Viewport context for actions."""
    viewportWidth: int
    viewportHeight: int


class KeyModifiers(BaseModel):
    """Keyboard modifiers."""
    ctrl: Optional[bool] = None
    shift: Optional[bool] = None
    alt: Optional[bool] = None
    meta: Optional[bool] = None


class BaseAction(BaseModel):
    """Base interface for all Brotto actions."""
    id: str
    type: ActionType
    observation_id: str
    timestamp: int


class LeftClickAction(BaseAction):
    """Left click action."""
    coordinates: Coordinates
    viewport: ViewportContext


class DoubleClickAction(BaseAction):
    """Double click action."""
    coordinates: Coordinates
    viewport: ViewportContext


class RightClickAction(BaseAction):
    """Right click action."""
    coordinates: Coordinates
    viewport: ViewportContext


class DragAction(BaseAction):
    """Drag action."""
    coordinates: DragCoordinates
    viewport: ViewportContext


class MouseMoveAction(BaseAction):
    """Mouse move action."""
    coordinates: Coordinates
    viewport: ViewportContext


class ScrollAction(BaseAction):
    """Scroll action."""
    coordinates: Coordinates
    delta: ScrollDelta
    viewport: ViewportContext


class KeyAction(BaseAction):
    """Key action."""
    key: str
    modifiers: Optional[KeyModifiers] = None


class VisitUrlAction(BaseAction):
    """Visit URL action."""
    url: str
    timeout: Optional[int] = None


class HistoryBackAction(BaseAction):
    """History back action."""
    steps: Optional[int] = None


class ScreenshotAction(BaseAction):
    """Screenshot action."""
    fullPage: Optional[bool] = None


class WaitAction(BaseAction):
    """Wait action."""
    duration: int


class AskUserQuestionAction(BaseAction):
    """Ask user question action."""
    question: str
    context: Optional[str] = None
    choices: Optional[List[str]] = None


class TerminateAction(BaseAction):
    """Terminate action."""
    reason: Optional[str] = None


class PauseAndMemorizeFactAction(BaseAction):
    """Pause and memorize fact action."""
    fact: str
    category: Optional[str] = None


# API Types

class TaskStatus(str, Enum):
    """Task status values."""
    CREATED = "created"
    WAITING_FOR_CLIENT = "waiting_for_client"
    CONNECTED = "connected"
    OBSERVING = "observing"
    PLANNING = "planning"
    POLICY_CHECK = "policy_check"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SessionState(str, Enum):
    """Session state values."""
    CREATED = "created"
    WAITING_FOR_CLIENT = "waiting_for_client"
    CONNECTED = "connected"
    OBSERVING = "observing"
    PLANNING = "planning"
    POLICY_CHECK = "policy_check"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Priority(str, Enum):
    """Priority values."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ApprovalStatus(str, Enum):
    """Approval status values."""
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"


class Task(BaseModel):
    """Task representation."""
    id: str
    userId: str
    organizationId: str
    deviceId: Optional[str] = None
    goal: str
    status: TaskStatus
    priority: Priority
    createdAt: datetime
    updatedAt: datetime
    completedAt: Optional[datetime] = None
    sessionId: Optional[str] = None


class Session(BaseModel):
    """Session representation."""
    id: str
    taskId: str
    deviceId: Optional[str] = None
    organizationId: str
    state: SessionState
    currentUrl: Optional[str] = None
    currentDomain: Optional[str] = None
    startedAt: datetime
    lastHeartbeatAt: datetime
    terminatedAt: Optional[datetime] = None
    terminationReason: Optional[str] = None


class ApprovalRequest(BaseModel):
    """Approval request representation."""
    id: str
    sessionId: str
    taskId: str
    userId: str
    actionType: str
    actionData: Dict[str, Any]
    status: ApprovalStatus
    screenshotUrl: Optional[str] = None
    createdAt: datetime
    expiresAt: datetime
    decidedAt: Optional[datetime] = None


T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Paginated response wrapper."""
    data: List[T]
    total: int
    page: int
    limit: int
    totalPages: int


class CreateTaskInput(BaseModel):
    """Input for creating a task."""
    goal: str
    deviceId: Optional[str] = None
    priority: Priority = Priority.MEDIUM


class UpdateTaskInput(BaseModel):
    """Input for updating a task."""
    goal: Optional[str] = None
    priority: Optional[Priority] = None
    status: Optional[TaskStatus] = None


class CreateSessionInput(BaseModel):
    """Input for creating a session."""
    taskId: str


class ApprovalDecision(BaseModel):
    """Approval decision input."""
    decision: Literal["approved", "denied"]
    reason: Optional[str] = None


# WebSocket Event Types

class SessionEventType(str, Enum):
    """Session event types."""
    SESSION_STARTED = "session_started"
    SESSION_TERMINATED = "session_terminated"
    STATE_CHANGED = "state_changed"
    ACTION_REQUESTED = "action_requested"
    ACTION_EXECUTED = "action_executed"
    APPROVAL_REQUIRED = "approval_required"
    APPROVAL_DECIDED = "approval_decided"
    ERROR = "error"
    HEARTBEAT = "heartbeat"


class SessionEvent(BaseModel):
    """Session event wrapper."""
    type: SessionEventType
    payload: Any
    timestamp: int


class StateChangedEvent(BaseModel):
    """State changed event payload."""
    sessionId: str
    previousState: SessionState
    newState: SessionState


class ActionRequestedEvent(BaseModel):
    """Action requested event payload."""
    sessionId: str
    action: Dict[str, Any]


class ActionExecutedEvent(BaseModel):
    """Action executed event payload."""
    sessionId: str
    actionId: str
    success: bool
    error: Optional[str] = None


class ApprovalRequiredEvent(BaseModel):
    """Approval required event payload."""
    approvalRequest: ApprovalRequest


class ApprovalDecidedEvent(BaseModel):
    """Approval decided event payload."""
    approvalId: str
    sessionId: str
    decision: Literal["approved", "denied"]
    decidedBy: str


class SessionErrorEvent(BaseModel):
    """Session error event payload."""
    sessionId: str
    error: str


class HeartbeatEvent(BaseModel):
    """Heartbeat event payload."""
    sessionId: str
    leaseExpiresAt: int
