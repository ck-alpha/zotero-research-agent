import { assert } from "chai";
import {
  normalizeDoi,
  normalizeArxivId,
  normalizeOpenAlexId,
} from "../src/recommendation/candidate/identity";
import { normalizeExternalPaper } from "../src/recommendation/candidate/normalize";
import { buildNovelCandidatePool } from "../src/recommendation/candidate/deduplicate";
import {
  assertRecommendationCandidate,
  assertCandidateProvenance,
} from "../src/recommendation/domain/validation";
import type {
  CandidateProvenance,
  RecommendationCandidate,
} from "../src/recommendation/domain/candidate";
import { IndexedResearchLibrarySource } from "../src/recommendation/profile/librarySource";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import {
  indexSnapshot,
  indexedItem,
  paperSignal,
  PROFILE_NOW,
} from "./helpers/researchProfileFixtures";

const provenance: CandidateProvenance = {
  route: "profile_query",
  provider: "openalex",
  providerRank: 1,
  query: "Agents",
};
const paper = (
  patch: Record<string, unknown> = {},
  p: CandidateProvenance = provenance,
): RecommendationCandidate =>
  normalizeExternalPaper(
    {
      title: "Long term memory for research agents",
      authors: ["A. Author"],
      year: 2026,
      provider: "openalex",
      ...patch,
    },
    p,
  )!;
const pool = (candidates: RecommendationCandidate[]) =>
  buildNovelCandidatePool(candidates, { libraryID: 1, papers: [] }, 80);

