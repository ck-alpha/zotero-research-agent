import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import {
  profileIdForLibrary,
  paperIdForLibraryItem,
} from "../src/recommendation/profile/identity";
import {
  normalizeTopic,
  evidenceRef,
} from "../src/recommendation/profile/topicNormalization";
import {
  DAY_MS,
  PROFILE_SCORING,
  timeDecay,
} from "../src/recommendation/profile/profileScoring";
import { IndexedResearchLibrarySource } from "../src/recommendation/profile/librarySource";
import { assertResearchProfile } from "../src/recommendation/domain/validation";
import { validatePreferenceUpdate } from "../src/recommendation/profile/profileUpdater";
import {
  indexSnapshot,
  indexedItem,
  paperSignal,
  preferences,
  PROFILE_NOW as now,
} from "./helpers/researchProfileFixtures";

describe("research profile pure logic", function () {
  const builder = new ProfileBuilder();
  it("centralizes strict library and local paper identities", function () {
    assert.equal(profileIdForLibrary(6), "library:6");
    assert.equal(paperIdForLibraryItem(6, 8), "library:6:item:8");
    for (const value of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
      undefined,
    ]) {
      assert.throws(() => profileIdForLibrary(value as number), /libraryID/);
    }
    assert.throws(() => paperIdForLibraryItem(1, 0), /itemID/);
  });

  it("filters index papers and maps detached tags, metadata and collection paths", async function () {
    const snapshot = indexSnapshot([
      indexedItem(1),
      indexedItem(2, { deleted: true }),
      indexedItem(3, { kind: "standalone-note" }),
      indexedItem(4, { kind: "standalone-attachment" }),
      indexedItem(5, { title: "  " }),
      indexedItem(6, { title: null as unknown as string }),
      indexedItem(7, { libraryID: 6 }),
      indexedItem(8, { addedAt: NaN, modifiedAt: -1, collectionIds: [999] }),
    ]);
    const source = new IndexedResearchLibrarySource({
      getSnapshot: async () => snapshot,
    });
    const result = await source.getLibrarySnapshot(1);
    assert.deepEqual(
      result.papers.map((paper) => paper.itemId),
      [paperIdForLibraryItem(1, 1), paperIdForLibraryItem(1, 8)],
    );
    assert.deepEqual(result.papers[0].collectionPaths, ["Research / Agents"]);
    assert.deepEqual(result.papers[0].manualTags, ["Agents"]);
    assert.deepEqual(result.papers[0].automaticTags, ["Automatic"]);
    assert.equal(result.papers[0].abstract, "An abstract");
    assert.equal(result.papers[1].addedAt, 0);
    result.papers[0].manualTags.push("Changed");
    assert.deepEqual(snapshot.itemById.get(1)!.tags, ["Agents"]);
    await rejects(source.getLibrarySnapshot(6), /scope mismatch/);
    await rejects(source.getLibrarySnapshot(0), /libraryID/);
  });

  it("uses fixed-time half-life decay and clamps future timestamps", function () {
    assert.equal(timeDecay(now, now), 1);
    assert.closeTo(timeDecay(now - 180 * DAY_MS, now), 0.5, 1e-12);
    assert.closeTo(timeDecay(now - 360 * DAY_MS, now), 0.25, 1e-12);
    assert.equal(timeDecay(now + DAY_MS, now), 1);
    assert.closeTo(timeDecay(now - 90 * DAY_MS, now, 90), 0.5, 1e-12);
    assert.throws(() => timeDecay(now, now, 0), TypeError);
  });

  it("normalizes only obvious text duplicates and rejects invalid labels", function () {
    assert.equal(normalizeTopic("  AGENT\t Systems  ").key, "agent systems");
    assert.equal(normalizeTopic("cafe\u0301").key, normalizeTopic("Café").key);
    assert.notEqual(normalizeTopic("C++").key, normalizeTopic("C").key);
    assert.notEqual(
      normalizeTopic("Robotics").key,
      normalizeTopic("Agents").key,
    );
    for (const value of [
      "",
      "   ",
      "\u200b",
      "a\u0000b",
      "x".repeat(161),
      null,
      12,
      "---",
      "\ud800",
    ])
      assert.throws(() => normalizeTopic(value), TypeError);
  });

  it("builds a valid deterministic profile without any model or main Agent", function () {
    const papers = [
      paperSignal(2, { manualTags: ["agents", " Agents ", "Robotics"] }),
      paperSignal(1),
    ];
    const profile = builder.build({ libraryID: 1, papers, now });
    assertResearchProfile(profile);
    assert.equal(profile.version, 1);
    assert.lengthOf(profile.topics, 2);
    assert.deepEqual(
      profile,
      builder.build({ libraryID: 1, papers: [...papers].reverse(), now }),
    );
    assert.isUndefined(profile.embedding);
    assert.equal(profile.signalSummary.libraryPaperCount, 2);
    assert.equal(profile.signalSummary.positiveFeedbackCount, 0);
    assert.equal(profile.signalSummary.negativeFeedbackCount, 0);
    assert.notInclude(
      profile.topics.map((topic) => topic.label),
      "Unreliable automatic tag",
    );
  });

  it("does not count duplicated per-paper tag/collection/model support as extra votes", function () {
    const simple = builder.build({
      libraryID: 1,
      papers: [paperSignal()],
      now,
    });
    const repeated = builder.build({
      libraryID: 1,
      papers: [
        paperSignal(1, {
          manualTags: ["Agents", "agents"],
          collectionPaths: ["Agents"],
        }),
      ],
      extractedTopics: [
        {
          label: "Agents",
          confidence: 1,
          supportingPaperIds: [paperSignal().itemId],
        },
      ],
      now,
    });
    assert.equal(simple.topics[0].weight, repeated.topics[0].weight);
    assert.equal(simple.topics[0].confidence, repeated.topics[0].confidence);
    assert.equal(
      new Set(repeated.topics[0].evidenceRefs).size,
      repeated.topics[0].evidenceRefs.length,
    );
    assert.include(
      repeated.topics[0].evidenceRefs,
      evidenceRef("paper", paperSignal().itemId),
    );
  });

  it("calculates interest separately from certainty and prioritizes explicit preferences", function () {
    const current = builder.build({
      libraryID: 1,
      papers: [paperSignal()],
      now,
    });
    const old = builder.build({
      libraryID: 1,
      papers: [paperSignal(1, { addedAt: now - 360 * DAY_MS })],
      now,
    });
    assert.isAbove(current.topics[0].weight, old.topics[0].weight);
    assert.equal(current.topics[0].confidence, old.topics[0].confidence);
    assert.notEqual(current.topics[0].weight, current.topics[0].confidence);
    const prefs = preferences();
    prefs.negativeTopics[0] = {
      ...prefs.negativeTopics[0],
      label: "AGENTS",
      strength: 1,
    };
    const profile = builder.build({
      libraryID: 1,
      papers: [paperSignal()],
      explicitPreferences: prefs,
      now,
    });
    assert.equal(profile.topics[0].weight, 0);
    assert.equal(profile.topics[0].confidence, 1);
    assert.deepEqual(profile.topics[0].sources, ["library", "explicit"]);
    const positive = builder.build({
      libraryID: 1,
      papers: [],
      explicitPreferences: preferences(),
      now,
    });
    assert.equal(positive.topics[0].weight, 1);
    assert.deepEqual(positive.topics[0].sources, ["explicit"]);
    assert.deepEqual(positive.representativePapers, []);
  });

  it("preserves detached positive and negative preferences across full rebuilds", function () {
    const previous = builder.build({
      libraryID: 1,
      papers: [paperSignal()],
      explicitPreferences: preferences(),
      now,
    });
    const next = builder.build({
      libraryID: 1,
      papers: [],
      previous,
      now: now + 100,
    });
    assert.deepEqual(next.explicitPreferences, previous.explicitPreferences);
    assert.equal(next.version, 2);
    assert.equal(next.generatedAt, now + 100);
    next.explicitPreferences.positiveTopics[0].strength = 0;
    assert.equal(previous.explicitPreferences.positiveTopics[0].strength, 1);
    assert.throws(
      () => builder.build({ libraryID: 6, papers: [], previous, now }),
      /scope/,
    );
    assert.throws(
      () => builder.build({ libraryID: 1, papers: [], previous, now: now - 1 }),
      /backwards/,
    );
  });

  it("validates preference identity, polarity, timestamps and magnitude", function () {
    const prefs = preferences();
    assert.deepEqual(validatePreferenceUpdate(prefs, now), prefs);
    for (const patch of [
      { strength: -0.1 },
      { strength: NaN },
      { label: " " },
      { updatedAt: now + 1 },
      { createdAt: now },
    ]) {
      assert.throws(
        () =>
          validatePreferenceUpdate(
            {
              ...prefs,
              positiveTopics: [{ ...prefs.positiveTopics[0], ...patch }],
            },
            now,
          ),
        TypeError,
      );
    }
    assert.throws(
      () =>
        validatePreferenceUpdate(
          {
            ...prefs,
            positiveTopics: [
              prefs.positiveTopics[0],
              { ...prefs.positiveTopics[0], id: "another" },
            ],
          },
          now,
        ),
      /Duplicate/,
    );
    assert.throws(
      () =>
        validatePreferenceUpdate(
          {
            ...prefs,
            negativeTopics: [
              { ...prefs.negativeTopics[0], id: prefs.positiveTopics[0].id },
            ],
          },
          now,
        ),
      /Duplicate/,
    );
  });

  it("bounds evidence and representatives with deterministic reasons and eligible IDs", function () {
    const papers = Array.from({ length: 60 }, (_, i) => paperSignal(i + 1));
    const profile = builder.build({
      libraryID: 1,
      papers,
      explicitPreferences: preferences(),
      now,
    });
    assert.lengthOf(
      profile.representativePapers,
      PROFILE_SCORING.maxRepresentativePapers,
    );
    assert.isAtMost(
      profile.topics[0].evidenceRefs.length,
      PROFILE_SCORING.maxEvidenceRefs,
    );
    assert.include(
      profile.topics[0].evidenceRefs.slice(0, 6),
      evidenceRef("preference", "positive-1"),
    );
    assert.include(
      profile.topics[0].evidenceRefs.slice(0, 6),
      evidenceRef("tag", "agents"),
    );
    for (const paper of profile.representativePapers) {
      assert.include(
        papers.map((p) => p.itemId),
        paper.itemId,
      );
      assert.equal(paper.reason, "explicit_positive");
      assert.isAtLeast(paper.weight, 0);
      assert.isAtMost(paper.weight, 1);
    }
    for (const ref of profile.topics[0].evidenceRefs.filter((ref) =>
      ref.startsWith("paper:"),
    ))
      assert.include(
        papers.map((p) => evidenceRef("paper", p.itemId)),
        ref,
      );
    assert.deepEqual(
      profile,
      builder.build({
        libraryID: 1,
        papers: [...papers].reverse(),
        explicitPreferences: preferences(),
        now,
      }),
    );
  });

  it("allows an empty library, skips bad metadata labels and validates model evidence", function () {
    const profile = builder.build({ libraryID: 1, papers: [], now });
    assert.deepEqual(profile.topics, []);
    assert.deepEqual(profile.representativePapers, []);
    const badTags = builder.build({
      libraryID: 1,
      papers: [paperSignal(1, { manualTags: ["", "\u0000", "Valid"] })],
      now,
    });
    assert.deepEqual(
      badTags.topics.map((topic) => topic.label),
      ["Valid"],
    );
    assert.throws(
      () =>
        builder.build({
          libraryID: 1,
          papers: [paperSignal()],
          extractedTopics: [
            {
              label: "Agents",
              confidence: 1,
              supportingPaperIds: ["invented"],
            },
          ],
          now,
        }),
      /supporting paper/,
    );
    assert.throws(
      () =>
        builder.build({
          libraryID: 1,
          papers: [paperSignal(), paperSignal()],
          now,
        }),
      /Duplicate paper/,
    );
    assert.throws(
      () => new ProfileBuilder({ ...PROFILE_SCORING, halfLifeDays: -1 }),
      /config/,
    );
    assert.lengthOf(
      new ProfileBuilder({ ...PROFILE_SCORING, maxTopics: 1 }).build({
        libraryID: 1,
        papers: [paperSignal(1, { manualTags: ["A", "B"] })],
        now,
      }).topics,
      1,
    );
  });
});
