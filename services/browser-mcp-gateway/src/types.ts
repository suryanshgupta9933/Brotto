/**
 * Fara Action Types
 * Based on ARCHITECTURE.md section 3.5 - Fara action adapter mapping
 */

export type FaraActionType =
  | 'left_click'
  | 'double_click'
  | 'right_click'
  | 'drag'
  | 'mouse_move'
  | 'scroll'
  | 'key'
  | 'visit_url'
  | 'history_back'
  | 'screenshot'
  | 'wait'
  | 'ask_user_question'
  | 'terminate'
  | 'pause_and_memorize_fact';

export interface FaraActionBase {
  type: FaraActionType;
  observation_id?: string;
  timestamp?: number;
}

export interface ClickAction extends FaraActionBase {
  type: 'left_click' | 'double_click' | 'right_click';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
}

export interface DragAction extends FaraActionBase {
  type: 'drag';
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
}

export interface MouseMoveAction extends FaraActionBase {
  type: 'mouse_move';
  x: number;
  y: number;
}

export interface ScrollAction extends FaraActionBase {
  type: 'scroll';
  x: number;
  y: number;
  delta_x?: number;
  delta_y?: number;
}

export interface KeyAction extends FaraActionBase {
  type: 'key';
  key: string;
}

export interface VisitUrlAction extends FaraActionBase {
  type: 'visit_url';
  url: string;
}

export interface HistoryBackAction extends FaraActionBase {
  type: 'history_back';
}

export interface ScreenshotAction extends FaraActionBase {
  type: 'screenshot';
}

export interface WaitAction extends FaraActionBase {
  type: 'wait';
  duration_ms: number;
}

export interface AskUserQuestionAction extends FaraActionBase {
  type: 'ask_user_question';
  question: string;
  options?: string[];
}

export interface TerminateAction extends FaraActionBase {
  type: 'terminate';
  reason?: string;
}

export interface PauseAndMemorizeFactAction extends FaraActionBase {
  type: 'pause_and_memorize_fact';
  fact: string;
}

export type FaraAction =
  | ClickAction
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

/**
 * MCP Tool Call Result
 */
export interface ToolCallResult {
  success: boolean;
  error?: string;
  data?: unknown;
  observation_id?: string;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  session_id: string;
  cdp_endpoint: string;
  viewport_width: number;
  viewport_height: number;
  browser_type?: 'chromium' | 'firefox' | 'webkit';
  profile_dir?: string;
}

/**
 * Accessibility snapshot verification result
 */
export interface AccessibilityVerification {
  verified: boolean;
  checks: VerificationCheck[];
  error?: string;
}

export interface VerificationCheck {
  type: 'element_exists' | 'text_present' | 'form_value' | 'domain_match' | 'dialog_open';
  selector?: string;
  expected?: string;
  actual?: string;
  passed: boolean;
  message: string;
}
