import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { createRecommendationEmbeddingProvider } from "../src/agent/services/recommendationEmbeddingProvider";
import { RankingService } from "../src/recommendation/ranking/rankingService";
import { callEmbeddings } from "../src/utils/llmClient";
import { makeCandidate, makeProfile } from "./helpers/recommendationFixtures";

describe("recommendation embedding adapter using existing client", function () {
  let originalZotero: typeof Zotero;
  let originalToolkit: unknown;
  const globals = globalThis as typeof globalThis & { ztoolkit?: unknown };
  let prefs: Map<string, unknown>;
  let handler: (url: string, init?: RequestInit) => Promise<unknown>;
  const set = (key: string, value: unknown) =>
    prefs.set(`extensions.zotero.llmforzotero.${key}`, value);
  beforeEach(function () {
    originalZotero = globalThis.Zotero;
    originalToolkit = globals.ztoolkit;
    prefs = new Map();
    globalThis.Zotero = {
      Prefs: {
        get: (key: string) => prefs.get(key) ?? "",
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
    } as never;
    globals.ztoolkit = {
      getGlobal: (name: string) => (name === "fetch" ? handler : undefined),
      log: () => {},
    };
    handler = async () => {
      throw new Error("Unexpected network");
    };
    set("embeddingProvider", "custom");
    set("embeddingApiBase", "https://embedding.invalid/v1");
    set("embeddingModel", "dedicated-test-embedding");
    set("model", "main-agent-model");
  });
  afterEach(function () {
    globalThis.Zotero = originalZotero;
    globals.ztoolkit = originalToolkit;
  });
  it("checks availability locally and never falls back to main model/config", function () {
    assert.isDefined(createRecommendationEmbeddingProvider());
    set("embeddingApiBase", "");
    assert.isUndefined(createRecommendationEmbeddingProvider());
    set("embeddingApiBase", "https://embedding.invalid");
    set("embeddingProvider", "openai");
    set("embeddingApiKey", "");
    assert.isUndefined(createRecommendationEmbeddingProvider());
  });
  it("preserves indexed response order and uses dedicated embedding payload with signal", async function () {
    const controller = new AbortController();
    handler = async (url, init) => {
      assert.equal(url, "https://embedding.invalid/v1/embeddings");
      assert.strictEqual(init?.signal, controller.signal);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "dedicated-test-embedding",
        input: ["first", "second"],
      });
      return {
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      };
    };
    assert.deepEqual(
      await createRecommendationEmbeddingProvider()!.embed(
        ["first", "second"],
        controller.signal,
      ),
      {
        model: "dedicated-test-embedding",
        vectors: [
          [1, 0],
          [0, 1],
        ],
      },
    );
  });
  it("runs ranking batches through the adapter in order (32 + 4), without one request per paper", async function () {
    const batches: string[][] = [];
    handler = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      batches.push(payload.input);
      assert.equal(payload.model, "dedicated-test-embedding");
      return {
        ok: true,
        json: async () => ({
          data: payload.input.map((_t: string, index: number) => ({
            index,
            embedding: [1, 0],
          })),
        }),
      };
    };
    const candidates = Array.from({ length: 35 }, (_, i) => ({
      ...makeCandidate(),
      candidateId: `c-${String(i).padStart(2, "0")}`,
      title: `Paper ${i}`,
      abstract: "a".repeat(5000),
    }));
    const result = await new RankingService().rank({
      profile: makeProfile(),
      candidates,
      now: Date.UTC(2026, 8, 9),
      semanticProvider: createRecommendationEmbeddingProvider(),
    });
    assert.deepEqual(
      batches.map((b) => b.length),
      [32, 4],
    );
    assert.isTrue(result.diagnostics.semanticSucceeded);
    assert.isTrue(batches[0][1].startsWith("Paper 0\n"));
    assert.lengthOf(batches[0][1], 1200);
    assert.isTrue(batches[1][0].startsWith("Paper 31\n"));
    assert.notInclude(batches[0][1], "providerRank");
  });
  it("rejects invalid vectors and changed settings", async function () {
    const adapter = createRecommendationEmbeddingProvider()!;
    for (const vectors of [[], [[]], [[NaN]], [[1], [1]]]) {
      handler = async () => ({
        ok: true,
        json: async () => ({
          data: vectors.map((embedding) => ({ embedding })),
        }),
      });
      await rejects(adapter.embed(["one"]));
    }
    set("embeddingModel", "changed");
    await rejects(adapter.embed(["one"]), /configuration_changed/);
  });
  it("cancels before network and forwards in-flight abort through the existing client", async function () {
    const adapter = createRecommendationEmbeddingProvider()!;
    const before = new AbortController();
    before.abort();
    await rejects(adapter.embed(["one"], before.signal), /cancel/);
    const controller = new AbortController();
    let calls = 0;
    handler = async (_url, init) => {
      calls++;
      assert.strictEqual(init?.signal, controller.signal);
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("transport aborted")),
          { once: true },
        );
        controller.abort();
      });
    };
    await rejects(adapter.embed(["one"], controller.signal), /aborted/);
    assert.equal(calls, 1);
  });
  it("rejects duplicate, mixed and out-of-range indices instead of misaligning vectors", async function () {
    for (const indices of [
      [0, 0],
      [0, undefined],
      [-1, 0],
      [0, 2],
      [0, 0.5],
      [0, NaN],
    ]) {
      handler = async () => ({
        ok: true,
        json: async () => ({
          data: indices.map((index) => ({ index, embedding: [1] })),
        }),
      });
      await rejects(
        createRecommendationEmbeddingProvider()!.embed(["a", "b"]),
        /indices/,
      );
    }
  });
  it("keeps the old callEmbeddings signature working", async function () {
    handler = async (_url, init) => {
      assert.notProperty(init, "signal");
      return { ok: true, json: async () => ({ data: [{ embedding: [1] }] }) };
    };
    assert.deepEqual(await callEmbeddings(["legacy"]), [[1]]);
  });
});
