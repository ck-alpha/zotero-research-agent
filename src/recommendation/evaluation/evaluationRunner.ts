import type {
  RecommendationEvaluationCase,
  RecommendationEvaluationResult,
  EvaluatedRecommendation,
} from "./contracts";
import {
  assertResearchProfile,
  assertRecommendationCandidate,
  assertRecommendationImpression,
  assertNonEmptyId,
} from "../domain/validation";
import { RankingService } from "../ranking/rankingService";
import { retrieveEvidence } from "../evidence/evidenceRetriever";
import { formatEvidence } from "../evidence/evidenceFormatter";
import { rankingMetrics, evidenceMetrics } from "./metrics";
import { formatRecommendationTrace } from "./traceFormatter";

export function assertEvaluationCase(
  input: RecommendationEvaluationCase,
): void {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "id",
          "profile",
          "candidates",
          "now",
          "topK",
          "expectedSignals",
          "knownCandidateIds",
        ].includes(key),
    )
  )
    throw new TypeError("Invalid evaluation fields");
  if (
    input.expectedSignals !== undefined &&
    (!input.expectedSignals ||
      typeof input.expectedSignals !== "object" ||
      Array.isArray(input.expectedSignals) ||
      Object.keys(input.expectedSignals).some(
        (key) =>
          !["preferredCandidateIds", "rejectedCandidateIds"].includes(key),
      ))
  )
    throw new TypeError("Invalid expected signals");
  assertNonEmptyId(input.id, "caseId");
  assertResearchProfile(input.profile);
  if (
    !Number.isSafeInteger(input.now) ||
    input.now < 0 ||
    !Number.isFinite(new Date(input.now).getTime()) ||
    !Number.isSafeInteger(input.topK) ||
    input.topK < 1 ||
    input.topK > 20 ||
    !Array.isArray(input.candidates)
  )
    throw new TypeError("Invalid evaluation case");
  const ids = new Set<string>();
  for (const c of input.candidates) {
    assertRecommendationCandidate(c);
    if (ids.has(c.candidateId))
      throw new TypeError("Duplicate evaluation candidate");
    ids.add(c.candidateId);
  }
  for (const list of [
    input.expectedSignals?.preferredCandidateIds,
    input.expectedSignals?.rejectedCandidateIds,
    input.knownCandidateIds,
  ]) {
    if (list === undefined) continue;
    if (!Array.isArray(list) || new Set(list).size !== list.length)
      throw new TypeError("Invalid evaluation labels");
    for (const id of list) assertNonEmptyId(id, "label");
  }
  const preferred = input.expectedSignals?.preferredCandidateIds ?? [];
  const rejected = input.expectedSignals?.rejectedCandidateIds ?? [];
  if (
    [...preferred, ...rejected].some((id) => !ids.has(id)) ||
    preferred.some((id) => rejected.includes(id))
  )
    throw new TypeError("Unknown or contradictory evaluation labels");
}

/** Inspect externally supplied observations without recomputing their ranking. */
export function evaluateRecommendationResults(
  input: RecommendationEvaluationCase,
  rows: EvaluatedRecommendation[],
  warnings: string[] = [],
): RecommendationEvaluationResult {
  assertEvaluationCase(input);
  if (!Array.isArray(rows) || rows.length > input.topK)
    throw new TypeError("Invalid evaluation results");
  assertRecommendationImpression({
    recommendationId: input.id,
    profileId: input.profile.profileId,
    profileVersion: input.profile.version,
    timestamp: input.now,
    candidates: rows.map((r) => r.paper),
  });
  rows.forEach(({ paper }, i) => {
    if (
      paper.rank !== i + 1 ||
      new Set(paper.matchedTopicIds).size !== paper.matchedTopicIds.length ||
      !input.candidates.some((c) => c.candidateId === paper.candidateId) ||
      paper.matchedTopicIds.some(
        (id) => !input.profile.topics.some((t) => t.id === id),
      )
    )
      throw new TypeError("Invalid evaluation result membership or order");
    const original = input.candidates.find(
      (c) => c.candidateId === paper.candidateId,
    )!;
    if (paper.title !== original.title || paper.abstract !== original.abstract)
      throw new TypeError("Changed evaluation candidate content");
  });
  const evidence = evidenceMetrics(input, rows);
  return {
    caseId: input.id,
    rankingMetrics: rankingMetrics(input, rows),
    evidenceMetrics: evidence,
    recommendations: JSON.parse(JSON.stringify(rows)),
    warnings: [
      ...new Set([
        ...warnings,
        ...rows.flatMap((r) =>
          Array.isArray(r.explanation?.warnings) ? r.explanation.warnings : [],
        ),
        ...(input.expectedSignals?.preferredCandidateIds === undefined
          ? ["evaluation_relevance_unlabeled"]
          : []),
        ...(input.knownCandidateIds === undefined
          ? ["evaluation_novelty_unmeasured"]
          : []),
        ...(evidence.unsupportedExplanationCount
          ? ["evaluation_unsupported_explanation"]
          : []),
      ]),
    ].sort(),
    trace: formatRecommendationTrace(input.profile, rows),
  };
}

/** Network-free fixed-clock benchmark; uses the unchanged production ranker/formatter. */
export async function runRecommendationEvaluation(
  input: RecommendationEvaluationCase,
): Promise<RecommendationEvaluationResult> {
  assertEvaluationCase(input);
  const snapshot: RecommendationEvaluationCase = JSON.parse(
    JSON.stringify(input),
  );
  const ranked = await new RankingService().rank({
    profile: snapshot.profile,
    candidates: snapshot.candidates,
    now: snapshot.now,
    topK: snapshot.topK,
  });
  const rows: EvaluatedRecommendation[] = [];
  for (const paper of ranked.recommendations) {
    const evidenceInput = {
      candidate: paper,
      profile: snapshot.profile,
      snapshot: { libraryID: 1, papers: [] },
      now: snapshot.now,
    };
    const retrieved = await retrieveEvidence(evidenceInput);
    rows.push({
      paper,
      explanation: formatEvidence(
        evidenceInput,
        retrieved.evidence,
        retrieved.warnings,
      ),
    });
  }
  return evaluateRecommendationResults(snapshot, rows, ranked.warnings);
}
