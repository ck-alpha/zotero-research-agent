import type { CandidateScores, RecommendationCandidate } from "./candidate";

/** Snapshot of a displayed paper, preserving metadata and score breakdown. */
export interface RecommendedPaper extends RecommendationCandidate {
  /** One-based display rank, independent of array order. */
  rank: number;
  scores: CandidateScores & { finalScore: number };
  /** Topic IDs from the profile revision used for this impression. */
  matchedTopicIds: string[];
}

export interface RecommendationImpression {
  recommendationId: string;
  timestamp: number;
  profileVersion: number;
  candidates: RecommendedPaper[];
}
