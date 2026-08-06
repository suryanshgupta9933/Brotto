/**
 * Unit tests for Brotto action validation schemas.
 */

import { z } from 'zod';
import {
  CoordinatesSchema,
  DragCoordinatesSchema,
  ScrollDeltaSchema,
  ViewportContextSchema,
  KeyModifiersSchema,
  LeftClickArgsSchema,
  DoubleClickArgsSchema,
  RightClickArgsSchema,
  DragArgsSchema,
  MouseMoveArgsSchema,
  ScrollArgsSchema,
  KeyArgsSchema,
  VisitUrlArgsSchema,
  HistoryBackArgsSchema,
  ScreenshotArgsSchema,
  WaitArgsSchema,
  AskUserQuestionArgsSchema,
  TerminateArgsSchema,
  PauseAndMemorizeFactArgsSchema,
  FaraActionArgsSchema,
  validateCoordinatesInBounds,
  assertCoordinatesInBounds,
} from '../validation';
import { ActionType } from '../actions';

describe('CoordinatesSchema', () => {
  it('should accept valid coordinates', () => {
    const result = CoordinatesSchema.parse({ x: 100, y: 200 });
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('should accept zero coordinates', () => {
    const result = CoordinatesSchema.parse({ x: 0, y: 0 });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('should reject negative x', () => {
    expect(() => CoordinatesSchema.parse({ x: -1, y: 0 })).toThrow(z.ZodError);
  });

  it('should reject negative y', () => {
    expect(() => CoordinatesSchema.parse({ x: 0, y: -1 })).toThrow(z.ZodError);
  });

  it('should reject non-integer x', () => {
    expect(() => CoordinatesSchema.parse({ x: 1.5, y: 0 })).toThrow(z.ZodError);
  });

  it('should reject non-integer y', () => {
    expect(() => CoordinatesSchema.parse({ x: 0, y: 1.5 })).toThrow(z.ZodError);
  });

  it('should reject non-number x', () => {
    expect(() => CoordinatesSchema.parse({ x: '100', y: 0 })).toThrow(z.ZodError);
  });

  it('should reject missing x', () => {
    expect(() => CoordinatesSchema.parse({ y: 0 })).toThrow(z.ZodError);
  });

  it('should reject missing y', () => {
    expect(() => CoordinatesSchema.parse({ x: 0 })).toThrow(z.ZodError);
  });
});

describe('DragCoordinatesSchema', () => {
  it('should accept valid drag coordinates', () => {
    const result = DragCoordinatesSchema.parse({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
    });
    expect(result).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
    });
  });

  it('should reject if start is missing', () => {
    expect(() =>
      DragCoordinatesSchema.parse({ end: { x: 100, y: 100 } })
    ).toThrow(z.ZodError);
  });

  it('should reject if end is missing', () => {
    expect(() =>
      DragCoordinatesSchema.parse({ start: { x: 0, y: 0 } })
    ).toThrow(z.ZodError);
  });
});

describe('ScrollDeltaSchema', () => {
  it('should accept valid scroll delta', () => {
    const result = ScrollDeltaSchema.parse({ deltaX: 0, deltaY: 100 });
    expect(result).toEqual({ deltaX: 0, deltaY: 100 });
  });

  it('should accept negative deltaY for scrolling up', () => {
    const result = ScrollDeltaSchema.parse({ deltaX: 0, deltaY: -100 });
    expect(result).toEqual({ deltaX: 0, deltaY: -100 });
  });

  it('should accept zero deltas', () => {
    const result = ScrollDeltaSchema.parse({ deltaX: 0, deltaY: 0 });
    expect(result).toEqual({ deltaX: 0, deltaY: 0 });
  });

  it('should reject non-integer deltaX', () => {
    expect(() =>
      ScrollDeltaSchema.parse({ deltaX: 1.5, deltaY: 0 })
    ).toThrow(z.ZodError);
  });
});

describe('ViewportContextSchema', () => {
  it('should accept valid viewport context', () => {
    const result = ViewportContextSchema.parse({
      viewportWidth: 1280,
      viewportHeight: 720,
    });
    expect(result).toEqual({ viewportWidth: 1280, viewportHeight: 720 });
  });

  it('should reject zero width', () => {
    expect(() =>
      ViewportContextSchema.parse({ viewportWidth: 0, viewportHeight: 720 })
    ).toThrow(z.ZodError);
  });

  it('should reject negative width', () => {
    expect(() =>
      ViewportContextSchema.parse({ viewportWidth: -100, viewportHeight: 720 })
    ).toThrow(z.ZodError);
  });

  it('should reject negative height', () => {
    expect(() =>
      ViewportContextSchema.parse({ viewportWidth: 1280, viewportHeight: -100 })
    ).toThrow(z.ZodError);
  });
});

describe('KeyModifiersSchema', () => {
  it('should accept empty object', () => {
    const result = KeyModifiersSchema.parse({});
    expect(result).toEqual({});
  });

  it('should accept all modifiers', () => {
    const result = KeyModifiersSchema.parse({
      ctrl: true,
      shift: true,
      alt: true,
      meta: true,
    });
    expect(result).toEqual({
      ctrl: true,
      shift: true,
      alt: true,
      meta: true,
    });
  });

  it('should accept partial modifiers', () => {
    const result = KeyModifiersSchema.parse({ ctrl: true });
    expect(result).toEqual({ ctrl: true });
  });

  it('should reject non-boolean value', () => {
    expect(() => KeyModifiersSchema.parse({ ctrl: 'true' })).toThrow(z.ZodError);
  });
});

describe('LeftClickArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.LEFT_CLICK,
    coordinates: { x: 100, y: 200 },
    viewport: { viewportWidth: 1280, viewportHeight: 720 },
  };

  it('should accept valid left click args', () => {
    const result = LeftClickArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should reject wrong action type', () => {
    expect(() =>
      LeftClickArgsSchema.parse({ ...validArgs, type: ActionType.DOUBLE_CLICK })
    ).toThrow(z.ZodError);
  });

  it('should reject invalid coordinates', () => {
    expect(() =>
      LeftClickArgsSchema.parse({ ...validArgs, coordinates: { x: -1, y: 0 } })
    ).toThrow(z.ZodError);
  });

  it('should reject invalid viewport', () => {
    expect(() =>
      LeftClickArgsSchema.parse({
        ...validArgs,
        viewport: { viewportWidth: 0, viewportHeight: 720 },
      })
    ).toThrow(z.ZodError);
  });
});

