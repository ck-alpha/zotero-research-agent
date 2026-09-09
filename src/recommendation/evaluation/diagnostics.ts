import type { DiagnosticStage, StageDiagnostic } from "./contracts";

export interface DiagnosticOutcome {
  timeout?: boolean;
  fallback?: boolean;
  failureCode?: string;
}
/** Request-local, opt-in observer. Never persists data or exposes source/error text. */
export class RecommendationDiagnostics {
  private aggregate: DiagnosticOutcome = {};
  constructor(
    private readonly sink?: (record: StageDiagnostic) => void,
    private readonly clock: () => number = () =>
      globalThis.performance?.now() ?? Date.now(),
    private readonly signal?: AbortSignal,
  ) {}
  private time(): number {
    try {
      const n = this.clock();
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  async measure<T>(
    stage: DiagnosticStage,
    work: () => Promise<T>,
    classify?: (result: T) => DiagnosticOutcome,
  ): Promise<T> {
    const start = this.time();
    let outcome: DiagnosticOutcome = {};
    try {
      const result = await work();
      outcome = classify?.(result) ?? {};
      return result;
    } catch (error) {
      outcome = {
        failureCode: this.signal?.aborted
          ? "recommendation_cancelled"
          : `${stage}_failed`,
      };
      throw error;
    } finally {
      if (stage === "total")
        outcome = {
          ...this.aggregate,
          ...outcome,
          timeout: Boolean(this.aggregate.timeout || outcome.timeout),
          fallback: Boolean(this.aggregate.fallback || outcome.fallback),
        };
      else
        this.aggregate = {
          timeout: Boolean(this.aggregate.timeout || outcome.timeout),
          fallback: Boolean(this.aggregate.fallback || outcome.fallback),
          failureCode: outcome.failureCode ?? this.aggregate.failureCode,
        };
      const record: StageDiagnostic = {
        stage,
        durationMs: Math.max(0, this.time() - start),
        timeout: Boolean(outcome.timeout),
        fallback: Boolean(outcome.fallback),
        ...(outcome.failureCode ? { failureCode: outcome.failureCode } : {}),
      };
      try {
        this.sink?.(record);
      } catch {
        /* An observer cannot fail a recommendation. */
      }
    }
  }
}
