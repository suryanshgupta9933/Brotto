/**
 * Tests for trace and span types
 */

import {
  SessionState,
  ActionType,
  PolicyResult,
  FARA_SPAN_ATTRIBUTES,
  createFaraTracer,
  getCurrentSpan,
  isTracing,
  SPAN_KINDS,
  SPAN_STATUS,
} from '../traces';

describe('traces', () => {
  describe('SessionState', () => {
    it('should have all expected session states', () => {
      expect(SessionState.CREATED).toBe('created');
      expect(SessionState.WAITING_FOR_CLIENT).toBe('waiting_for_client');
      expect(SessionState.CONNECTED).toBe('connected');
      expect(SessionState.OBSERVING).toBe('observing');
      expect(SessionState.PLANNING).toBe('planning');
      expect(SessionState.POLICY_CHECK).toBe('policy_check');
      expect(SessionState.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(SessionState.EXECUTING).toBe('executing');
      expect(SessionState.VERIFYING).toBe('verifying');
      expect(SessionState.COMPLETED).toBe('completed');
      expect(SessionState.FAILED).toBe('failed');
      expect(SessionState.CANCELLED).toBe('cancelled');
    });
  });

  describe('ActionType', () => {
    it('should have all expected action types', () => {
      expect(ActionType.LEFT_CLICK).toBe('left_click');
      expect(ActionType.DOUBLE_CLICK).toBe('double_click');
      expect(ActionType.RIGHT_CLICK).toBe('right_click');
      expect(ActionType.DRAG).toBe('drag');
      expect(ActionType.MOUSE_MOVE).toBe('mouse_move');
      expect(ActionType.SCROLL).toBe('scroll');
      expect(ActionType.KEY_PRESS).toBe('key');
      expect(ActionType.VISIT_URL).toBe('visit_url');
      expect(ActionType.HISTORY_BACK).toBe('history_back');
      expect(ActionType.SCREENSHOT).toBe('screenshot');
      expect(ActionType.WAIT).toBe('wait');
      expect(ActionType.ASK_USER_QUESTION).toBe('ask_user_question');
      expect(ActionType.TERMINATE).toBe('terminate');
      expect(ActionType.PAUSE_AND_MEMORIZE).toBe('pause_and_memorize_fact');
      expect(ActionType.KEYBOARD_INSERT_TEXT).toBe('keyboard_insert_text');
    });
  });

  describe('PolicyResult', () => {
    it('should have all expected policy results', () => {
      expect(PolicyResult.APPROVED).toBe('approved');
      expect(PolicyResult.DENIED).toBe('denied');
      expect(PolicyResult.APPROVED_WITH_MODIFICATIONS).toBe('approved_with_modifications');
      expect(PolicyResult.REQUIRES_APPROVAL).toBe('requires_approval');
      expect(PolicyResult.SKIPPED).toBe('skipped');
    });
  });

  describe('FARA_SPAN_ATTRIBUTES', () => {
    it('should have service attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.SERVICE_NAME).toBe('fara.service.name');
      expect(FARA_SPAN_ATTRIBUTES.SERVICE_VERSION).toBe('fara.service.version');
    });

    it('should have tenant and session attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.TENANT_ID).toBe('fara.tenant_id');
      expect(FARA_SPAN_ATTRIBUTES.SESSION_ID).toBe('fara.session_id');
      expect(FARA_SPAN_ATTRIBUTES.TASK_ID).toBe('fara.task_id');
      expect(FARA_SPAN_ATTRIBUTES.DEVICE_ID).toBe('fara.device_id');
    });

    it('should have session lifecycle attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.SESSION_STATE).toBe('fara.session.state');
      expect(FARA_SPAN_ATTRIBUTES.SESSION_CREATOR).toBe('fara.session.creator');
      expect(FARA_SPAN_ATTRIBUTES.SESSION_START_TIME).toBe('fara.session.start_time');
      expect(FARA_SPAN_ATTRIBUTES.SESSION_END_TIME).toBe('fara.session.end_time');
    });

    it('should have model attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.MODEL_VERSION).toBe('fara.model.version');
      expect(FARA_SPAN_ATTRIBUTES.MODEL_NAME).toBe('fara.model.name');
      expect(FARA_SPAN_ATTRIBUTES.PROMPT_TEMPLATE_VERSION).toBe('fara.prompt_template.version');
    });

    it('should have action attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.ACTION_TYPE).toBe('fara.action.type');
      expect(FARA_SPAN_ATTRIBUTES.ACTION_PROPOSED).toBe('fara.action.proposed');
      expect(FARA_SPAN_ATTRIBUTES.ACTION_EXECUTED).toBe('fara.action.executed');
    });

    it('should have policy and approval attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.POLICY_RESULT).toBe('fara.policy.result');
      expect(FARA_SPAN_ATTRIBUTES.APPROVAL_DECISION).toBe('fara.approval.decision');
    });

    it('should have screenshot attributes', () => {
      expect(FARA_SPAN_ATTRIBUTES.SCREENSHOT_HASH).toBe('fara.screenshot.hash');
      expect(FARA_SPAN_ATTRIBUTES.SCREENSHOT_WIDTH).toBe('fara.screenshot.width');
      expect(FARA_SPAN_ATTRIBUTES.SCREENSHOT_HEIGHT).toBe('fara.screenshot.height');
    });
  });

  describe('createFaraTracer', () => {
    it('should create a tracer with the given name', () => {
      const tracer = createFaraTracer('test-service');
      expect(tracer).toBeDefined();
    });
  });

  describe('getCurrentSpan', () => {
    it('should return undefined when no span is active', () => {
      const span = getCurrentSpan();
      expect(span).toBeUndefined();
    });
  });

  describe('isTracing', () => {
    it('should return false when no span is active', () => {
      expect(isTracing()).toBe(false);
    });
  });

  describe('SPAN_KINDS', () => {
    it('should have standard OpenTelemetry span kinds', () => {
      expect(SPAN_KINDS.SERVER).toBeDefined();
      expect(SPAN_KINDS.CLIENT).toBeDefined();
      expect(SPAN_KINDS.PRODUCER).toBeDefined();
      expect(SPAN_KINDS.CONSUMER).toBeDefined();
      expect(SPAN_KINDS.INTERNAL).toBeDefined();
    });
  });

  describe('SPAN_STATUS', () => {
    it('should have standard span statuses', () => {
      expect(SPAN_STATUS.OK).toBeDefined();
      expect(SPAN_STATUS.ERROR).toBeDefined();
      expect(SPAN_STATUS.UNSET).toBeDefined();
      // Note: OpenTelemetry SpanStatusCode values in this API version:
      // OK = 1, ERROR = 2, UNSET = 0
      expect(SPAN_STATUS.OK.code).toBe(1);
      expect(SPAN_STATUS.ERROR.code).toBe(2);
      expect(SPAN_STATUS.UNSET.code).toBe(0);
    });
  });
});