describe('DoubleClickArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.DOUBLE_CLICK,
    coordinates: { x: 100, y: 200 },
    viewport: { viewportWidth: 1280, viewportHeight: 720 },
  };

  it('should accept valid double click args', () => {
    const result = DoubleClickArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });
});

describe('RightClickArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.RIGHT_CLICK,
    coordinates: { x: 100, y: 200 },
    viewport: { viewportWidth: 1280, viewportHeight: 720 },
  };

  it('should accept valid right click args', () => {
    const result = RightClickArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });
});

describe('DragArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.DRAG,
    coordinates: {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
    },
    viewport: { viewportWidth: 1280, viewportHeight: 720 },
  };

  it('should accept valid drag args', () => {
    const result = DragArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should reject invalid start coordinates', () => {
    expect(() =>
      DragArgsSchema.parse({
        ...validArgs,
        coordinates: { start: { x: -1, y: 0 }, end: { x: 100, y: 100 } },
      })
    ).toThrow(z.ZodError);
  });
});

describe('MouseMoveArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.MOUSE_MOVE,
    coordinates: { x: 100, y: 200 },
    viewport: { viewportWidth: 1280, viewportHeight: 720 },
  };

  it('should accept valid mouse move args', () => {
    const result = MouseMoveArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });
});

describe('ScrollArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.SCROLL,
    coordinates: { x: 100, y: 200 },
    delta: { deltaX: 0, deltaY: 100 },
    viewport: { viewportWidth: 1280, viewportHeight: 720 },
  };

  it('should accept valid scroll args', () => {
    const result = ScrollArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should reject missing delta', () => {
    expect(() =>
      ScrollArgsSchema.parse({
        ...validArgs,
        delta: undefined,
      })
    ).toThrow(z.ZodError);
  });
});

