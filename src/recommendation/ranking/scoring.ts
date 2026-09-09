import type {
  CandidateScores,
  RecommendationCandidate,
} from "../domain/candidate";
import type { RankingConfig } from "./config";
import { clamp, compareText } from "./textSimilarity";
export function baseScore(
  scores: CandidateScores & { preference: number },
  config: RankingConfig,
): number {
  let numerator = 0,
    denominator = 0;
  for (const feature of ["semantic", "lexical", "graph", "recency"] as const) {
    const value = scores[feature];
    if (value !== undefined) {
      const weight = config[`${feature}Weight`];
      numerator += weight * value;
      denominator += weight;
    }
  }
  return clamp((denominator ? numerator / denominator : 0) * scores.preference);
}
export function compareBase(
  a: RecommendationCandidate,
  b: RecommendationCandidate,
): number {
  return (
    (b.scores.baseScore ?? 0) - (a.scores.baseScore ?? 0) ||
    (b.scores.lexical ?? 0) - (a.scores.lexical ?? 0) ||
    (b.scores.semantic ?? -1) - (a.scores.semantic ?? -1) ||
    compareText(a.candidateId, b.candidateId)
  );
}
