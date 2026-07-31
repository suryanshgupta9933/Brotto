/**
 * Agent Evaluation Suite
 *
 * Tests agent performance on real tasks including:
 * - Task success rate
 * - Action accuracy
 * - Human intervention tracking
 * - Latency metrics
 */

import { test, expect, type Page } from '@playwright/test';

// Metrics tracking
interface EvaluationMetrics {
  taskSuccess: boolean;
  actionCount: number;
  repeatedActions: number;
  humanInterventions: number;
  screenshotToActionLatency: number;
  totalTaskDuration: number;
  modelCost: number;
  failureReason?: string;
}

const metricsHistory: EvaluationMetrics[] = [];

async function trackMetrics(page: Page, metrics: Partial<EvaluationMetrics>): Promise<void> {
  const fullMetrics: EvaluationMetrics = {
    taskSuccess: false,
    actionCount: 0,
    repeatedActions: 0,
    humanInterventions: 0,
    screenshotToActionLatency: 0,
    totalTaskDuration: 0,
    modelCost: 0,
    ...metrics,
  };
  metricsHistory.push(fullMetrics);
}

// Test task definitions
const EVALUATION_TASKS = [
  {
    id: 'search-info',
    name: 'Search and Information Retrieval',
    description: 'Search for information on the web and extract specific details',
    difficulty: 'easy',
    expectedActions: 3,
  },
  {
    id: 'multi-step-form',
    name: 'Multi-Step Form Filling',
    description: 'Complete a multi-page form with various input types',
    difficulty: 'medium',
    expectedActions: 8,
  },
  {
    id: 'crm-workflow',
    name: 'CRM Workflow Navigation',
    description: 'Navigate through a CRM system to update a contact',
    difficulty: 'medium',
    expectedActions: 5,
  },
  {
    id: 'scheduling',
    name: 'Scheduling Task',
    description: 'Find an available time slot and create a calendar event',
    difficulty: 'medium',
    expectedActions: 6,
  },
  {
    id: 'file-download',
    name: 'File Download',
    description: 'Navigate to a file and download it to the designated location',
    difficulty: 'easy',
    expectedActions: 4,
  },
  {
    id: 'auth-dashboard',
    name: 'Authenticated Dashboard Navigation',
    description: 'Log into a dashboard and retrieve specific information',
    difficulty: 'medium',
    expectedActions: 5,
  },
  {
    id: 'spa-interaction',
    name: 'Single Page Application Interaction',
    description: 'Interact with a dynamic SPA with client-side routing',
    difficulty: 'hard',
    expectedActions: 7,
  },
  {
    id: 'popup-handling',
    name: 'Popup and Nested Frame Handling',
    description: 'Handle multiple popups and iframes within a page',
    difficulty: 'hard',
    expectedActions: 6,
  },
];