describe('KeyArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.KEY,
    key: 'Enter',
  };

  it('should accept valid key args', () => {
    const result = KeyArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept key args with modifiers', () => {
    const argsWithModifiers = {
      ...validArgs,
      modifiers: { ctrl: true, shift: true },
    };
    const result = KeyArgsSchema.parse(argsWithModifiers);
    expect(result).toEqual(argsWithModifiers);
  });

  it('should reject empty key', () => {
    expect(() => KeyArgsSchema.parse({ ...validArgs, key: '' })).toThrow(
      z.ZodError
    );
  });

  it('should reject missing key', () => {
    expect(() => KeyArgsSchema.parse({ ...validArgs, key: undefined })).toThrow(
      z.ZodError
    );
  });
});

describe('VisitUrlArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.VISIT_URL,
    url: 'https://example.com',
  };

  it('should accept valid visit URL args', () => {
    const result = VisitUrlArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept URL with optional timeout', () => {
    const argsWithTimeout = { ...validArgs, timeout: 30000 };
    const result = VisitUrlArgsSchema.parse(argsWithTimeout);
    expect(result).toEqual(argsWithTimeout);
  });

  it('should reject invalid URL', () => {
    expect(() => VisitUrlArgsSchema.parse({ ...validArgs, url: 'not-a-url' })).toThrow(
      z.ZodError
    );
  });

  it('should reject missing URL', () => {
    expect(() => VisitUrlArgsSchema.parse({ ...validArgs, url: undefined })).toThrow(
      z.ZodError
    );
  });
});

describe('HistoryBackArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.HISTORY_BACK,
  };

  it('should accept valid history back args', () => {
    const result = HistoryBackArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept history back with steps', () => {
    const argsWithSteps = { ...validArgs, steps: 2 };
    const result = HistoryBackArgsSchema.parse(argsWithSteps);
    expect(result).toEqual(argsWithSteps);
  });

  it('should reject negative steps', () => {
    expect(() =>
      HistoryBackArgsSchema.parse({ ...validArgs, steps: -1 })
    ).toThrow(z.ZodError);
  });
});

describe('ScreenshotArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.SCREENSHOT,
  };

  it('should accept valid screenshot args', () => {
    const result = ScreenshotArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept screenshot with fullPage', () => {
    const argsWithFullPage = { ...validArgs, fullPage: true };
    const result = ScreenshotArgsSchema.parse(argsWithFullPage);
    expect(result).toEqual(argsWithFullPage);
  });
});

describe('WaitArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.WAIT,
    duration: 1000,
  };

  it('should accept valid wait args', () => {
    const result = WaitArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should reject zero duration', () => {
    expect(() => WaitArgsSchema.parse({ ...validArgs, duration: 0 })).toThrow(
      z.ZodError
    );
  });

  it('should reject negative duration', () => {
    expect(() => WaitArgsSchema.parse({ ...validArgs, duration: -100 })).toThrow(
      z.ZodError
    );
  });
});

describe('AskUserQuestionArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.ASK_USER_QUESTION,
    question: 'What should I do next?',
  };

  it('should accept valid ask user question args', () => {
    const result = AskUserQuestionArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept with context', () => {
    const argsWithContext = { ...validArgs, context: 'We are on the homepage' };
    const result = AskUserQuestionArgsSchema.parse(argsWithContext);
    expect(result).toEqual(argsWithContext);
  });

  it('should accept with choices', () => {
    const argsWithChoices = {
      ...validArgs,
      choices: ['Option A', 'Option B', 'Option C'],
    };
    const result = AskUserQuestionArgsSchema.parse(argsWithChoices);
    expect(result).toEqual(argsWithChoices);
  });

  it('should reject empty question', () => {
    expect(() =>
      AskUserQuestionArgsSchema.parse({ ...validArgs, question: '' })
    ).toThrow(z.ZodError);
  });
});

