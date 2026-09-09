import type { ResearchProfile, TopicInterest } from "../domain/profile";
import { assertNonEmptyId, assertResearchProfile } from "../domain/validation";
import {
  PROFILE_SCORING,
  clampUnit,
  timeDecay,
} from "../profile/profileScoring";
import { compareText, normalizeTopic } from "../profile/topicNormalization";
import type { FeedbackProfileState } from "./replay";

function validateState(state: FeedbackProfileState, now: number): void {
  for (const count of [
    state.positiveFeedbackCount,
    state.negativeFeedbackCount,
  ])
    if (!Number.isSafeInteger(count) || count < 0)
      throw new TypeError("Invalid feedback count");
  const ids = new Set<string>();
  for (const t of state.topics) {
    assertNonEmptyId(t.id);
    assertNonEmptyId(t.label);
    if (ids.has(t.id)) throw new TypeError("Duplicate feedback topic");
    ids.add(t.id);
    for (const value of [t.positive, t.negative])
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new TypeError("Invalid feedback aggregate");
    timeDecay(t.lastEvidenceAt, now);
    if (t.lastEvidenceAt > now) throw new TypeError("Future feedback evidence");
    for (const ref of t.evidenceRefs)
      if (
        typeof ref !== "string" ||
        !ref.startsWith("feedback:") ||
        ref.length <= 9
      )
        throw new TypeError("Invalid feedback evidence");
  }
}

/** Full replay against an immutable baseline, never against previously boosted scores. */
export function applyProfileFeedback(
  profile: ResearchProfile,
  state: FeedbackProfileState,
  now: number,
  rebuild = false,
): ResearchProfile {
  assertResearchProfile(profile);
  timeDecay(now, now);
  validateState(state, now);
  if (now < profile.updatedAt)
    throw new TypeError("Profile time cannot move backwards");
  if (
    !profile.feedbackBaseTopics &&
    profile.topics.some((t) => t.sources.includes("feedback"))
  )
    throw new Error(
      "Feedback baseline missing; refresh profile before reconciliation",
    );
  const next: ResearchProfile = JSON.parse(JSON.stringify(profile));
  const base = next.feedbackBaseTopics ?? next.topics;
  if (
    base.some(
      (t) =>
        t.sources.includes("feedback") ||
        t.evidenceRefs.some((r) => r.startsWith("feedback:")),
    )
  )
    throw new TypeError("Invalid non-feedback baseline");
  const topics = new Map<string, TopicInterest>(
    base.map((t) => [t.id, JSON.parse(JSON.stringify(t))]),
  );
  for (const f of state.topics) {
    if (f.positive === 0 && f.negative === 0) continue;
    const t = topics.get(f.id) ?? {
      id: f.id,
      label: f.label,
      weight: 0,
      confidence: 0,
      sources: [],
      lastEvidenceAt: 0,
      evidenceRefs: [],
    };
    // Baseline already includes explicit positive/negative preferences. Apply
    // additional feedback penalty only beyond the explicit penalty already paid.
    const negative = profile.explicitPreferences.negativeTopics
      .filter(
        (p) => normalizeTopic(p.label).key === normalizeTopic(t.label).key,
      )
      .reduce((m, p) => Math.max(m, p.strength), 0);
    const unpenalized = negative < 1 ? t.weight / (1 - negative) : 0;
    t.weight = clampUnit(
      Math.max(unpenalized, f.positive) * (1 - Math.max(negative, f.negative)),
    );
    t.confidence = clampUnit(Math.max(t.confidence, f.positive, f.negative));
    t.sources = [...t.sources, "feedback"];
    t.lastEvidenceAt = Math.max(t.lastEvidenceAt, f.lastEvidenceAt);
    // Preserve the non-feedback evidence; reserve the remaining bounded slots
    // for newest event refs, with one feedback ref even for a full baseline.
    const refs = t.evidenceRefs.slice(0, PROFILE_SCORING.maxEvidenceRefs - 1);
    t.evidenceRefs = [
      ...refs,
      ...f.evidenceRefs.slice(0, PROFILE_SCORING.maxEvidenceRefs - refs.length),
    ];
    topics.set(t.id, t);
  }
  next.topics = [...topics.values()]
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.confidence - a.confidence ||
        compareText(a.id, b.id),
    )
    .slice(0, PROFILE_SCORING.maxTopics);
  next.signalSummary.positiveFeedbackCount = state.positiveFeedbackCount;
  next.signalSummary.negativeFeedbackCount = state.negativeFeedbackCount;
  const changed =
    JSON.stringify(next.topics) !== JSON.stringify(profile.topics) ||
    JSON.stringify(next.signalSummary) !==
      JSON.stringify(profile.signalSummary);
  if (!changed) return JSON.parse(JSON.stringify(profile));
  next.feedbackBaseTopics = JSON.parse(JSON.stringify(base));
  next.version = profile.version + (rebuild ? 0 : 1);
  next.updatedAt = now;
  delete next.embedding;
  assertResearchProfile(next);
  return next;
}
