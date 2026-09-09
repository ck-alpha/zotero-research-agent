import type {
  FeedbackAction,
  RecommendationFeedback,
} from "../domain/feedback";
import type { ImpressionStore, ProfileStore } from "../domain/stores";
import {
  assertNonEmptyId,
  assertRecommendationImpression,
} from "../domain/validation";
import { profileIdForLibrary } from "../profile/identity";
import { ProfileVersionConflict } from "../profile/profileStore";
import { feedbackEventId } from "./policy";
import { FeedbackReplay, validateFeedbackRelation } from "./replay";
import { applyProfileFeedback } from "./profileUpdater";
import type { ScopedFeedbackStore } from "./stores";

export type FeedbackInput = {
  libraryID: number;
  recommendationId: string;
  candidateId: string;
  action: FeedbackAction;
  timestamp: number;
};
export class RecommendationFeedbackService {
  readonly replay: FeedbackReplay;
  constructor(
    private readonly profiles: ProfileStore,
    private readonly impressions: ImpressionStore,
    private readonly events: ScopedFeedbackStore,
  ) {
    this.replay = new FeedbackReplay(events, impressions);
  }
  async reconcileProfileFeedback(
    profileId: string,
    now: number,
    onlyIfUnreconciled = false,
  ) {
    assertNonEmptyId(profileId);
    let previousProfileVersion: number | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await this.profiles.load(profileId);
      if (!current) throw new Error("Feedback requires an existing profile");
      previousProfileVersion ??= current.version;
      const state = await this.replay.loadForProfile(profileId, now);
      if (
        onlyIfUnreconciled &&
        current.signalSummary.positiveFeedbackCount ===
          state.positiveFeedbackCount &&
        current.signalSummary.negativeFeedbackCount ===
          state.negativeFeedbackCount
      )
        return {
          profileUpdated: false,
          previousProfileVersion,
          newProfileVersion: current.version,
          warnings: [] as string[],
        };
      const next = applyProfileFeedback(current, state, now);
      if (next.version === current.version)
        return {
          profileUpdated: false,
          previousProfileVersion,
          newProfileVersion: current.version,
          warnings: [] as string[],
        };
      try {
        await this.profiles.save(next, current.version);
        return {
          profileUpdated: true,
          previousProfileVersion,
          newProfileVersion: next.version,
          warnings: current.embedding
            ? ["feedback_profile_embedding_invalidated"]
            : [],
        };
      } catch (error) {
        if (!(error instanceof ProfileVersionConflict)) throw error;
      }
    }
    return {
      profileUpdated: false,
      previousProfileVersion,
      warnings: ["feedback_profile_reconcile_required"],
    };
  }
  async submit(input: FeedbackInput) {
    // Capture/validate primitives before I/O so caller mutation cannot change scope.
    const { libraryID, recommendationId, candidateId, action, timestamp } =
      input;
    const profileId = profileIdForLibrary(libraryID);
    const eventId = feedbackEventId(recommendationId, candidateId, action);
    const event: RecommendationFeedback = {
      eventId,
      recommendationId,
      paperId: candidateId,
      action,
      timestamp,
    };
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
      throw new TypeError("Invalid feedback timestamp");
    const impression = await this.impressions.load(recommendationId);
    if (!impression) throw new Error("Unknown recommendationId");
    assertRecommendationImpression(impression);
    validateFeedbackRelation(event, impression, profileId);
    const profile = await this.profiles.load(profileId);
    if (!profile) throw new Error("Feedback requires an existing profile");
    let existing = await this.events.load(eventId);
    if (!existing) {
      try {
        await this.events.append(event, profileId);
      } catch (error) {
        // Only an actual matching durable event makes a concurrent insert an
        // idempotent success. Transport/schema failures never fall back to memory.
        existing = await this.events.load(eventId);
        if (!existing) throw error;
      }
    }
    if (existing) validateFeedbackRelation(existing, impression, profileId);
    const appliedTopicIds = [
      ...new Set(
        impression.candidates.find((p) => p.candidateId === candidateId)!
          .matchedTopicIds,
      ),
    ].filter((id) => impression.topicSnapshot?.some((t) => t.id === id));
    let reconciliation;
    try {
      reconciliation = await this.reconcileProfileFeedback(
        profileId,
        Math.max(timestamp, profile.updatedAt),
        Boolean(existing),
      );
    } catch {
      reconciliation = {
        profileUpdated: false,
        previousProfileVersion: profile.version,
        warnings: ["feedback_profile_reconcile_required"],
      };
    }
    return {
      eventId,
      recommendationId,
      candidateId,
      action,
      status: existing ? ("already_recorded" as const) : ("recorded" as const),
      feedbackRecorded: true,
      ...reconciliation,
      appliedTopicIds,
      warnings: [
        ...reconciliation.warnings,
        ...(existing ? ["feedback_already_recorded"] : []),
        ...(!appliedTopicIds.length ? ["feedback_no_matched_topics"] : []),
      ],
    };
  }
}
