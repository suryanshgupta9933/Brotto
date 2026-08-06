interface StepRecord {
  stepIndex: number;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
}

export class MetricsCollector {
  private steps: StepRecord[] = [];
  private startedAt = Date.now();

  recordStep(elapsedMs: number, tokens: { prompt: number; completion: number }): void {
    this.steps.push({
      stepIndex: this.steps.length,
      elapsedMs,
      promptTokens: tokens.prompt,
      completionTokens: tokens.completion,
    });
  }

  printSummary(): void {
    const total = Date.now() - this.startedAt;
    const steps = this.steps.length;
    const stepLatencies = this.steps.map((s) => s.elapsedMs).sort((a, b) => a - b);
    const p50 = stepLatencies[Math.floor(steps / 2)] ?? 0;
    const p95 = stepLatencies[Math.floor(steps * 0.95)] ?? 0;
    const max = stepLatencies[stepLatencies.length - 1] ?? 0;
    const totalPrompt = this.steps.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = this.steps.reduce((s, r) => s + r.completionTokens, 0);
    const totalTokens = totalPrompt + totalCompletion;

    console.log("\n=== E2E Metrics ===");
    console.log(`Total wall time:    ${(total / 1000).toFixed(2)}s`);
    console.log(`Steps:              ${steps}`);
    console.log(`Per-step latency:   p50=${p50}ms p95=${p95}ms max=${max}ms`);
    console.log(`Prompt tokens:      ${totalPrompt}`);
    console.log(`Completion tokens:  ${totalCompletion}`);
    console.log(`Total tokens:       ${totalTokens}`);
    console.log("====================\n");
  }

  printOnSuccess(stepCount: number): void {
    console.log(`[e2e] task completed in ${stepCount} steps`);
  }
}
