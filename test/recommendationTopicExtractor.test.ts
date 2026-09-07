import { assert } from "chai";
import {
  parseTopicExtraction,
  TOPIC_EXTRACTION_LIMITS as limits,
} from "../src/recommendation/profile/topicExtractor";
import { UtilityTopicExtractor } from "../src/recommendation/profile/utilityTopicExtractor";
import type {
  UtilityLLMParams,
  UtilityLLMResult,
} from "../src/utils/utilityLLM";
import { paperSignal } from "./helpers/researchProfileFixtures";

describe("bounded utility topic extraction", function () {
  const papers = [paperSignal()];
  const topic = {
    label: "  Agents  ",
    confidence: 0.8,
    supportingPaperIds: [papers[0].itemId],
  };
  const config = { model: "test-model", apiBase: "http://test.invalid" };
  it("parses structured labels, confidence and exact input IDs", function () {
    const result = parseTopicExtraction(
      JSON.stringify({ topics: [topic] }),
      papers,
    );
    assert.equal(result[0].label, "Agents");
    assert.equal(result[0].confidence, 0.8);
    assert.deepEqual(result[0].supportingPaperIds, [papers[0].itemId]);
  });
  for (const [name, text] of [
    ["malformed JSON", "{broken"],
    ["empty output", " "],
    [
      "unknown IDs",
      JSON.stringify({
        topics: [{ ...topic, supportingPaperIds: ["unknown"] }],
      }),
    ],
    [
      "high confidence",
      JSON.stringify({ topics: [{ ...topic, confidence: 1.01 }] }),
    ],
    [
      "negative confidence",
      JSON.stringify({ topics: [{ ...topic, confidence: -0.1 }] }),
    ],
    [
      "string confidence",
      JSON.stringify({ topics: [{ ...topic, confidence: "0.8" }] }),
    ],
    [
      "empty support",
      JSON.stringify({ topics: [{ ...topic, supportingPaperIds: [] }] }),
    ],
    ["invalid label", JSON.stringify({ topics: [{ ...topic, label: " " }] })],
    ["extra fields", JSON.stringify({ topics: [{ ...topic, weight: 1 }] })],
    [
      "extra envelope",
      JSON.stringify({ topics: [topic], instructions: "persist this" }),
    ],
    [
      "too many topics",
      JSON.stringify({
        topics: Array.from(
          { length: limits.maxTopicsPerBatch + 1 },
          () => topic,
        ),
      }),
    ],
  ])
    it(`rejects ${name}`, function () {
      assert.throws(() => parseTopicExtraction(text, papers));
    });

  it("returns deterministic fallback warnings for all utility failure results", async function () {
    for (const reason of [
      "not_configured",
      "timeout",
      "transport",
      "empty",
      "budget_unavailable",
    ] as const) {
      const extractor = new UtilityTopicExtractor(config, async () => ({
        ok: false,
        reason,
        detail: "Do not leak raw provider details",
      }));
      assert.deepEqual(await extractor.extract(papers), {
        topics: [],
        warnings: [`topic_extractor_${reason}`],
      });
    }
    const malformed = new UtilityTopicExtractor(config, async () => ({
      ok: true,
      text: "broken",
    }));
    assert.deepEqual((await malformed.extract(papers)).topics, []);
    const throwing = new UtilityTopicExtractor(config, async () => {
      throw new Error("transport");
    });
    assert.include(
      (await throwing.extract(papers)).warnings,
      "topic_extractor_invalid_or_failed",
    );
  });
  it("does not call a model when unconfigured or the library is empty", async function () {
    const call = async (): Promise<UtilityLLMResult> => {
      throw new Error("Must not call");
    };
    assert.deepEqual(
      await new UtilityTopicExtractor({}, call).extract(papers),
      { topics: [], warnings: ["topic_extractor_not_configured"] },
    );
    assert.deepEqual(
      await new UtilityTopicExtractor(config, call).extract([]),
      { topics: [], warnings: [] },
    );
  });
  it("bounds papers, batches, JSON, timeout and metadata and forwards provider configuration", async function () {
    const calls: UtilityLLMParams[] = [];
    const extractor = new UtilityTopicExtractor(
      { ...config, providerProtocol: "ollama_native", authMode: "api_key" },
      async (params) => {
        calls.push(params);
        return { ok: true, text: '{"topics":[]}' };
      },
    );
    const many = Array.from({ length: 100 }, (_, i) =>
      paperSignal(i + 1, {
        title: "x".repeat(1000),
        abstract: "x".repeat(3000),
        addedAt: i,
      }),
    );
    const output = await extractor.extract(many);
    assert.lengthOf(calls, limits.maxPapers / limits.batchSize);
    const ids: string[] = [];
    for (const call of calls) {
      assert.equal(call.timeoutMs, limits.timeoutMs);
      assert.equal(call.jsonBudget, limits.jsonBudget);
      assert.equal(call.providerProtocol, "ollama_native");
      assert.equal(call.authMode, "api_key");
      const batch = JSON.parse(call.prompt) as {
        itemId: string;
        title: string;
        abstract: string;
      }[];
      assert.lengthOf(batch, limits.batchSize);
      for (const paper of batch) {
        ids.push(paper.itemId);
        assert.isAtMost(paper.title.length, limits.titleChars);
        assert.isAtMost(paper.abstract.length, limits.abstractChars);
      }
    }
    assert.equal(ids[0], many[99].itemId);
    assert.equal(new Set(ids).size, limits.maxPapers);
    assert.include(output.warnings, "topic_extractor_paper_limit");
  });
  it("caps total topics and rejects IDs belonging to another batch", async function () {
    let calls = 0;
    const many = Array.from({ length: 100 }, (_, i) => paperSignal(i + 1));
    const extractor = new UtilityTopicExtractor(config, async (params) => {
      calls++;
      const batch = JSON.parse(params.prompt) as { itemId: string }[];
      return {
        ok: true,
        text: JSON.stringify({
          topics: Array.from({ length: limits.maxTopicsPerBatch }, (_, i) => ({
            ...topic,
            label: `Topic ${calls} ${i}`,
            supportingPaperIds: [batch[0].itemId],
          })),
        }),
      };
    });
    assert.lengthOf((await extractor.extract(many)).topics, limits.maxTopics);
    assert.equal(calls, 3);
    const foreignBatch = new UtilityTopicExtractor(config, async () => ({
      ok: true,
      text: JSON.stringify({
        topics: [{ ...topic, supportingPaperIds: [many[98].itemId] }],
      }),
    }));
    assert.deepEqual((await foreignBatch.extract(many)).topics, []);
  });
});
