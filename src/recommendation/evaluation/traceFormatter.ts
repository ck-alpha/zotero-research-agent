import type { ResearchProfile } from "../domain/profile";
import type { EvaluatedRecommendation } from "./contracts";

/** Debug data only; JSON quoting prevents source text from forging trace sections. */
export function formatRecommendationTrace(
  profile: ResearchProfile,
  rows: readonly EvaluatedRecommendation[],
): string {
  return [
    "Recommendation Trace",
    ...rows.map(({ paper, explanation }) =>
      [
        `Candidate: ${JSON.stringify(paper.candidateId)}`,
        `Rank: ${paper.rank}`,
        `Profile Topics: ${JSON.stringify(profile.topics.map((t) => ({ id: t.id, label: t.label })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))}`,
        `Matched Topic IDs: ${JSON.stringify(paper.matchedTopicIds)}`,
        `Ranking: ${JSON.stringify(
          Object.fromEntries(
            Object.entries(paper.scores)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          ),
        )}`,
        `Provenance: ${JSON.stringify(paper.provenance)}`,
        `Evidence: ${JSON.stringify(explanation?.evidence)}`,
        `Reason: ${JSON.stringify(explanation?.reason)}`,
        `Warnings: ${JSON.stringify(explanation?.warnings)}`,
      ].join("\n"),
    ),
  ].join("\n\n");
}
