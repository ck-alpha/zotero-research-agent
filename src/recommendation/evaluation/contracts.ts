import type { ResearchProfile } from "../domain/profile";
import type { RecommendationCandidate } from "../domain/candidate";
import type { RecommendedPaper } from "../domain/recommendation";
import type { EvidenceResult } from "../evidence/contracts";

/** Fixed inputs only; no providers, clocks, stores or host objects. */
export interface RecommendationEvaluationCase {
  id: string;
  profile: ResearchProfile;
  candidates: RecommendationCandidate[];
  now: number;
  topK: number;
  expectedSignals?: {
    preferredCandidateIds?: string[];
    rejectedCandidateIds?: string[];
  };
  /** Exact candidate identities already known to the user. Omitted = unmeasured. */
  knownCandidateIds?: string[];
}
export interface RankingMetrics {
  precisionAtK: number | null;
  recallAtK: number | null;
  mrr: number | null;
  ndcgAtK: number | null;
  diversityScore: number;
  noveltyRate: number | null;
  rejectedAtK: number;
}
export interface EvidenceMetrics {
  evidenceAvailability: number;
  /** Fraction of ranked matched topics supported by valid reasons. */
  evidenceCoverage: number;
  reasonGroundingRate: number;
  unsupportedExplanationCount: number;
}
export interface EvaluatedRecommendation {
  paper: RecommendedPaper;
  explanation: EvidenceResult;
}
export interface RecommendationEvaluationResult {
  caseId: string;
  rankingMetrics: RankingMetrics;
  evidenceMetrics: EvidenceMetrics;
  recommendations: EvaluatedRecommendation[];
  warnings: string[];
  trace: string;
}
export type DiagnosticStage = "discovery" | "ranking" | "evidence" | "total";
export interface StageDiagnostic {
  stage: DiagnosticStage;
  durationMs: number;
  timeout: boolean;
  fallback: boolean;
  failureCode?: string;
}
