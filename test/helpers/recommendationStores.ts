import type {
  FeedbackQuery,
  FeedbackStore,
  ImpressionStore,
  ProfileStore,
} from "../../src/recommendation/domain/stores";
import type { ResearchProfile } from "../../src/recommendation/domain/profile";
import type { RecommendationFeedback } from "../../src/recommendation/domain/feedback";
import type { RecommendationImpression } from "../../src/recommendation/domain/recommendation";
import {
  assertNonEmptyId,
  assertRecommendationFeedback,
  assertRecommendationImpression,
  assertResearchProfile,
} from "../../src/recommendation/domain/validation";

/** JSON snapshots exercise the future persistence boundary; test data only. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// These test doubles are process-local and intentionally never wired to Zotero.
export class InMemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, ResearchProfile>();

  async load(profileId: string): Promise<ResearchProfile | null> {
    assertNonEmptyId(profileId, "profileId");
    const profile = this.profiles.get(profileId);
    return profile ? clone(profile) : null;
  }

  async save(
    profile: ResearchProfile,
    expectedVersion: number | null,
  ): Promise<void> {
    assertResearchProfile(profile);
    if (
      expectedVersion !== null &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    ) {
      throw new TypeError(
        "expectedVersion must be null or a positive safe integer",
      );
    }
    const current = this.profiles.get(profile.profileId);
    if (
      (current?.version ?? null) !== expectedVersion ||
      profile.version !== (expectedVersion ?? 0) + 1
    ) {
      throw new Error("Profile version conflict");
    }
    this.profiles.set(profile.profileId, clone(profile));
  }
}

export class InMemoryFeedbackStore implements FeedbackStore {
  private readonly events = new Map<string, RecommendationFeedback>();

  async append(event: RecommendationFeedback): Promise<void> {
    assertRecommendationFeedback(event);
    if (this.events.has(event.eventId))
      throw new Error("Duplicate feedback eventId");
    this.events.set(event.eventId, clone(event));
  }

  async list(query: FeedbackQuery = {}): Promise<RecommendationFeedback[]> {
    if (query.paperId !== undefined) assertNonEmptyId(query.paperId, "paperId");
    if (query.recommendationId !== undefined)
      assertNonEmptyId(query.recommendationId, "recommendationId");
    return [...this.events.values()]
      .filter(
        (event) =>
          (query.paperId === undefined || event.paperId === query.paperId) &&
          (query.recommendationId === undefined ||
            event.recommendationId === query.recommendationId),
      )
      .map(clone);
  }
}

export class InMemoryImpressionStore implements ImpressionStore {
  private readonly impressions = new Map<string, RecommendationImpression>();

  async save(impression: RecommendationImpression): Promise<void> {
    assertRecommendationImpression(impression);
    if (this.impressions.has(impression.recommendationId))
      throw new Error("Duplicate impression recommendationId");
    this.impressions.set(impression.recommendationId, clone(impression));
  }

  async load(
    recommendationId: string,
  ): Promise<RecommendationImpression | null> {
    assertNonEmptyId(recommendationId, "recommendationId");
    const impression = this.impressions.get(recommendationId);
    return impression ? clone(impression) : null;
  }
}
