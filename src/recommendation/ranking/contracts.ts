import type { ResearchProfile } from "../domain/profile";
import type { RecommendationCandidate } from "../domain/candidate";
import type { RecommendedPaper } from "../domain/recommendation";

export interface RankingEmbeddingProvider {
  embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<{ model: string; vectors: number[][] }>;
}
export interface RankingInput {
  profile: ResearchProfile;
  candidates: RecommendationCandidate[];
  focus?: string;
  now: number;
  semanticProvider?: RankingEmbeddingProvider;
  signal?: AbortSignal;
  topK?: number;
}
export interface RankingResult {
  profileId: string;
  profileVersion: number;
  generatedAt: number;
  focus?: string;
  recommendations: RecommendedPaper[];
  diagnostics: {
    inputCandidateCount: number;
    semanticRequested: boolean;
    semanticSucceeded: boolean;
    semanticCandidateCount: number;
    semanticFallback: boolean;
    semanticTimedOut?: boolean;
    topKRequested: number;
    topKReturned: number;
  };
  warnings: string[];
}
