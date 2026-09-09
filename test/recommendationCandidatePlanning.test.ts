import { assert } from "chai";
import { buildQueryPlan } from "../src/recommendation/candidate/queryRecall";
import { buildSeedPlan } from "../src/recommendation/candidate/seedRecall";
import { CANDIDATE_DISCOVERY_LIMITS } from "../src/recommendation/candidate/config";
import type {
  ResearchProfile,
  TopicInterest,
} from "../src/recommendation/domain/profile";
import { makeProfile } from "./helpers/recommendationFixtures";
import { paperSignal } from "./helpers/researchProfileFixtures";

function topic(
  id: string,
  label = id,
  weight = 1,
  confidence = 1,
): TopicInterest {
  return {
    id,
    label,
    weight,
    confidence,
    sources: ["library"],
    lastEvidenceAt: 100,
    evidenceRefs: [],
  };
}

function profile(topics: TopicInterest[] = []): ResearchProfile {
  return {
    ...makeProfile(),
    profileId: "library:1",
    topics,
    representativePapers: [],
    explicitPreferences: { positiveTopics: [], negativeTopics: [] },
  };
}

function representatives(
  ids: string[],
): ResearchProfile["representativePapers"] {
  return ids.map((itemId) => ({
    itemId,
    title: `Seed ${itemId}`,
    weight: 1,
    reason: "recent",
    addedAt: 100,
  }));
}

describe("candidate query planning", function () {
  it("prioritizes weight times confidence with deterministic topic identity ties", function () {
    const input = profile([
      topic("z", "High weight, low confidence", 1, 0.1),
      topic("b", "Second tied topic", 0.5, 1),
      topic("a", "First tied topic", 1, 0.5),
      topic("best", "Reliable interest", 0.8, 0.9),
    ]);
    const original = structuredClone(input);
    const first = buildQueryPlan(input);
    assert.deepEqual(
      first.queries.map((query) => query.topicId),
      ["best", "a", "b", "z"],
    );
    assert.deepEqual(first, buildQueryPlan(input));
    assert.deepEqual(input, original);
    input.topics.reverse();
    assert.deepEqual(buildQueryPlan(input), first);
  });

  it("skips zero, negative and invalid weights/confidences and explicit negative topics", function () {
    const input = profile([
      topic("valid", "Useful interest"),
      topic("zero", "Zero", 0),
      topic("negative", "Negative", -0.1),
      topic("nan", "Not a number", Number.NaN),
      topic("infinite", "Infinite", Number.POSITIVE_INFINITY),
      topic("confidence-zero", "No confidence", 1, 0),
      topic("confidence-invalid", "Invalid confidence", 1, Number.NaN),
      topic("forbidden", "  PROMPT   ENGINEERING  "),
    ]);
    input.explicitPreferences.negativeTopics = [
      {
        id: "negative-preference",
        label: "Prompt Engineering",
        strength: 1,
        createdAt: 100,
        updatedAt: 100,
      },
    ];
    assert.deepEqual(
      buildQueryPlan(input).queries.map((query) => query.topicId),
      ["valid"],
    );
  });

  it("places transient focus first and reserves the remaining shared query budget", function () {
    const input = profile(
      Array.from({ length: 9 }, (_, index) => topic(`topic-${index}`)),
    );
    const original = structuredClone(input);
    const result = buildQueryPlan(input, "  Agent   Memory  ");
    assert.lengthOf(result.queries, CANDIDATE_DISCOVERY_LIMITS.maxQueries);
    assert.equal(result.focus, "Agent Memory");
    assert.equal(result.queries[0].query, "Agent Memory");
    assert.isTrue(result.queries[0].focus);
    assert.isUndefined(result.queries[0].topicId);
    assert.deepEqual(input, original);
    assert.lengthOf(
      buildQueryPlan(input).queries,
      CANDIDATE_DISCOVERY_LIMITS.maxQueries,
    );
  });

  it("deduplicates NFC, case and whitespace variants before assigning query slots", function () {
    const input = profile([
      topic("a", "Cafe\u0301   Agents"),
      topic("b", " CAFÉ agents "),
      topic("c", "Different topic"),
    ]);
    const result = buildQueryPlan(input, "Café Agents", { maxQueries: 2 });
    assert.deepEqual(
      result.queries.map((query) => query.query),
      ["Café Agents", "Different topic"],
    );
    assert.isTrue(result.queries[0].focus);
  });

  it("rejects invalid focus, supports focus-only recall, and bounds focus length", function () {
    assert.throws(() => buildQueryPlan(profile(), "   "), /focus/i);
    assert.deepEqual(
      buildQueryPlan(profile(), "Current question").queries.map(
        (query) => query.query,
      ),
      ["Current question"],
    );
    const focus = "x".repeat(CANDIDATE_DISCOVERY_LIMITS.maxFocusChars + 20);
    assert.throws(() => buildQueryPlan(profile(), focus), /focus/i);
  });
});

