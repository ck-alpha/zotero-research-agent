import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { benchmarkCases } from "./fixtures";
import {
  runRecommendationEvaluation,
  evaluateRecommendationResults,
} from "../../src/recommendation/evaluation/evaluationRunner";
import {
  evidenceMetrics,
  rankingMetrics,
} from "../../src/recommendation/evaluation/metrics";
import type { EvaluatedRecommendation } from "../../src/recommendation/evaluation/contracts";

describe("recommendation deterministic evaluation", function () {
  it("A: strong topic match leads with grounded explanation", async function () {
    const result = await runRecommendationEvaluation(benchmarkCases()[0]);
    assert.equal(result.recommendations[0].paper.candidateId, "A");
    assert.deepEqual(result.rankingMetrics, {
      precisionAtK: 1,
      recallAtK: 1,
      mrr: 1,
      ndcgAtK: 1,
      diversityScore: 0,
      noveltyRate: 1,
      rejectedAtK: 0,
    });
    assert.deepEqual(result.evidenceMetrics, {
      evidenceAvailability: 1,
      evidenceCoverage: 1,
      reasonGroundingRate: 1,
      unsupportedExplanationCount: 0,
    });
  });
  it("B: negative topic applies compatibility penalty", async function () {
    const input = benchmarkCases()[1];
    input.topK = 2;
    const result = await runRecommendationEvaluation(input);
    assert.deepEqual(
      result.recommendations.map((r) => r.paper.candidateId),
      ["A", "Y"],
    );
    assert.equal(result.recommendations[1].paper.scores.preference, 0);
    assert.equal(result.recommendations[1].paper.scores.baseScore, 0);
  });
  it("C: unavailable evidence preserves recommendation without invented reason", async function () {
    const result = await runRecommendationEvaluation(benchmarkCases()[2]);
    assert.lengthOf(result.recommendations, 1);
    assert.include(result.warnings, "evidence_unavailable");
    assert.deepEqual(
      result.recommendations[0].explanation.reason.evidenceRefs,
      [],
    );
    assert.deepEqual(result.evidenceMetrics, {
      evidenceAvailability: 0,
      evidenceCoverage: 0,
      reasonGroundingRate: 0,
      unsupportedExplanationCount: 0,
    });
  });
  it("is identical across repeated, JSON roundtrip and permuted candidate input", async function () {
    const input = benchmarkCases()[0];
    input.topK = 2;
    const baseline = await runRecommendationEvaluation(input);
    const serialized = JSON.stringify(input);
    assert.deepEqual(
      await runRecommendationEvaluation(JSON.parse(serialized)),
      baseline,
    );
    input.candidates.reverse();
    assert.deepEqual(await runRecommendationEvaluation(input), baseline);
    assert.equal(
      JSON.stringify(baseline),
      JSON.stringify(JSON.parse(JSON.stringify(baseline))),
    );
  });
  it("breaks tied scores by candidate ID independent of recall order", async function () {
    const input = benchmarkCases()[0];
    input.candidates = ["z", "a"].map((candidateId) => ({
      ...input.candidates[1],
      candidateId,
    }));
    input.expectedSignals = undefined;
    input.topK = 2;
    assert.deepEqual(
      (await runRecommendationEvaluation(input)).recommendations.map(
        (r) => r.paper.candidateId,
      ),
      ["a", "z"],
    );
  });
  it("computes nontrivial binary metrics, novelty and pairwise diversity", function () {
    const input = benchmarkCases()[0];
    input.topK = 3;
    input.expectedSignals = {
      preferredCandidateIds: ["b", "d"],
      rejectedCandidateIds: ["a"],
    };
    input.knownCandidateIds = ["a", "c"];
    const rows = ["a", "b", "c"].map((candidateId) => ({
      paper: { candidateId, title: candidateId },
    })) as EvaluatedRecommendation[];
    const metrics = rankingMetrics(input, rows);
    assert.equal(metrics.precisionAtK, 1 / 3);
    assert.equal(metrics.recallAtK, 1 / 2);
    assert.equal(metrics.mrr, 1 / 2);
    assert.closeTo(
      metrics.ndcgAtK!,
      1 / Math.log2(3) / (1 + 1 / Math.log2(3)),
      1e-12,
    );
    assert.equal(metrics.diversityScore, 1);
    assert.equal(metrics.noveltyRate, 1 / 3);
    assert.equal(metrics.rejectedAtK, 1);
    rows[1].paper.title = "a";
    assert.closeTo(rankingMetrics(input, rows).diversityScore, 2 / 3, 1e-12);
  });
  it("uses K as precision denominator even for a short result list", async function () {
    const input = benchmarkCases()[2];
    input.topK = 3;
    assert.equal(
      (await runRecommendationEvaluation(input)).rankingMetrics.precisionAtK,
      1 / 3,
    );
  });
  it("returns finite zeroes for empty input and null for unmeasured indicators", async function () {
    const input = benchmarkCases()[0];
    input.candidates = [];
    input.expectedSignals = { preferredCandidateIds: [] };
    const result = await runRecommendationEvaluation(input);
    assert.deepEqual(result.rankingMetrics, {
      precisionAtK: 0,
      recallAtK: 0,
      mrr: 0,
      ndcgAtK: 0,
      diversityScore: 0,
      noveltyRate: 0,
      rejectedAtK: 0,
    });
    assert.equal(result.evidenceMetrics.reasonGroundingRate, 0);
    delete input.expectedSignals;
    delete input.knownCandidateIds;
    const unmeasured = await runRecommendationEvaluation(input);
    assert.isNull(unmeasured.rankingMetrics.mrr);
    assert.isNull(unmeasured.rankingMetrics.noveltyRate);
    assert.include(unmeasured.warnings, "evaluation_relevance_unlabeled");
  });
  for (const mutation of [
    "reference",
    "topic",
    "summary",
    "snippet",
    "duplicate",
    "candidate",
    "confidence",
    "malformed",
  ] as const) {
    it(`rejects unsupported explanation: ${mutation}`, async function () {
      const input = benchmarkCases()[0];
      const result = await runRecommendationEvaluation(input);
      const rows = JSON.parse(JSON.stringify(result.recommendations));
      const e = rows[0].explanation;
      if (mutation === "reference") e.reason.evidenceRefs = ["nonexistent"];
      if (mutation === "topic") e.reason.matchedTopics = ["invented"];
      if (mutation === "summary")
        e.reason.summary = "Proves a breakthrough result";
      if (mutation === "snippet")
        e.evidence[0].snippet = "invented Agentic Recommendation";
      if (mutation === "duplicate") e.evidence.push(e.evidence[0]);
      if (mutation === "candidate") e.evidence[0].candidateId = "someone-else";
      if (mutation === "confidence") e.reason.confidence = NaN;
      if (mutation === "malformed") e.reason = null;
      assert.equal(evidenceMetrics(input, rows).unsupportedExplanationCount, 1);
      assert.equal(evidenceMetrics(input, rows).reasonGroundingRate, 0);
    });
  }
  it("reports invalid explanations in the evaluation result and quotes trace data", async function () {
    const input = benchmarkCases()[0];
    const result = await runRecommendationEvaluation(input);
    const rows = JSON.parse(JSON.stringify(result.recommendations));
    rows[0].explanation.reason.summary = "Injected\nRanking: 100";
    const inspected = evaluateRecommendationResults(input, rows);
    assert.include(inspected.warnings, "evaluation_unsupported_explanation");
    assert.include(inspected.trace, "Injected\\nRanking: 100");
    assert.notInclude(inspected.trace, "\nRanking: 100");
    assert.include(inspected.trace, "lexical");
  });
  it("rejects bad K, clock, duplicate candidates, unknown and conflicting labels", async function () {
    for (const patch of [
      { topK: 0 },
      { topK: 1.5 },
      { now: NaN },
      {
        candidates: [
          benchmarkCases()[0].candidates[0],
          benchmarkCases()[0].candidates[0],
        ],
      },
      { expectedSignals: { preferredCandidateIds: ["unknown"] } },
      {
        expectedSignals: {
          preferredCandidateIds: ["A"],
          rejectedCandidateIds: ["A"],
        },
      },
    ]) {
      await rejects(
        () => runRecommendationEvaluation({ ...benchmarkCases()[0], ...patch }),
        TypeError,
      );
    }
  });
  it("rejects unknown candidates, duplicate results, invalid ranks/scores/topics and changed content", async function () {
    const input = benchmarkCases()[0];
    const result = await runRecommendationEvaluation(input);
    for (const patch of [
      { candidateId: "unknown" },
      { rank: 2 },
      { scores: { finalScore: NaN } },
      { matchedTopicIds: ["unknown"] },
      { abstract: "invented" },
    ]) {
      const rows = JSON.parse(JSON.stringify(result.recommendations));
      Object.assign(rows[0].paper, patch);
      assert.throws(
        () => evaluateRecommendationResults(input, rows),
        TypeError,
      );
    }
    assert.throws(
      () =>
        evaluateRecommendationResults(input, [
          ...result.recommendations,
          ...result.recommendations,
        ]),
      TypeError,
    );
  });
});
