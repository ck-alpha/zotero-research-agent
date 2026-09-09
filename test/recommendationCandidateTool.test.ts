import { assert } from "chai";
import { rejects } from "node:assert/strict";
import type { AgentToolContext } from "../src/agent/types";
import { createBuiltInToolRegistry } from "../src/agent/tools";
import { createResearchCandidateDiscoverTool } from "../src/agent/tools/recommendation/researchCandidateDiscover";
import { AgentLiteratureDiscoverySource } from "../src/agent/services/recommendationLiteratureSource";
import { LiteratureSearchService } from "../src/agent/services/literatureSearchService";
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
} from "./helpers/researchProfileFixtures";
import { resolvedAgentRequest } from "./helpers/resolvedAgentRequest";

const context = (): AgentToolContext => ({
  request: resolvedAgentRequest({
    conversationKey: 1,
    mode: "agent",
    userText: "Discover papers",
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

describe("research_candidate_discover integration", function () {
  it("registers a read-only model tool exclusively in the local Agent catalog", function () {
    const registry = createBuiltInToolRegistry({
      zoteroGateway: {} as never,
      pdfService: {} as never,
      pdfPageService: {} as never,
      retrievalService: {} as never,
    });
    const spec = registry.getTool("research_candidate_discover")!.spec;
    assert.equal(spec.mutability, "read");
    assert.isFalse(spec.requiresConfirmation);
    assert.isTrue(spec.localAgentOnly);
    assert.equal(spec.exposure, "model");
    assert.include(
      registry.listToolsForRequest(context().request).map((tool) => tool.name),
      spec.name,
    );
    assert.notInclude(
      registry.listTools().map((tool) => tool.name),
      spec.name,
    );
    for (const authMode of ["codex_app_server", "webchat"] as const)
      assert.notInclude(
        registry
          .listToolsForRequest({ ...context().request, authMode })
          .map((tool) => tool.name),
        spec.name,
      );
    assert.notInclude(
      registry
        .listToolsForRequest({
          ...context().request,
          providerProtocol: "web_sync",
        })
        .map((tool) => tool.name),
      spec.name,
    );
  });
  it("validates focus/limit and rejects model-supplied scope or providers", async function () {
    let calls = 0;
    const tool = createResearchCandidateDiscoverTool(
      {
        get: async () => {
          calls++;
          throw new Error("Unexpected read");
        },
      },
      {
        getLibrarySnapshot: async () => {
          throw new Error("Unexpected snapshot");
        },
      },
      () => emptySource,
    );
    assert.isTrue(tool.validate({}).ok);
    assert.isTrue(tool.validate({ focus: "Agent memory", limit: 50 }).ok);
    for (const input of [
      null,
      [],
      { libraryID: 2 },
      { profileId: "library:2" },
      { topics: [] },
      { seedIds: [] },
      { providerUrl: "https://example.invalid" },
      { focus: "" },
      { focus: " " },
      { focus: 2 },
      { focus: "x".repeat(301) },
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { limit: "5" },
      { limit: null },
    ])
      assert.isFalse(tool.validate(input).ok);
    const ctx = context();
    ctx.request.libraryID = 0;
    await rejects(tool.execute({ limit: 30 }, ctx), /libraryID/i);
    assert.equal(calls, 0);
  });
  it("runs index → saved full profile → both recall routes → novelty/dedup → bounded tool output", async function () {
    const source = new IndexedResearchLibrarySource({
      getSnapshot: async () =>
        indexSnapshot([
          indexedItem(1, { doi: "10.1234/seed" }),
          indexedItem(99, { doi: "10.1234/saved" }),
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
      });
      profile.version = 1;
      profile.representativePapers = profile.representativePapers.slice(0, 1);
      // Put a high-priority topic beyond the profile tool's 20-topic summary cap.
      profile.topics = Array.from({ length: 25 }, (_, i) => ({
        ...profile.topics[0],
        id: `topic-${i}`,
        label: `Interest ${i}`,
        weight: i === 24 ? 1 : 0.1,
        confidence: 1,
      }));
      await store.save(profile, null);
      let calls = 0;
      const controller = new AbortController();
      const ctx = context();
      ctx.signal = controller.signal;
      const discovery: LiteratureDiscoverySource = {
        search: async (request) => {
          if (!calls++) assert.equal(request.query, "Interest 24");
          assert.strictEqual(request.signal, controller.signal);
          return {
            papers: [
              {
                title: "Already saved",
                authors: [],
                doi: "https://doi.org/10.1234/SAVED",
                provider: "openalex",
              },
              {
                title: "New research candidate",
                authors: ["Author"],
                doi: "10.1234/new",
                abstract: "a".repeat(900),
                provider: "openalex",
              },
              {
                title: "Another candidate",
                authors: [],
                doi: "10.1234/other",
                provider: "openalex",
              },
            ],
            warnings: [],
          };
        },
        related: async ({ doi, signal }) => {
          assert.equal(doi, "10.1234/seed");
          assert.strictEqual(signal, controller.signal);
          return {
            papers: [
              {
                title: "New research candidate",
                authors: [],
                doi: "10.1234/new",
                provider: "openalex",
              },
            ],
            warnings: [],
          };
        },
      };
      const service = new ProfileService(store, source);
      const tool = createResearchCandidateDiscoverTool(
        service,
        source,
        (actualContext) => {
          assert.strictEqual(actualContext, ctx);
          return discovery;
        },
      );
      const result = (await tool.execute({ limit: 1 }, ctx)) as {
        profileId: string;
        profileVersion: number;
        candidateCount: number;
        candidates: Array<{
          abstract: string;
          provenance: unknown[];
          sources: string[];
        }>;
        diagnostics: {
          finalCandidateCount: number;
          existingLibraryExcluded: number;
        };
        warnings: string[];
      };
      assert.equal(result.profileId, "library:1");
      assert.equal(result.profileVersion, 1);
      assert.equal(result.candidateCount, 1);
      assert.equal(result.diagnostics.finalCandidateCount, 2);
      assert.equal(result.diagnostics.existingLibraryExcluded, 5);
      assert.lengthOf(result.candidates[0].abstract, 400);
      assert.lengthOf(result.candidates[0].provenance, 6);
      assert.deepEqual(result.candidates[0].sources, [
        "profile_query",
        "seed_recommendation",
      ]);
      assert.include(result.warnings, "candidate_tool_output_truncated");
      assert.notProperty(result.candidates[0], "scores");
      assert.deepEqual(await store.load("library:1"), profile);
    } finally {
      db.close();
    }
  });
});

describe("Agent literature discovery adapter", function () {
  it("maps search and DOI-only seed calls, context, identifiers and safe warnings", async function () {
    const ctx = context();
    const signal = new AbortController().signal;
    const inputs: unknown[] = [];
    const adapter = new AgentLiteratureDiscoverySource(
      {
        execute: async (input, actual) => {
          inputs.push(input);
          assert.strictEqual(actual.signal, signal);
          assert.strictEqual(actual.request, ctx.request);
          return {
            results: [
              {
                title: "Research",
                authors: ["A"],
                sourceUrl: "https://openalex.org/W123",
                doi: "10.1234/test",
                year: 2026,
              },
            ],
            warnings: ["Raw provider message"],
          };
        },
      },
      ctx,
    );
    const result = await adapter.search({ query: "Agents", limit: 12, signal });
    await adapter.related({
      doi: "https://doi.org/10.1234/SEED",
      limit: 8,
      signal,
    });
    assert.deepEqual(inputs, [
      { mode: "search", source: "openalex", query: "Agents", limit: 12 },
      {
        mode: "recommendations",
        source: "openalex",
        doi: "10.1234/seed",
        limit: 8,
      },
    ]);
    assert.equal(result.papers[0].openAlexId, "W123");
    assert.equal(result.papers[0].provider, "openalex");
    assert.deepEqual(result.warnings, ["candidate_provider_warning"]);
  });
  it("distinguishes empty success from transport failures and propagates cancellation", async function () {
    const ctx = context();
    const empty = new AgentLiteratureDiscoverySource(
      { execute: async () => ({ results: [] }) },
      ctx,
    );
    assert.deepEqual(
      (await empty.search({ query: "Agents", limit: 1 })).papers,
      [],
    );
    const failed = new AgentLiteratureDiscoverySource(
      {
        execute: async () => ({
          results: [],
          message: "private URL/credential diagnostic",
        }),
      },
      ctx,
    );
    await rejects(
      failed.search({ query: "Agents", limit: 1 }),
      /candidate_provider_unavailable/,
    );
    const controller = new AbortController();
    controller.abort();
    await rejects(
      empty.search({ query: "Agents", limit: 1, signal: controller.signal }),
      /cancel/i,
    );
  });
  it("passes abort to actual OpenAlex fetch and never turns DOI failure into a keyword search", async function () {
    const original = globalThis.fetch;
    const controller = new AbortController();
    const ctx = context();
    ctx.signal = controller.signal;
    const urls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      urls.push(String(url));
      assert.strictEqual(init?.signal, controller.signal);
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    try {
      const adapter = new AgentLiteratureDiscoverySource(
        new LiteratureSearchService({
          resolveMetadataItem: () => null,
        } as never),
        ctx,
      );
      await rejects(
        adapter.related({
          doi: "10.1234/missing",
          limit: 8,
          signal: controller.signal,
        }),
        /candidate_provider_unavailable/,
      );
      assert.lengthOf(urls, 1);
      assert.notInclude(urls[0], "search=");
      globalThis.fetch = (async (_url, init) => {
        assert.strictEqual(init?.signal, controller.signal);
        controller.abort();
        throw new Error("Aborted");
      }) as typeof fetch;
      await rejects(
        adapter.search({
          query: "Agents",
          limit: 1,
          signal: controller.signal,
        }),
        /cancel/i,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
