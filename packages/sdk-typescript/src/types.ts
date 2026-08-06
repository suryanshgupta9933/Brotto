/**
 * TypeScript types for the Brotto Platform SDK
 */

// Re-export action types from brotto-action-schema
// These are the canonical action types for browser automation

export enum ActionType {
  LEFT_CLICK = 'left_click',
  DOUBLE_CLICK = 'double_click',
  RIGHT_CLICK = 'right_click',
  DRAG = 'drag',
  MOUSE_MOVE = 'mouse_move',
  SCROLL = 'scroll',
  KEY = 'key',
  VISIT_URL = 'visit_url',
  HISTORY_BACK = 'history_back',
  SCREENSHOT = 'screenshot',
  WAIT = 'wait',
  ASK_USER_QUESTION = 'ask_user_question',
  TERMINATE = 'terminate',
  PAUSE_AND_MEMORIZE_FACT = 'pause_and_memorize_fact',
}

export interface Coordinates {
  x: number;
  y: number;
}

export interface DragCoordinates {
  start: Coordinates;
  end: Coordinates;
}

export interface ScrollDelta {
  deltaX: number;
  deltaY: number;
}

export interface ViewportContext {
  viewportWidth: number;
  viewportHeight: number;
}

export interface BaseAction<T extends ActionType> {
  readonly id: string;
  readonly type: T;
  readonly observationId: string;
  readonly timestamp: number;
}

export interface LeftClickAction extends BaseAction<ActionType.LEFT_CLICK> {
  coordinates: Coordinates;
  viewport: ViewportContext;
}

export interface DoubleClickAction extends BaseAction<ActionType.DOUBLE_CLICK> {
  coordinates: Coordinates;
  viewport: ViewportContext;
}

export interface RightClickAction extends BaseAction<ActionType.RIGHT_CLICK> {
  coordinates: Coordinates;
  viewport: ViewportContext;
}

export interface DragAction extends BaseAction<ActionType.DRAG> {
  coordinates: DragCoordinates;
  viewport: ViewportContext;
}

export interface MouseMoveAction extends BaseAction<ActionType.MOUSE_MOVE> {
  coordinates: Coordinates;
  viewport: ViewportContext;
}

export interface ScrollAction extends BaseAction<ActionType.SCROLL> {
  coordinates: Coordinates;
  delta: ScrollDelta;
  viewport: ViewportContext;
}

export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface KeyAction extends BaseAction<ActionType.KEY> {
  key: string;
  modifiers?: KeyModifiers;
}

export interface VisitUrlAction extends BaseAction<ActionType.VISIT_URL> {
  url: string;
  timeout?: number;
}

export interface HistoryBackAction extends BaseAction<ActionType.HISTORY_BACK> {
  steps?: number;
}

export interface ScreenshotAction extends BaseAction<ActionType.SCREENSHOT> {
  fullPage?: boolean;
}

export interface WaitAction extends BaseAction<ActionType.WAIT> {
  duration: number;
}

export interface AskUserQuestionAction extends BaseAction<ActionType.ASK_USER_QUESTION> {
  question: string;
  context?: string;
  choices?: string[];
}

export interface TerminateAction extends BaseAction<ActionType.TERMINATE> {
  reason?: string;
}

export interface PauseAndMemorizeFactAction extends BaseAction<ActionType.PAUSE_AND_MEMORIZE_FACT> {
  fact: string;
  category?: string;
}

export type FaraAction =
  | LeftClickAction
  | DoubleClickAction
  | RightClickAction
  | DragAction
  | MouseMoveAction
  | ScrollAction
  | KeyAction
  | VisitUrlAction
  | HistoryBackAction
  | ScreenshotAction
  | WaitAction
  | AskUserQuestionAction
  | TerminateAction
  | PauseAndMemorizeFactAction;

// API Types

export type TaskStatus =
  | 'created'
  | 'waiting_for_client'
  | 'connected'
  | 'observing'
  | 'planning'
  | 'policy_check'
  | 'waiting_for_approval'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SessionState =
  | 'created'
  | 'waiting_for_client'
  | 'connected'
  | 'observing'
  | 'planning'
  | 'policy_check'
  | 'waiting_for_approval'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  userId: string;
  organizationId: string;
  deviceId: string | null;
  goal: string;
  status: TaskStatus;
  priority: Priority;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  sessionId?: string;
}

export interface Session {
  id: string;
  taskId: string;
  deviceId: string | null;
  organizationId: string;
  state: SessionState;
  currentUrl: string | null;
  currentDomain: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date;
  terminatedAt: Date | null;
  terminationReason: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  taskId: string;
  userId: string;
  actionType: string;
  actionData: Record<string, unknown>;
  status: ApprovalStatus;
  screenshotUrl: string | null;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateTaskInput {
  goal: string;
  deviceId?: string;
  priority?: Priority;
}

export interface UpdateTaskInput {
  goal?: string;
  priority?: Priority;
  status?: TaskStatus;
}

export interface CreateSessionInput {
  taskId: string;
}

export interface ApprovalDecision {
  decision: 'approved' | 'denied';
}

// WebSocket Event Types

export type SessionEventType =
  | 'session_started'
  | 'session_terminated'
  | 'state_changed'
  | 'action_requested'
  | 'action_executed'
  | 'approval_required'
  | 'approval_decided'
  | 'error'
  | 'heartbeat';

export interface SessionEvent {
  type: SessionEventType;
  payload: unknown;
  timestamp: number;
}

export interface StateChangedEvent {
  type: 'state_changed';
  payload: {
    sessionId: string;
    previousState: SessionState;
    newState: SessionState;
  };
  timestamp: number;
}

export interface ActionRequestedEvent {
  type: 'action_requested';
  payload: {
    sessionId: string;
    action: FaraAction;
  };
  timestamp: number;
}

export interface ActionExecutedEvent {
  type: 'action_executed';
  payload: {
    sessionId: string;
    actionId: string;
    success: boolean;
    error?: string;
  };
  timestamp: number;
}

export interface ApprovalRequiredEvent {
  type: 'approval_required';
  payload: {
    approvalRequest: ApprovalRequest;
  };
  timestamp: number;
}

export interface ApprovalDecidedEvent {
  type: 'approval_decided';
  payload: {
    approvalId: string;
    sessionId: string;
    decision: 'approved' | 'denied';
    decidedBy: string;
  };
  timestamp: number;
}

export interface SessionErrorEvent {
  type: 'error';
  payload: {
    sessionId: string;
    error: string;
  };
  timestamp: number;
}

export interface HeartbeatEvent {
  type: 'heartbeat';
  payload: {
    sessionId: string;
    leaseExpiresAt: number;
  };
  timestamp: number;
}

export type TypedSessionEvent =
  | StateChangedEvent
  | ActionRequestedEvent
  | ActionExecutedEvent
  | ApprovalRequiredEvent
  | ApprovalDecidedEvent
  | SessionErrorEvent
  | HeartbeatEvent
  | { type: SessionEventType; payload: unknown; timestamp: number };