describe('TerminateArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.TERMINATE,
  };

  it('should accept valid terminate args', () => {
    const result = TerminateArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept with finalAnswer', () => {
    // ponytail: legacy `reason` field replaced with `finalAnswer` for the
    // user-facing answer (Slice C — agent-feel UX).
    const argsWithAnswer = { ...validArgs, finalAnswer: 'Task completed' };
    const result = TerminateArgsSchema.parse(argsWithAnswer);
    expect(result).toEqual(argsWithAnswer);
  });
});

describe('PauseAndMemorizeFactArgsSchema', () => {
  const validArgs = {
    id: 'action-1',
    observationId: 0,
    timestamp: Date.now(),
    type: ActionType.PAUSE_AND_MEMORIZE_FACT,
    fact: 'The user prefers dark mode',
  };

  it('should accept valid pause and memorize fact args', () => {
    const result = PauseAndMemorizeFactArgsSchema.parse(validArgs);
    expect(result).toEqual(validArgs);
  });

  it('should accept with category', () => {
    const argsWithCategory = { ...validArgs, category: 'user_preference' };
    const result = PauseAndMemorizeFactArgsSchema.parse(argsWithCategory);
    expect(result).toEqual(argsWithCategory);
  });

  it('should reject empty fact', () => {
    expect(() =>
      PauseAndMemorizeFactArgsSchema.parse({ ...validArgs, fact: '' })
    ).toThrow(z.ZodError);
  });
});

describe('FaraActionArgsSchema', () => {
  it('should accept left click action', () => {
    const action = {
      id: 'action-1',
      observationId: 0,
      timestamp: Date.now(),
      type: ActionType.LEFT_CLICK,
      coordinates: { x: 100, y: 200 },
      viewport: { viewportWidth: 1280, viewportHeight: 720 },
    };
    const result = FaraActionArgsSchema.parse(action);
    expect(result).toEqual(action);
  });

  it('should accept terminate action', () => {
    const action = {
      id: 'action-1',
      observationId: 0,
      timestamp: Date.now(),
      type: ActionType.TERMINATE,
    };
    const result = FaraActionArgsSchema.parse(action);
    expect(result).toEqual(action);
  });

  it('should reject invalid action type', () => {
    expect(() =>
      FaraActionArgsSchema.parse({
        id: 'action-1',
        observationId: 0,
        timestamp: Date.now(),
        type: 'invalid_action',
        coordinates: { x: 100, y: 200 },
        viewport: { viewportWidth: 1280, viewportHeight: 720 },
      })
    ).toThrow(z.ZodError);
  });
});

describe('validateCoordinatesInBounds', () => {
  it('should return true for coordinates within bounds', () => {
    expect(validateCoordinatesInBounds(100, 200, 1280, 720)).toBe(true);
  });

  it('should return true for origin coordinates', () => {
    expect(validateCoordinatesInBounds(0, 0, 1280, 720)).toBe(true);
  });

  it('should return true for coordinates at edge (max - 1)', () => {
    expect(validateCoordinatesInBounds(1279, 719, 1280, 720)).toBe(true);
  });

  it('should return false for x at max (boundary)', () => {
    expect(validateCoordinatesInBounds(1280, 0, 1280, 720)).toBe(false);
  });

  it('should return false for y at max (boundary)', () => {
    expect(validateCoordinatesInBounds(0, 720, 1280, 720)).toBe(false);
  });

  it('should return false for negative x', () => {
    expect(validateCoordinatesInBounds(-1, 0, 1280, 720)).toBe(false);
  });

  it('should return false for negative y', () => {
    expect(validateCoordinatesInBounds(0, -1, 1280, 720)).toBe(false);
  });
});

describe('assertCoordinatesInBounds', () => {
  it('should not throw for coordinates within bounds', () => {
    expect(() =>
      assertCoordinatesInBounds(100, 200, 1280, 720)
    ).not.toThrow();
  });

  it('should throw for coordinates out of bounds', () => {
    expect(() =>
      assertCoordinatesInBounds(1280, 0, 1280, 720)
    ).toThrow('Coordinates (1280, 0) are out of bounds');
  });

  it('should throw with correct message for negative coordinates', () => {
    expect(() =>
      assertCoordinatesInBounds(-1, -1, 1280, 720)
    ).toThrow('Coordinates (-1, -1) are out of bounds');
  });
});
