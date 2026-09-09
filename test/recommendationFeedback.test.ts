import { AgentToolRegistry } from "../src/agent/tools/registry";
import { ActionContractService } from "../src/agent/contracts/actionContract";
import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteFeedbackStore,
  SqliteImpressionStore,
  FEEDBACK_TABLE,
  IMPRESSION_TABLE,
} from "../src/recommendation/feedback/stores";
import {
  feedbackEventId,
  FEEDBACK_STRENGTH,
} from "../src/recommendation/feedback/policy";
import { FeedbackReplay } from "../src/recommendation/feedback/replay";
import { applyProfileFeedback } from "../src/recommendation/feedback/profileUpdater";
import { RecommendationFeedbackService } from "../src/recommendation/feedback/service";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import { ProfileService } from "../src/recommendation/profile/profileService";
import {
  SqliteProfileStore,
  ProfileVersionConflict,
} from "../src/recommendation/profile/profileStore";
import { ResearchProfileTestDb } from "./helpers/researchProfileDb";
import { makeImpression } from "./helpers/recommendationFixtures";
import type { FeedbackAction } from "../src/recommendation/domain/feedback";
import { createRecommendationFeedbackTool } from "../src/agent/tools/recommendation/recommendationFeedback";
import { createResearchRecommendTool } from "../src/agent/tools/recommendation/researchRecommend";
import { resolvedAgentRequest } from "./helpers/resolvedAgentRequest";
import { IndexedResearchLibrarySource } from "../src/recommendation/profile/librarySource";
import {
  indexSnapshot,
  indexedItem,
  PROFILE_NOW,
} from "./helpers/researchProfileFixtures";
import type { AgentToolContext } from "../src/agent/types";

const now = PROFILE_NOW;
function impression() {
  const p = makeImpression();
  p.profileId = "library:1";
  p.timestamp = now;
  p.topicSnapshot = [{ id: "topic-1", label: "Agentic Recommendation" }];
  return p;
}
function event(
  action: FeedbackAction = "positive",
  recommendationId = "rec-1",
) {
  return {
    eventId: feedbackEventId(recommendationId, "candidate-1", action),
    recommendationId,
    paperId: "candidate-1",
    action,
    timestamp: now,
  };
}
function profile() {
  const p = new ProfileBuilder().build({ libraryID: 1, papers: [], now });
  p.topics = [
    {
      id: "topic-1",
      label: "Agentic Recommendation",
      weight: 0.2,
      confidence: 0.2,
      sources: ["library"],
      lastEvidenceAt: now,
      evidenceRefs: ["paper:1"],
    },
  ];
  return p;
}
function setup() {
  const db = new ResearchProfileTestDb();
  const impressions = new SqliteImpressionStore(() => db),
    events = new SqliteFeedbackStore(() => db),
    profiles = new SqliteProfileStore(() => db);
  const service = new RecommendationFeedbackService(
    profiles,
    impressions,
    events,
  );
  return { db, impressions, events, profiles, service };
}
const input = (action: FeedbackAction = "positive") => ({
  libraryID: 1,
  recommendationId: "rec-1",
  candidateId: "candidate-1",
  action,
  timestamp: now,
});
const ctx = (): AgentToolContext => ({
  request: resolvedAgentRequest({
    conversationKey: 1,
    mode: "agent",
    userText: "第2篇感兴趣",
    libraryID: 1,
  }),
  item: null,
  currentAnswerText: "",
  modelName: "",
});

