import { assert } from "chai";
import type { AgentToolContext } from "../src/agent/types";
import { createBuiltInToolRegistry } from "../src/agent/tools";
import { AgentToolRegistry } from "../src/agent/tools/registry";
import {
  createResearchProfileGetTool,
  PROFILE_TOOL_LIMITS,
} from "../src/agent/tools/recommendation/researchProfileGet";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import {
  ProfileService,
  type ProfileGetOptions,
} from "../src/recommendation/profile/profileService";
import { SqliteProfileStore } from "../src/recommendation/profile/profileStore";
import { IndexedResearchLibrarySource } from "../src/recommendation/profile/librarySource";
import { ResearchProfileTestDb } from "./helpers/researchProfileDb";
import { resolvedAgentRequest } from "./helpers/resolvedAgentRequest";
import {
  indexSnapshot,
  indexedItem,
  paperSignal,
  preferences,
  PROFILE_NOW as now,
} from "./helpers/researchProfileFixtures";

function context(libraryID: number | undefined = 1): AgentToolContext {
  const request = resolvedAgentRequest({
    conversationKey: 1,
    mode: "agent",
    userText: "Read my research profile",
    libraryID,
    model: "model",
    apiBase: "https://test.invalid",
    providerProtocol: "openai_chat_compat",
    authMode: "api_key",
  });
  // Preserve deliberately invalid/missing scope for tool validation tests.
  request.libraryID = libraryID;
  return { request, item: null, currentAnswerText: "", modelName: "model" };
}

