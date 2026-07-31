/**
 * Unit tests for action types.
 */

import { ActionType, isViewportAction, isNavigationAction } from '../actions';

describe('ActionType', () => {
  it('should have all action types defined', () => {
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

describe('isViewportAction', () => {
  it('should return true for viewport-based actions', () => {
    expect(isViewportAction({ type: ActionType.LEFT_CLICK } as any)).toBe(true);
    expect(isViewportAction({ type: ActionType.DOUBLE_CLICK } as any)).toBe(true);
    expect(isViewportAction({ type: ActionType.RIGHT_CLICK } as any)).toBe(true);
    expect(isViewportAction({ type: ActionType.DRAG } as any)).toBe(true);
    expect(isViewportAction({ type: ActionType.MOUSE_MOVE } as any)).toBe(true);
    expect(isViewportAction({ type: ActionType.SCROLL } as any)).toBe(true);
  });

  it('should return false for non-viewport actions', () => {
    expect(isViewportAction({ type: ActionType.KEY } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.VISIT_URL } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.HISTORY_BACK } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.SCREENSHOT } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.WAIT } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.ASK_USER_QUESTION } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.TERMINATE } as any)).toBe(false);
    expect(isViewportAction({ type: ActionType.PAUSE_AND_MEMORIZE_FACT } as any)).toBe(false);
  });
});

describe('isNavigationAction', () => {
  it('should return true for navigation actions', () => {
    expect(isNavigationAction({ type: ActionType.VISIT_URL } as any)).toBe(true);
    expect(isNavigationAction({ type: ActionType.HISTORY_BACK } as any)).toBe(true);
  });

  it('should return false for non-navigation actions', () => {
    expect(isNavigationAction({ type: ActionType.LEFT_CLICK } as any)).toBe(false);
    expect(isNavigationAction({ type: ActionType.KEY } as any)).toBe(false);
    expect(isNavigationAction({ type: ActionType.SCREENSHOT } as any)).toBe(false);
    expect(isNavigationAction({ type: ActionType.TERMINATE } as any)).toBe(false);
    expect(isNavigationAction({ type: ActionType.WAIT } as any)).toBe(false);
    expect(isNavigationAction({ type: ActionType.ASK_USER_QUESTION } as any)).toBe(false);
    expect(isNavigationAction({ type: ActionType.PAUSE_AND_MEMORIZE_FACT } as any)).toBe(false);
  });
});
