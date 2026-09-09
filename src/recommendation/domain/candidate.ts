import type { CandidateEvidence } from "./evidence";

export type CandidateSource = "profile_query" | "seed_recommendation";

export type CandidateDiscoveryProvider = "openalex" | "arxiv" | "europepmc";

/** Provider order is a recall trace, never a personalized score. */
export type CandidateProvenance =
  | {
      route: "profile_query";
      provider: CandidateDiscoveryProvider;
      /** One-based position in this provider response. */
      providerRank: number;
      query: string;
      topicId?: string;
      focus?: boolean;
    }
  | {
      route: "seed_recommendation";
      provider: CandidateDiscoveryProvider;
      providerRank: number;
      seedPaperId: string;
    };

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
  sourceUrl?: string;
  openAccessUrl?: string;
  provenance: CandidateProvenance[];
  /** Unique routes from provenance, in discovery order. */
  sources: CandidateSource[];
  /** Unique seed IDs from provenance. */
  seedPaperIds?: string[];
  scores: CandidateScores;
  evidence?: CandidateEvidence;
}
