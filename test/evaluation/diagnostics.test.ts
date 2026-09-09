import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { RecommendationDiagnostics } from "../../src/recommendation/evaluation/diagnostics";
import type { StageDiagnostic } from "../../src/recommendation/evaluation/contracts";
import { RankingService } from "../../src/recommendation/ranking/rankingService";
import { retrieveEvidence } from "../../src/recommendation/evidence/evidenceRetriever";
import { createResearchRecommendTool } from "../../src/agent/tools/recommendation/researchRecommend";
import { benchmarkCases } from "./fixtures";
import { resolvedAgentRequest } from "../helpers/resolvedAgentRequest";
import type { AgentToolContext } from "../../src/agent/types";

const context = (): AgentToolContext => ({
  request: resolvedAgentRequest({
    conversationKey: 1,
    userText: "recommend papers based on my library",
    mode: "agent",
    libraryID: 1,
  }),
  item: null,
  currentAnswerText: "",
  modelName: "",
});

describe("recommendation internal diagnostics", function () {
  it("measures deterministic nested durations and aggregates degraded outcomes", async function () {
    let tick = 0;
    const records: StageDiagnostic[] = [];
    const d = new RecommendationDiagnostics(
      (r) => records.push(r),
      () => tick++,
    );
    const result = await d.measure("total", () =>
      d.measure(
        "ranking",
        async () => 42,
        () => ({
          timeout: true,
          fallback: true,
          failureCode: "ranking_semantic_failed_fallback",
        }),
      ),
    );
    assert.equal(result, 42);
    assert.deepEqual(records, [
      {
        stage: "ranking",
        durationMs: 1,
        timeout: true,
        fallback: true,
        failureCode: "ranking_semantic_failed_fallback",
      },
      {
        stage: "total",
        durationMs: 3,
        timeout: true,
        fallback: true,
        failureCode: "ranking_semantic_failed_fallback",
      },
    ]);
  });
  it("reports failures without error text and rethrows original error", async function () {
    const records: StageDiagnostic[] = [];
    const d = new RecommendationDiagnostics(
      (r) => records.push(r),
      () => 1,
    );
    const error = new Error("secret provider payload");
    await rejects(
      () =>
        d.measure("total", () =>
          d.measure("discovery", async () => {
            throw error;
          }),
        ),
      (e) => e === error,
    );
    assert.equal(records[0].failureCode, "discovery_failed");
    assert.notInclude(JSON.stringify(records), "secret");
  });
  it("observer and clock errors do not alter results; backwards time is clamped", async function () {
    const d = new RecommendationDiagnostics(
      () => {
        throw new Error();
      },
      () => {
        throw new Error();
      },
    );
    assert.equal(await d.measure("total", async () => 3), 3);
    const records: StageDiagnostic[] = [];
    let tick = 10;
    await new RecommendationDiagnostics(
      (r) => records.push(r),
      () => tick--,
    ).measure("total", async () => 1);
    assert.equal(records[0].durationMs, 0);
  });
  it("classifies cancellation separately from timeout", async function () {
    const controller = new AbortController();
    controller.abort();
    const records: StageDiagnostic[] = [];
    const d = new RecommendationDiagnostics(
      (r) => records.push(r),
      () => 0,
      controller.signal,
    );
    await rejects(() =>
      d.measure("total", async () => {
        throw new Error();
      }),
    );
    assert.equal(records[0].failureCode, "recommendation_cancelled");
    assert.isFalse(records[0].timeout);
  });
  it("marks actual embedding deadline fallback without changing legacy warning", async function () {
    const input = benchmarkCases()[0];
    const result = await new RankingService({ semanticTimeoutMs: 1 }).rank({
      ...input,
      semanticProvider: { embed: () => new Promise(() => {}) },
    });
    assert.isTrue(result.diagnostics.semanticTimedOut);
    assert.isTrue(result.diagnostics.semanticFallback);
    assert.include(result.warnings, "ranking_semantic_failed_fallback");
    assert.equal(result.recommendations[0].candidateId, "A");
  });
  it("distinguishes exhausted evidence deadlines from source failures", async function () {
    const input = benchmarkCases()[0];
    const ranked = await new RankingService().rank(input);
    const evidenceInput = {
      candidate: ranked.recommendations[0],
      profile: input.profile,
      now: input.now,
      snapshot: {
        libraryID: 1,
        papers: [
          {
            itemId: "paper:ABC123",
            title: "seed",
            authors: [],
            manualTags: [],
            automaticTags: [],
            collectionPaths: [],
            addedAt: 100,
            modifiedAt: 100,
          },
        ],
      },
    };
    const source = {
      notes: async () => {
        throw new Error("private");
      },
      content: async () => [],
    };
    const timed = await retrieveEvidence(evidenceInput, source, 0);
    assert.include(timed.warnings, "evidence_source_timeout");
    assert.include(timed.warnings, "evidence_partial_failure");
    const failed = await retrieveEvidence(
      evidenceInput,
      source,
      Date.now() + 5000,
    );
    assert.notInclude(failed.warnings, "evidence_source_timeout");
    assert.include(failed.warnings, "evidence_partial_failure");
  });
  for (const failAt of ["none", "discovery", "persistence"] as const) {
    it(`observes real tool stages including ${failAt} failure, outside model output`, async function () {
      const input = benchmarkCases()[0];
      input.profile.profileId = "library:1";
      const records: StageDiagnostic[] = [];
      let tick = 0;
      const tool = createResearchRecommendTool(
        {
          get: async () => ({
            profile: input.profile,
            status: "loaded",
            warnings: [],
          }),
        },
        { getLibrarySnapshot: async () => ({ libraryID: 1, papers: [] }) },
        () => ({
          search: async () => {
            if (failAt === "discovery") throw new Error("private");
            return {
              papers: [
                {
                  title: "Agentic Recommendation",
                  abstract: "Agentic Recommendation methods",
                  doi: "10.1234/new",
                  authors: [],
                  provider: "openalex",
                },
              ],
              warnings: [],
            };
          },
          related: async () => ({ papers: [], warnings: [] }),
        }),
        {
          now: () => input.now,
          embeddingFactory: () => undefined,
          diagnosticClock: () => tick++,
          onDiagnostic: (r) => records.push(r),
          impressionStore: {
            save: async () => {
              if (failAt === "persistence") throw new Error("db");
            },
            load: async () => null,
          },
        },
      );
      if (failAt === "none") {
        const result = await tool.execute({ topK: 1 }, context());
        assert.notProperty(result, "durationMs");
        assert.notProperty(result, "trace");
      } else await rejects(() => tool.execute({ topK: 1 }, context()));
      assert.deepEqual(
        records.map((r) => r.stage),
        failAt === "discovery"
          ? ["discovery", "total"]
          : ["discovery", "ranking", "evidence", "total"],
      );
      assert.equal(records.at(-1)!.durationMs, failAt === "discovery" ? 3 : 7);
      if (failAt !== "none")
        assert.equal(records.at(-1)!.failureCode, "total_failed");
      else assert.isTrue(records.at(-1)!.fallback);
    });
  }
});
