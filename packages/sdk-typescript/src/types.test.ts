import { describe, it, expect } from 'vitest';
import {
  ActionType,
  Coordinates,
  TaskStatus,
  SessionState,
  Priority,
  ApprovalStatus,
} from '../types.js';

describe('types', () => {
  describe('ActionType', () => {
    it('should have all expected action types', () => {
      expect(ActionType.LEFT_CLICK).toBe('left_click');
      expect(ActionType.DOUBLE_CLICK).toBe('double_click');
      expect(ActionType.RIGHT_CLICK).toBe('right_click');
      expect(ActionType.DRAG).toBe('drag');
      expect(ActionType.MOUSE_MOVE).toBe('mouse_move');
      expect(ActionType.SCROLL).toBe('scroll');
      expect(ActionType.KEY).toBe('key');
      expect(ActionType.VISIT_URL).toBe('visit_url');
      expect(ActionType.HISTORY_BACK).toBe('history_back');
      expect(ActionType.SCREENSHOT).toBe('screenshot');
      expect(ActionType.WAIT).toBe('wait');
      expect(ActionType.ASK_USER_QUESTION).toBe('ask_user_question');
      expect(ActionType.TERMINATE).toBe('terminate');
      expect(ActionType.PAUSE_AND_MEMORIZE_FACT).toBe('pause_and_memorize_fact');
    });
  });

  describe('Coordinates', () => {
    it('should create coordinates with x and y', () => {
      const coords: Coordinates = { x: 100, y: 200 };
      expect(coords.x).toBe(100);
      expect(coords.y).toBe(200);
    });
  });

  describe('TaskStatus', () => {
    it('should have all expected task statuses', () => {
      expect(TaskStatus.CREATED).toBe('created');
      expect(TaskStatus.WAITING_FOR_CLIENT).toBe('waiting_for_client');
      expect(TaskStatus.CONNECTED).toBe('connected');
      expect(TaskStatus.OBSERVING).toBe('observing');
      expect(TaskStatus.PLANNING).toBe('planning');
      expect(TaskStatus.POLICY_CHECK).toBe('policy_check');
      expect(TaskStatus.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(TaskStatus.EXECUTING).toBe('executing');
      expect(TaskStatus.VERIFYING).toBe('verifying');
      expect(TaskStatus.COMPLETED).toBe('completed');
      expect(TaskStatus.FAILED).toBe('failed');
      expect(TaskStatus.CANCELLED).toBe('cancelled');
    });
  });

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

  describe('Priority', () => {
    it('should have all expected priorities', () => {
      expect(Priority.LOW).toBe('low');
      expect(Priority.MEDIUM).toBe('medium');
      expect(Priority.HIGH).toBe('high');
    });
  });

  describe('ApprovalStatus', () => {
    it('should have all expected approval statuses', () => {
      expect(ApprovalStatus.PENDING).toBe('pending');
      expect(ApprovalStatus.APPROVED).toBe('approved');
      expect(ApprovalStatus.DENIED).toBe('denied');
      expect(ApprovalStatus.EXPIRED).toBe('expired');
    });
  });
});
