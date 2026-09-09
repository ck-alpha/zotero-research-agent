import type { EvidenceResult } from "../src/recommendation/evidence/contracts";
import { SqliteImpressionStore } from "../src/recommendation/feedback/stores";
import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { AgentToolContext } from "../src/agent/types";
import { createBuiltInToolRegistry } from "../src/agent/tools";
import { createResearchRecommendTool } from "../src/agent/tools/recommendation/researchRecommend";
import type { LiteratureDiscoverySource } from "../src/recommendation/candidate/contracts";
import { IndexedResearchLibrarySource } from "../src/recommendation/profile/librarySource";
import { ProfileService } from "../src/recommendation/profile/profileService";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import { SqliteProfileStore } from "../src/recommendation/profile/profileStore";
import { ResearchProfileTestDb } from "./helpers/researchProfileDb";
import {
  indexSnapshot,
  indexedItem,
  PROFILE_NOW,
  preferences,
} from "./helpers/researchProfileFixtures";
import { resolvedAgentRequest } from "./helpers/resolvedAgentRequest";
import type { CandidateScores } from "../src/recommendation/domain/candidate";

const context = (): AgentToolContext => ({
  request: resolvedAgentRequest({
    conversationKey: 1,
    mode: "agent",
    userText: "根据我的文献库推荐新论文",
    libraryID: 1,
  }),
  item: null,
  currentAnswerText: "",
  modelName: "",
});
const emptySource: LiteratureDiscoverySource = {
  search: async () => ({ papers: [], warnings: [] }),
  related: async () => ({ papers: [], warnings: [] }),
};
const noRead = {
  get: async () => {
    throw new Error("Unexpected profile read");
  },
};
const noSnapshot = {
  getLibrarySnapshot: async () => {
    throw new Error("Unexpected snapshot read");
  },
};

