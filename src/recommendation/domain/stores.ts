import type { ResearchProfile } from "./profile";
import type { RecommendationFeedback } from "./feedback";
import type { RecommendationImpression } from "./recommendation";

/**
 * All adapters must validate writes, reject invalid input without mutation,
 * and return detached snapshots. Missing IDs return null. Invalid lookup IDs
 * reject. Async boundaries allow later transactional SQLite/Zotero.DB adapters.
 * These interfaces do not provide production persistence in Phase 1.
 */
export interface ProfileStore {
  load(profileId: string): Promise<ResearchProfile | null>;
  /**
   * Atomic compare-and-swap: null creates version 1 only if absent; otherwise
   * the stored version must equal expectedVersion and the new version must be
   * expectedVersion + 1. Reject conflicts; never silently overwrite a revision.
   * Stores retain the latest snapshot only; revision history is deferred.
   */
  save(profile: ResearchProfile, expectedVersion: number | null): Promise<void>;
}

export interface FeedbackQuery {
  paperId?: string;
  recommendationId?: string;
}

export interface FeedbackStore {
  /** Reject duplicate eventId, including identical retries; never overwrite. */
  append(event: RecommendationFeedback): Promise<void>;
  /** In append order; when both filters are present they are ANDed. */
  list(query?: FeedbackQuery): Promise<RecommendationFeedback[]>;
}

export interface ImpressionStore {
  /** Create an immutable exposure snapshot; reject duplicate recommendationId. */
  save(impression: RecommendationImpression): Promise<void>;
  load(recommendationId: string): Promise<RecommendationImpression | null>;
}
