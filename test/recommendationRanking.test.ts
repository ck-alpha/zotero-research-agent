import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { makeCandidate, makeProfile } from "./helpers/recommendationFixtures";
import type { RecommendationCandidate } from "../src/recommendation/domain/candidate";
import type {
  RankingEmbeddingProvider,
  RankingInput,
} from "../src/recommendation/ranking/contracts";
import {
  RANKING_CONFIG,
  resolveRankingConfig,
} from "../src/recommendation/ranking/config";
import {
  normalizeText,
  textMatch,
  jaccard,
  tokens,
} from "../src/recommendation/ranking/textSimilarity";
import {
  computeFeatures,
  graphFeature,
  recencyFeature,
} from "../src/recommendation/ranking/features";
import { baseScore, compareBase } from "../src/recommendation/ranking/scoring";
import {
  cosine,
  semanticRelevance,
  validateVectors,
  profileText,
} from "../src/recommendation/ranking/semantic";
import { diversify } from "../src/recommendation/ranking/diversity";
import { RankingService } from "../src/recommendation/ranking/rankingService";
import { assertRecommendationImpression } from "../src/recommendation/domain/validation";

const now = Date.UTC(2026, 8, 9);
const config = resolveRankingConfig();
function candidate(
  id: string,
  title: string,
  patch: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  return {
    ...makeCandidate(),
    candidateId: id,
    title,
    abstract: undefined,
    publicationDate: undefined,
    sources: ["profile_query"],
    seedPaperIds: undefined,
    provenance: [
      {
        route: "profile_query",
        provider: "openalex",
        providerRank: 1,
        query: "Recommendation",
      },
    ],
    scores: {},
    ...patch,
  };
}
const input = (
  candidates = [candidate("a", "Recommendation"), candidate("b", "Astronomy")],
): RankingInput => ({ profile: makeProfile(), candidates, now });
const rank = (patch: Partial<RankingInput> = {}) =>
  new RankingService().rank({ ...input(), ...patch });

