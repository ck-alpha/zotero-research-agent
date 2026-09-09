import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { CandidateDiscoveryService } from "../src/recommendation/candidate/candidateService";
import type {
  ExternalPaper,
  LiteratureDiscoveryBatch,
  LiteratureDiscoverySource,
} from "../src/recommendation/candidate/contracts";
import type { ResearchProfile } from "../src/recommendation/domain/profile";
import { assertRecommendationCandidate } from "../src/recommendation/domain/validation";
import type { ResearchLibrarySnapshot } from "../src/recommendation/profile/contracts";
import { makeProfile } from "./helpers/recommendationFixtures";
import { paperSignal, PROFILE_NOW } from "./helpers/researchProfileFixtures";

function profile(labels: string[] = ["Agents"]): ResearchProfile {
  const template = makeProfile();
  return {
    ...template,
    profileId: "library:1",
    version: 7,
    topics: labels.map((label, index) => ({
      ...template.topics[0],
      id: `topic-${index}`,
      label,
      weight: 1,
      confidence: 1,
    })),
    representativePapers: [],
    explicitPreferences: { positiveTopics: [], negativeTopics: [] },
  };
}

function external(
  id: string,
  patch: Partial<ExternalPaper> = {},
): ExternalPaper {
  return {
    title: `Research paper on ${id}`,
    authors: ["A. Researcher"],
    doi: `10.1234/${id}`,
    provider: "openalex",
    year: 2026,
    ...patch,
  };
}

function batch(...papers: ExternalPaper[]): LiteratureDiscoveryBatch {
  return { papers, warnings: [] };
}

function withSeeds(input: ResearchProfile, count = 1): ResearchLibrarySnapshot {
  const papers = Array.from({ length: count }, (_, index) =>
    paperSignal(index + 1, { doi: `10.1234/seed-${index}` }),
  );
  input.representativePapers = papers.map((paper) => ({
    itemId: paper.itemId,
    title: paper.title,
    weight: 1,
    reason: "recent",
    addedAt: PROFILE_NOW,
  }));
  return { libraryID: 1, papers };
}

function source(
  patch: Partial<LiteratureDiscoverySource> = {},
): LiteratureDiscoverySource {
  return {
    search: async () => batch(),
    related: async () => batch(),
    ...patch,
  };
}