describe("candidate identity, novelty and provenance", function () {
  it("keeps discovery metadata precedence when a late identifier joins earlier groups", function () {
    const first = paper({
      title: "First distinct research title",
      doi: "10.1234/bridge",
      authors: [],
    });
    const second = paper(
      {
        title: "Another distinct research title",
        openAlexId: "W77",
        authors: ["Earlier author"],
      },
      { ...provenance, query: "Second" },
    );
    const bridge = paper(
      { doi: "10.1234/bridge", openAlexId: "W77", authors: ["Later author"] },
      { ...provenance, query: "Bridge" },
    );
    const result = pool([first, second, bridge]);
    assert.lengthOf(result.candidates, 1);
    assert.deepEqual(result.candidates[0].authors, ["Earlier author"]);
    assert.deepEqual(
      result.candidates[0].provenance.map((p) =>
        p.route === "profile_query" ? p.query : "",
      ),
      ["Agents", "Second", "Bridge"],
    );
  });
  it("canonicalizes identifiers without accepting unrelated URL hosts", function () {
    for (const value of [
      " 10.1234/ABC ",
      "doi:10.1234/ABC",
      "http://doi.org/10.1234/ABC",
      "https://doi.org/10.1234/ABC",
    ])
      assert.equal(normalizeDoi(value), "10.1234/abc");
    assert.equal(normalizeOpenAlexId("https://openalex.org/W123"), "W123");
    assert.equal(normalizeOpenAlexId("w123"), "W123");
    assert.equal(
      normalizeArxivId("https://arxiv.org/pdf/2601.12345v2.pdf"),
      "2601.12345",
    );
    assert.equal(normalizeArxivId("arXiv:2601.12345v1"), "2601.12345");
    assert.isUndefined(normalizeDoi("https://evil.invalid/10.1234/abc"));
    assert.isUndefined(normalizeOpenAlexId("https://evil.invalid/W123"));
    assert.isUndefined(normalizeArxivId("https://evil.invalid/abs/2601.12345"));
  });
  it("uses strong identity priority and conservative title-year/author fallback", function () {
    assert.equal(
      paper({ doi: "10.1234/x", arxivId: "2601.12345", openAlexId: "W1" })
        .candidateId,
      "doi:10.1234/x",
    );
    assert.equal(
      paper({ arxivId: "2601.12345", openAlexId: "W1" }).candidateId,
      "arxiv:2601.12345",
    );
    assert.equal(paper({ openAlexId: "W1" }).candidateId, "openalex:W1");
    assert.match(paper().candidateId, /^bibliographic:/);
    assert.lengthOf(
      pool([
        paper(),
        paper({ title: " LONG term memory for research agents " }),
      ]).candidates,
      1,
    );
    assert.lengthOf(
      pool([
        paper(),
        paper({ title: "Long term memory for scientific agents" }),
      ]).candidates,
      2,
    );
    assert.lengthOf(pool([paper(), paper({ year: 2025 })]).candidates, 2);
    assert.lengthOf(
      pool([
        paper({ title: "Introduction" }),
        paper({ title: "Introduction" }, { ...provenance, query: "Other" }),
      ]).candidates,
      2,
    );
    assert.lengthOf(
      pool([paper({ doi: "10.1234/a" }), paper({ doi: "10.1234/b" })])
        .candidates,
      2,
    );
  });
  it("merges identifier bridges with stable first discovery and all unique provenance", function () {
    const a = paper({
      doi: "10.1234/a",
      openAlexId: "W1",
      authors: [],
      abstract: "short",
    });
    const b = paper(
      { openAlexId: "W1", abstract: "A longer full abstract" },
      { ...provenance, query: "Memory" },
    );
    const c = paper(
      { doi: "https://doi.org/10.1234/A" },
      {
        route: "seed_recommendation",
        provider: "openalex",
        providerRank: 2,
        seedPaperId: "library:1:item:8",
      },
    );
    const result = pool([a, b, c, c]);
    assert.lengthOf(result.candidates, 1);
    assert.equal(result.duplicateCandidatesMerged, 3);
    const merged = result.candidates[0];
    assert.equal(merged.abstract, b.abstract);
    assert.deepEqual(merged.authors, ["A. Author"]);
    assert.lengthOf(merged.provenance, 3);
    assert.deepEqual(merged.sources, ["profile_query", "seed_recommendation"]);
    assert.deepEqual(merged.seedPaperIds, ["library:1:item:8"]);
    assert.deepEqual(merged.scores, {});
    assertRecommendationCandidate(merged);
  });
  it("excludes exact library DOI and conservative bibliography but preserves similar titles", function () {
    const snapshot = {
      libraryID: 1,
      papers: [
        paperSignal(99, { doi: "https://doi.org/10.1234/SAVED" }),
        paperSignal(100, {
          title: "Long term memory for research agents",
          year: "2026",
        }),
      ],
    };
    const result = buildNovelCandidatePool(
      [
        paper({ doi: "10.1234/saved", title: "Distinct title" }),
        paper(),
        paper({ title: "Long term memory for scientific agents" }),
      ],
      snapshot,
      80,
    );
    assert.equal(result.existingLibraryExcluded, 2);
    assert.lengthOf(result.candidates, 1);
  });
  it("validates route-specific provenance and redundant contract consistency", function () {
    for (const invalid of [
      { ...provenance, provider: "unknown" },
      { ...provenance, providerRank: 0 },
      { ...provenance, providerRank: 1.5 },
      { ...provenance, providerRank: Number.MAX_SAFE_INTEGER + 1 },
      { ...provenance, query: " " },
      { ...provenance, topicId: "" },
      { ...provenance, focus: "true" },
      { ...provenance, seedPaperId: "seed" },
      { route: "seed_recommendation", provider: "openalex", providerRank: 1 },
      {
        route: "seed_recommendation",
        provider: "openalex",
        providerRank: 1,
        seedPaperId: "seed",
        query: "query",
      },
    ])
      assert.throws(() => assertCandidateProvenance(invalid));
    assert.throws(() =>
      assertRecommendationCandidate({ ...paper(), provenance: [] }),
    );
    assert.throws(() =>
      assertRecommendationCandidate({
        ...paper(),
        sources: ["seed_recommendation"],
      }),
    );
    assert.throws(() =>
      assertRecommendationCandidate({
        ...paper(),
        seedPaperIds: ["unrelated"],
      }),
    );
  });
  it("maps optional DOI without changing topic scoring or profile content", async function () {
    const source = (doi: string) =>
      new IndexedResearchLibrarySource({
        getSnapshot: async () => indexSnapshot([indexedItem(1, { doi })]),
      });
    const without = await source("  ").getLibrarySnapshot(1);
    const withDoi = await source(" 10.1234/a ").getLibrarySnapshot(1);
    assert.isUndefined(without.papers[0].doi);
    assert.equal(withDoi.papers[0].doi, "10.1234/a");
    const builder = new ProfileBuilder();
    assert.deepEqual(
      builder.build({ libraryID: 1, papers: without.papers, now: PROFILE_NOW }),
      builder.build({ libraryID: 1, papers: withDoi.papers, now: PROFILE_NOW }),
    );
  });
});