describe("Phase 4 text and deterministic features", function () {
  it("normalizes Unicode, case folds and collapses whitespace without UI tokenizers", function () {
    assert.equal(normalizeText(" ＡＧＥＮＴＳ\n  Straße  "), "agents strasse");
    assert.equal(normalizeText("Cafe\u0301"), "café");
    assert.deepEqual(
      [...tokens("Agents-2026, 数据!")],
      ["agents", "2026", "数据"],
    );
  });
  it("uses phrase match then token coverage and unrelated/empty matches", function () {
    assert.equal(textMatch("Deep learning systems", "DEEP  LEARNING"), 1);
    assert.equal(textMatch("Learning agents", "deep learning"), 0.5);
    assert.equal(textMatch("Astronomy", "deep learning"), 0);
    assert.equal(textMatch("any text", "---"), 0);
    assert.equal(jaccard(tokens("a b"), tokens("b c")), 1 / 3);
    assert.equal(jaccard(tokens(""), tokens("")), 0);
  });
  it("weights topic intensity/confidence and focus independently", function () {
    const p = makeProfile();
    p.topics = [
      { ...p.topics[0], label: "Agents", weight: 1, confidence: 0.5 },
      {
        ...p.topics[0],
        id: "other",
        label: "Vision",
        weight: 0.5,
        confidence: 0.5,
      },
    ];
    const c = candidate("a", "Agents");
    assert.closeTo(
      computeFeatures(p, c, undefined, now, config).lexical,
      2 / 3,
      1e-12,
    );
    assert.closeTo(
      computeFeatures(p, c, "Vision", now, config).lexical,
      (0.4 * 2) / 3,
      1e-12,
    );
    assert.closeTo(
      computeFeatures(p, c, "Agents", now, config).lexical,
      0.6 + (0.4 * 2) / 3,
      1e-12,
    );
  });
  it("matches only known positive topics in strength/ID order including provenance and caps", function () {
    const p = makeProfile();
    p.topics = ["b", "a", "z", "zero", "negative"].map((id) => ({
      ...p.topics[0],
      id,
      label: id === "negative" ? "Prompting" : id,
      weight: id === "z" ? 1 : id === "zero" ? 0 : 0.5,
      confidence: 1,
    }));
    const c = candidate("x", "a b z Prompting", {
      provenance: [
        {
          route: "profile_query",
          provider: "openalex",
          providerRank: 1,
          query: "x",
          topicId: "invented",
        },
      ],
    });
    assert.deepEqual(
      computeFeatures(p, c, undefined, now, { ...config, maxMatchedTopics: 2 })
        .matchedTopicIds,
      ["z", "a"],
    );
    c.title = "qqq";
    c.provenance[0] = {
      ...c.provenance[0],
      route: "profile_query",
      query: "x",
      topicId: "b",
    };
    assert.deepEqual(
      computeFeatures(p, c, undefined, now, config).matchedTopicIds,
      ["b"],
    );
  });
  it("penalizes strongest explicit negative conflict, including weak partial matches", function () {
    const p = makeProfile();
    p.explicitPreferences.negativeTopics[0].label = "Pure Prompting";
    assert.closeTo(
      computeFeatures(p, candidate("a", "Prompting"), undefined, now, config)
        .preference,
      0.55,
      1e-12,
    );
    p.explicitPreferences.negativeTopics.push({
      ...p.explicitPreferences.negativeTopics[0],
      id: "n2",
      label: "Prompting",
      strength: 1,
    });
    assert.equal(
      computeFeatures(p, candidate("a", "Prompting"), undefined, now, config)
        .preference,
      0,
    );
    assert.equal(
      computeFeatures(p, candidate("a", "Agents"), undefined, now, config)
        .preference,
      1,
    );
  });
  it("uses strongest seed rank and ignores all query ranks", function () {
    const c = makeCandidate();
    const seed = c.provenance[1];
    const values = [1, 2, 3].map((providerRank) =>
      graphFeature({ ...c, provenance: [{ ...seed, providerRank }] }),
    );
    assert.closeTo(values[0], 1, 1e-12);
    assert.closeTo(values[1], 1 / Math.log2(3), 1e-12);
    assert.closeTo(values[2], 0.5, 1e-12);
    assert.equal(graphFeature({ ...c, provenance: [c.provenance[0]] }), 0);
    assert.equal(
      graphFeature({
        ...c,
        provenance: [
          { ...seed, providerRank: 3 },
          { ...seed, providerRank: 1 },
        ],
      }),
      1,
    );
  });
  it("uses leading publication year, half life and safe future/missing date handling", function () {
    assert.equal(recencyFeature("2026-09", now, 3), 1);
    assert.equal(recencyFeature("2023", now, 3), 0.5);
    assert.equal(recencyFeature("2027", now, 3), 1);
    for (const date of [
      undefined,
      "unknown",
      "20260",
      "2026garbage",
      "0999",
      "9999",
      "September 2026",
    ])
      assert.isUndefined(recencyFeature(date, now, 3));
  });
  it("renormalizes missing features and applies preference after the weighted mean", function () {
    const s = {
      semantic: 1,
      lexical: 0.5,
      graph: 0,
      recency: 0.5,
      preference: 1,
    };
    assert.closeTo(baseScore(s, config), 0.65, 1e-12);
    assert.closeTo(
      baseScore({ ...s, semantic: undefined }, config),
      0.2 / 0.55,
      1e-12,
    );
    assert.closeTo(
      baseScore({ ...s, semantic: undefined, recency: undefined }, config),
      0.15 / 0.45,
      1e-12,
    );
    assert.closeTo(baseScore({ ...s, preference: 0.4 }, config), 0.26, 1e-12);
    assert.equal(baseScore({ ...s, preference: 0 }, config), 0);
  });
  it("uses stable base lexical/semantic/ID tie breaks", function () {
    const a = candidate("a", "same", {
        scores: { baseScore: 0.5, lexical: 0.5 },
      }),
      b = candidate("b", "same", { scores: { ...a.scores } });
    assert.isBelow(compareBase(a, b), 0);
    b.scores.semantic = 0;
    assert.isAbove(compareBase(a, b), 0);
    a.scores.lexical = 0.6;
    assert.isBelow(compareBase(a, b), 0);
  });
  it("validates all centralized defaults and rejects unavailable-feature-only weights", function () {
    assert.deepEqual(resolveRankingConfig(), RANKING_CONFIG);
    for (const patch of [
      { mmrLambda: 2 },
      { semanticWeight: NaN },
      { semanticBatchSize: 0 },
      { maxSemanticTopics: 1.5 },
      { recencyHalfLifeYears: 0 },
      { toolDefaultTopK: 21 },
      { lexicalWeight: 0, graphWeight: 0 },
      { unknown: 1 },
    ])
      assert.throws(() => resolveRankingConfig(patch as never), TypeError);
    assert.equal(
      resolveRankingConfig({ mmrLambda: 0, recencyHalfLifeYears: 0.5 })
        .mmrLambda,
      0,
    );
  });
});