describe("candidate seed planning", function () {
  it("keeps representative order and canonical DOI identity within a bounded seed budget", function () {
    const papers = Array.from({ length: 7 }, (_, index) =>
      paperSignal(index + 1, { doi: `https://doi.org/10.1234/SEED-${index}` }),
    );
    const input = profile();
    input.representativePapers = representatives(
      [...papers].reverse().map((paper) => paper.itemId),
    );
    const original = structuredClone(input);
    const result = buildSeedPlan(input, { libraryID: 1, papers });
    assert.lengthOf(result.seeds, CANDIDATE_DISCOVERY_LIMITS.maxSeeds);
    assert.deepEqual(
      result.seeds.map((seed) => seed.seedPaperId),
      [...papers]
        .reverse()
        .slice(0, CANDIDATE_DISCOVERY_LIMITS.maxSeeds)
        .map((paper) => paper.itemId),
    );
    assert.equal(result.seeds[0].doi, "10.1234/seed-6");
    assert.equal(result.seedsSkippedWithoutDoi, 0);
    assert.deepEqual(input, original);
  });

  it("skips missing DOI or missing/foreign paper identity without keyword substitution", function () {
    const missing = paperSignal(1);
    const blank = paperSignal(2, { doi: "   " });
    const usable = paperSignal(3, { doi: "doi:10.1234/GOOD" });
    const foreign = paperSignal(4, {
      itemId: "library:9:item:4",
      doi: "10.1234/foreign",
    });
    const input = profile();
    input.representativePapers = representatives([
      missing.itemId,
      "library:1:item:999",
      blank.itemId,
      foreign.itemId,
      usable.itemId,
    ]);
    const result = buildSeedPlan(input, {
      libraryID: 1,
      papers: [usable, foreign, blank, missing],
    });
    assert.deepEqual(result.seeds, [
      { doi: "10.1234/good", seedPaperId: usable.itemId },
    ]);
    assert.equal(result.seedsSkippedWithoutDoi, 2);
    assert.equal(result.seedsSkippedMissingPaper, 2);
    assert.isNotEmpty(result.warnings);
    assert.notProperty(result.seeds[0], "query");
  });

  it("preserves representative paper identities even when two saved papers share a DOI", function () {
    const papers = [
      paperSignal(1, { doi: "10.1234/same" }),
      paperSignal(2, { doi: "https://doi.org/10.1234/SAME" }),
      paperSignal(3, { doi: "10.1234/next" }),
    ];
    const input = profile();
    input.representativePapers = representatives(
      papers.map((paper) => paper.itemId),
    );
    const result = buildSeedPlan(
      input,
      { libraryID: 1, papers },
      { maxSeeds: 2 },
    );
    assert.deepEqual(result.seeds, [
      { doi: "10.1234/same", seedPaperId: papers[0].itemId },
      { doi: "10.1234/same", seedPaperId: papers[1].itemId },
    ]);
  });
});