const emptySnapshot: ResearchLibrarySnapshot = { libraryID: 1, papers: [] };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("CandidateDiscoveryService", function () {
  it("returns query-only candidates with traceable empty-score domain contracts", async function () {
    let searchCalls = 0;
    const input = profile();
    const service = new CandidateDiscoveryService(
      source({
        search: async (request) => {
          searchCalls++;
          assert.equal(request.query, "Agents");
          assert.equal(request.limit, 12);
          return batch(external("first"), external("second"));
        },
        related: async () => assert.fail("Unexpected seed call"),
      }),
      { now: () => PROFILE_NOW },
    );
    const result = await service.discover({
      libraryID: 1,
      profile: input,
      snapshot: emptySnapshot,
    });
    assert.equal(searchCalls, 1);
    assert.equal(result.profileId, "library:1");
    assert.equal(result.profileVersion, 7);
    assert.equal(result.generatedAt, PROFILE_NOW);
    assert.equal(result.diagnostics.queriesPlanned, 1);
    assert.equal(result.diagnostics.queriesSucceeded, 1);
    assert.equal(result.diagnostics.seedsPlanned, 0);
    assert.equal(result.diagnostics.rawCandidateCount, 2);
    assert.equal(result.diagnostics.finalCandidateCount, 2);
    assert.isFalse(result.diagnostics.poolTruncated);
    result.candidates.forEach((candidate, index) => {
      assertRecommendationCandidate(candidate);
      assert.deepEqual(candidate.scores, {});
      assert.deepEqual(candidate.sources, ["profile_query"]);
      assert.deepInclude(candidate.provenance, {
        route: "profile_query",
        provider: "openalex",
        providerRank: index + 1,
        query: "Agents",
        topicId: "topic-0",
      });
    });
  });

  it("supports weak seed-only profiles and transmits DOI without a query fallback", async function () {
    const input = profile([]);
    const snapshot = withSeeds(input);
    const result = await new CandidateDiscoveryService(
      source({
        search: async () => assert.fail("Unexpected keyword fallback"),
        related: async (request) => {
          assert.equal(request.doi, "10.1234/seed-0");
          assert.equal(request.limit, 8);
          assert.notProperty(request, "query");
          assert.notProperty(request, "title");
          return batch(external("related"));
        },
      }),
    ).discover({ libraryID: 1, profile: input, snapshot });
    assert.equal(result.diagnostics.queriesPlanned, 0);
    assert.equal(result.diagnostics.seedsPlanned, 1);
    assert.equal(result.diagnostics.seedsSucceeded, 1);
    assert.deepEqual(result.candidates[0].seedPaperIds, [
      snapshot.papers[0].itemId,
    ]);
    assert.deepEqual(result.candidates[0].provenance, [
      {
        route: "seed_recommendation",
        provider: "openalex",
        providerRank: 1,
        seedPaperId: snapshot.papers[0].itemId,
      },
    ]);
  });

  it("merges query/seed and multi-topic hits while excluding the entire current library", async function () {
    const input = profile(["Agents", "Recommendation"]);
    const snapshot = withSeeds(input);
    snapshot.papers.push(
      paperSignal(99, { doi: "https://doi.org/10.1234/SAVED" }),
    );
    const original = structuredClone({ input, snapshot });
    const result = await new CandidateDiscoveryService(
      source({
        search: async () => batch(external("shared"), external("saved")),
        related: async () =>
          batch(
            external("shared", {
              doi: "https://doi.org/10.1234/SHARED",
              abstract: "A fuller abstract provided by seed discovery.",
            }),
            external("novel-seed"),
          ),
      }),
    ).discover({ libraryID: 1, profile: input, snapshot });
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.doi),
      ["10.1234/shared", "10.1234/novel-seed"],
    );
    const shared = result.candidates[0];
    assert.lengthOf(shared.provenance, 3);
    assert.deepEqual(shared.sources, ["profile_query", "seed_recommendation"]);
    assert.deepEqual(shared.seedPaperIds, [snapshot.papers[0].itemId]);
    assert.equal(
      shared.abstract,
      "A fuller abstract provided by seed discovery.",
    );
    assert.deepEqual(shared.scores, {});
    assert.equal(result.diagnostics.rawCandidateCount, 6);
    assert.equal(result.diagnostics.existingLibraryExcluded, 2);
    assert.equal(result.diagnostics.duplicateCandidatesMerged, 2);
    assert.equal(result.diagnostics.finalCandidateCount, 2);
    assert.deepEqual({ input, snapshot }, original);
  });

  it("uses focus first without changing the persistent profile or version", async function () {
    const input = profile(["Long term interest"]);
    const original = structuredClone(input);
    const result = await new CandidateDiscoveryService(
      source({ search: async ({ query }) => batch(external(query)) }),
    ).discover({
      libraryID: 1,
      profile: input,
      snapshot: emptySnapshot,
      focus: "Transient question",
    });
    assert.equal(result.focus, "Transient question");
    assert.equal(result.diagnostics.queriesPlanned, 2);
    assert.equal(
      result.candidates[0].title,
      "Research paper on Transient question",
    );
    assert.deepInclude(result.candidates[0].provenance, {
      route: "profile_query",
      provider: "openalex",
      providerRank: 1,
      query: "Transient question",
      focus: true,
    });
    assert.equal(result.profileVersion, input.version);
    assert.deepEqual(input, original);
  });

  for (const failingRoute of ["search", "related"] as const) {
    it(`preserves successful routes and diagnostics after a ${failingRoute} failure`, async function () {
      const input = profile(["First topic", "Second topic"]);
      const snapshot = withSeeds(input, 2);
      let failedOnce = false;
      const result = await new CandidateDiscoveryService(
        source({
          search: async ({ query }) => {
            if (failingRoute === "search" && !failedOnce) {
              failedOnce = true;
              throw new Error("Network failure with raw private diagnostic");
            }
            return batch(external(`query-${query}`));
          },
          related: async ({ doi }) => {
            if (failingRoute === "related" && !failedOnce) {
              failedOnce = true;
              throw new Error("Seed unavailable with raw private diagnostic");
            }
            return batch(external(`related-${doi.slice(-1)}`));
          },
        }),
      ).discover({ libraryID: 1, profile: input, snapshot });
      assert.equal(result.diagnostics.queriesPlanned, 2);
      assert.equal(result.diagnostics.seedsPlanned, 2);
      assert.equal(
        result.diagnostics.queriesSucceeded,
        failingRoute === "search" ? 1 : 2,
      );
      assert.equal(
        result.diagnostics.seedsSucceeded,
        failingRoute === "related" ? 1 : 2,
      );
      assert.lengthOf(result.candidates, 3);
      assert.isNotEmpty(result.warnings);
      assert.notInclude(
        JSON.stringify(result.warnings),
        "raw private diagnostic",
      );
    });
  }

  it("distinguishes empty successful responses and absent recall inputs from total dependency failure", async function () {
    const service = new CandidateDiscoveryService(source());
    const empty = await service.discover({
      libraryID: 1,
      profile: profile(),
      snapshot: emptySnapshot,
    });
    assert.deepEqual(empty.candidates, []);
    assert.equal(empty.diagnostics.queriesSucceeded, 1);
    const absent = await service.discover({
      libraryID: 1,
      profile: profile([]),
      snapshot: emptySnapshot,
    });
    assert.deepEqual(absent.candidates, []);
    assert.equal(absent.diagnostics.queriesPlanned, 0);
    assert.equal(absent.diagnostics.seedsPlanned, 0);
    assert.isNotEmpty(absent.warnings);
    const input = profile();
    await rejects(
      new CandidateDiscoveryService(
        source({
          search: async () => {
            throw new Error("Unavailable");
          },
          related: async () => {
            throw new Error("Unavailable");
          },
        }),
      ).discover({ libraryID: 1, profile: input, snapshot: withSeeds(input) }),
      /failed|unavailable/i,
    );
  });

  it("validates library/profile scope and invalid state before any external request", async function () {
    let calls = 0;
    const service = new CandidateDiscoveryService(
      source({
        search: async () => {
          calls++;
          return batch();
        },
      }),
    );
    for (const invalid of [
      { libraryID: 0, profile: profile(), snapshot: emptySnapshot },
      {
        libraryID: 1,
        profile: { ...profile(), profileId: "library:2" },
        snapshot: emptySnapshot,
      },
      {
        libraryID: 1,
        profile: profile(),
        snapshot: { ...emptySnapshot, libraryID: 2 },
      },
      {
        libraryID: 1,
        profile: { ...profile(), version: 0 },
        snapshot: emptySnapshot,
      },
    ]) {
      await rejects(service.discover(invalid), /libraryID|scope|version/i);
    }
    assert.equal(calls, 0);
  });

  it("admits a bounded pool in discovery order and merges later provenance into admitted candidates", async function () {
    const input = profile();
    const result = await new CandidateDiscoveryService(
      source({
        search: async () =>
          batch(external("a"), external("b"), external("c"), external("d")),
        related: async () => batch(external("b"), external("e")),
      }),
      { limits: { maxCandidatePool: 2 } },
    ).discover({ libraryID: 1, profile: input, snapshot: withSeeds(input) });
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.doi),
      ["10.1234/a", "10.1234/b"],
    );
    assert.lengthOf(result.candidates[1].provenance, 2);
    assert.deepEqual(result.candidates[1].scores, {});
    assert.equal(result.diagnostics.finalCandidateCount, 2);
    assert.isTrue(result.diagnostics.poolTruncated);
    assert.isNotEmpty(result.warnings);
  });

  it("skips malformed external papers while retaining valid siblings and provider ranks", async function () {
    const result = await new CandidateDiscoveryService(
      source({
        search: async () => ({
          papers: [
            null,
            external("blank", { title: "   " }),
            { ...external("bad-provider"), provider: "unknown" },
            { ...external("bad-title"), title: 7 },
            external("valid"),
          ] as unknown as ExternalPaper[],
          warnings: [],
        }),
      }),
    ).discover({ libraryID: 1, profile: profile(), snapshot: emptySnapshot });
    assert.lengthOf(result.candidates, 1);
    assert.equal(result.candidates[0].doi, "10.1234/valid");
    assert.equal(result.candidates[0].provenance[0].providerRank, 5);
    assert.equal(result.diagnostics.rawCandidateCount, 5);
    assert.equal(result.diagnostics.invalidCandidateCount, 4);
    assert.isNotEmpty(result.warnings);
    assertRecommendationCandidate(result.candidates[0]);
  });

  it("keeps healthy routes after malformed dependency batch structures", async function () {
    const result = await new CandidateDiscoveryService(
      source({
        search: async ({ query }) =>
          query === "Invalid"
            ? (null as unknown as LiteratureDiscoveryBatch)
            : batch(external("healthy")),
      }),
    ).discover({
      libraryID: 1,
      profile: profile(["Invalid", "Healthy"]),
      snapshot: emptySnapshot,
    });
    assert.equal(result.diagnostics.queriesSucceeded, 1);
    assert.lengthOf(result.candidates, 1);
    assert.isNotEmpty(result.warnings);
  });

  it("bounds shared query/seed concurrency and orders results independently of completion timing", async function () {
    const pending: Array<{
      id: string;
      finish: (result: LiteratureDiscoveryBatch) => void;
    }> = [];
    let active = 0;
    let peak = 0;
    const call = async (id: string): Promise<LiteratureDiscoveryBatch> => {
      active++;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        pending.push({
          id,
          finish: (result) => {
            active--;
            resolve(result);
          },
        });
      });
    };
    const input = profile(["First", "Second", "Third"]);
    const snapshot = withSeeds(input);
    const service = new CandidateDiscoveryService(
      source({
        search: async ({ query }) => call(query),
        related: async () => call("Seed"),
      }),
      { limits: { maxConcurrentRequests: 2 }, now: () => PROFILE_NOW },
    );
    const run = service.discover({ libraryID: 1, profile: input, snapshot });
    await tick();
    assert.deepEqual(
      pending.map((item) => item.id),
      ["First", "Second"],
    );
    pending[1].finish(batch(external("second")));
    await tick();
    assert.equal(pending[2].id, "Third");
    pending[2].finish(batch(external("third")));
    await tick();
    assert.equal(pending[3].id, "Seed");
    pending[3].finish(batch(external("seed-result")));
    pending[0].finish(batch(external("first")));
    const result = await run;
    assert.equal(peak, 2);
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.doi),
      [
        "10.1234/first",
        "10.1234/second",
        "10.1234/third",
        "10.1234/seed-result",
      ],
    );
    const replay = await new CandidateDiscoveryService(
      source({
        search: async ({ query }) => batch(external(query.toLowerCase())),
        related: async () => batch(external("seed-result")),
      }),
      { limits: { maxConcurrentRequests: 2 }, now: () => PROFILE_NOW },
    ).discover({ libraryID: 1, profile: input, snapshot });
    assert.deepEqual(result, replay);
  });

  it("rejects pre-cancelled requests before scheduling any source work", async function () {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await rejects(
      new CandidateDiscoveryService(
        source({
          search: async () => {
            calls++;
            return batch();
          },
        }),
      ).discover({
        libraryID: 1,
        profile: profile(),
        snapshot: emptySnapshot,
        signal: controller.signal,
      }),
      /cancel|abort/i,
    );
    assert.equal(calls, 0);
  });

  it("promptly cancels an uncooperative dependency and never starts queued routes", async function () {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const run = new CandidateDiscoveryService(
      source({
        search: async ({ signal }) => {
          calls++;
          assert.strictEqual(signal, controller.signal);
          started();
          return new Promise(() => {});
        },
      }),
      { limits: { maxConcurrentRequests: 1 } },
    ).discover({
      libraryID: 1,
      profile: profile(["First", "Second"]),
      snapshot: emptySnapshot,
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    await rejects(run, /cancel|abort/i);
    assert.equal(calls, 1);
  });
});