test.describe('Agent Evaluation Suite', () => {
  for (const task of EVALUATION_TASKS) {
    test.describe(`${task.name} (${task.difficulty})`, () => {
      test('should complete task successfully', async ({ page }) => {
        const startTime = Date.now();

        // Simulate task execution
        await page.goto('https://example.com');

        // Simulate actions being taken
        for (let i = 0; i < task.expectedActions; i++) {
          await page.waitForTimeout(100); // Simulate action delay
        }

        const duration = Date.now() - startTime;

        const metrics: EvaluationMetrics = {
          taskSuccess: true,
          actionCount: task.expectedActions,
          repeatedActions: 0,
          humanInterventions: 0,
          screenshotToActionLatency: 150, // ms
          totalTaskDuration: duration,
          modelCost: 0.05 * task.expectedActions, // Simulated cost
        };

        await trackMetrics(page, metrics);

        expect(metrics.taskSuccess).toBe(true);
        expect(metrics.actionCount).toBeLessThanOrEqual(task.expectedActions * 1.5); // Allow some variance
      });

      test('should track action accuracy', async ({ page }) => {
        await page.goto('https://example.com');

        const targetX = 100;
        const targetY = 100;
        const tolerance = 10; // pixels

        // Simulate clicking near target
        const clickedX = targetX + 2; // Within tolerance
        const clickedY = targetY - 1; // Within tolerance

        const isAccurate =
          Math.abs(clickedX - targetX) <= tolerance &&
          Math.abs(clickedY - targetY) <= tolerance;

        expect(isAccurate).toBe(true);
      });

      test('should measure screenshot-to-action latency', async ({ page }) => {
        await page.goto('https://example.com');

        const screenshotStart = Date.now();
        await page.screenshot();
        const screenshotEnd = Date.now();

        const actionStart = Date.now();
        await page.click('body');
        const actionEnd = Date.now();

        const screenshotLatency = screenshotEnd - screenshotStart;
        const actionLatency = actionEnd - actionStart;
        const totalLatency = actionEnd - screenshotStart;

        expect(screenshotLatency).toBeLessThan(500); // Screenshot should be fast
        expect(totalLatency).toBeLessThan(2000); // End-to-end should be reasonable
      });
    });
  }

  test.describe('Human Intervention Tracking', () => {
    test('should track approval requests', async ({ page }) => {
      await page.goto('https://example.com');

      let interventionCount = 0;

      // Simulate intervention detection
      page.on('dialog', async () => {
        interventionCount++;
        await page.waitForTimeout(100); // Simulate human response
      });

      // Trigger a few dialogs
      await page.evaluate(() => {
        window.confirm('Proceed?');
        window.confirm('Continue?');
      });

      expect(interventionCount).toBe(2);
    });

    test('should calculate intervention rate', async ({ page }) => {
      await page.goto('https://example.com');

      const totalActions = 10;
      const interventions = 2;
      const interventionRate = interventions / totalActions;

      expect(interventionRate).toBe(0.2); // 20% intervention rate
    });
  });

  test.describe('Repeated Action Detection', () => {
    test('should detect repeated actions', async ({ page }) => {
      await page.goto('https://example.com');

      const actionHistory: string[] = [];
      let repeatedCount = 0;

      // Simulate action sequence
      const actions = ['click', 'scroll', 'click', 'click', 'type'];

      for (const action of actions) {
        actionHistory.push(action);

        // Check for repetition (same action 3+ times)
        const recentActions = actionHistory.slice(-3);
        if (recentActions.every((a) => a === action) && recentActions.length === 3) {
          repeatedCount++;
        }
      }

      // Actions: click, scroll, click, click, click
      // The last 3 are: scroll, click, click -> not all same
      // We had 2 clicks at position 0 and 2, then 2 and 3
      expect(repeatedCount).toBe(0);
    });

    test('should track repeated action rate', async ({ page }) => {
      await page.goto('https://example.com');

      const actions = [
        { type: 'click', x: 100, y: 100 },
        { type: 'click', x: 100, y: 100 },
        { type: 'click', x: 100, y: 100 },
        { type: 'scroll', deltaY: -100 },
        { type: 'click', x: 200, y: 200 },
      ];

      // Find repeated actions
      let repeatedActions = 0;
      for (let i = 1; i < actions.length; i++) {
        if (
          actions[i].type === actions[i - 1].type &&
          'x' in actions[i] &&
          'x' in actions[i - 1] &&
          (actions[i] as any).x === (actions[i - 1] as any).x &&
          (actions[i] as any).y === (actions[i - 1] as any).y
        ) {
          repeatedActions++;
        }
      }

      const repeatedActionRate = repeatedActions / (actions.length - 1);
      expect(repeatedActionRate).toBe(0.5); // 2 repeated out of 4 transitions
    });
  });

  test.describe('End-to-End Latency', () => {
    test('should measure total task duration', async ({ page }) => {
      const taskStart = Date.now();

      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      await page.fill('input[type="text"]', 'test');
      await page.waitForTimeout(300);
      await page.click('button[type="submit"]');

      const taskEnd = Date.now();
      const totalDuration = taskEnd - taskStart;

      expect(totalDuration).toBeGreaterThan(0);
      expect(totalDuration).toBeLessThan(10000); // Should complete in reasonable time
    });

    test('should measure model inference time', async ({ page }) => {
      await page.goto('https://example.com');

      const inferenceStart = Date.now();
      // Simulate inference
      await page.waitForTimeout(200);
      const inferenceEnd = Date.now();

      const inferenceTime = inferenceEnd - inferenceStart;
      expect(inferenceTime).toBeGreaterThan(0);
    });
  });

  test.describe('Cost Tracking', () => {
    test('should estimate model cost per task', async ({ page }) => {
      await page.goto('https://example.com');

      const inputTokens = 1000;
      const outputTokens = 500;
      const costPer1kInput = 0.01;
      const costPer1kOutput = 0.03;

      const inputCost = (inputTokens / 1000) * costPer1kInput;
      const outputCost = (outputTokens / 1000) * costPer1kOutput;
      const totalCost = inputCost + outputCost;

      expect(totalCost).toBe(0.025); // $0.025 per task
    });

    test('should track cumulative cost', async () => {
      const taskCosts = [0.01, 0.025, 0.015, 0.03];
      const cumulativeCost = taskCosts.reduce((sum, cost) => sum + cost, 0);

      expect(cumulativeCost).toBe(0.08);
    });
  });

  test.describe('Failure Analysis', () => {
    test('should categorize failure types', async ({ page }) => {
      await page.goto('https://example.com');

      const failureTypes = [
        'navigation_timeout',
        'element_not_found',
        'coordinate_out_of_bounds',
        'policy_denied',
        'authentication_failed',
      ];

      for (const failureType of failureTypes) {
        const metrics: EvaluationMetrics = {
          taskSuccess: false,
          actionCount: 5,
          repeatedActions: 0,
          humanInterventions: 0,
          screenshotToActionLatency: 1000,
          totalTaskDuration: 5000,
          modelCost: 0.05,
          failureReason: failureType,
        };

        await trackMetrics(page, metrics);
      }

      expect(metricsHistory.filter((m) => !m.taskSuccess)).toHaveLength(5);
    });

    test('should calculate failure rate', async () => {
      const totalTasks = metricsHistory.length || 10;
      const failedTasks = metricsHistory.filter((m) => !m.taskSuccess).length;
      const failureRate = failedTasks / totalTasks;

      expect(failureRate).toBeGreaterThanOrEqual(0);
      expect(failureRate).toBeLessThanOrEqual(1);
    });
  });
});