describe("Phase 4 semantic math and boundaries", function () {
  it("computes exact cosine, zero vectors and negative-clamped relevance", function () {
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.equal(cosine([1, 0], [-1, 0]), -1);
    assert.equal(semanticRelevance([1, 0], [-1, 0]), 0);
    assert.equal(cosine([0, 0], [1, 0]), 0);
    assert.equal(cosine([0, 0], [0, 0]), 0);
    assert.closeTo(cosine([1e308, 1e308], [1e308, 1e308]), 1, 1e-12);
  });
  it("rejects wrong count, dimensions, sparse arrays and nonfinite values", function () {
    for (const vectors of [
      [],
      [[]],
      [[1], [1, 2]],
      [[NaN]],
      [[Infinity]],
      new Array(1),
      [new Array(2)],
    ])
      assert.throws(() => validateVectors(vectors, 1));
    assert.throws(() => cosine([1], [1, 2]));
  });
  it("bounds semantic text and excludes negative preferences, evidence and conversation", function () {
    const i = input();
    i.focus = "Current focus";
    const text = profileText(i, config);
    assert.isTrue(text.startsWith("Current focus\n"));
    assert.include(text, "Recommendation");
    assert.include(text, "Agents");
    assert.include(text, "Seed paper");
    assert.notInclude(text, "Prompting");
    assert.notInclude(text, "paper:ABC123");
    i.profile.explicitPreferences.positiveTopics.push({
      ...i.profile.explicitPreferences.negativeTopics[0],
      id: "conflicting-positive",
    });
    assert.notInclude(profileText(i, config), "Prompting");
    assert.lengthOf(
      profileText(i, { ...config, maxSemanticProfileChars: 5 }),
      5,
    );
    assert.equal(
      profileText(i, {
        ...config,
        maxSemanticTopics: 0,
        maxSemanticPositivePrefs: 0,
        maxSemanticRepresentativePapers: 0,
      }),
      "Current focus",
    );
  });
});

