import type { ActionProposalV1, ActionResultV1, CompletionProposalV1, MessageId } from '@fara-platform/fara-action-schema';
import { InferenceContractError } from '@fara/agent-orchestrator';
import { IDS, createHarness, observation, succeededResult } from './helpers/fakes.js';

describe('deterministic canonical simulated client', () => {
  test('runs blank page through two ACKed actions to evidenced completion exactly once', async () => {
    const blank = observation({
      observationId: IDS.observationBlank,
      capturedAt: '2026-08-04T10:00:00.000Z',
      url: 'https://fixture.test/blank',
      title: 'Blank',
    });
    const target = observation({
      observationId: IDS.observationTarget,
      capturedAt: '2026-08-04T10:00:05.000Z',
      url: 'https://fixture.test/search',
      title: 'Search',
      screenshotByte: 'b',
    });
    const results = observation({
      observationId: IDS.observationResults,
      capturedAt: '2026-08-04T10:00:10.000Z',
      url: 'https://fixture.test/search?q=boots',
      title: 'Search results',
      screenshotByte: 'c',
    });
    const plans = [
      {
        kind: 'action', observationId: blank.observationId,
        proposedAt: '2026-08-04T10:00:01.000Z',
        action: { type: 'visit_url', url: target.url },
      } as ActionProposalV1,
      {
        kind: 'action', observationId: target.observationId,
        proposedAt: '2026-08-04T10:00:06.000Z',
        action: { type: 'insert_text', text: 'boots' },
      } as ActionProposalV1,
      {
        kind: 'completion', observationId: results.observationId, type: 'terminate',
        status: 'succeeded', summary: 'Search results were captured.',
        findings: [{ fact: 'The results page contains the completed boots search.', observationIds: [results.observationId] }],
        unmetCriteria: [], confidence: 1,
      } as CompletionProposalV1,
    ];
    const { client, engine, inference, store, terminals, trajectory } = createHarness(plans);

    await engine.handle({
      type: 'session.open', sessionId: IDS.session, taskId: IDS.task,
      messageId: '20000000-0000-4000-8000-000000000001' as MessageId,
      goal: 'Search for boots', completionCriteria: ['Results page for boots is visible'],
      occurredAt: blank.capturedAt,
    });
    await engine.handle({
      type: 'observation.submitted', sessionId: IDS.session,
      messageId: '20000000-0000-4000-8000-000000000002' as MessageId,
      observation: blank, occurredAt: blank.capturedAt,
    });

    const first = client.commands[0]!;
    await engine.handle({
      type: 'action.acknowledged', sessionId: IDS.session,
      messageId: '20000000-0000-4000-8000-000000000003' as MessageId,
      clientSequence: 3, actionId: first.actionId, stepId: first.stepId,
      observationId: first.observationId, acknowledgedAt: '2026-08-04T10:00:03.000Z',
      occurredAt: '2026-08-04T10:00:03.000Z',
    });
    client.settled();
    await engine.handle({
      type: 'action.completed', sessionId: IDS.session,
      messageId: '20000000-0000-4000-8000-000000000004' as MessageId,
      result: succeededResult(first, target), occurredAt: '2026-08-04T10:00:04.000Z',
    });

    const second = client.commands[1]!;
    await engine.handle({
      type: 'action.acknowledged', sessionId: IDS.session,
      messageId: '20000000-0000-4000-8000-000000000005' as MessageId,
      clientSequence: 5, actionId: second.actionId, stepId: second.stepId,
      observationId: second.observationId, acknowledgedAt: '2026-08-04T10:00:08.000Z',
      occurredAt: '2026-08-04T10:00:08.000Z',
    });
    client.settled();
    await engine.handle({
      type: 'action.completed', sessionId: IDS.session,
      messageId: '20000000-0000-4000-8000-000000000006' as MessageId,
      result: succeededResult(second, results), occurredAt: '2026-08-04T10:00:09.000Z',
    });

    const session = await store.load(IDS.session as never);
    expect(session).toMatchObject({ state: 'COMPLETED', activeAction: null, terminalReason: { code: 'MODEL_COMPLETION' } });
    expect(inference.maxConcurrent).toBe(1);
    expect(client.maxInFlight).toBe(1);
    expect(client.commands).toHaveLength(2);
    expect(client.commands.map((command) => command.observationId)).toEqual([
      blank.observationId,
      target.observationId,
    ]);
    expect(trajectory.events.map((event) => event.kind)).toEqual([
      'session_lifecycle',
      'observation_captured', 'model_request', 'model_response', 'action_proposed', 'policy_decided', 'action_dispatched',
      'action_acknowledged', 'action_completed',
      'observation_captured', 'model_request', 'model_response', 'action_proposed', 'policy_decided', 'action_dispatched',
      'action_acknowledged', 'action_completed',
      'observation_captured', 'model_request', 'model_response', 'verification_result', 'task_terminal_outcome',
    ]);
    expect(terminals.notifications).toHaveLength(1);
    expect(terminals.notifications[0]).toMatchObject({
      sessionId: IDS.session,
      payload: {
        type: 'task.completed',
        completion: {
          findings: [{ fact: 'The results page contains the completed boots search.', observationIds: [results.observationId] }],
        },
      },
    });
  });

  test('replays one stable terminal after response loss and marks it received on reconnect', async () => {
    const observed = observation({
      observationId: IDS.observationBlank,
      capturedAt: '2026-08-04T10:00:00.000Z',
      url: 'https://fixture.test/already-complete',
      title: 'Already complete',
    });
    const completion = {
      kind: 'completion', observationId: observed.observationId, type: 'terminate',
      status: 'succeeded', summary: 'The requested page is visibly complete.',
      findings: [{ fact: 'The completed fixture is visible.', observationIds: [observed.observationId] }],
      unmetCriteria: [], confidence: 1,
    } as CompletionProposalV1;
    const { engine, store, terminals } = createHarness([completion], [], { failTerminalAfterDeliveryOnce: true });
    await engine.handle({
      type: 'session.open', sessionId: IDS.session, taskId: IDS.task,
      messageId: '21000000-0000-4000-8000-000000000001' as MessageId,
      goal: 'Confirm completion', completionCriteria: ['Completed fixture is visible'],
      occurredAt: observed.capturedAt,
    });
    await expect(engine.handle({
      type: 'observation.submitted', sessionId: IDS.session,
      messageId: '21000000-0000-4000-8000-000000000002' as MessageId,
      observation: observed, occurredAt: observed.capturedAt,
    })).rejects.toThrow('simulated terminal response loss');

    const persisted = await store.load(IDS.session);
    expect(persisted).toMatchObject({ state: 'COMPLETED', terminalDelivery: { status: 'pending' } });
    const terminalSequence = persisted!.terminalDelivery!.notification.sequence;
    await engine.handle({
      type: 'reconcile.request', sessionId: IDS.session,
      messageId: '21000000-0000-4000-8000-000000000003' as MessageId,
      lastReceivedSequence: terminalSequence - 1,
      lastSentClientSequence: 3,
      pendingActionIds: [], occurredAt: '2026-08-04T10:00:05.000Z',
    });
    expect(terminals.attempts).toBe(2);
    expect(terminals.notifications).toHaveLength(1);

    await engine.handle({
      type: 'reconcile.request', sessionId: IDS.session,
      messageId: '21000000-0000-4000-8000-000000000004' as MessageId,
      lastReceivedSequence: terminalSequence,
      lastSentClientSequence: 4,
      pendingActionIds: [], occurredAt: '2026-08-04T10:00:06.000Z',
    });
    expect(terminals.attempts).toBe(2);
    expect(await store.load(IDS.session)).toMatchObject({ terminalDelivery: { status: 'sent' } });
  });

  test('requires a durable ACK, rejects reorder, and ignores an exactly replayed result without re-execution', async () => {
    const before = observation({ observationId: IDS.observationBlank, capturedAt: '2026-08-04T10:00:00.000Z', url: 'https://fixture.test/start', title: 'Start' });
    const after = observation({ observationId: IDS.observationTarget, capturedAt: '2026-08-04T10:00:05.000Z', url: 'https://fixture.test/next', title: 'Next', screenshotByte: 'b' });
    const plan = { kind: 'action', observationId: before.observationId, proposedAt: '2026-08-04T10:00:01.000Z', action: { type: 'left_click', x: 1, y: 1 } } as ActionProposalV1;
    const completion = { kind: 'completion', observationId: after.observationId, type: 'terminate', status: 'succeeded', summary: 'The next page is visible.', findings: [{ fact: 'The next page is visible.', observationIds: [after.observationId] }], unmetCriteria: [], confidence: 1 } as CompletionProposalV1;
    const { client, engine, store, trajectory } = createHarness([plan, completion]);
    await engine.handle({ type: 'session.open', sessionId: IDS.session, taskId: IDS.task, messageId: '22000000-0000-4000-8000-000000000001' as MessageId, goal: 'Advance', completionCriteria: ['Next page visible'], occurredAt: before.capturedAt });
    await engine.handle({ type: 'observation.submitted', sessionId: IDS.session, messageId: '22000000-0000-4000-8000-000000000002' as MessageId, observation: before, occurredAt: before.capturedAt });
    const command = client.commands[0]!;
    const result = succeededResult(command, after);
    const reorderedEvent = { type: 'action.completed' as const, sessionId: IDS.session, messageId: '22000000-0000-4000-8000-000000000004' as MessageId, result, occurredAt: result.completedAt };
    await expect(engine.handle(reorderedEvent)).rejects.toMatchObject({ code: 'ACTION_ACK_REQUIRED' });
    await engine.handle({ type: 'action.acknowledged', sessionId: IDS.session, messageId: '22000000-0000-4000-8000-000000000003' as MessageId, clientSequence: 3, actionId: command.actionId, stepId: command.stepId, observationId: command.observationId, acknowledgedAt: result.startedAt, occurredAt: result.startedAt });
    const completionEvent = { ...reorderedEvent, messageId: '22000000-0000-4000-8000-000000000005' as MessageId };
    const accepted = await engine.handle(completionEvent);
    const replay = await engine.handle(completionEvent);
    expect(replay).toEqual(accepted);
    expect(client.commands).toHaveLength(1);
    expect(trajectory.events.filter((event) => event.kind === 'action_acknowledged')).toHaveLength(1);
    expect(trajectory.events.filter((event) => event.kind === 'action_completed')).toHaveLength(1);
    expect(await store.load(IDS.session)).toMatchObject({ state: 'COMPLETED' });
  });

  test('maps malformed inference, policy denial, terminal action failure, and cancellation to one auditable terminal each', async () => {
    const observed = observation({ observationId: IDS.observationBlank, capturedAt: '2026-08-04T10:00:00.000Z', url: 'https://fixture.test/start', title: 'Start' });
    const openAndObserve = async (harness: ReturnType<typeof createHarness>, suffix: string) => {
      await harness.engine.handle({ type: 'session.open', sessionId: IDS.session, taskId: IDS.task, messageId: `23000000-0000-4000-8000-0000000000${suffix}1` as MessageId, goal: 'Test failure boundary', completionCriteria: ['Complete safely'], occurredAt: observed.capturedAt });
      await harness.engine.handle({ type: 'observation.submitted', sessionId: IDS.session, messageId: `23000000-0000-4000-8000-0000000000${suffix}2` as MessageId, observation: observed, occurredAt: observed.capturedAt });
    };

    const malformed = createHarness([new InferenceContractError('invalid model contract', false)]);
    await openAndObserve(malformed, '1');
    expect(await malformed.store.load(IDS.session)).toMatchObject({ state: 'FAILED', terminalReason: { code: 'INFERENCE_REPAIR_EXHAUSTED' } });
    expect(malformed.terminals.notifications).toHaveLength(1);

    const deniedPlan = { kind: 'action', observationId: observed.observationId, proposedAt: '2026-08-04T10:00:01.000Z', action: { type: 'left_click', x: 1, y: 1 } } as ActionProposalV1;
    const denied = createHarness([deniedPlan], ['denied']);
    await openAndObserve(denied, '2');
    expect(await denied.store.load(IDS.session)).toMatchObject({ state: 'FAILED', terminalReason: { code: 'POLICY_DENIED' } });
    expect(denied.client.commands).toHaveLength(0);
    expect(denied.terminals.notifications).toHaveLength(1);

    const failed = createHarness([deniedPlan]);
    await openAndObserve(failed, '3');
    const command = failed.client.commands[0]!;
    await failed.engine.handle({ type: 'action.acknowledged', sessionId: IDS.session, messageId: '23000000-0000-4000-8000-000000000033' as MessageId, clientSequence: 3, actionId: command.actionId, stepId: command.stepId, observationId: command.observationId, acknowledgedAt: '2026-08-04T10:00:03.000Z', occurredAt: '2026-08-04T10:00:03.000Z' });
    const failedResult = {
      ...succeededResult(command, { ...observed, observationId: IDS.observationTarget, capturedAt: '2026-08-04T10:00:05.000Z' }),
      status: 'failed_terminal', error: { code: 'CDP_DETACHED', message: 'The authoritative tab detached', retryable: false },
    } as ActionResultV1;
    await failed.engine.handle({ type: 'action.completed', sessionId: IDS.session, messageId: '23000000-0000-4000-8000-000000000034' as MessageId, result: failedResult, occurredAt: failedResult.completedAt });
    expect(await failed.store.load(IDS.session)).toMatchObject({ state: 'FAILED', terminalReason: { code: 'ACTION_FAILED_TERMINAL' } });
    expect(failed.terminals.notifications).toHaveLength(1);

    const cancelled = createHarness([]);
    await cancelled.engine.handle({ type: 'session.open', sessionId: IDS.session, taskId: IDS.task, messageId: '23000000-0000-4000-8000-000000000041' as MessageId, goal: 'Cancel safely', completionCriteria: [], occurredAt: observed.capturedAt });
    const cancelEvent = { type: 'task.cancelled' as const, sessionId: IDS.session, messageId: '23000000-0000-4000-8000-000000000042' as MessageId, reason: 'User cancelled before observation', occurredAt: '2026-08-04T10:00:01.000Z' };
    const first = await cancelled.engine.handle(cancelEvent);
    expect(await cancelled.engine.handle(cancelEvent)).toEqual(first);
    expect(await cancelled.store.load(IDS.session)).toMatchObject({ state: 'CANCELLED', activeAction: null, activeInferenceId: null });
    expect(cancelled.terminals.notifications).toHaveLength(1);
    expect(cancelled.trajectory.events.filter((event) => event.kind === 'task_terminal_outcome')).toHaveLength(1);
  });

  test('rejects speculative completion and stops on deterministic no-progress evidence', async () => {
    const observed = observation({ observationId: IDS.observationBlank, capturedAt: '2026-08-04T10:00:00.000Z', url: 'https://fixture.test/unchanged', title: 'Unchanged' });
    const speculative = {
      kind: 'completion', observationId: observed.observationId, type: 'terminate', status: 'succeeded',
      summary: 'The task probably succeeded.',
      findings: [{ fact: 'It seems likely to be complete.', observationIds: [observed.observationId] }],
      unmetCriteria: [], confidence: 0.9,
    } as CompletionProposalV1;
    const uncertain = createHarness([speculative]);
    await uncertain.engine.handle({ type: 'session.open', sessionId: IDS.session, taskId: IDS.task, messageId: '24000000-0000-4000-8000-000000000001' as MessageId, goal: 'Prove completion', completionCriteria: ['Concrete result is visible'], occurredAt: observed.capturedAt });
    await uncertain.engine.handle({ type: 'observation.submitted', sessionId: IDS.session, messageId: '24000000-0000-4000-8000-000000000002' as MessageId, observation: observed, occurredAt: observed.capturedAt });
    expect(await uncertain.store.load(IDS.session)).toMatchObject({ state: 'OBSERVING', terminalReason: null, verifierFailureCount: 1 });
    expect(uncertain.terminals.notifications).toHaveLength(0);

    const plan = { kind: 'action', observationId: observed.observationId, proposedAt: '2026-08-04T10:00:01.000Z', action: { type: 'left_click', x: 1, y: 1 } } as ActionProposalV1;
    const stalled = createHarness([plan], [], { budgets: { maxRepeatedObservations: 2, maxNoVerifiedEffect: 10 } });
    await stalled.engine.handle({ type: 'session.open', sessionId: IDS.session, taskId: IDS.task, messageId: '24000000-0000-4000-8000-000000000011' as MessageId, goal: 'Advance', completionCriteria: ['Page changes'], occurredAt: observed.capturedAt });
    await stalled.engine.handle({ type: 'observation.submitted', sessionId: IDS.session, messageId: '24000000-0000-4000-8000-000000000012' as MessageId, observation: observed, occurredAt: observed.capturedAt });
    const command = stalled.client.commands[0]!;
    await stalled.engine.handle({ type: 'action.acknowledged', sessionId: IDS.session, messageId: '24000000-0000-4000-8000-000000000013' as MessageId, clientSequence: 3, actionId: command.actionId, stepId: command.stepId, observationId: command.observationId, acknowledgedAt: '2026-08-04T10:00:03.000Z', occurredAt: '2026-08-04T10:00:03.000Z' });
    const unchanged = { ...observed, observationId: IDS.observationTarget, capturedAt: '2026-08-04T10:00:05.000Z' };
    const result = succeededResult(command, unchanged);
    await stalled.engine.handle({ type: 'action.completed', sessionId: IDS.session, messageId: '24000000-0000-4000-8000-000000000014' as MessageId, result, occurredAt: result.completedAt });
    expect(await stalled.store.load(IDS.session)).toMatchObject({ state: 'FAILED', terminalReason: { code: 'REPEATED_OBSERVATION' } });
    expect(stalled.inference.inputs).toHaveLength(1);
    expect(stalled.terminals.notifications).toHaveLength(1);
  });
});
