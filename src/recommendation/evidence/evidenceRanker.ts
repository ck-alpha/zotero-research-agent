import {
  EVIDENCE_CONFIG as config,
  type RecommendationEvidence,
} from "./contracts";
import { clamp, compareText, textMatch } from "../ranking/textSimilarity";

export function evidenceConfidence(
  snippet: string,
  topics: readonly string[],
  source: RecommendationEvidence["sourceType"],
  sourceTime: number | undefined,
  now: number,
): number {
  const match = Math.max(0, ...topics.map((t) => textMatch(snippet, t)));
  const freshness =
    sourceTime !== undefined && sourceTime > 0 && sourceTime <= now
      ? 2 ** (-(now - sourceTime) / config.freshnessHalfLifeMs)
      : 0;
  return Number(
    clamp(
      config.weights.topic * match +
        config.weights.quality * config.quality[source] +
        config.weights.freshness * freshness +
        config.weights.completeness *
          Math.min(1, snippet.length / config.maxSnippetChars),
    ).toFixed(6),
  );
}
export function rankEvidence(
  evidence: readonly RecommendationEvidence[],
): RecommendationEvidence[] {
  return [...evidence].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      compareText(a.reference, b.reference) ||
      compareText(a.evidenceId, b.evidenceId),
  );
}
