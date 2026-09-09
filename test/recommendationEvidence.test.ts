import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { makeCandidate, makeProfile } from "./helpers/recommendationFixtures";
import {
  EVIDENCE_CONFIG as config,
  assertRecommendationEvidence,
  type EvidenceInput,
  type RecommendationEvidence,
} from "../src/recommendation/evidence/contracts";
import { RecommendationEvidenceService } from "../src/recommendation/evidence/evidenceService";
import {
  evidenceConfidence,
  rankEvidence,
} from "../src/recommendation/evidence/evidenceRanker";
import { formatEvidence } from "../src/recommendation/evidence/evidenceFormatter";
import { RankingService } from "../src/recommendation/ranking/rankingService";
import { AgentRecommendationEvidenceSource } from "../src/agent/services/recommendationEvidenceSource";
import { PdfService } from "../src/agent/services/pdfService";
import { pdfTextCache } from "../src/modules/contextPanel/state";

function input(): EvidenceInput {
  const profile = makeProfile();
  profile.topics[0].label = "Agentic Recommendation";
  profile.topics[0].evidenceRefs = ["paper:library%3A1%3Aitem%3A1"];
  return {
    profile,
    now: 1000,
    candidate: {
      ...makeCandidate(),
      title: "Agentic Recommendation",
      abstract: "Agentic Recommendation with traceable sources.",
      rank: 1,
      scores: { finalScore: 1 },
      matchedTopicIds: [profile.topics[0].id],
      seedPaperIds: ["library:1:item:1"],
      provenance: [
        {
          route: "seed_recommendation",
          provider: "openalex",
          providerRank: 1,
          seedPaperId: "library:1:item:1",
        },
      ],
      sources: ["seed_recommendation"],
    },
    snapshot: {
      libraryID: 1,
      papers: [
        {
          itemId: "library:1:item:1",
          title: "Seed",
          authors: [],
          manualTags: ["Agentic Recommendation"],
          automaticTags: [],
          collectionPaths: ["Agentic Recommendation"],
          abstract: "Agentic Recommendation library abstract",
          addedAt: 100,
          modifiedAt: 100,
        },
      ],
    },
  };
}
const valid = (): RecommendationEvidence => ({
  evidenceId: "a:e1",
  candidateId: "a",
  sourceType: "abstract",
  reference: "candidate:a#abstract",
  snippet: "Agentic Recommendation",
  confidence: 0.5,
  createdAt: 100,
});

describe("Phase 6 evidence contracts", function () {
  it("accepts all sources and rejects invalid fields, confidence and oversized snippets", function () {
    for (const sourceType of Object.keys(config.quality))
      assert.doesNotThrow(() =>
        assertRecommendationEvidence({ ...valid(), sourceType }),
      );
    for (const patch of [
      { confidence: -1 },
      { confidence: 1.1 },
      { confidence: NaN },
      { confidence: Infinity },
      { sourceType: "generated" },
      { sourceType: "toString" },
      { snippet: "x".repeat(config.maxSnippetChars + 1) },
      { reference: "" },
      { candidateId: "" },
      { createdAt: -1 },
      { createdAt: 1.5 },
      { extra: true },
    ])
      assert.throws(() =>
        assertRecommendationEvidence({ ...valid(), ...patch }),
      );
  });
  it("has stable scoring, immutable results and deterministic tie breaks", async function () {
    const a = { ...valid(), evidenceId: "z", reference: "z" },
      b = { ...valid(), evidenceId: "a", reference: "a" };
    assert.deepEqual(rankEvidence([a, b]), rankEvidence([b, a]));
    assert.equal(rankEvidence([a, b])[0].evidenceId, "a");
    for (const source of Object.keys(
      config.quality,
    ) as RecommendationEvidence["sourceType"][]) {
      const score = evidenceConfidence(
        "Agentic Recommendation",
        ["Agentic Recommendation"],
        source,
        100,
        1000,
      );
      assert.isAtLeast(score, 0);
      assert.isAtMost(score, 1);
      assert.equal(
        score,
        evidenceConfidence(
          "Agentic Recommendation",
          ["Agentic Recommendation"],
          source,
          100,
          1000,
        ),
      );
    }
    const service = new RecommendationEvidenceService();
    const first = await service.explain(input());
    assert.deepEqual(first, await service.explain(input()));
    assert.isTrue(Object.isFrozen(first.evidence[0]));
    assert.isTrue(Object.isFrozen(first.reason.evidenceRefs));
  });
});

