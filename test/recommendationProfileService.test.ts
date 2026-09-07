import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { ProfileService } from "../src/recommendation/profile/profileService";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import type {
  ResearchLibrarySource,
  TopicExtractor,
} from "../src/recommendation/profile/contracts";
import { InMemoryProfileStore } from "./helpers/recommendationStores";
import {
  paperSignal,
  preferences,
  PROFILE_NOW,
} from "./helpers/researchProfileFixtures";

describe("research ProfileService lifecycle", function () {
  let store: InMemoryProfileStore;
  let source: ResearchLibrarySource;
  let now: number;
  let reads: number;
  let service: ProfileService;
  beforeEach(function () {
    store = new InMemoryProfileStore();
    now = PROFILE_NOW;
    reads = 0;
    source = {
      getLibrarySnapshot: async (libraryID) => {
        reads++;
        return { libraryID, papers: [paperSignal()] };
      },
    };
    service = new ProfileService(
      store,
      source,
      new ProfileBuilder(),
      () => now,
      15,
    );
  });
  it("builds once, persists version 1, then serves cached reads without source/model calls", async function () {
    const first = await service.get(1);
    assert.equal(first.status, "built");
    assert.equal(first.profile.profileId, "library:1");
    assert.equal(first.profile.version, 1);
    assert.equal(reads, 1);
    let calls = 0;
    const cached = await service.get(1, {
      extractor: {
        extract: async () => {
          calls++;
          throw new Error("Must not call");
        },
      },
    });
    assert.equal(cached.status, "loaded");
    assert.deepEqual(cached.profile, first.profile);
    assert.equal(reads, 1);
    assert.equal(calls, 0);
    cached.profile.topics[0].weight = 0;
    assert.deepEqual((await service.get(1)).profile, first.profile);
  });
  it("rebuilds with new timestamps and preserved explicit preferences", async function () {
    const first = await service.updateExplicitPreferences(1, preferences());
    now++;
    const next = await service.get(1, { refresh: true });
    assert.equal(next.status, "rebuilt");
    assert.equal(next.profile.version, 2);
    assert.deepEqual(
      next.profile.explicitPreferences,
      first.profile.explicitPreferences,
    );
    assert.equal(next.profile.generatedAt, now);
    assert.equal(next.profile.updatedAt, now);
    assert.equal(next.profile.signalSummary.explicitPreferenceCount, 2);
    assert.equal(
      next.profile.topics.find((topic) => topic.label === "Agents")!.weight,
      1,
    );
  });
  it("validates preference updates before I/O and recomputes affected scores in one CAS revision", async function () {
    await service.get(1);
    const original = (await store.load("library:1"))!;
    now++;
    const value = preferences();
    value.positiveTopics[0].strength = 0;
    value.negativeTopics[0] = {
      ...value.negativeTopics[0],
      label: "Agents",
      strength: 1,
    };
    const next = await service.updateExplicitPreferences(1, value);
    assert.equal(next.profile.version, original.version + 1);
    assert.equal(next.profile.topics[0].weight, 0);
    assert.equal(next.profile.generatedAt, now);
    value.negativeTopics[0].strength = -1;
    const readCount = reads;
    await rejects(service.updateExplicitPreferences(1, value), /strength/);
    assert.equal(reads, readCount);
    assert.deepEqual(await store.load("library:1"), next.profile);
  });
  it("fails competing CAS rebuilds explicitly without hidden retries", async function () {
    await service.get(1);
    const results = await Promise.allSettled([
      service.rebuild(1),
      service.rebuild(1),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failure = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    assert.match(failure.reason.message, /version conflict/);
    assert.equal((await store.load("library:1"))!.version, 2);
    assert.equal(reads, 3);
  });
  it("accepts valid model evidence but derives persistent weight deterministically", async function () {
    const extractor: TopicExtractor = {
      extract: async () => ({
        topics: [
          {
            label: "Multi-agent planning",
            confidence: 0.9,
            supportingPaperIds: [paperSignal().itemId],
          },
        ],
        warnings: [],
      }),
    };
    const result = await service.get(1, { extractor });
    const topic = result.profile.topics.find(
      (topic) => topic.label === "Multi-agent planning",
    )!;
    assert.exists(topic);
    assert.notEqual(topic.confidence, 0.9);
    assert.notEqual(topic.weight, 0.9);
    assert.deepEqual(result.warnings, []);
  });
  for (const failure of [
    "throw",
    "unknown_id",
    "invalid_confidence",
    "empty",
    "invalid_warnings",
    "timeout",
  ] as const) {
    it(`persists a deterministic fallback after extractor ${failure}`, async function () {
      const extractor: TopicExtractor = {
        extract: async () => {
          if (failure === "throw")
            throw new Error("Transport failed, sensitive provider details");
          if (failure === "timeout") return new Promise(() => {});
          return {
            topics:
              failure === "empty"
                ? []
                : [
                    {
                      label: "Model-only topic",
                      confidence: failure === "invalid_confidence" ? 2 : 0.9,
                      supportingPaperIds: [
                        failure === "unknown_id"
                          ? "invented"
                          : paperSignal().itemId,
                      ],
                    },
                  ],
            warnings:
              failure === "invalid_warnings"
                ? ["raw secret model payload"]
                : [],
          };
        },
      };
      const result = await service.get(1, { extractor });
      assert.equal(result.status, "built");
      assert.isNotEmpty(result.warnings);
      assert.deepEqual(
        result.profile,
        new ProfileBuilder().build({
          libraryID: 1,
          papers: [paperSignal()],
          now,
        }),
      );
      assert.deepEqual(await store.load("library:1"), result.profile);
    });
  }
  it("protects source data against extractor mutations", async function () {
    const extractor: TopicExtractor = {
      extract: async (papers) => {
        papers[0].manualTags.length = 0;
        return { topics: [], warnings: [] };
      },
    };
    const result = await service.get(1, { extractor });
    assert.equal(result.profile.topics[0].label, "Agents");
  });
  it("does not persist cancelled builds", async function () {
    const controller = new AbortController();
    await rejects(
      service.get(1, {
        signal: controller.signal,
        extractor: {
          extract: async () => {
            controller.abort();
            return { topics: [], warnings: [] };
          },
        },
      }),
      /cancelled/,
    );
    assert.isNull(await store.load("library:1"));
    await rejects(service.get(1, { signal: controller.signal }), /cancelled/);
  });
  it("cancels a stalled extractor immediately even when it ignores the abort signal", async function () {
    const controller = new AbortController();
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const slowService = new ProfileService(
      store,
      source,
      new ProfileBuilder(),
      () => now,
      30_000,
    );
    const run = slowService.get(1, {
      signal: controller.signal,
      extractor: {
        extract: async () => {
          started!();
          return new Promise(() => {});
        },
      },
    });
    await ready;
    controller.abort();
    await rejects(run, /cancelled/);
    assert.isNull(await store.load("library:1"));
  });
  it("rejects invalid scopes and mismatched sources without model or store writes", async function () {
    await rejects(service.get(0), /libraryID/);
    assert.equal(reads, 0);
    const mismatch = new ProfileService(store, {
      getLibrarySnapshot: async () => ({ libraryID: 6, papers: [] }),
    });
    await rejects(mismatch.get(1), /scope mismatch/);
    assert.isNull(await store.load("library:1"));
  });
  it("documents removal of unsupported feedback/embedding state on a full rebuild", async function () {
    const previous = new ProfileBuilder().build({
      libraryID: 1,
      papers: [paperSignal()],
      now,
    });
    previous.topics[0].sources.push("feedback");
    previous.signalSummary.positiveFeedbackCount = 2;
    previous.embedding = {
      model: "old",
      dimension: 3,
      storageKey: "legacy",
      updatedAt: now,
    };
    await store.save(previous, null);
    const loaded = await service.get(1);
    assert.equal(loaded.profile.signalSummary.positiveFeedbackCount, 2);
    const result = await service.rebuild(1);
    assert.include(result.warnings, "feedback_state_discarded_on_rebuild");
    assert.include(result.warnings, "profile_embedding_invalidated_on_rebuild");
    assert.equal(result.profile.signalSummary.positiveFeedbackCount, 0);
    assert.isUndefined(result.profile.embedding);
  });
});