describe("Phase 5 durable recommendation memory", function () {
  it("uses collision-free deterministic logical event identity", function () {
    const id = feedbackEventId("a:b", "c", "positive");
    assert.equal(id, feedbackEventId("a:b", "c", "positive"));
    assert.notEqual(id, feedbackEventId("a", "b:c", "positive"));
    assert.notEqual(id, feedbackEventId("a:b", "c", "negative"));
    assert.notEqual(id, feedbackEventId("a:b", "d", "positive"));
    assert.throws(() => feedbackEventId("a", "b", "__proto__" as never));
  });
  it("creates, detaches, rejects duplicates, filters and reopens both real SQLite stores", async function () {
    const dir = mkdtempSync(join(tmpdir(), "feedback-"));
    let db = new ResearchProfileTestDb(join(dir, "db.sqlite"));
    try {
      let impressions = new SqliteImpressionStore(() => db),
        events = new SqliteFeedbackStore(() => db);
      await Promise.all([
        impressions.initialize(),
        impressions.initialize(),
        events.initialize(),
      ]);
      const p = impression(),
        e = event();
      const save = impressions.save(p),
        append = events.append(e, "library:1");
      p.candidates[0].title = "mutated";
      e.action = "negative";
      await Promise.all([save, append]);
      assert.notEqual(
        (await impressions.load("rec-1"))!.candidates[0].title,
        "mutated",
      );
      assert.equal((await events.load(event().eventId))!.action, "positive");
      await rejects(impressions.save(impression()));
      await rejects(events.append(event(), "library:1"));
      await events.append(event("negative"), "library:1");
      assert.deepEqual(
        (
          await events.list({
            profileId: "library:1",
            paperId: "candidate-1",
            recommendationId: "rec-1",
          })
        ).map((e) => e.action),
        ["positive", "negative"],
      );
      assert.lengthOf(await events.list({ profileId: "library:2" }), 0);
      const read = (await events.list())[0];
      read.action = "skip";
      assert.equal((await events.list())[0].action, "positive");
      db.close();
      db = new ResearchProfileTestDb(join(dir, "db.sqlite"));
      impressions = new SqliteImpressionStore(() => db);
      events = new SqliteFeedbackStore(() => db);
      assert.isNotNull(await impressions.load("rec-1"));
      assert.lengthOf(await events.list(), 2);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects invalid writes before initialization and retries failed lazy initialization", async function () {
    const { db, impressions, events } = setup();
    try {
      await rejects(impressions.save({ ...impression(), timestamp: -1 }));
      await rejects(
        events.append({ ...event(), action: "invalid" as never }, "library:1"),
      );
      await rejects(events.append(event(), ""));
      assert.lengthOf(db.statements, 0);
      db.failWhen = () => true;
      await rejects(impressions.initialize());
      db.failWhen = undefined;
      await impressions.save(impression());
      await rejects(
        impressions.save({
          ...impression(),
          recommendationId: "bad",
          topicSnapshot: [],
        }),
      );
      assert.isNull(await impressions.load("bad"));
    } finally {
      db.close();
    }
  });
  for (const kind of ["impression", "feedback"] as const)
    for (const corruption of ["json", "metadata", "schema"]) {
      it(`rejects ${kind} ${corruption} corruption`, async function () {
        const { db, impressions, events } = setup();
        try {
          await impressions.save(impression());
          await events.append(event(), "library:1");
          const table =
            kind === "impression" ? IMPRESSION_TABLE : FEEDBACK_TABLE;
          const field =
            corruption === "json"
              ? `${kind}_json`
              : corruption === "schema"
                ? "schema_version"
                : "timestamp";
          await db.queryAsync(`UPDATE ${table} SET ${field} = ?`, [
            corruption === "json" ? "{}" : 999,
          ]);
          await rejects(
            kind === "impression"
              ? impressions.load("rec-1")
              : events.load(event().eventId),
          );
        } finally {
          db.close();
        }
      });
    }
  for (const action of ["positive", "save", "negative", "skip"] as const) {
    it(`replays ${action}, half-life decay and bounded strength`, async function () {
      const { db, impressions, events, service } = setup();
      try {
        await impressions.save(impression());
        await events.append(event(action), "library:1");
        const full = await service.replay.loadForProfile("library:1", now);
        const half = await service.replay.loadForProfile(
          "library:1",
          now + 180 * 86400000,
        );
        const key = FEEDBACK_STRENGTH[action] > 0 ? "positive" : "negative";
        assert.closeTo(
          full.topics[0][key],
          1 - Math.exp(-Math.abs(FEEDBACK_STRENGTH[action]) / 2),
          1e-12,
        );
        assert.closeTo(
          half.topics[0][key],
          1 - Math.exp(-Math.abs(FEEDBACK_STRENGTH[action]) / 4),
          1e-12,
        );
        assert.equal(full.positiveFeedbackCount, key === "positive" ? 1 : 0);
        assert.equal(full.negativeFeedbackCount, key === "negative" ? 1 : 0);
      } finally {
        db.close();
      }
    });
  }
  it("aggregates multiple candidates and conflicting events deterministically with bounded recent evidence", async function () {
    const { db, impressions, events, service } = setup();
    try {
      const p = impression();
      p.candidates.push({
        ...p.candidates[0],
        candidateId: "candidate-2",
        rank: 2,
      });
      await impressions.save(p);
      for (let i = 0; i < 20; i++) {
        const rec = `rec-${i + 2}`;
        await impressions.save({ ...p, recommendationId: rec });
        await events.append(event("save", rec), "library:1");
      }
      await events.append(event("positive"), "library:1");
      await events.append(event("negative"), "library:1");
      const second = {
        ...event("skip"),
        paperId: "candidate-2",
        eventId: feedbackEventId("rec-1", "candidate-2", "skip"),
      };
      await events.append(second, "library:1");
      const state = await service.replay.loadForProfile("library:1", now);
      assert.equal(state.positiveFeedbackCount, 21);
      assert.equal(state.negativeFeedbackCount, 2);
      assert.isAtMost(state.topics[0].positive, 1);
      assert.isAtLeast(state.topics[0].negative, 0);
      assert.lengthOf(state.topics[0].evidenceRefs, 12);
      assert.deepEqual(
        await service.replay.loadForProfile("library:1", now),
        state,
      );
      const updated = applyProfileFeedback(profile(), state, now);
      const decayed = await service.replay.loadForProfile(
        "library:1",
        now + 1e15,
      );
      assert.equal(decayed.topics[0].positive, 0);
      assert.deepEqual(
        applyProfileFeedback(updated, decayed, now + 1e15).topics,
        profile().topics,
      );
    } finally {
      db.close();
    }
  });
  it("concurrent identical submissions persist once and recover through CAS", async function () {
    const { db, impressions, profiles, events, service } = setup();
    try {
      await profiles.save(profile(), null);
      await impressions.save(impression());
      const results = await Promise.all([
        service.submit(input()),
        service.submit(input()),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [
        "already_recorded",
        "recorded",
      ]);
      assert.lengthOf(await events.list(), 1);
      await service.reconcileProfileFeedback("library:1", now);
      assert.equal((await profiles.load("library:1"))!.version, 2);
    } finally {
      db.close();
    }
  });
  it("updates from baseline, preserves metadata, removes unsupported topics and invalidates embedding", async function () {
    const p = profile();
    p.embedding = {
      model: "test",
      dimension: 1,
      storageKey: "ref",
      updatedAt: now,
    };
    const original = JSON.stringify(p);
    const state = {
      positiveFeedbackCount: 1,
      negativeFeedbackCount: 0,
      topics: [
        {
          id: "topic-1",
          label: "Agentic Recommendation",
          positive: 0.6,
          negative: 0,
          lastEvidenceAt: now,
          evidenceRefs: ["feedback:e"],
        },
        {
          id: "historical",
          label: "Historical RAG",
          positive: 0.3,
          negative: 0,
          lastEvidenceAt: now,
          evidenceRefs: ["feedback:e"],
        },
      ],
    };
    const next = applyProfileFeedback(p, state, now + 1);
    assert.equal(next.version, 2);
    assert.equal(next.generatedAt, p.generatedAt);
    assert.equal(next.updatedAt, now + 1);
    assert.notProperty(next, "embedding");
    assert.deepEqual(next.representativePapers, p.representativePapers);
    assert.deepEqual(next.explicitPreferences, p.explicitPreferences);
    assert.deepEqual(next.topics[0].sources, ["library", "feedback"]);
    assert.equal(JSON.stringify(p), original);
    assert.deepEqual(applyProfileFeedback(next, state, now + 2), next);
    const removed = applyProfileFeedback(
      next,
      { topics: [], positiveFeedbackCount: 0, negativeFeedbackCount: 0 },
      now + 2,
    );
    assert.deepEqual(removed.topics, p.topics);
    const negative = applyProfileFeedback(
      p,
      {
        ...state,
        topics: [{ ...state.topics[0], positive: 0, negative: 0.7 }],
      },
      now,
    );
    assert.isBelow(negative.topics[0].weight, p.topics[0].weight);
  });
  it("accepts stale impressions, deduplicates delayed retries and retains conflicting actions", async function () {
    const { db, impressions, profiles, events, service } = setup();
    try {
      await profiles.save(profile(), null);
      await impressions.save(impression());
      const first = await service.submit(input());
      assert.equal(first.status, "recorded");
      assert.equal(first.newProfileVersion, 2);
      const retry = await service.submit({ ...input(), timestamp: now + 5000 });
      assert.equal(retry.status, "already_recorded");
      assert.isFalse(retry.profileUpdated);
      assert.equal(retry.newProfileVersion, 2);
      await service.submit(input("negative"));
      assert.lengthOf(await events.list(), 2);
      const p = (await profiles.load("library:1"))!;
      assert.equal(p.signalSummary.positiveFeedbackCount, 1);
      assert.equal(p.signalSummary.negativeFeedbackCount, 1);
    } finally {
      db.close();
    }
  });
  for (const patch of [
    { libraryID: 2 },
    { candidateId: "absent" },
    { recommendationId: "missing" },
    { timestamp: now - 1 },
  ])
    it(`rejects wrong feedback integrity ${JSON.stringify(patch)}`, async function () {
      const { db, impressions, profiles, events, service } = setup();
      try {
        await profiles.save(profile(), null);
        await impressions.save(impression());
        await rejects(service.submit({ ...input(), ...patch }));
        assert.lengthOf(await events.list(), 0);
      } finally {
        db.close();
      }
    });
  for (const failures of [1, 2])
    it(`records event before CAS and bounds retries (${failures} conflicts)`, async function () {
      const { db, impressions, profiles, events } = setup();
      try {
        await profiles.save(profile(), null);
        await impressions.save(impression());
        let attempts = 0;
        const service = new RecommendationFeedbackService(
          {
            load: (id) => profiles.load(id),
            save: async (p, v) => {
              assert.lengthOf(await events.list(), 1);
              if (++attempts <= failures) throw new ProfileVersionConflict();
              await profiles.save(p, v);
            },
          },
          impressions,
          events,
        );
        const result = await service.submit(input());
        assert.equal(attempts, 2);
        assert.isTrue(result.feedbackRecorded);
        if (failures === 2) {
          assert.include(
            result.warnings,
            "feedback_profile_reconcile_required",
          );
          assert.isFalse(result.profileUpdated);
          await service.reconcileProfileFeedback("library:1", now);
        }
        assert.equal((await profiles.load("library:1"))!.version, 2);
        const retry = await service.submit(input());
        assert.isFalse(retry.profileUpdated);
      } finally {
        db.close();
      }
    });
  it("records topic-free feedback counts without inventing labels or importing papers", async function () {
    const { db, impressions, profiles, service } = setup();
    try {
      await profiles.save(profile(), null);
      const p = impression();
      p.candidates[0].matchedTopicIds = [];
      p.topicSnapshot = [];
      await impressions.save(p);
      const result = await service.submit(input("save"));
      assert.include(result.warnings, "feedback_no_matched_topics");
      const updated = (await profiles.load("library:1"))!;
      assert.deepEqual(updated.topics, profile().topics);
      assert.lengthOf(updated.representativePapers, 0);
      assert.equal(updated.signalSummary.positiveFeedbackCount, 1);
    } finally {
      db.close();
    }
  });
  it("fails replay for missing impressions and nonmembers; deduplicates repeated logical events", async function () {
    const { db, impressions, events, service } = setup();
    try {
      await events.append(event(), "library:1");
      await rejects(service.replay.loadForProfile("library:1", now), /Missing/);
      const p = impression();
      p.candidates = [];
      await impressions.save(p);
      await rejects(
        service.replay.loadForProfile("library:1", now),
        /relation/,
      );
      const replay = new FeedbackReplay(
        {
          append: async () => {},
          load: async () => event(),
          list: async () => [event(), event()],
        },
        { save: async () => {}, load: async () => impression() },
      );
      assert.equal(
        (await replay.loadForProfile("library:1", now)).positiveFeedbackCount,
        1,
      );
    } finally {
      db.close();
    }
  });
  it("refresh preserves feedback without invoking a model on submission", async function () {
    const { db, impressions, profiles, service } = setup();
    try {
      await profiles.save(profile(), null);
      await impressions.save(impression());
      await service.submit(input());
      const profileService = new ProfileService(
        profiles,
        {
          getLibrarySnapshot: async () => ({
            libraryID: 1,
            papers: [],
            warnings: [],
          }),
        },
        undefined,
        () => now,
        undefined,
        service.replay,
      );
      const refreshed = await profileService.get(1, { refresh: true });
      assert.equal(refreshed.profile.signalSummary.positiveFeedbackCount, 1);
      assert.include(refreshed.profile.topics[0].sources, "feedback");
      assert.equal(refreshed.profile.topics[0].label, "Agentic Recommendation");
      assert.notInclude(
        refreshed.warnings,
        "feedback_state_discarded_on_rebuild",
      );
      assert.equal(refreshed.profile.generatedAt, now);
    } finally {
      db.close();
    }
  });
  it("exposes constrained local write with confirmation and validates every model field", async function () {
    const { db, impressions, profiles, service } = setup();
    try {
      await profiles.save(profile(), null);
      await impressions.save(impression());
      const tool = createRecommendationFeedbackTool(service, () => now);
      assert.equal(tool.spec.name, "recommendation_feedback");
      assert.equal(tool.spec.mutability, "write");
      assert.isTrue(tool.spec.requiresConfirmation);
      assert.isTrue(tool.spec.localAgentOnly);
      for (const key of [
        "libraryID",
        "profileId",
        "eventId",
        "strength",
        "timestamp",
        "topicIds",
        "text",
      ])
        assert.isFalse(
          tool.validate({
            recommendationId: "rec-1",
            candidateId: "candidate-1",
            action: "positive",
            [key]: 1,
          }).ok,
        );
      for (const action of ["positive", "save", "negative", "skip"])
        assert.isTrue(
          tool.validate({
            recommendationId: "rec-1",
            candidateId: "candidate-1",
            action,
          }).ok,
        );
      assert.isFalse(
        tool.validate({
          recommendationId: "rec-1",
          candidateId: "candidate-1",
          action: "import",
        }).ok,
      );
      const value = {
        recommendationId: "rec-1",
        candidateId: "candidate-1",
        action: "positive" as const,
      };
      const first = (await tool.execute(value, ctx())) as any;
      assert.equal(first.effect, "applied");
      assert.equal(first.content.newProfileVersion, 2);
      const retry = (await tool.execute(value, ctx())) as any;
      assert.equal(retry.effect, "none");
      assert.equal(retry.content.status, "already_recorded");
      const wrong = ctx();
      wrong.request.libraryID = 2;
      await rejects(tool.execute(value, wrong));
    } finally {
      db.close();
    }
  });
  it("requires concrete confirmation under Action Contract, retains locking and records no Zotero mutation", async function () {
    const { db, impressions, profiles, events, service } = setup();
    try {
      await profiles.save(profile(), null);
      await impressions.save(impression());
      const registry = new AgentToolRegistry(
        new ActionContractService({} as never),
      );
      registry.register(createRecommendationFeedbackTool(service, () => now));
      const context = ctx();
      context.request.actionContract = await new ActionContractService(
        {} as never,
      ).createContract(context.request);
      let locks = 0;
      const call = {
        id: "feedback-call",
        name: "recommendation_feedback",
        arguments: {
          recommendationId: "rec-1",
          candidateId: "candidate-1",
          action: "positive",
        },
      };
      const prepared = await registry.prepareExecution(call, context, {
        executeWithLock: async (task) => {
          locks++;
          return task();
        },
      });
      assert.equal(prepared.kind, "confirmation");
      assert.lengthOf(await events.list(), 0);
      if (prepared.kind !== "confirmation")
        throw new Error("Expected confirmation");
      assert.equal(prepared.deny().result.ok, false);
      assert.lengthOf(await events.list(), 0);
      const approved = await registry.prepareExecution(call, context, {
        executeWithLock: async (task) => {
          locks++;
          return task();
        },
      });
      if (approved.kind !== "confirmation")
        throw new Error("Expected confirmation");
      const executed = await approved.execute();
      assert.isTrue(executed.result.ok);
      assert.equal(executed.result.effect, "applied");
      assert.deepEqual(executed.result.actionReceipts, []);
      assert.equal(locks, 1);
      assert.lengthOf(await events.list(), 1);
      assert.isFalse(
        db.statements.some((sql) => sql.includes("journal_actions")),
      );
      assert.notInclude(
        registry.listTools().map((t) => t.name),
        "recommendation_feedback",
      );
      assert.notInclude(
        registry
          .listToolsForRequest({
            ...context.request,
            authMode: "webchat",
          } as never)
          .map((t) => t.name),
        "recommendation_feedback",
      );
    } finally {
      db.close();
    }
  });
  it("demo: index → recommendation → durable feedback → updated profile → ranking order changes", async function () {
    const { db, impressions, profiles, service } = setup();
    try {
      const source = new IndexedResearchLibrarySource({
        getSnapshot: async () =>
          indexSnapshot([
            indexedItem(1, {
              collectionIds: [],
              tags: ["Agentic Recommendation", "RAG"],
            }),
          ]),
      });
      const snapshot = await source.getLibrarySnapshot(1);
      const p = new ProfileBuilder().build({
        libraryID: 1,
        papers: snapshot.papers,
        now,
      });
      // A controlled baseline makes the before/after easy to explain.
      p.topics = [
        {
          ...profile().topics[0],
          id: "agents",
          label: "Agentic Recommendation",
          weight: 0.2,
        },
        { ...profile().topics[0], id: "rag", label: "RAG", weight: 0.25 },
      ];
      p.representativePapers = [];
      await profiles.save(p, null);
      const profileService = new ProfileService(
        profiles,
        source,
        undefined,
        () => now,
        undefined,
        service.replay,
      );
      const literature = {
        search: async () => ({
          papers: [
            {
              title: "Agentic Recommendation",
              doi: "10.1234/a",
              authors: [],
              provider: "openalex" as const,
            },
            {
              title: "RAG",
              doi: "10.1234/b",
              authors: [],
              provider: "openalex" as const,
            },
            {
              title: "Astronomy",
              doi: "10.1234/c",
              authors: [],
              provider: "openalex" as const,
            },
          ],
          warnings: [],
        }),
        related: async () => ({ papers: [], warnings: [] }),
      };
      const recommend = createResearchRecommendTool(
        profileService,
        source,
        () => literature,
        {
          impressionStore: impressions,
          now: () => now,
          embeddingFactory: () => undefined,
        },
      );
      const first = (await recommend.execute({ topK: 3 }, ctx())) as any;
      assert.lengthOf(first.recommendations, 3);
      assert.equal(first.recommendations[0].candidateId, "doi:10.1234/b");
      assert.deepEqual(
        (await impressions.load(first.recommendationId))!.candidates.map(
          (c) => c.candidateId,
        ),
        first.recommendations.map((c: any) => c.candidateId),
      );
      const feedback = createRecommendationFeedbackTool(service, () => now);
      await feedback.execute(
        {
          recommendationId: first.recommendationId,
          candidateId: "doi:10.1234/a",
          action: "positive",
        },
        ctx(),
      );
      await feedback.execute(
        {
          recommendationId: first.recommendationId,
          candidateId: "doi:10.1234/b",
          action: "negative",
        },
        ctx(),
      );
      const next = (await profiles.load("library:1"))!;
      assert.equal(next.version, 3);
      assert.equal(next.signalSummary.positiveFeedbackCount, 1);
      assert.equal(next.signalSummary.negativeFeedbackCount, 1);
      assert.isBelow(next.topics.find((t) => t.id === "rag")!.weight, 0.25);
      const second = (await recommend.execute({ topK: 3 }, ctx())) as any;
      assert.equal(second.profileVersion, 3);
      assert.equal(second.recommendations[0].candidateId, "doi:10.1234/a");
      assert.notEqual(second.recommendationId, first.recommendationId);
      const failing = createResearchRecommendTool(
        profileService,
        source,
        () => literature,
        {
          impressionStore: {
            save: async () => {
              throw new Error("disk full");
            },
            load: async () => null,
          },
          now: () => now,
          embeddingFactory: () => undefined,
        },
      );
      await rejects(failing.execute({ topK: 3 }, ctx()), /disk full/);
      let writes = 0;
      const failedRanking = createResearchRecommendTool(
        profileService,
        source,
        () => ({
          search: async () => {
            throw new Error("offline");
          },
          related: async () => {
            throw new Error("offline");
          },
        }),
        {
          impressionStore: {
            save: async () => {
              writes++;
            },
            load: async () => null,
          },
          embeddingFactory: () => undefined,
        },
      );
      await rejects(failedRanking.execute({ topK: 3 }, ctx()));
      assert.equal(writes, 0);
    } finally {
      db.close();
    }
  });
});
