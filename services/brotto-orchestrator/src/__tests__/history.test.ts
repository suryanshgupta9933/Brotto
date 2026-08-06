/**
 * History Manager Tests
 */

import { HistoryManager } from '../history';
import { ActionType, createActionSuccess, createActionFailure } from '@brotto/brotto-action-schema';

describe('HistoryManager', () => {
  let history: HistoryManager;

  beforeEach(() => {
    history = new HistoryManager({
      maxActionHistory: 10,
      maxScreenshotHistory: 5,
      maxRecentActionsForPrompt: 3,
    });
  });

  describe('action recording', () => {
    it('should record action in history', () => {
      const entry = {
        action: {
          id: 'act-1',
          type: ActionType.LEFT_CLICK,
          observationId: 1,
          timestamp: Date.now(),
          coordinates: { x: 100, y: 200 },
          viewport: { viewportWidth: 1920, viewportHeight: 1080 },
        },
        result: createActionSuccess('act-1', {}),
        observationIdAtExecution: 1,
        executedAt: new Date(),
        durationMs: 100,
      };

      history.recordAction(entry);

      const actions = history.getActionHistory();
      expect(actions).toHaveLength(1);
      expect(actions[0].action.id).toBe('act-1');
    });

    it('should limit action history size', () => {
      // Record more than maxActionHistory
      for (let i = 0; i < 15; i++) {
        history.recordAction({
          action: {
            id: `act-${i}`,
            type: ActionType.LEFT_CLICK,
            observationId: i,
            timestamp: Date.now(),
            coordinates: { x: 100, y: 200 },
            viewport: { viewportWidth: 1920, viewportHeight: 1080 },
          },
          result: createActionSuccess(`act-${i}`, {}),
          observationIdAtExecution: i,
          executedAt: new Date(),
          durationMs: 100,
        });
      }

      const actions = history.getActionHistory();
      expect(actions).toHaveLength(10); // maxActionHistory
      expect(actions[0].action.id).toBe('act-5'); // First 5 were dropped
    });

    it('should get recent actions', () => {
      // Record 5 actions
      for (let i = 0; i < 5; i++) {
        history.recordAction({
          action: {
            id: `act-${i}`,
            type: ActionType.LEFT_CLICK,
            observationId: i,
            timestamp: Date.now(),
            coordinates: { x: 100, y: 200 },
            viewport: { viewportWidth: 1920, viewportHeight: 1080 },
          },
          result: createActionSuccess(`act-${i}`, {}),
          observationIdAtExecution: i,
          executedAt: new Date(),
          durationMs: 100,
        });
      }

      const recent = history.getRecentActions(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].action.id).toBe('act-2');
    });
  });

  describe('screenshot recording', () => {
    it('should record screenshot', () => {
      const screenshot = Buffer.from('fake-image-data');

      history.recordScreenshot({
        observationId: 1,
        screenshot,
        url: 'https://example.com',
        domain: 'example.com',
        timestamp: new Date(),
      });

      const screenshots = history.getScreenshotHistory();
      expect(screenshots).toHaveLength(1);
      expect(screenshots[0].domain).toBe('example.com');
    });

    it('should limit screenshot history size', () => {
      for (let i = 0; i < 10; i++) {
        history.recordScreenshot({
          observationId: i,
          screenshot: Buffer.from(`image-${i}`),
          url: `https://example.com/page${i}`,
          domain: 'example.com',
          timestamp: new Date(),
        });
      }

      const screenshots = history.getScreenshotHistory();
      expect(screenshots).toHaveLength(5); // maxScreenshotHistory
    });

    it('should get most recent screenshot', () => {
      history.recordScreenshot({
        observationId: 1,
        screenshot: Buffer.from('first'),
        url: 'https://example.com/1',
        domain: 'example.com',
        timestamp: new Date(),
      });

      history.recordScreenshot({
        observationId: 2,
        screenshot: Buffer.from('second'),
        url: 'https://example.com/2',
        domain: 'example.com',
        timestamp: new Date(),
      });

      const recent = history.getMostRecentScreenshot();
      expect(recent?.observationId).toBe(2);
    });
  });

  describe('memory management', () => {
    it('should store memories', () => {
      history.storeMemory({
        fact: 'User prefers dark mode',
        category: 'preference',
        timestamp: new Date(),
        actionId: 'act-1',
      });

      const memories = history.getAllMemories();
      expect(memories).toHaveLength(1);
      expect(memories[0].fact).toBe('User prefers dark mode');
    });

    it('should filter memories by category', () => {
      history.storeMemory({
        fact: 'Dark mode',
        category: 'preference',
        timestamp: new Date(),
        actionId: 'act-1',
      });

      history.storeMemory({
        fact: 'Email sent',
        category: 'action',
        timestamp: new Date(),
        actionId: 'act-2',
      });

      const preferenceMemories = history.getMemories('preference');
      expect(preferenceMemories).toHaveLength(1);
      expect(preferenceMemories[0].fact).toBe('Dark mode');
    });
  });

  describe('prompt context building', () => {
    it('should build prompt context with recent actions', () => {
      // Record some actions
      for (let i = 0; i < 3; i++) {
        history.recordAction({
          action: {
            id: `act-${i}`,
            type: ActionType.LEFT_CLICK,
            observationId: i,
            timestamp: Date.now(),
            coordinates: { x: 100, y: 200 },
            viewport: { viewportWidth: 1920, viewportHeight: 1080 },
          },
          result: i === 0 ? createActionSuccess(`act-${i}`, {}) : createActionFailure(`act-${i}`, 'Test error', 'test'),
          observationIdAtExecution: i,
          executedAt: new Date(),
          durationMs: 100,
        });
      }

      const context = history.buildPromptContext({
        goal: 'Test goal',
        includeActionsCount: 3,
        includeMemories: true,
      });

      expect(context.goal).toBe('Test goal');
      expect(context.recentActions).toHaveLength(3);
      expect(context.totalActionsCount).toBe(3);
    });

    it('should include failure message for failed actions', () => {
      history.recordAction({
        action: {
          id: 'act-1',
          type: ActionType.VISIT_URL,
          observationId: 1,
          timestamp: Date.now(),
          url: 'https://example.com',
        },
        result: createActionFailure(ActionType.VISIT_URL, 'navigation_failed' as never, 'Navigation failed'),
        observationIdAtExecution: 1,
        executedAt: new Date(),
        durationMs: 100,
      });

      const context = history.buildPromptContext({
        goal: 'Test goal',
      });

      expect(context.failureMessage).toContain('Navigation failed');
    });

    it('should include memories in context', () => {
      history.storeMemory({
        fact: 'Important fact',
        category: 'test',
        timestamp: new Date(),
        actionId: 'act-1',
      });

      const context = history.buildPromptContext({
        goal: 'Test goal',
        includeMemories: true,
      });

      expect(context.memories).toHaveLength(1);
      expect(context.memories[0].fact).toBe('Important fact');
    });
  });

  describe('trajectory', () => {
    it('should record full trajectory', () => {
      history.recordAction({
        action: {
          id: 'act-1',
          type: ActionType.LEFT_CLICK,
          observationId: 1,
          timestamp: Date.now(),
          coordinates: { x: 100, y: 200 },
          viewport: { viewportWidth: 1920, viewportHeight: 1080 },
        },
        result: createActionSuccess('act-1', {}),
        observationIdAtExecution: 1,
        executedAt: new Date(),
        durationMs: 100,
      });

      history.recordScreenshot({
        observationId: 2,
        screenshot: Buffer.from('image'),
        url: 'https://example.com',
        domain: 'example.com',
        timestamp: new Date(),
      });

      const trajectory = history.getTrajectory();
      expect(trajectory).toHaveLength(2);
      expect(trajectory[0].type).toBe('action');
      expect(trajectory[1].type).toBe('screenshot');
    });
  });

  describe('statistics', () => {
    it('should return correct statistics', () => {
      history.recordAction({
        action: {
          id: 'act-1',
          type: ActionType.LEFT_CLICK,
          observationId: 1,
          timestamp: Date.now(),
          coordinates: { x: 100, y: 200 },
          viewport: { viewportWidth: 1920, viewportHeight: 1080 },
        },
        result: createActionSuccess('act-1', {}),
        observationIdAtExecution: 1,
        executedAt: new Date(),
        durationMs: 100,
      });

      history.recordScreenshot({
        observationId: 2,
        screenshot: Buffer.from('image'),
        url: 'https://example.com',
        domain: 'example.com',
        timestamp: new Date(),
      });

      const stats = history.getStats();
      expect(stats.actionHistorySize).toBe(1);
      expect(stats.screenshotHistorySize).toBe(1);
      expect(stats.maxActionHistory).toBe(10);
      expect(stats.maxScreenshotHistory).toBe(5);
    });
  });

  describe('clear', () => {
    it('should clear all history', () => {
      history.recordAction({
        action: {
          id: 'act-1',
          type: ActionType.LEFT_CLICK,
          observationId: 1,
          timestamp: Date.now(),
          coordinates: { x: 100, y: 200 },
          viewport: { viewportWidth: 1920, viewportHeight: 1080 },
        },
        result: createActionSuccess('act-1', {}),
        observationIdAtExecution: 1,
        executedAt: new Date(),
        durationMs: 100,
      });

      history.clear();

      expect(history.getActionHistory()).toHaveLength(0);
      expect(history.getScreenshotHistory()).toHaveLength(0);
      expect(history.getTrajectory()).toHaveLength(0);
    });
  });
});