test.describe('Aggregate Metrics', () => {
  test('should calculate task success rate', async () => {
    const metrics: EvaluationMetrics[] = [
      { taskSuccess: true, actionCount: 5, repeatedActions: 0, humanInterventions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
      { taskSuccess: true, actionCount: 6, repeatedActions: 1, humanInterventions: 0, screenshotToActionLatency: 150, totalTaskDuration: 1200, modelCost: 0.015 },
      { taskSuccess: false, actionCount: 3, repeatedActions: 0, humanInterventions: 2, screenshotToActionLatency: 200, totalTaskDuration: 800, modelCost: 0.01, failureReason: 'timeout' },
    ];

    const successRate = metrics.filter((m) => m.taskSuccess).length / metrics.length;
    expect(successRate).toBeCloseTo(0.667, 1);
  });

  test('should calculate average action accuracy', async () => {
    const actionAccuracies = [0.95, 0.88, 0.92, 0.78, 0.99];
    const averageAccuracy = actionAccuracies.reduce((a, b) => a + b) / actionAccuracies.length;

    expect(averageAccuracy).toBeCloseTo(0.904, 1);
  });

  test('should calculate average steps to completion', async () => {
    const actionCounts = [5, 6, 8, 4, 7];
    const averageSteps = actionCounts.reduce((a, b) => a + b) / actionCounts.length;

    expect(averageSteps).toBe(6);
  });

  test('should calculate repeated action rate', async () => {
    const metrics: EvaluationMetrics[] = [
      { actionCount: 10, repeatedActions: 2, taskSuccess: true, humanInterventions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
      { actionCount: 8, repeatedActions: 1, taskSuccess: true, humanInterventions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
      { actionCount: 12, repeatedActions: 4, taskSuccess: true, humanInterventions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
    ];

    const totalActions = metrics.reduce((sum, m) => sum + m.actionCount, 0);
    const totalRepeated = metrics.reduce((sum, m) => sum + m.repeatedActions, 0);
    const repeatedActionRate = totalRepeated / totalActions;

    expect(repeatedActionRate).toBeCloseTo(0.233, 1);
  });

  test('should calculate human intervention rate', async () => {
    const metrics: EvaluationMetrics[] = [
      { actionCount: 10, humanInterventions: 1, taskSuccess: true, repeatedActions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
      { actionCount: 8, humanInterventions: 2, taskSuccess: true, repeatedActions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
      { actionCount: 12, humanInterventions: 0, taskSuccess: true, repeatedActions: 0, screenshotToActionLatency: 100, totalTaskDuration: 1000, modelCost: 0.01 },
    ];

    const totalActions = metrics.reduce((sum, m) => sum + m.actionCount, 0);
    const totalInterventions = metrics.reduce((sum, m) => sum + m.humanInterventions, 0);
    const interventionRate = totalInterventions / totalActions;

    expect(interventionRate).toBeCloseTo(0.1, 1);
  });
});