describe("research_recommend tool and no-network SQLite integration", function () {
  it("registers read/no-confirmation/model exposure only in plugin Agent", function () {
    const registry = createBuiltInToolRegistry({
      zoteroGateway: {} as never,
      pdfService: {} as never,
      pdfPageService: {} as never,
      retrievalService: {} as never,
    });
    const spec = registry.getTool("research_recommend")!.spec;
    assert.equal(spec.mutability, "read");
    assert.isFalse(spec.requiresConfirmation);
    assert.equal(spec.exposure, "model");
    assert.isTrue(spec.localAgentOnly);
    assert.include(
      registry.listToolsForRequest(context().request).map((t) => t.name),
      spec.name,
    );
    assert.notInclude(
      registry.listTools().map((t) => t.name),
      spec.name,
    );
    for (const patch of [
      { authMode: "codex_app_server" },
      { authMode: "webchat" },
      { providerProtocol: "web_sync" },
    ])
      assert.notInclude(
        registry
          .listToolsForRequest({ ...context().request, ...patch } as never)
          .map((t) => t.name),
        spec.name,
      );
  });
  it("guides personalized requests directly while retaining generic scholarly search", function () {
    const tool = createResearchRecommendTool(
      noRead,
      noSnapshot,
      () => emptySource,
    );
    for (const userText of [
      "根据我的文献库推荐新论文",
      "最近有什么论文值得我读",
      "按我的研究兴趣推荐几篇",
      "find papers I should read next",
      "recommend papers based on my library",
    ])
      assert.isTrue(
        tool.guidance!.matches({ ...context().request, userText }),
        userText,
      );
    for (const userText of [
      "Find papers about transformers",
      "Summarize this paper",
      "Search articles by Ada",
      "根据我的习惯推荐电影",
      "Plan a holiday based on my interests",
    ])
      assert.isFalse(
        tool.guidance!.matches({ ...context().request, userText }),
        userText,
      );
    assert.include(tool.guidance!.instruction, "literature_search");
  });
  it("validates focus/topK and rejects model supplied scope, algorithms, providers and persistence", async function () {
    const tool = createResearchRecommendTool(
      noRead,
      noSnapshot,
      () => emptySource,
    );
    assert.isTrue(tool.validate({}).ok);
    assert.isTrue(tool.validate({ focus: " Agents\n memory ", topK: 20 }).ok);
    for (const raw of [
      null,
      [],
      { focus: "" },
      { focus: " " },
      { focus: 2 },
      { focus: "x".repeat(301) },
      { topK: 0 },
      { topK: 21 },
      { topK: 1.5 },
      { topK: "5" },
      { topK: null },
      { libraryID: 2 },
      { profileId: "library:2" },
      { candidates: [] },
      { weights: {} },
      { mmrLambda: 1 },
      { providerUrl: "https://invalid" },
      { embeddingModel: "main" },
      { refresh: true },
    ])
      assert.isFalse(tool.validate(raw).ok, JSON.stringify(raw));
    const ctx = context();
    ctx.request.libraryID = 0;
    await rejects(tool.execute({ topK: 10 }, ctx), /libraryID/i);
    await rejects(tool.execute({ topK: 0 }, context()), /arguments/i);
  });
  for (const semantic of [false, true])
    it(`runs index → SQLite profile revision → novel full pool → ranking/MMR → bounded Top-K (semantic=${semantic})`, async function () {
      const source = new IndexedResearchLibrarySource({
        getSnapshot: async () =>
          indexSnapshot([
            indexedItem(1, { doi: "10.1234/seed", collectionIds: [] }),
          ]),
      });
      const snapshot = await source.getLibrarySnapshot(1);
      const db = new ResearchProfileTestDb();
      try {
        const store = new SqliteProfileStore(() => db);
        const profile = new ProfileBuilder().build({
          libraryID: 1,
          papers: snapshot.papers,
          now: PROFILE_NOW,
          explicitPreferences: preferences(),
        });
        profile.topics = [
          {
            ...profile.topics[0],
            id: "agents",
            label: "Agents",
            weight: 1,
            confidence: 1,
          },
        ];
        profile.representativePapers = profile.representativePapers.slice(0, 1);
        await store.save(profile, null);
        profile.version = 2;
        await store.save(profile, 1);
        let queries = 0,
          seeds = 0;
        const ctx = context();
        ctx.signal = new AbortController().signal;
        const discovery: LiteratureDiscoverySource = {
          search: async ({ signal }) => {
            queries++;
            assert.strictEqual(signal, ctx.signal);
            return {
              papers: [
                {
                  title: "Saved seed",
                  doi: "10.1234/seed",
                  authors: [],
                  provider: "openalex",
                },
                ...Array.from({ length: 11 }, (_, i) => ({
                  title: `Unrelated astronomy ${i}`,
                  doi: `10.1234/filler${i}`,
                  authors: [],
                  provider: "openalex" as const,
                })),
              ],
              warnings: [],
            };
          },
          related: async ({ doi, signal }) => {
            seeds++;
            assert.equal(doi, "10.1234/seed");
            assert.strictEqual(signal, ctx.signal);
            return {
              papers: [
                {
                  title: "Agents systems",
                  abstract: "Agents architecture ".repeat(80),
                  doi: "10.1234/a",
                  authors: ["Author"],
                  year: 2026,
                  provider: "openalex",
                },
                {
                  title: "Agents systems",
                  abstract: "Agents architecture ".repeat(80),
                  doi: "10.1234/b",
                  authors: ["Author"],
                  year: 2026,
                  provider: "openalex",
                },
                {
                  title: "Agents astronomy",
                  doi: "10.1234/c",
                  authors: [],
                  year: 2026,
                  provider: "openalex",
                },
                {
                  title: "Agents Prompting",
                  doi: "10.1234/d",
                  authors: [],
                  year: 2026,
                  provider: "openalex",
                },
              ],
              warnings: [],
            };
          },
        };
        const tool = createResearchRecommendTool(
          new ProfileService(store, source),
          source,
          () => discovery,
          {
            now: () => PROFILE_NOW,
            impressionStore: new SqliteImpressionStore(() => db),
            embeddingFactory: () =>
              semantic
                ? {
                    embed: async (texts) => ({
                      model: "fake",
                      vectors: texts.map((t) =>
                        t.startsWith("Agents astronomy")
                          ? [0, 1]
                          : t.includes("Seed") ||
                              t === "Agents\nAgents\nPaper 1"
                            ? [1, 1]
                            : [1, 0],
                      ),
                    }),
                  }
                : undefined,
          },
        );
        const result = (await tool.execute({ topK: 20 }, ctx)) as {
          recommendationId: string;
          profileId: string;
          profileVersion: number;
          generatedAt: number;
          recommendationCount: number;
          recommendations: Array<
            EvidenceResult & {
              rank: number;
              candidateId: string;
              title: string;
              abstract?: string;
              matchedTopics: Array<{ id: string; label: string }>;
              scores: CandidateScores;
              provenance: unknown[];
              seedPaperIds?: string[];
            }
          >;
          discoveryDiagnostics: {
            finalCandidateCount: number;
            existingLibraryExcluded: number;
          };
          rankingDiagnostics: {
            inputCandidateCount: number;
            semanticSucceeded: boolean;
          };
          warnings: string[];
        };
        assert.equal(result.profileId, "library:1");
        assert.equal(result.profileVersion, 2);
        assert.equal(result.generatedAt, PROFILE_NOW);
        assert.equal(queries, 1);
        assert.equal(seeds, 1);
        assert.equal(result.discoveryDiagnostics.finalCandidateCount, 15);
        assert.equal(result.rankingDiagnostics.inputCandidateCount, 15);
        assert.equal(result.discoveryDiagnostics.existingLibraryExcluded, 1);
        assert.equal(result.recommendationCount, 15);
        assert.isTrue(result.recommendations[0].title.startsWith("Agents"));
        assert.deepEqual(
          result.recommendations.map((p) => p.rank),
          Array.from({ length: 15 }, (_, i) => i + 1),
        );
        const first = result.recommendations.find(
          (p) => p.candidateId === "doi:10.1234/a",
        )!;
        assert.lengthOf(first.abstract!, 500);
        assert.deepEqual(first.matchedTopics, [
          { id: "agents", label: "Agents" },
        ]);
        assert.isNotEmpty(first.evidence);
        assert.isNotEmpty(first.reason.evidenceRefs);
        assert.deepEqual(first.reason.matchedTopics, ["Agents"]);
        for (const paper of result.recommendations) {
          assert.isAtMost(paper.evidence.length, 4);
          assert.isAtMost(
            JSON.stringify({ evidence: paper.evidence, reason: paper.reason })
              .length,
            6000,
          );
          assert.isTrue(
            paper.evidence.every((e) => e.candidateId === paper.candidateId),
          );
          assert.isTrue(
            paper.reason.evidenceRefs.every((ref) =>
              paper.evidence.some((e) => e.evidenceId === ref),
            ),
          );
        }
        assert.equal(first.scores.graph, 1);
        assert.equal(first.scores.recency, 1);
        assert.lengthOf(first.provenance, 1);
        assert.deepEqual(first.seedPaperIds, ["library:1:item:1"]);
        const negative = result.recommendations.find(
          (p) => p.candidateId === "doi:10.1234/d",
        )!;
        assert.equal(negative.scores.preference, 0.1);
        assert.isBelow(negative.scores.baseScore!, first.scores.baseScore!);
        assert.equal(result.rankingDiagnostics.semanticSucceeded, semantic);
        assert.include(result.warnings, "ranking_tool_output_truncated");
        assert.isString(result.recommendationId);
        const impression = await new SqliteImpressionStore(() => db).load(
          result.recommendationId,
        );
        assert.deepEqual(
          impression!.candidates.map((p) => p.candidateId),
          result.recommendations.map((p) => p.candidateId),
        );
        assert.deepEqual(
          impression!.candidates.map((p) => p.provenance),
          result.recommendations.map((p) => p.provenance),
        );
        for (const paper of impression!.candidates) {
          assert.notProperty(paper, "reason");
          assert.notProperty(paper, "warnings");
        }
        assert.notProperty(result, "profile");
        assert.notProperty(result, "vectors");
        for (const p of result.recommendations)
          assert.notProperty(p.scores, "feedback");
        assert.deepEqual(await store.load("library:1"), profile);
        if (!semantic) {
          const small = (await tool.execute({ topK: 2 }, ctx)) as typeof result;
          assert.equal(small.recommendationCount, 2);
          assert.equal(small.rankingDiagnostics.inputCandidateCount, 15);
          assert.deepEqual(
            small.recommendations.map((p) => p.candidateId),
            ["doi:10.1234/a", "doi:10.1234/c"],
          );
        }
      } finally {
        db.close();
      }
    });
  it("enforces architecture boundaries with no candidate tool recursion or future-phase dependencies", function () {
    for (const file of readdirSync("src/recommendation/ranking").filter((f) =>
      f.endsWith(".ts"),
    )) {
      const text = readFileSync(`src/recommendation/ranking/${file}`, "utf8");
      assert.notMatch(
        text,
        /from\s+['"][^'"]*(?:agent\/|modules\/contextPanel|llmClient|conversationMemory)/u,
        file,
      );
    }
    const text = readFileSync(
      "src/agent/tools/recommendation/researchRecommend.ts",
      "utf8",
    );
    assert.include(text, "new CandidateDiscoveryService");
    assert.include(text, "discovery.candidates");
    assert.notMatch(
      text,
      /\b(?:FeedbackStore|paper_read|MinerU|ZoteroPane|getTool|createResearchCandidateDiscoverTool)\b/u,
    );
  });
});
