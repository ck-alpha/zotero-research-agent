import { assert } from "chai";
import {
  makeFeedback,
  makeImpression,
  makeProfile,
} from "./helpers/recommendationFixtures";
import {
  InMemoryFeedbackStore,
  InMemoryImpressionStore,
  InMemoryProfileStore,
} from "./helpers/recommendationStores";

async function rejects(
  operation: Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    assert.instanceOf(error, Error);
    assert.include((error as Error).message, message);
    return;
  }
  assert.fail("Expected operation to reject");
}

describe("recommendation store boundaries (in-memory test doubles)", function () {
  it("creates, loads and updates a detached profile snapshot", async function () {
    const store = new InMemoryProfileStore();
    assert.isNull(await store.load("profile-1"));
    const input = makeProfile();
    await store.save(input, null);
    input.topics[0].weight = 0;
    const saved = (await store.load(input.profileId))!;
    assert.equal(saved.topics[0].weight, 0.8);
    saved.topics[0].evidenceRefs.push("new-ref");
    assert.lengthOf(
      (await store.load(input.profileId))!.topics[0].evidenceRefs,
      1,
    );
    saved.version = 2;
    saved.updatedAt = 200;
    await store.save(saved, 1);
    assert.deepEqual(await store.load(input.profileId), saved);
  });

  it("rejects invalid writes and revision conflicts without changing stored state", async function () {
    const store = new InMemoryProfileStore();
    const profile = makeProfile();
    await rejects(
      store.save({ ...profile, version: 2 }, null),
      "version conflict",
    );
    assert.isNull(await store.load(profile.profileId));
    await store.save(profile, null);
    for (const [version, expectedVersion] of [
      [1, null],
      [1, 1],
      [3, 1],
      [2, 2],
    ] as const) {
      await rejects(
        store.save({ ...profile, version }, expectedVersion),
        "version conflict",
      );
    }
    await rejects(store.save({ ...profile, version: 0 }, 1), "profile.version");
    await rejects(
      store.save({ ...profile, profileId: " " }, null),
      "profileId",
    );
    await rejects(
      store.save({ ...profile, version: 2 }, NaN),
      "expectedVersion",
    );
    await rejects(store.load(" "), "profileId");
    assert.deepEqual(await store.load(profile.profileId), profile);
  });

  it("allows only one writer to advance the same profile revision", async function () {
    const store = new InMemoryProfileStore();
    const profile = makeProfile();
    await store.save(profile, null);
    const results = await Promise.allSettled([
      store.save({ ...profile, version: 2, updatedAt: 200 }, 1),
      store.save({ ...profile, version: 2, updatedAt: 300 }, 1),
    ]);
    assert.deepEqual(
      results.map((result) => result.status),
      ["fulfilled", "rejected"],
    );
    assert.equal((await store.load(profile.profileId))!.updatedAt, 200);
  });

  it("keeps different profiles independent", async function () {
    const store = new InMemoryProfileStore();
    await store.save(makeProfile(), null);
    await store.save({ ...makeProfile(), profileId: "profile-2" }, null);
    await store.save({ ...makeProfile(), version: 2 }, 1);
    assert.equal((await store.load("profile-2"))!.version, 1);
  });

  it("appends feedback in insertion order, filters and isolates read/write copies", async function () {
    const store = new InMemoryFeedbackStore();
    assert.deepEqual(await store.list(), []);
    const first = makeFeedback();
    await store.append(first);
    first.action = "negative";
    await store.append({
      ...makeFeedback(),
      eventId: "event-2",
      timestamp: 50,
      action: "save",
      recommendationId: "rec-2",
    });
    await store.append({
      ...makeFeedback(),
      eventId: "event-3",
      paperId: "candidate-2",
      action: "skip",
    });
    const events = await store.list();
    assert.deepEqual(
      events.map((event) => event.eventId),
      ["event-1", "event-2", "event-3"],
    );
    assert.equal(events[0].action, "positive");
    events[0].action = "negative";
    assert.equal((await store.list())[0].action, "positive");
    assert.lengthOf(await store.list({ paperId: "candidate-1" }), 2);
    assert.lengthOf(await store.list({ recommendationId: "rec-1" }), 2);
    assert.lengthOf(
      await store.list({ paperId: "candidate-1", recommendationId: "rec-1" }),
      1,
    );
    assert.deepEqual(await store.list({ paperId: "missing" }), []);
  });

  it("rejects duplicate and invalid feedback without overwriting or appending", async function () {
    const store = new InMemoryFeedbackStore();
    await store.append(makeFeedback());
    await rejects(store.append(makeFeedback()), "Duplicate");
    await rejects(
      store.append({ ...makeFeedback(), action: "negative" }),
      "Duplicate",
    );
    await rejects(store.append({ ...makeFeedback(), eventId: " " }), "eventId");
    await rejects(
      store.append({ ...makeFeedback(), eventId: "event-2", timestamp: NaN }),
      "timestamp",
    );
    await rejects(store.list({ paperId: " " }), "paperId");
    await rejects(store.list({ recommendationId: " " }), "recommendationId");
    assert.deepEqual(await store.list(), [makeFeedback()]);
  });

  it("saves immutable impressions with full breakdown and matching profile revision", async function () {
    const store = new InMemoryImpressionStore();
    assert.isNull(await store.load("rec-1"));
    const impression = makeImpression();
    await store.save(impression);
    impression.candidates[0].scores.finalScore = 999;
    const saved = (await store.load("rec-1"))!;
    assert.deepEqual(saved, makeImpression());
    assert.equal(saved.profileId, "profile-1");
    saved.candidates[0].matchedTopicIds.push("other");
    assert.deepEqual(await store.load("rec-1"), makeImpression());
    await rejects(store.save(impression), "Duplicate");
    await rejects(
      store.save({ ...impression, recommendationId: " " }),
      "recommendationId",
    );
    await rejects(
      store.save({
        ...impression,
        recommendationId: "rec-2",
        profileVersion: 0,
      }),
      "profileVersion",
    );
    await rejects(store.load(""), "recommendationId");
    assert.isNull(await store.load("rec-2"));
    assert.deepEqual(await store.load("rec-1"), makeImpression());
  });
});
