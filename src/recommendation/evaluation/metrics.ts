import type {
  RecommendationEvaluationCase,
  RankingMetrics,
  EvidenceMetrics,
  EvaluatedRecommendation,
} from "./contracts";
import { assertRecommendationEvidence } from "../evidence/contracts";
import { formatEvidence } from "../evidence/evidenceFormatter";
import { candidateAbstractReference } from "../evidence/evidenceRetriever";
import { jaccard, tokens } from "../ranking/textSimilarity";

const ratio = (n: number, d: number) => (d ? n / d : 0);

/** Binary relevance, macro-free single-case engineering indicators. */
export function rankingMetrics(
  input: RecommendationEvaluationCase,
  rows: readonly EvaluatedRecommendation[],
): RankingMetrics {
  const selected = rows.slice(0, input.topK).map((r) => r.paper);
  const labels = input.expectedSignals?.preferredCandidateIds;
  const relevant = new Set(labels ?? []);
  const hits: number[] = selected.map((p) =>
    relevant.has(p.candidateId) ? 1 : 0,
  );
  const first = hits.indexOf(1);
  const dcg = hits.reduce((sum, hit, i) => sum + hit / Math.log2(i + 2), 0);
  const ideal = Array.from(
    { length: Math.min(relevant.size, input.topK) },
    (_, i) => 1 / Math.log2(i + 2),
  ).reduce((a, b) => a + b, 0);
  let distance = 0,
    pairs = 0;
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      distance +=
        1 -
        jaccard(
          tokens(`${selected[i].title}\n${selected[i].abstract ?? ""}`),
          tokens(`${selected[j].title}\n${selected[j].abstract ?? ""}`),
        );
      pairs++;
    }
  }
  const known = new Set(input.knownCandidateIds ?? []);
  const rejected = new Set(input.expectedSignals?.rejectedCandidateIds ?? []);
  return {
    precisionAtK:
      labels === undefined
        ? null
        : ratio(
            hits.reduce((a, b) => a + b, 0),
            input.topK,
          ),
    recallAtK:
      labels === undefined
        ? null
        : ratio(
            hits.reduce((a, b) => a + b, 0),
            relevant.size,
          ),
    mrr: labels === undefined ? null : first < 0 ? 0 : 1 / (first + 1),
    ndcgAtK: labels === undefined ? null : ratio(dcg, ideal),
    diversityScore: ratio(distance, pairs),
    noveltyRate:
      input.knownCandidateIds === undefined
        ? null
        : ratio(
            selected.filter((p) => !known.has(p.candidateId)).length,
            selected.length,
          ),
    rejectedAtK: selected.filter((p) => rejected.has(p.candidateId)).length,
  };
}

/** Reject unsupported text even when its IDs resolve: reproduce the Phase 6 formatter. */
export function evidenceMetrics(
  input: RecommendationEvaluationCase,
  rows: readonly EvaluatedRecommendation[],
): EvidenceMetrics {
  let available = 0,
    grounded = 0,
    unsupported = 0,
    covered = 0,
    totalTopics = 0;
  for (const { paper, explanation } of rows) {
    totalTopics += paper.matchedTopicIds.length;
    try {
      const ids = new Set<string>();
      for (const e of explanation.evidence) {
        assertRecommendationEvidence(e);
        if (e.candidateId !== paper.candidateId || ids.has(e.evidenceId))
          throw new TypeError("Invalid evidence identity");
        ids.add(e.evidenceId);
        if (
          e.reference === candidateAbstractReference(paper.candidateId) &&
          (e.sourceType !== "abstract" || !paper.abstract?.includes(e.snippet))
        )
          throw new TypeError("Invented abstract evidence");
      }
      const expected = formatEvidence(
        {
          candidate: paper,
          profile: input.profile,
          snapshot: { libraryID: 1, papers: [] },
          now: input.now,
        },
        explanation.evidence,
      ).reason;
      const actual = explanation.reason;
      const equal =
        actual.summary === expected.summary &&
        actual.confidence === expected.confidence &&
        JSON.stringify(actual.evidenceRefs) ===
          JSON.stringify(expected.evidenceRefs) &&
        JSON.stringify(actual.matchedTopics) ===
          JSON.stringify(expected.matchedTopics);
      if (explanation.evidence.length) available++;
      if (
        !equal ||
        actual.evidenceRefs.some((ref) => !ids.has(ref)) ||
        actual.matchedTopics.some(
          (label) =>
            !input.profile.topics.some(
              (t) => t.label === label && paper.matchedTopicIds.includes(t.id),
            ),
        )
      ) {
        unsupported++;
      } else if (actual.evidenceRefs.length) {
        grounded++;
        covered += paper.matchedTopicIds.filter((id) =>
          input.profile.topics.some(
            (t) => t.id === id && actual.matchedTopics.includes(t.label),
          ),
        ).length;
      }
    } catch {
      unsupported++;
    }
  }
  return {
    evidenceAvailability: ratio(available, rows.length),
    evidenceCoverage: ratio(covered, totalTopics),
    reasonGroundingRate: ratio(grounded, rows.length),
    unsupportedExplanationCount: unsupported,
  };
}
