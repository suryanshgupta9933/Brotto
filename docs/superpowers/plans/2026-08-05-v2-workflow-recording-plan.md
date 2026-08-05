# v2 Plan: Workflow Recording + Deterministic Replay

## Goal

Capture agent exploration sessions and convert them into **deterministic workflows** that can replay step-by-step with self-healing when elements drift.

## Problem Statement

Current canonical loop is purely reactive — every action is decided at runtime by the model. For repetitive workflows (form filling, data extraction, QA testing), we need:

1. **Capture** — Record a complete session: observations + actions + approvals
2. **Convert** — Transform captured session into deterministic workflow steps
3. **Replay** — Execute workflow with self-healing when elements don't match

## Architecture

```
[Browser Extension]
    | captures Observation + Action + Approval per step
    v
[Session Recording Store] — IndexedDB in extension, exported as JSON
    |
    v
[Workflow Converter] — Offline tool (Node CLI or web page)
    | converts session → WorkflowDefinition
    v
[Workflow Definition] — JSON with deterministic steps
    |
    v
[Workflow Replayer] — Extension module, executes steps
    | uses StableRef.match() for self-healing
    v
[Browser Actions] — Same CDP commands, verified targets
```

## Data Model

### SessionRecording

```typescript
interface SessionRecording {
  id: string
  startTime: number
  endTime: number
  url: string
  steps: RecordedStep[]
  metadata: {
    userAgent: string
    viewport: { width: number, height: number }
  }
}

interface RecordedStep {
  stepIndex: number
  observation: Observation        // includes accessibilityNodes + semanticTargets
  action: AgentAction | null      // null if model chose not to act
  approval: ApprovalResult | null // null if no approval needed
  targetRef?: StableRef            // resolved stable ref used for action
  timestamp: number
  error?: string
}
```

### WorkflowDefinition

```typescript
interface WorkflowDefinition {
  version: "1.0"
  name: string
  description: string
  steps: WorkflowStep[]
  retryPolicy: RetryPolicy
}

interface WorkflowStep {
  index: number
  action: "click" | "type" | "scroll" | "wait" | "navigate" | "extract"
  target: StableRef | null        // null = model decides at runtime
  params: Record<string, any>     // e.g., { text: "hello", submit: true }
  optional: boolean               // skip if target not found (self-healing)
  extract?: ExtractSpec            // for extract actions
}

interface RetryPolicy {
  maxAttempts: number
  fallbackToModel: boolean        // if true, call model when ref not found
  timeoutMs: number
}
```

## Implementation: Session Recording

### RecordingController (Priority: High)

New module wrapping `CanonicalExtensionController`:

```typescript
class RecordingController {
  private isRecording: boolean
  private recordedSteps: RecordedStep[]

  startRecording(): void
  stopRecording(): SessionRecording
  captureStep(
    observation: Observation,
    action: AgentAction | null,
    approval: ApprovalResult | null
  ): void
}
```

**Storage**: IndexedDB via `idb` library (lightweight, async)

### Observable Pipeline (Priority: High)

Wrap `executeAction()` to emit `RecordedStep` events:

```typescript
// In controller.ts, around the execution pipeline:
const stepRecord: RecordedStep = {
  stepIndex: this.recordedSteps.length,
  observation,
  action,
  approval,
  targetRef: action?.targetRef,
  timestamp: Date.now()
}
this.recordingController?.captureStep(stepRecord)
```

## Implementation: Workflow Converter

### CLI Tool (Priority: Medium)

```
npx workflow-converter ./session-recording.json --name "Login Flow" --output ./workflows/login.json
```

**Conversion logic**:
1. Parse `SessionRecording.steps`
2. Filter to steps with non-null `action` and `targetRef`
3. Deduplicate sequential same-action (e.g., rapid clicks → single click)
4. Convert to `WorkflowStep[]`
5. Infer `retryPolicy` from step errors (add retry on steps that failed)
6. Output `WorkflowDefinition`

### Web UI Converter (Priority: Low)

Simple drag-drop page to convert and preview workflows.

## Implementation: Workflow Replayer

### ReplayController (Priority: High)

```typescript
class ReplayController {
  constructor(
    private workflow: WorkflowDefinition,
    private replayer: ReplayController
  )

  async execute(): Promise<ReplayResult> {
    for (const step of this.workflow.steps) {
      const result = await this.executeStep(step)
      if (result.error && !step.optional) {
        if (this.workflow.retryPolicy.fallbackToModel) {
          // Call model to handle this step
          await this.handleWithModel(step)
        } else {
          throw new ReplayError(step, result.error)
        }
      }
    }
  }
}
```

### Self-Healing Logic (Priority: High)

When `StableRef.match()` fails for a step:

1. **Attempt 1**: Retry with looser bounds tolerance (±10px)
2. **Attempt 2**: Match by role + nearest accessible name
3. **Attempt 3**: If `fallbackToModel`, send observation to model with context
4. **Attempt 4**: Skip if `optional: true`, continue workflow

### Recovery Points (Priority: Medium)

For long workflows, save checkpoint after each N steps:
```typescript
interface Checkpoint {
  stepIndex: number
  snapshot: Observation       // full page state at checkpoint
  pendingSteps: WorkflowStep[] // remaining steps
}
```

On replay start, offer "resume from checkpoint" option.

## Files to Create

- `clients/browser-extension/src/canonical/recording-controller.ts` — Recording logic
- `clients/browser-extension/src/canonical/replay-controller.ts` — Workflow replay
- `clients/browser-extension/src/canonical/workflow-types.ts` — `WorkflowDefinition`, `WorkflowStep`, etc.
- `clients/browser-extension/src/storage.ts` — IndexedDB wrapper
- `tools/workflow-converter/` — Node CLI for conversion

## Verification

- [ ] Record a 10-step session, export to JSON
- [ ] Convert JSON to WorkflowDefinition
- [ ] Replay workflow — all steps execute with verified targets
- [ ] Introduce element drift (add offset to target) — self-healing kicks in
- [ ] Optional step not found — replay continues
- [ ] Non-optional step not found + fallbackToModel=false — replay fails with clear error

## Notes

- Recording adds overhead (~50ms per step) — make it configurable (off by default)
- Export format is JSON for portability — no backend required
- Consider encrypted export for sensitive workflows (credentials in params)
