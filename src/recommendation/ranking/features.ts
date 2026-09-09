import type { RecommendationCandidate } from "../domain/candidate";
import type { ResearchProfile } from "../domain/profile";
import type { RankingConfig } from "./config";
import {
  candidateText,
  clamp,
  compareText,
  normalizeText,
  textMatch,
} from "./textSimilarity";

export function positiveTopics(profile: ResearchProfile) {
  const negatives = profile.explicitPreferences.negativeTopics;
  return profile.topics
    .filter(
      (t) =>
        t.weight * t.confidence > 0 &&
        !negatives.some(
          (n) =>
            n.id === t.id || normalizeText(n.label) === normalizeText(t.label),
        ),
    )
    .sort(
      (a, b) =>
        b.weight * b.confidence - a.weight * a.confidence ||
        compareText(a.id, b.id),
    );
}
export function graphFeature(candidate: RecommendationCandidate): number {
  return candidate.provenance.reduce(
    (best, p) =>
      p.route === "seed_recommendation"
        ? Math.max(best, clamp(1 / Math.log2(p.providerRank + 1)))
        : best,
    0,
  );
}
export function recencyFeature(
  date: string | undefined,
  now: number,
  halfLife: number,
): number | undefined {
  const match = date?.trim().match(/^(\d{4})(?=$|[-/\s])/u);
  if (!match) return undefined;
  const year = Number(match[1]);
  const currentYear = new Date(now).getUTCFullYear();
  if (year < 1000 || year > currentYear + 1) return undefined;
  return 2 ** (-Math.max(0, currentYear - year) / halfLife);
}
export function computeFeatures(
  profile: ResearchProfile,
  candidate: RecommendationCandidate,
  focus: string | undefined,
  now: number,
  config: RankingConfig,
) {
  const text = candidateText(candidate, config.maxLexicalCandidateChars);
  const topics = positiveTopics(profile);
  let total = 0,
    matched = 0;
  for (const topic of topics) {
    const strength = topic.weight * topic.confidence;
    total += strength;
    matched += strength * textMatch(text, topic.label);
  }
  const profileLexical = total ? matched / total : 0;
  const lexical = clamp(
    focus
      ? config.focusLexicalWeight * textMatch(text, focus) +
          (1 - config.focusLexicalWeight) * profileLexical
      : profileLexical,
  );
  const negativeConflict = profile.explicitPreferences.negativeTopics.reduce(
    (best, p) => Math.max(best, p.strength * textMatch(text, p.label)),
    0,
  );
  const provenanceTopics = new Set(
    candidate.provenance.flatMap((p) =>
      p.route === "profile_query" && p.topicId ? [p.topicId] : [],
    ),
  );
  const matchedTopicIds = topics
    .filter(
      (t) =>
        textMatch(text, t.label) >= config.matchedTopicThreshold ||
        provenanceTopics.has(t.id),
    )
    .slice(0, config.maxMatchedTopics)
    .map((t) => t.id);
  return {
    lexical,
    graph: graphFeature(candidate),
    recency: recencyFeature(
      candidate.publicationDate,
      now,
      config.recencyHalfLifeYears,
    ),
    preference: clamp(1 - negativeConflict),
    matchedTopicIds,
  };
}
