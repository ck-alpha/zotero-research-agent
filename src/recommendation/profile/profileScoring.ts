import type { RepresentativePaper } from "../domain/profile";

export const PROFILE_SCORING = Object.freeze({
  halfLifeDays: 180,
  manualTagQuality: 1,
  collectionQuality: 0.65,
  llmQuality: 0.45,
  interestScale: 3,
  inferredWeightCeiling: 0.75,
  confidenceScale: 2,
  representativeRecencyShare: 0.3,
  maxTopics: 40,
  maxEvidenceRefs: 12,
  maxRepresentativePapers: 12,
});
export type ProfileScoringConfig = {
  [K in keyof typeof PROFILE_SCORING]: number;
};
export const DAY_MS = 86_400_000;
export const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export function timeDecay(
  timestamp: number,
  now: number,
  halfLifeDays: number = PROFILE_SCORING.halfLifeDays,
): number {
  if (
    ![timestamp, now].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    !Number.isFinite(halfLifeDays) ||
    halfLifeDays <= 0
  ) {
    throw new TypeError("Invalid time decay input");
  }
  return 2 ** (-Math.max(0, now - timestamp) / DAY_MS / halfLifeDays);
}

export function scoreTopic(
  evidence: readonly { quality: number; addedAt: number }[],
  now: number,
  positive: number,
  negative: number,
  config: ProfileScoringConfig,
): { weight: number; confidence: number } {
  const decayed = evidence.reduce(
    (sum, signal) =>
      sum +
      signal.quality * timeDecay(signal.addedAt, now, config.halfLifeDays),
    0,
  );
  const quality = evidence.reduce((sum, signal) => sum + signal.quality, 0);
  const inferred =
    config.inferredWeightCeiling *
    (1 - Math.exp(-decayed / config.interestScale));
  return {
    // Explicit preferences are not time-decayed; negative wins an exact tie.
    weight: clampUnit(Math.max(inferred, positive) * (1 - negative)),
    // Certainty measures independent supporting evidence, not interest intensity.
    confidence: clampUnit(
      Math.max(
        1 - Math.exp(-quality / config.confidenceScale),
        positive,
        negative,
      ),
    ),
  };
}

export function validateScoringConfig(config: ProfileScoringConfig): void {
  for (const key of Object.keys(
    PROFILE_SCORING,
  ) as (keyof ProfileScoringConfig)[]) {
    const value = config[key];
    if (!Number.isFinite(value) || value <= 0)
      throw new TypeError(`Invalid scoring config: ${key}`);
    if (key.startsWith("max") && !Number.isSafeInteger(value))
      throw new TypeError(`Invalid scoring limit: ${key}`);
  }
  for (const key of [
    "manualTagQuality",
    "collectionQuality",
    "llmQuality",
    "inferredWeightCeiling",
    "representativeRecencyShare",
  ] as const) {
    if (config[key] > 1) throw new TypeError(`Invalid scoring config: ${key}`);
  }
}

export function scoreRepresentative(
  evidence: readonly {
    topicWeight: number;
    quality: number;
    positive: number;
    negative: number;
  }[],
  addedAt: number,
  now: number,
  config: ProfileScoringConfig,
): Pick<RepresentativePaper, "weight" | "reason"> {
  const relevance = evidence.reduce(
    (best, topic) => Math.max(best, topic.topicWeight * topic.quality),
    0,
  );
  const explicitPositive = evidence.some(
    (topic) => topic.positive > 0 && topic.positive > topic.negative,
  );
  const recency = timeDecay(addedAt, now, config.halfLifeDays);
  const share = config.representativeRecencyShare;
  return {
    weight: share * recency + (1 - share) * relevance,
    reason: explicitPositive
      ? "explicit_positive"
      : (1 - share) * relevance > share * recency
        ? "high_topic_relevance"
        : "recent",
  };
}
