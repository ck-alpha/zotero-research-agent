import { assert } from "chai";
import {
  assertRecommendationCandidate,
  assertRecommendationFeedback,
  assertRecommendationImpression,
  assertResearchProfile,
} from "../src/recommendation/domain/validation";
import {
  makeCandidate,
  makeFeedback,
  makeImpression,
  makeProfile,
} from "./helpers/recommendationFixtures";

describe("recommendation domain contracts", function () {
  it("validates new bounded score fields while retaining signed MMR and legacy contracts", function () {
    for (const key of ["preference", "diversity"]) {
      for (const value of [0, 1])
        assertRecommendationCandidate({
          ...makeCandidate(),
          scores: { [key]: value, finalScore: -0.2 },
        });
      for (const value of [-0.1, 1.1, NaN, Infinity, null])
        assert.throws(
          () =>
            assertRecommendationCandidate({
              ...makeCandidate(),
              scores: { [key]: value },
            }),
          TypeError,
        );
    }
  });
  it("requires an impression profile identity as well as its revision", function () {
    assert.equal(makeImpression().profileId, "profile-1");
    for (const profileId of [undefined, null, "", " ", 1]) {
      assert.throws(
        () =>
          assertRecommendationImpression({ ...makeImpression(), profileId }),
        TypeError,
        "profileId",
      );
    }
  });
  it("round trips a complete profile with independent intensity and confidence", function () {
    const original = makeProfile();
    const value: unknown = JSON.parse(JSON.stringify(original));
    assertResearchProfile(value);
    assert.deepEqual(value, original);
    assert.equal(value.topics[0].weight, 0.8);
    assert.equal(value.topics[0].confidence, 0.4);
    assert.equal(value.explicitPreferences.positiveTopics[0].strength, 1);
    assert.equal(value.explicitPreferences.negativeTopics[0].strength, 0.9);
    value.topics[0].evidenceRefs.push("paper:other");
    assert.lengthOf(original.topics[0].evidenceRefs, 1);
  });

  it("accepts an empty initial profile and absent optional embedding", function () {
    const value = makeProfile();
    value.topics = [];
    value.representativePapers = [];
    value.explicitPreferences = { positiveTopics: [], negativeTopics: [] };
    value.signalSummary = {
      libraryPaperCount: 0,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      explicitPreferenceCount: 0,
    };
    delete value.embedding;
    assertResearchProfile(value);
  });

  for (const invalidVersion of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    null,
  ]) {
    it(`rejects invalid profile and impression versions: ${String(invalidVersion)}`, function () {
      assert.throws(
        () =>
          assertResearchProfile({ ...makeProfile(), version: invalidVersion }),
        TypeError,
        "profile.version",
      );
      assert.throws(
        () =>
          assertRecommendationImpression({
            ...makeImpression(),
            profileVersion: invalidVersion,
          }),
        TypeError,
        "impression.profileVersion",
      );
    });
  }

  for (const field of ["weight", "confidence"] as const) {
    it(`validates topic ${field} independently including boundaries`, function () {
      for (const number of [0, 1, -0.01, 1.01, NaN, Infinity]) {
        const value = makeProfile();
        value.topics[0][field] = number;
        if (number === 0 || number === 1) assertResearchProfile(value);
        else
          assert.throws(() => assertResearchProfile(value), TypeError, field);
      }
    });
  }

  it("validates both preference polarities and representative weight", function () {
    for (const polarity of ["positiveTopics", "negativeTopics"] as const) {
      for (const strength of [-1, 2, NaN]) {
        const value = makeProfile();
        value.explicitPreferences[polarity][0].strength = strength;
        assert.throws(
          () => assertResearchProfile(value),
          TypeError,
          "strength",
        );
      }
    }
    const value = makeProfile();
    value.representativePapers[0].weight = 2;
    assert.throws(() => assertResearchProfile(value), TypeError, "weight");
  });

  it("rejects malformed nested values and accidental inline vectors", function () {
    const mutations: Array<(value: ReturnType<typeof makeProfile>) => void> = [
      (value) => {
        value.profileId = "  ";
      },
      (value) => {
        value.topics[0].id = "";
      },
      (value) => {
        value.topics[0].evidenceRefs = [""];
      },
      (value) => {
        value.topics[0].sources = [];
      },
      (value) => {
        value.explicitPreferences.negativeTopics[0].id = "";
      },
      (value) => {
        value.embedding!.dimension = 0;
      },
      (value) => {
        value.embedding!.storageKey = "";
      },
      (value) => {
        value.signalSummary.libraryPaperCount = -1;
      },
      (value) => {
        value.generatedAt = Infinity;
      },
    ];
    for (const mutate of mutations) {
      const value = makeProfile();
      mutate(value);
      assert.throws(() => assertResearchProfile(value), TypeError);
    }
    const value = makeProfile();
    assert.throws(
      () =>
        assertResearchProfile({
          ...value,
          embedding: { ...value.embedding, vector: [1, 2, 3] },
        }),
      TypeError,
      "vector",
    );
    for (const invalid of [
      null,
      [],
      {},
      new Date(),
      { ...value, topics: new Array(1) },
    ]) {
      assert.throws(() => assertResearchProfile(invalid), TypeError);
    }
  });

  it("preserves candidate score breakdown and allows unscored candidates", function () {
    const value: unknown = JSON.parse(JSON.stringify(makeCandidate()));
    assertRecommendationCandidate(value);
    assert.equal(value.scores.feedback, -0.3);
    assert.equal(value.scores.lexical, 2.4);
    assert.deepEqual(value.sources, ["profile_query", "seed_recommendation"]);
    assertRecommendationCandidate({
      candidateId: "paper-2",
      title: "Unknown metadata",
      authors: [],
      sources: ["profile_query"],
      provenance: [
        {
          route: "profile_query",
          provider: "openalex",
          providerRank: 1,
          query: "unknown metadata",
        },
      ],
      scores: {},
    });
    for (const key of Object.keys(value.scores)) {
      assert.throws(
        () =>
          assertRecommendationCandidate({ ...value, scores: { [key]: NaN } }),
        TypeError,
        key,
      );
    }
    assert.throws(
      () => assertRecommendationCandidate({ ...value, sources: ["citation"] }),
      TypeError,
      "sources",
    );
    assert.throws(
      () => assertRecommendationCandidate({ ...value, authors: [null] }),
      TypeError,
      "authors",
    );
  });

  it("accepts all four feedback actions and rejects unknown actions and empty IDs", function () {
    for (const action of ["positive", "negative", "save", "skip"]) {
      assertRecommendationFeedback({ ...makeFeedback(), action });
    }
    assert.throws(
      () =>
        assertRecommendationFeedback({ ...makeFeedback(), action: "click" }),
      TypeError,
      "action",
    );
    for (const key of ["eventId", "paperId", "recommendationId"]) {
      assert.throws(
        () => assertRecommendationFeedback({ ...makeFeedback(), [key]: " " }),
        TypeError,
        key,
      );
    }
  });

  it("requires rank, final score and matched topics on displayed paper snapshots", function () {
    const value: unknown = JSON.parse(JSON.stringify(makeImpression()));
    assertRecommendationImpression(value);
    assert.equal(value.candidates[0].rank, 1);
    assert.deepEqual(value.candidates[0].matchedTopicIds, ["topic-1"]);
    for (const patch of [
      { rank: 0 },
      { scores: {} },
      { matchedTopicIds: undefined },
    ]) {
      assert.throws(
        () =>
          assertRecommendationImpression({
            ...value,
            candidates: [{ ...value.candidates[0], ...patch }],
          }),
        TypeError,
      );
    }
    for (const patch of [{ rank: 2 }, { candidateId: "another-paper" }]) {
      assert.throws(
        () =>
          assertRecommendationImpression({
            ...value,
            candidates: [
              value.candidates[0],
              { ...value.candidates[0], ...patch },
            ],
          }),
        TypeError,
        "unique",
      );
    }
    assertRecommendationImpression({ ...value, candidates: [] });
  });
});