describe("research_profile_get Agent tool", function () {
  const profile = () =>
    new ProfileBuilder().build({ libraryID: 1, papers: [paperSignal()], now });
  function setup() {
    const calls: { libraryID: number; options?: ProfileGetOptions }[] = [];
    const tool = createResearchProfileGetTool({
      get: async (libraryID, options) => {
        calls.push({ libraryID, options });
        return { profile: profile(), status: "loaded", warnings: [] };
      },
    });
    const registry = new AgentToolRegistry();
    registry.register(tool);
    return { tool, registry, calls };
  }
  it("registers the built-in read tool only on the local Agent catalog", function () {
    const builtIns = createBuiltInToolRegistry({
      zoteroGateway: {} as never,
      pdfService: {} as never,
      pdfPageService: {} as never,
      retrievalService: {} as never,
    });
    const spec = builtIns.getTool("research_profile_get")!.spec;
    assert.equal(spec.mutability, "read");
    assert.isFalse(spec.requiresConfirmation);
    assert.isTrue(spec.localAgentOnly);
    assert.include(
      builtIns.listToolsForRequest(context().request).map((t) => t.name),
      spec.name,
    );
    assert.notInclude(
      builtIns.listTools().map((t) => t.name),
      spec.name,
    );
    for (const authMode of ["codex_app_server", "webchat"] as const)
      assert.notInclude(
        builtIns
          .listToolsForRequest({ ...context().request, authMode })
          .map((t) => t.name),
        spec.name,
      );
    assert.notInclude(
      builtIns
        .listToolsForRequest({
          ...context().request,
          providerProtocol: "web_sync",
        })
        .map((t) => t.name),
      spec.name,
    );
  });
  it("accepts only refresh, rejecting arbitrary library IDs and malformed arguments", function () {
    const { tool } = setup();
    assert.deepEqual(tool.validate({}), {
      ok: true,
      value: { refresh: false },
    });
    assert.deepEqual(tool.validate({ refresh: true }), {
      ok: true,
      value: { refresh: true },
    });
    for (const args of [
      { libraryID: 6 },
      { refresh: "true" },
      null,
      [],
      { profileId: "library:6" },
    ])
      assert.isFalse(tool.validate(args).ok);
    assert.isUndefined(tool.createPendingAction);
    assert.isUndefined(tool.planMutation);
    assert.isUndefined(tool.describeAction);
  });
  it("derives scope from the request and forwards refresh, model adapter and abort signal", async function () {
    const { tool, calls } = setup();
    const ctx = context(6);
    ctx.item = { libraryID: 1 } as Zotero.Item;
    ctx.signal = new AbortController().signal;
    await tool.execute({ refresh: true }, ctx);
    assert.equal(calls[0].libraryID, 6);
    assert.isTrue(calls[0].options!.refresh);
    assert.strictEqual(calls[0].options!.signal, ctx.signal);
    assert.exists(calls[0].options!.extractor);
    const itemContext = context();
    itemContext.request.libraryID = undefined;
    itemContext.item = { libraryID: 6 } as Zotero.Item;
    await tool.execute({ refresh: false }, itemContext);
    assert.equal(calls[1].libraryID, 6);
    const scopeContext = context(6);
    scopeContext.request.libraryID = undefined;
    await tool.execute({ refresh: false }, scopeContext);
    assert.equal(calls[2].libraryID, 6);
  });
  it("returns a clear registry failure for missing/invalid library without falling back", async function () {
    const { registry, calls } = setup();
    for (const libraryID of [undefined, 0, -1, 1.5, NaN, null, "1", ""]) {
      const ctx = context();
      ctx.request.libraryID = libraryID as number | undefined;
      if (libraryID === undefined)
        ctx.request.turnPaperScope = {
          ...ctx.request.turnPaperScope,
          libraryID: 0,
        };
      ctx.item =
        libraryID === undefined ? null : ({ libraryID: 6 } as Zotero.Item);
      const execution = await registry.prepareExecution(
        { id: "read", name: "research_profile_get", arguments: {} },
        ctx,
      );
      assert.equal(execution.kind, "result");
      if (execution.kind !== "result")
        throw new Error("Unexpected confirmation");
      assert.isFalse(execution.execution.result.ok);
      assert.include(
        JSON.stringify(execution.execution.result.content),
        "valid current libraryID",
      );
    }
    assert.lengthOf(calls, 0);
  });
  it("returns structured compact results without invoking any write confirmation", async function () {
    const { registry } = setup();
    const execution = await registry.prepareExecution(
      { id: "read", name: "research_profile_get", arguments: {} },
      context(),
    );
    assert.equal(execution.kind, "result");
    if (execution.kind !== "result") throw new Error("Unexpected confirmation");
    assert.isTrue(execution.execution.result.ok);
    assert.isUndefined(execution.execution.result.effect);
    const result = execution.execution.result.content as Record<
      string,
      unknown
    >;
    assert.containsAllKeys(result, [
      "profileId",
      "version",
      "status",
      "topics",
      "representativePapers",
      "explicitPreferences",
      "signalSummary",
      "generatedAt",
      "updatedAt",
      "warnings",
    ]);
    assert.notInclude(JSON.stringify(result), "A research abstract");
    assert.containsAllKeys((result.topics as object[])[0], [
      "label",
      "weight",
      "confidence",
      "sources",
      "evidenceRefs",
    ]);
  });
  it("caps topics, evidence, representatives and preferences while flagging truncation", async function () {
    const p = profile();
    p.topics = Array.from({ length: 50 }, (_, i) => ({
      ...p.topics[0],
      id: `topic-${i}`,
      evidenceRefs: Array.from({ length: 20 }, (_, j) => `paper-${j}`),
    }));
    p.representativePapers = Array.from({ length: 30 }, (_, i) => ({
      ...p.representativePapers[0],
      itemId: `paper-${i}`,
    }));
    p.explicitPreferences = preferences();
    p.explicitPreferences.negativeTopics = Array.from(
      { length: 30 },
      (_, i) => ({ ...preferences().negativeTopics[0], id: `negative-${i}` }),
    );
    const tool = createResearchProfileGetTool({
      get: async () => ({ profile: p, status: "loaded", warnings: [] }),
    });
    const result = (await tool.execute(
      { refresh: false },
      context(),
    )) as typeof p & { warnings: string[] };
    assert.lengthOf(result.topics, PROFILE_TOOL_LIMITS.topics);
    assert.lengthOf(
      result.topics[0].evidenceRefs,
      PROFILE_TOOL_LIMITS.evidenceRefs,
    );
    assert.lengthOf(
      result.representativePapers,
      PROFILE_TOOL_LIMITS.representativePapers,
    );
    assert.lengthOf(
      result.explicitPreferences.negativeTopics,
      PROFILE_TOOL_LIMITS.preferencesPerPolarity,
    );
    assert.include(result.warnings, "profile_tool_output_truncated");
    result.topics[0].sources.push("feedback");
    assert.notInclude(p.topics[0].sources, "feedback");
  });
  it("executes the index → signals → builder → production SQLite → Agent slice without a model", async function () {
    const db = new ResearchProfileTestDb();
    try {
      let snapshot = indexSnapshot();
      let reads = 0;
      const store = new SqliteProfileStore(() => db);
      const service = new ProfileService(
        store,
        new IndexedResearchLibrarySource({
          getSnapshot: async () => {
            reads++;
            return snapshot;
          },
        }),
        new ProfileBuilder(),
        () => now,
      );
      const registry = new AgentToolRegistry();
      registry.register(createResearchProfileGetTool(service));
      const ctx = context();
      ctx.modelName = "";
      ctx.request.model = undefined;
      ctx.request.apiBase = undefined;
      const run = async (refresh = false) => {
        const execution = await registry.prepareExecution(
          { id: "read", name: "research_profile_get", arguments: { refresh } },
          ctx,
        );
        if (execution.kind !== "result")
          throw new Error("Unexpected confirmation");
        assert.isTrue(execution.execution.result.ok);
        return execution.execution.result.content as {
          status: string;
          version: number;
          signalSummary: { libraryPaperCount: number };
        };
      };
      assert.equal((await run()).status, "built");
      assert.equal((await run()).status, "loaded");
      assert.equal(reads, 1);
      snapshot = indexSnapshot([indexedItem(), indexedItem(2)]);
      const refreshed = await run(true);
      assert.equal(refreshed.status, "rebuilt");
      assert.equal(refreshed.version, 2);
      assert.equal(refreshed.signalSummary.libraryPaperCount, 2);
      assert.equal(
        (await new SqliteProfileStore(() => db).load("library:1"))!.version,
        2,
      );
    } finally {
      db.close();
    }
  });
});
