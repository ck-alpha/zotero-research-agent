import type { ImpressionStore } from "../domain/stores";
import type { RecommendationImpression } from "../domain/recommendation";
import type { RecommendationFeedback } from "../domain/feedback";
import {
  assertRecommendationFeedback,
  assertRecommendationImpression,
} from "../domain/validation";
import { timeDecay } from "../profile/profileScoring";
import { compareText } from "../profile/topicNormalization";
import type { ScopedFeedbackStore } from "./stores";
import {
  feedbackEventId,
  FEEDBACK_STRENGTH,
  FEEDBACK_HALF_LIFE_DAYS,
  saturateFeedback,
} from "./policy";

export interface FeedbackTopicAggregate {
  id: string;
  label: string;
  positive: number;
  negative: number;
  lastEvidenceAt: number;
  evidenceRefs: string[];
}
export interface FeedbackProfileState {
  topics: FeedbackTopicAggregate[];
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
}
export interface ProfileFeedbackSource {
  loadForProfile(profileId: string, now: number): Promise<FeedbackProfileState>;
}
export function validateFeedbackRelation(
  event: RecommendationFeedback,
  impression: RecommendationImpression,
  profileId: string,
): void {
  assertRecommendationFeedback(event);
  assertRecommendationImpression(impression);
  if (
    impression.profileId !== profileId ||
    event.recommendationId !== impression.recommendationId ||
    event.timestamp < impression.timestamp ||
    impression.candidates.filter((p) => p.candidateId === event.paperId)
      .length !== 1 ||
    event.eventId !==
      feedbackEventId(event.recommendationId, event.paperId, event.action)
  )
    throw new Error("Invalid feedback impression relation");
}

export class FeedbackReplay implements ProfileFeedbackSource {
  constructor(
    private readonly events: ScopedFeedbackStore,
    private readonly impressions: ImpressionStore,
  ) {}
  async loadForProfile(
    profileId: string,
    now: number,
  ): Promise<FeedbackProfileState> {
    timeDecay(now, now);
    const events = await this.events.list({ profileId });
    const seen = new Set<string>();
    const impressions = new Map<string, RecommendationImpression>();
    const topics = new Map<
      string,
      {
        id: string;
        label: string;
        positive: number;
        negative: number;
        lastEvidenceAt: number;
        refs: { id: string; timestamp: number }[];
      }
    >();
    let positiveFeedbackCount = 0,
      negativeFeedbackCount = 0;
    // Fixed event order also fixes floating-point summation and conflicting labels.
    for (const e of events.sort(
      (a, b) => a.timestamp - b.timestamp || compareText(a.eventId, b.eventId),
    )) {
      let impression = impressions.get(e.recommendationId);
      if (!impression) {
        impression =
          (await this.impressions.load(e.recommendationId)) ?? undefined;
        if (!impression) throw new Error("Missing feedback impression");
        impressions.set(e.recommendationId, impression);
      }
      validateFeedbackRelation(e, impression, profileId);
      if (e.timestamp > now)
        throw new Error("Feedback timestamp is in the future");
      if (seen.has(e.eventId)) continue;
      seen.add(e.eventId);
      const strength = FEEDBACK_STRENGTH[e.action];
      if (strength > 0) positiveFeedbackCount++;
      else negativeFeedbackCount++;
      const paper = impression.candidates.find(
        (p) => p.candidateId === e.paperId,
      )!;
      const mass =
        Math.abs(strength) *
        timeDecay(e.timestamp, now, FEEDBACK_HALF_LIFE_DAYS);
      for (const id of new Set(paper.matchedTopicIds)) {
        const snapshot = impression.topicSnapshot?.find((t) => t.id === id);
        if (!snapshot) continue; // Legacy exposure without a label cannot invent one.
        const topic = topics.get(id) ?? {
          ...snapshot,
          positive: 0,
          negative: 0,
          lastEvidenceAt: 0,
          refs: [],
        };
        topic.label = snapshot.label;
        topic[strength > 0 ? "positive" : "negative"] += mass;
        topic.lastEvidenceAt = Math.max(topic.lastEvidenceAt, e.timestamp);
        topic.refs.push({ id: e.eventId, timestamp: e.timestamp });
        topics.set(id, topic);
      }
    }
    return {
      positiveFeedbackCount,
      negativeFeedbackCount,
      topics: [...topics.values()]
        .sort((a, b) => compareText(a.id, b.id))
        .map((t) => ({
          id: t.id,
          label: t.label,
          positive: saturateFeedback(t.positive),
          negative: saturateFeedback(t.negative),
          lastEvidenceAt: t.lastEvidenceAt,
          evidenceRefs: t.refs
            .sort(
              (a, b) => b.timestamp - a.timestamp || compareText(a.id, b.id),
            )
            .slice(0, 12)
            .map((r) => `feedback:${r.id}`),
        })),
    };
  }
}
