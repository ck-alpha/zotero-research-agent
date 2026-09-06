import type { CandidateEvidence } from "./evidence";

export type CandidateSource = "profile_query" | "seed_recommendation";

/** Finite values; scales and normalization belong to future scoring policy. */
export interface CandidateScores {
  semantic?: number;
  lexical?: number;
  graph?: number;
  recency?: number;
  feedback?: number;
  baseScore?: number;
  finalScore?: number;
}

export interface RecommendationCandidate {
  candidateId: string;
  title: string;
  abstract?: string;
  authors: string[];
  /** Source-provided date text; partial dates are allowed. */
  publicationDate?: string;
  doi?: string;
  arxivId?: string;
  openAlexId?: string;
  sources: CandidateSource[];
  seedPaperIds?: string[];
  scores: CandidateScores;
  evidence?: CandidateEvidence;
}