describe("Phase 6 retrieval and grounded explanation", function () {
  it("retrieves metadata, notes, abstracts and existing content with scoped references", async function () {
    const calls: string[] = [];
    const service = new RecommendationEvidenceService({
      notes: async (id) => {
        calls.push(id);
        return [
          { reference: `${id}#note:2`, text: "Agentic Recommendation note" },
        ];
      },
      content: async (id) => [
        {
          reference: `${id}#attachment:3:chunk:0`,
          text: "Agentic Recommendation cached content",
        },
      ],
    });
    const data = input();
    data.snapshot.papers[0].collectionPaths = [];
    data.snapshot.papers[0].abstract = undefined;
    const result = await service.explain(data);
    assert.deepEqual(calls, ["library:1:item:1"]);
    assert.sameMembers(
      result.evidence.map((e) => e.sourceType),
      ["abstract", "library_metadata", "library_note", "paper_content"],
    );
    assert.deepEqual(result.reason.matchedTopics, ["Agentic Recommendation"]);
    for (const ref of result.reason.evidenceRefs)
      assert.isTrue(result.evidence.some((e) => e.evidenceId === ref));
    assert.isTrue(
      result.evidence.every(
        (e) => e.candidateId === data.candidate.candidateId,
      ),
    );
  });
  it("never justifies a title-only candidate with library notes or fabricated citations", async function () {
    const data = input();
    data.candidate.abstract = undefined;
    const result = await new RecommendationEvidenceService().explain(data);
    assert.include(result.warnings, "evidence_unavailable");
    assert.deepEqual(result.reason.evidenceRefs, []);
    assert.deepEqual(result.reason.matchedTopics, []);
    assert.equal(result.reason.confidence, 0);
    assert.notInclude(result.reason.summary, "Agentic Recommendation");
  });
  it("reports missing evidence and refuses unrelated candidate mappings", async function () {
    const data = input();
    data.snapshot.papers = [];
    data.candidate.abstract = undefined;
    const result = await new RecommendationEvidenceService().explain(data);
    assert.isEmpty(result.evidence);
    assert.include(result.warnings, "evidence_unavailable");
    assert.isEmpty(formatEvidence(data, [valid()]).evidence);
  });
  it("preserves abstract evidence on partial failure, including a source timeout", async function () {
    this.timeout(5000);
    const data = input();
    const service = new RecommendationEvidenceService({
      notes: async () => {
        throw new Error("offline");
      },
      content: () => new Promise(() => {}),
    });
    const result = await service.explain(data);
    assert.include(result.warnings, "evidence_partial_failure");
    assert.isNotEmpty(result.reason.evidenceRefs);
  });
  it("propagates cancellation during retrieval", async function () {
    const controller = new AbortController();
    const data = input();
    data.signal = controller.signal;
    const promise = new RecommendationEvidenceService({
      notes: async () => {
        controller.abort();
        return [];
      },
      content: async () => [],
    }).explain(data);
    await rejects(promise, /cancel/i);
  });
  it("bounds escaped JSON, snippets and reference count; keeps an original matching window", async function () {
    const data = input();
    data.candidate.abstract =
      '"\\'.repeat(2000) + " Agentic Recommendation " + "tail ".repeat(300);
    const result = await new RecommendationEvidenceService().explain(data);
    assert.isAtMost(result.evidence.length, config.maxPerRecommendation);
    assert.isAtMost(
      JSON.stringify({ evidence: result.evidence, reason: result.reason })
        .length,
      config.maxExplanationChars,
    );
    for (const e of result.evidence)
      assert.isAtMost(e.snippet.length, config.maxSnippetChars);
    assert.include(data.candidate.abstract, result.evidence[0].snippet);
    assert.isNotEmpty(result.reason.evidenceRefs);
  });
  it("runs A/B fixture: ranking precedes evidence, A has stronger support, no LLM required", async function () {
    const data = input();
    const {
      rank: _rank,
      matchedTopicIds: _topics,
      ...candidate
    } = data.candidate;
    const a = { ...candidate, candidateId: "a", scores: {} };
    const b = {
      ...a,
      candidateId: "b",
      title: "Astronomy",
      abstract: "Stars and galaxies",
      provenance: [
        {
          route: "profile_query" as const,
          provider: "openalex" as const,
          providerRank: 2,
          query: "Astronomy",
        },
      ],
      sources: ["profile_query" as const],
      seedPaperIds: [],
    };
    const ranked = await new RankingService().rank({
      profile: data.profile,
      candidates: [b, a],
      now: data.now,
      topK: 2,
    });
    assert.equal(ranked.recommendations[0].candidateId, "a");
    const service = new RecommendationEvidenceService();
    const results = await Promise.all(
      ranked.recommendations.map((candidate) =>
        service.explain({ ...data, candidate }),
      ),
    );
    assert.isAbove(results[0].reason.confidence, results[1].reason.confidence);
    assert.include(results[0].reason.summary, "supplied candidate abstract");
    assert.notInclude(results[0].reason.summary, "outperforms");
  });
});

describe("Phase 6 production evidence adapter", function () {
  it("restricts item scope and reads notes and cached chunks only", async function () {
    let noteCalls = 0;
    const item = {
      id: 1,
      libraryID: 1,
      deleted: false,
      isRegularItem: () => true,
      getAttachments: () => [999999],
    };
    const source = new AgentRecommendationEvidenceSource(
      {
        getItem: () => item,
        getPaperNotes: () => {
          noteCalls++;
          return [{ noteId: 2, noteText: "Original note" }];
        },
      } as never,
      new PdfService(),
    );
    assert.deepEqual(await source.notes("library:2:item:1"), []);
    assert.equal(noteCalls, 0);
    assert.deepEqual(await source.content("library:1:item:1"), []);
    pdfTextCache.set(999999, { chunks: ["Already extracted"] } as never);
    try {
      assert.deepEqual(await source.content("library:1:item:1"), [
        {
          reference: "library:1:item:1#attachment:999999:chunk:0",
          text: "Already extracted",
        },
      ]);
      assert.deepEqual(await source.notes("library:1:item:1"), [
        { reference: "library:1:item:1#note:2", text: "Original note" },
      ]);
    } finally {
      pdfTextCache.delete(999999);
    }
  });
});
