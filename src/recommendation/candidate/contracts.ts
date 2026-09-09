import type {
  CandidateDiscoveryProvider,
  RecommendationCandidate,
} from "../domain/candidate";
import type { ResearchProfile } from "../domain/profile";
import type { ResearchLibrarySnapshot } from "../profile/contracts";

/** Metadata boundary only: no Agent, Zotero objects, provider payloads or scores. */
export interface ExternalPaper {
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  doi?: string;
  arxivId?: string;
  openAlexId?: string;
  sourceUrl?: string;
  openAccessUrl?: string;
  provider: CandidateDiscoveryProvider;
}

export interface TopicSearchRequest {
  query: string;
  limit: number;
  signal?: AbortSignal;
}

export interface SeedRelatedRequest {
  doi: string;
  limit: number;
  signal?: AbortSignal;
}

export interface LiteratureDiscoveryBatch {
  papers: ExternalPaper[];
  /** Compact candidate_* codes. Transport errors must not leak credentials. */
  warnings: string[];
}

export interface LiteratureDiscoverySource {
  search(input: TopicSearchRequest): Promise<LiteratureDiscoveryBatch>;
  related(input: SeedRelatedRequest): Promise<LiteratureDiscoveryBatch>;
}

export interface CandidateDiscoveryInput {
  libraryID: number;
  profile: ResearchProfile;
  snapshot: ResearchLibrarySnapshot;
  focus?: string;
  signal?: AbortSignal;
}

export interface CandidateDiscoveryDiagnostics {
  queriesPlanned: number;
  queriesSucceeded: number;
  queriesFailed: number;
  seedsPlanned: number;
  seedsSucceeded: number;
  seedsFailed: number;
  seedsSkippedWithoutDoi: number;
  seedsSkippedMissingPaper: number;
  rawCandidateCount: number;
  invalidCandidateCount: number;
  existingLibraryExcluded: number;
  duplicateCandidatesMerged: number;
  finalCandidateCount: number;
  poolTruncated: boolean;
}

export interface CandidateDiscoveryResult {
  profileId: string;
  profileVersion: number;
  generatedAt: number;
  focus?: string;
  candidates: RecommendationCandidate[];
  diagnostics: CandidateDiscoveryDiagnostics;
  warnings: string[];
}