describe("RankingService and separate MMR", function () {
  it("ranks deterministically without embeddings, preserves metadata, discards stale scores, and does not mutate inputs", async function () {
    const i = input();
    i.candidates[0].scores = makeCandidate().scores;
    const before = JSON.stringify(i);
    const result = await new RankingService().rank(i);
    assert.equal(result.recommendations[0].candidateId, "a");
    assert.include(result.warnings, "ranking_semantic_unavailable");
    assert.deepEqual(result.diagnostics, {
      inputCandidateCount: 2,
      semanticRequested: false,
      semanticSucceeded: false,
      semanticCandidateCount: 0,
      semanticFallback: true,
      topKRequested: 10,
      topKReturned: 2,
    });
    assert.equal(JSON.stringify(i), before);
    assert.deepEqual(
      result,
      await new RankingService().rank({
        ...i,
        candidates: [...i.candidates].reverse(),
      }),
    );
    for (const p of result.recommendations) {
      assert.isUndefined(p.scores.feedback);
      assert.isUndefined(p.scores.semantic);
      assert.isUndefined(p.scores.recency);
      for (const key of [
        "lexical",
        "graph",
        "preference",
        "baseScore",
        "diversity",
      ] as const)
        assert.isAtLeast(p.scores[key]!, 0);
      assert.deepEqual(
        p.provenance,
        i.candidates.find((c) => c.candidateId === p.candidateId)!.provenance,
      );
    }
    assertRecommendationImpression({
      recommendationId: "test-only",
      profileId: result.profileId,
      profileVersion: result.profileVersion,
      timestamp: now,
      candidates: result.recommendations,
    });
    result.recommendations[0].provenance[0].providerRank = 99;
    assert.equal(JSON.stringify(i), before);
  });
  it("supports semantic success with bounded ordered batches and profile/candidate separation", async function () {
    const seen: string[][] = [];
    const semanticProvider: RankingEmbeddingProvider = {
      embed: async (texts) => {
        seen.push([...texts]);
        return {
          model: "embedding-only",
          vectors: texts.map((t) =>
            t.trim() === "Astronomy"
              ? [1, 0]
              : t.trim() === "Recommendation"
                ? [0, 1]
                : [1, 0],
          ),
        };
      },
    };
    const result = await new RankingService({ semanticBatchSize: 2 }).rank({
      ...input(),
      semanticProvider,
    });
    assert.deepEqual(
      seen.map((x) => x.length),
      [2, 1],
    );
    assert.equal(seen[0][1].trim(), "Recommendation");
    assert.isTrue(result.diagnostics.semanticSucceeded);
    assert.equal(result.diagnostics.semanticCandidateCount, 2);
    assert.isFalse(result.diagnostics.semanticFallback);
    assert.isEmpty(result.warnings);
    assert.equal(result.recommendations[0].scores.semantic, 1);
  });
  it("falls back from provider errors without leaking diagnostics", async function () {
    const result = await rank({
      semanticProvider: {
        embed: async () => {
          throw new Error("private credential");
        },
      },
    });
    assert.deepEqual(result.warnings, ["ranking_semantic_failed_fallback"]);
    assert.isUndefined(result.recommendations[0].scores.semantic);
  });
  for (const invalid of [
    [],
    [[], [], []],
    [[1], [1, 2], [1]],
    [[NaN], [1], [1]],
    [[Infinity], [1], [1]],
  ])
    it(`discards invalid semantic vectors ${JSON.stringify(invalid)}`, async function () {
      const result = await rank({
        semanticProvider: {
          embed: async () => ({ model: "fake", vectors: invalid }),
        },
      });
      assert.deepEqual(result.warnings, ["ranking_semantic_invalid_vectors"]);
      assert.equal(result.diagnostics.semanticCandidateCount, 0);
    });
  it("discards earlier batches when later vectors or model identity mismatch", async function () {
    for (const changeModel of [true, false]) {
      let calls = 0;
      const result = await new RankingService({ semanticBatchSize: 2 }).rank({
        ...input(),
        semanticProvider: {
          embed: async (texts) => ({
            model: calls++ && changeModel ? "changed" : "fake",
            vectors: texts.map(() =>
              calls > 1 && !changeModel ? [1, 0] : [1],
            ),
          }),
        },
      });
      assert.deepEqual(result.warnings, ["ranking_semantic_invalid_vectors"]);
      assert.isUndefined(result.recommendations[0].scores.semantic);
    }
  });
  it("returns promptly on timeout, aborts transport and never starts later batches", async function () {
    let signal: AbortSignal | undefined,
      calls = 0;
    const result = await new RankingService({
      semanticTimeoutMs: 10,
      semanticBatchSize: 1,
    }).rank({
      ...input(),
      semanticProvider: {
        embed: async (_texts, s) => {
          signal = s;
          calls++;
          return new Promise(() => {});
        },
      },
    });
    assert.equal(calls, 1);
    assert.isTrue(signal?.aborted);
    assert.deepEqual(result.warnings, ["ranking_semantic_failed_fallback"]);
  });
  it("honors cancellation before, during, and between batches without fallback", async function () {
    const before = new AbortController();
    before.abort();
    await rejects(rank({ signal: before.signal }), /cancel/);
    for (const hangs of [true, false]) {
      const controller = new AbortController();
      let calls = 0;
      const pending = new RankingService({ semanticBatchSize: 1 }).rank({
        ...input(),
        signal: controller.signal,
        semanticProvider: {
          embed: async (texts) => {
            calls++;
            controller.abort();
            if (hangs) return new Promise(() => {});
            return { model: "fake", vectors: texts.map(() => [1]) };
          },
        },
      });
      await rejects(pending, /cancel/);
      assert.equal(calls, 1);
    }
  });
  it("changes relevance with focus and negative preferences without deleting papers", async function () {
    const candidates = [
      candidate("a", "Recommendation Prompting"),
      candidate("b", "Astronomy"),
    ];
    assert.equal(
      (await rank({ candidates })).recommendations[0].candidateId,
      "a",
    );
    const focused = await rank({ candidates, focus: "Astronomy" });
    assert.equal(focused.recommendations[0].candidateId, "b");
    assert.lengthOf(focused.recommendations, 2);
    assert.closeTo(focused.recommendations[1].scores.preference!, 0.1, 1e-12);
    const p = makeProfile();
    p.explicitPreferences.negativeTopics[0].strength = 1;
    assert.equal(
      (await rank({ profile: p, candidates })).recommendations.find(
        (p) => p.candidateId === "a",
      )!.scores.baseScore,
      0,
    );
  });
  it("uses seed graph and publication freshness to resolve otherwise equivalent papers", async function () {
    const c = candidate("b", "Recommendation", {
      provenance: [
        {
          route: "seed_recommendation",
          provider: "openalex",
          providerRank: 1,
          seedPaperId: "seed",
        },
      ],
      sources: ["seed_recommendation"],
      seedPaperIds: ["seed"],
    });
    assert.equal(
      (await rank({ candidates: [candidate("a", "Recommendation"), c] }))
        .recommendations[0].candidateId,
      "b",
    );
    assert.equal(
      (
        await rank({
          candidates: [
            candidate("a", "Recommendation", { publicationDate: "2020" }),
            candidate("b", "Recommendation", { publicationDate: "2026" }),
          ],
        })
      ).recommendations[0].candidateId,
      "b",
    );
  });
  it("diversifies near duplicates, favors relevance at lambda=1, and records selection-time utility", async function () {
    const candidates = [
      candidate("a", "Recommendation agents systems"),
      candidate("b", "Recommendation agents systems"),
      candidate("c", "Recommendation astronomy"),
    ];
    const result = await rank({ candidates, topK: 2 });
    assert.deepEqual(
      result.recommendations.map((p) => p.candidateId),
      ["a", "c"],
    );
    const relevance = await new RankingService({ mmrLambda: 1 }).rank({
      ...input(candidates),
      topK: 2,
    });
    assert.deepEqual(
      relevance.recommendations.map((p) => p.candidateId),
      ["a", "b"],
    );
    assert.equal(result.recommendations[0].scores.diversity, 0);
    assert.closeTo(result.recommendations[1].scores.diversity!, 0.25, 1e-12);
    for (const p of result.recommendations)
      assert.closeTo(
        p.scores.finalScore,
        0.8 * p.scores.baseScore! - 0.2 * p.scores.diversity!,
        1e-12,
      );
    const negative = diversify(
      relevance.recommendations.map((p) => ({
        ...p,
        scores: { ...p.scores, baseScore: 0 },
      })),
      2,
      { ...config, mmrLambda: 0.8 },
    );
    assert.isBelow(negative[1].scores.finalScore, 0);
  });
  it("uses semantic pairwise similarity when lexical text differs", async function () {
    const candidates = [
      candidate("a", "Recommendation"),
      candidate("b", "Recommendation second"),
      candidate("c", "Recommendation third"),
    ];
    const result = await rank({
      candidates,
      topK: 2,
      semanticProvider: {
        embed: async (texts) => ({
          model: "fake",
          vectors: texts.map((t) =>
            t.includes("Seed paper")
              ? [1, 1]
              : t.includes("third")
                ? [0, 1]
                : [1, 0],
          ),
        }),
      },
    });
    assert.deepEqual(
      result.recommendations.map((p) => p.candidateId),
      ["a", "c"],
    );
    assert.closeTo(result.recommendations[1].scores.diversity!, 0, 1e-12);
  });
  it("returns short/empty pools without filler or empty embedding calls", async function () {
    assert.lengthOf(
      (
        await rank({
          candidates: [candidate("one", "Recommendation")],
          topK: 20,
        })
      ).recommendations,
      1,
    );
    const result = await rank({
      candidates: [],
      semanticProvider: {
        embed: async () => {
          throw new Error("must not call");
        },
      },
    });
    assert.isEmpty(result.recommendations);
    assert.deepEqual(result.warnings, ["ranking_candidate_pool_empty"]);
    assert.isFalse(result.diagnostics.semanticRequested);
  });
  it("rejects invalid time, candidates, profile, focus, topK and duplicate IDs", async function () {
    for (const patch of [
      { now: NaN },
      { now: 9e15 },
      { now: -1 },
      { topK: 0 },
      { topK: 21 },
      { topK: 1.5 },
      { focus: "" },
      { candidates: null },
      { candidates: [candidate("a", "x"), candidate("a", "y")] },
      { profile: {} },
    ])
      await rejects(rank(patch as never), TypeError);
  });
});
