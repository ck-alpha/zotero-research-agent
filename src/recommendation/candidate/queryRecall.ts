import type { ResearchProfile } from "../domain/profile";
import { compareText } from "../profile/topicNormalization";
import {
  CANDIDATE_DISCOVERY_LIMITS,
  resolveCandidateLimits,
  type CandidateDiscoveryLimits,
} from "./config";

export interface PlannedQuery {
  query: string;
  topicId?: string;
  focus?: boolean;
}

const queryKey = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

/** Focus is ephemeral and never changes the profile or its revision. */
export function normalizeCandidateFocus(
  focus: unknown,
  maxChars: number = CANDIDATE_DISCOVERY_LIMITS.maxFocusChars,
): string | undefined {
  if (focus === undefined) return undefined;
  if (typeof focus !== "string" || focus.length > maxChars)
    throw new TypeError("Invalid candidate focus");
  const display = focus.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    !display ||
    display.length > maxChars ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(display) ||
    !/[\p{L}\p{N}]/u.test(display)
  )
    throw new TypeError("Invalid candidate focus");
  return display;
}

export function buildQueryPlan(
  profile: ResearchProfile,
  focus?: string,
  overrides: Partial<CandidateDiscoveryLimits> = {},
): { queries: PlannedQuery[]; focus?: string; warnings: string[] } {
  const limits = resolveCandidateLimits(overrides);
  const normalizedFocus = normalizeCandidateFocus(focus, limits.maxFocusChars);
  const negativeIds = new Set(
    profile.explicitPreferences.negativeTopics.map((topic) => topic.id),
  );
  const negativeKeys = new Set(
    profile.explicitPreferences.negativeTopics.map((topic) =>
      queryKey(topic.label),
    ),
  );
  const topics = profile.topics
    .filter(
      (topic) =>
        Number.isFinite(topic.weight) &&
        topic.weight > 0 &&
        topic.weight <= 1 &&
        Number.isFinite(topic.confidence) &&
        topic.confidence > 0 &&
        topic.confidence <= 1 &&
        queryKey(topic.label) &&
        !negativeIds.has(topic.id) &&
        !negativeKeys.has(queryKey(topic.label)),
    )
    .sort(
      (a, b) =>
        b.weight * b.confidence - a.weight * a.confidence ||
        compareText(a.id, b.id) ||
        compareText(a.label, b.label),
    );
  const queries: PlannedQuery[] = normalizedFocus
    ? [{ query: normalizedFocus, focus: true }]
    : [];
  const seen = new Set(queries.map((entry) => queryKey(entry.query)));
  for (const topic of topics) {
    if (queries.length >= limits.maxQueries) break;
    const key = queryKey(topic.label);
    if (seen.has(key)) continue;
    seen.add(key);
    // Preserve the saved display label, while comparison uses a normalized key.
    queries.push({ query: topic.label, topicId: topic.id });
  }
  return {
    queries,
    focus: normalizedFocus,
    warnings: topics.length ? [] : ["candidate_profile_has_no_topics"],
  };
}
