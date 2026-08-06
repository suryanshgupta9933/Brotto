"""Tests for brotto_sdk.types"""
import pytest
from datetime import datetime
from brotto_sdk.types import (
    ActionType,
    Coordinates,
    TaskStatus,
    SessionState,
    Priority,
    ApprovalStatus,
    Task,
    Session,
    ApprovalRequest,
    CreateTaskInput,
    UpdateTaskInput,
    ApprovalDecision,
)


class TestActionType:
    """Tests for ActionType enum."""

    def test_all_action_types_exist(self):
        """Test that all expected action types are defined."""
        assert ActionType.LEFT_CLICK == "left_click"
        assert ActionType.DOUBLE_CLICK == "double_click"
        assert ActionType.RIGHT_CLICK == "right_click"
        assert ActionType.DRAG == "drag"
        assert ActionType.MOUSE_MOVE == "mouse_move"
        assert ActionType.SCROLL == "scroll"
        assert ActionType.KEY == "key"
        assert ActionType.VISIT_URL == "visit_url"
        assert ActionType.HISTORY_BACK == "history_back"
        assert ActionType.SCREENSHOT == "screenshot"
        assert ActionType.WAIT == "wait"
        assert ActionType.ASK_USER_QUESTION == "ask_user_question"
        assert ActionType.TERMINATE == "terminate"
        assert ActionType.PAUSE_AND_MEMORIZE_FACT == "pause_and_memorize_fact"


class TestCoordinates:
    """Tests for Coordinates model."""

    def test_create_coordinates(self):
        """Test creating coordinates."""
        coords = Coordinates(x=100.0, y=200.0)
        assert coords.x == 100.0
        assert coords.y == 200.0


class TestTaskStatus:
    """Tests for TaskStatus enum."""

    def test_all_task_statuses_exist(self):
        """Test that all expected task statuses are defined."""
        assert TaskStatus.CREATED == "created"
        assert TaskStatus.WAITING_FOR_CLIENT == "waiting_for_client"
        assert TaskStatus.CONNECTED == "connected"
        assert TaskStatus.OBSERVING == "observing"
        assert TaskStatus.PLANNING == "planning"
        assert TaskStatus.POLICY_CHECK == "policy_check"
        assert TaskStatus.WAITING_FOR_APPROVAL == "waiting_for_approval"
        assert TaskStatus.EXECUTING == "executing"
        assert TaskStatus.VERIFYING == "verifying"
        assert TaskStatus.COMPLETED == "completed"
        assert TaskStatus.FAILED == "failed"
        assert TaskStatus.CANCELLED == "cancelled"


class TestSessionState:
    """Tests for SessionState enum."""

    def test_all_session_states_exist(self):
        """Test that all expected session states are defined."""
        assert SessionState.CREATED == "created"
        assert SessionState.WAITING_FOR_CLIENT == "waiting_for_client"
        assert SessionState.CONNECTED == "connected"
        assert SessionState.OBSERVING == "observing"
        assert SessionState.PLANNING == "planning"
        assert SessionState.POLICY_CHECK == "policy_check"
        assert SessionState.WAITING_FOR_APPROVAL == "waiting_for_approval"
        assert SessionState.EXECUTING == "executing"
        assert SessionState.VERIFYING == "verifying"
        assert SessionState.COMPLETED == "completed"
        assert SessionState.FAILED == "failed"
        assert SessionState.CANCELLED == "cancelled"


class TestPriority:
    """Tests for Priority enum."""

    def test_all_priorities_exist(self):
        """Test that all expected priorities are defined."""
        assert Priority.LOW == "low"
        assert Priority.MEDIUM == "medium"
        assert Priority.HIGH == "high"


class TestApprovalStatus:
    """Tests for ApprovalStatus enum."""

    def test_all_approval_statuses_exist(self):
        """Test that all expected approval statuses are defined."""
        assert ApprovalStatus.PENDING == "pending"
        assert ApprovalStatus.APPROVED == "approved"
        assert ApprovalStatus.DENIED == "denied"
        assert ApprovalStatus.EXPIRED == "expired"


class TestTask:
    """Tests for Task model."""

    def test_create_task(self):
        """Test creating a task."""
        task = Task(
            id="task-123",
            userId="user-456",
            organizationId="org-789",
            goal="Test task",
            status=TaskStatus.CREATED,
            priority=Priority.MEDIUM,
            createdAt=datetime.now(),
            updatedAt=datetime.now(),
        )
        assert task.id == "task-123"
        assert task.goal == "Test task"
        assert task.status == TaskStatus.CREATED


class TestSession:
    """Tests for Session model."""

    def test_create_session(self):
        """Test creating a session."""
        session = Session(
            id="session-123",
            taskId="task-456",
            organizationId="org-789",
            state=SessionState.CREATED,
            startedAt=datetime.now(),
            lastHeartbeatAt=datetime.now(),
        )
        assert session.id == "session-123"
        assert session.taskId == "task-456"
        assert session.state == SessionState.CREATED


class TestApprovalRequest:
    """Tests for ApprovalRequest model."""

    def test_create_approval_request(self):
        """Test creating an approval request."""
        approval = ApprovalRequest(
            id="approval-123",
            sessionId="session-456",
            taskId="task-789",
            userId="user-000",
            actionType="visit_url",
            actionData={"url": "https://example.com"},
            status=ApprovalStatus.PENDING,
            createdAt=datetime.now(),
            expiresAt=datetime.now(),
        )
        assert approval.id == "approval-123"
        assert approval.actionType == "visit_url"
        assert approval.status == ApprovalStatus.PENDING


class TestCreateTaskInput:
    """Tests for CreateTaskInput model."""

    def test_create_task_input_defaults(self):
        """Test default values for CreateTaskInput."""
        task_input = CreateTaskInput(goal="Test goal")
        assert task_input.goal == "Test goal"
        assert task_input.priority == Priority.MEDIUM
        assert task_input.deviceId is None


class TestUpdateTaskInput:
    """Tests for UpdateTaskInput model."""

    def test_update_task_input_partial(self):
        """Test partial updates with UpdateTaskInput."""
        update = UpdateTaskInput(priority=Priority.HIGH)
        assert update.priority == Priority.HIGH
        assert update.goal is None
        assert update.status is None


class TestApprovalDecision:
    """Tests for ApprovalDecision model."""

    def test_approve_decision(self):
        """Test creating an approval decision."""
        decision = ApprovalDecision(decision="approved")
        assert decision.decision == "approved"
        assert decision.reason is None

    def test_deny_decision_with_reason(self):
        """Test creating a denial decision with reason."""
        decision = ApprovalDecision(decision="denied", reason="Not safe")
        assert decision.decision == "denied"
        assert decision.reason == "Not safe"
