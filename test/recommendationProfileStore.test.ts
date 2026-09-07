import { assert } from "chai";
import { rejects } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROFILE_SCHEMA_VERSION,
  PROFILE_TABLE,
  SqliteProfileStore,
  ProfileVersionConflict,
} from "../src/recommendation/profile/profileStore";
import { ResearchProfileTestDb } from "./helpers/researchProfileDb";
import { ProfileBuilder } from "../src/recommendation/profile/profileBuilder";
import {
  paperSignal,
  PROFILE_NOW as now,
} from "./helpers/researchProfileFixtures";

describe("production research ProfileStore (real SQLite seam)", function () {
  let db: ResearchProfileTestDb;
  let store: SqliteProfileStore;
  const profile = () =>
    new ProfileBuilder().build({ libraryID: 1, papers: [paperSignal()], now });
  beforeEach(function () {
    db = new ResearchProfileTestDb();
    store = new SqliteProfileStore(() => db);
  });
  afterEach(function () {
    db.close();
  });

  it("initializes once, creates version 1 and loads a validated round-trip snapshot", async function () {
    await Promise.all([store.initialize(), store.initialize()]);
    assert.equal(
      db.statements.filter((sql) => sql.startsWith("CREATE TABLE")).length,
      1,
    );
    assert.isNull(await store.load("library:1"));
    await store.save(profile(), null);
    assert.deepEqual(await store.load("library:1"), profile());
  });
  it("enforces create-only and exact CAS revision increments", async function () {
    const p = profile();
    await rejects(
      store.save({ ...p, version: 2 }, null),
      ProfileVersionConflict,
    );
    await store.save(p, null);
    await rejects(store.save(p, null), ProfileVersionConflict);
    for (const [version, expected] of [
      [1, 1],
      [3, 1],
      [3, 2],
      [2, 3],
    ])
      await rejects(
        store.save({ ...p, version }, expected),
        ProfileVersionConflict,
      );
    await rejects(store.save({ ...p, version: 2 }, NaN), /expectedVersion/);
    await store.save({ ...p, version: 2, updatedAt: now + 1 }, 1);
    assert.equal((await store.load(p.profileId))!.version, 2);
    const rows = (await db.queryAsync(
      `SELECT schema_version, version FROM ${PROFILE_TABLE}`,
    )) as { schema_version: number; version: number }[];
    assert.equal(rows[0].schema_version, PROFILE_SCHEMA_VERSION);
    assert.notEqual(rows[0].version, rows[0].schema_version);
  });
  it("permits exactly one competing create and one competing update across store instances", async function () {
    const second = new SqliteProfileStore(() => db);
    const p = profile();
    const creates = await Promise.allSettled([
      store.save(p, null),
      second.save(p, null),
    ]);
    assert.equal(creates.filter((r) => r.status === "fulfilled").length, 1);
    const updates = await Promise.allSettled([
      store.save({ ...p, version: 2, updatedAt: now + 1 }, 1),
      second.save({ ...p, version: 2, updatedAt: now + 2 }, 1),
    ]);
    assert.equal(updates.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await store.load(p.profileId))!.version, 2);
  });
  it("isolates caller references even before an awaited save completes", async function () {
    const p = profile();
    const pending = store.save(p, null);
    p.profileId = "mutated";
    p.topics[0].weight = 0;
    await pending;
    const loaded = (await store.load("library:1"))!;
    assert.deepEqual(loaded, profile());
    loaded.topics[0].evidenceRefs.push("injected");
    assert.deepEqual(await store.load("library:1"), profile());
    assert.isNull(await store.load("mutated"));
  });
  it("rejects invalid inputs without changing existing state", async function () {
    const p = profile();
    await store.save(p, null);
    await rejects(
      store.save(
        { ...p, version: 2, topics: [{ ...p.topics[0], confidence: 2 }] },
        1,
      ),
      /confidence/,
    );
    await rejects(store.load(" "), /profileId/);
    assert.deepEqual(await store.load(p.profileId), p);
  });
  it("rejects invalid JSON, invalid profiles, mismatched metadata and unsupported schemas", async function () {
    await store.save(profile(), null);
    for (const value of [
      "{broken",
      JSON.stringify({ ...profile(), topics: null }),
      JSON.stringify({ ...profile(), version: 2 }),
      JSON.stringify({ ...profile(), profileId: "another" }),
      JSON.stringify({ ...profile(), updatedAt: 0 }),
    ]) {
      await db.queryAsync(`UPDATE ${PROFILE_TABLE} SET profile_json = ?`, [
        value,
      ]);
      await rejects(store.load("library:1"));
      await rejects(store.save({ ...profile(), version: 2 }, 1));
    }
    await db.queryAsync(
      `UPDATE ${PROFILE_TABLE} SET profile_json = ?, schema_version = 99`,
      [JSON.stringify(profile())],
    );
    await rejects(store.load("library:1"), /schema version/);
    await rejects(
      store.save({ ...profile(), version: 2 }, 1),
      /schema version/,
    );
  });
  it("rolls back a failed write and allows retry after initialization failure", async function () {
    db.failWhen = (sql) => sql.startsWith("CREATE TABLE");
    await rejects(store.initialize(), /Injected/);
    db.failWhen = undefined;
    await store.save(profile(), null);
    db.failWhen = (sql) => sql.startsWith("SELECT changes");
    await rejects(store.save({ ...profile(), version: 2 }, 1), /Injected/);
    db.failWhen = undefined;
    assert.deepEqual(await store.load("library:1"), profile());
  });
  it("keeps library profiles isolated", async function () {
    await store.save(profile(), null);
    await store.save({ ...profile(), profileId: "library:6" }, null);
    await store.save({ ...profile(), version: 2 }, 1);
    assert.equal((await store.load("library:6"))!.version, 1);
  });
  it("survives closing and reopening an actual database file", async function () {
    const dir = mkdtempSync(join(tmpdir(), "research-profile-"));
    let disk: ResearchProfileTestDb | undefined;
    try {
      disk = new ResearchProfileTestDb(join(dir, "profiles.sqlite"));
      await new SqliteProfileStore(() => disk!).save(profile(), null);
      disk.close();
      disk = undefined;
      disk = new ResearchProfileTestDb(join(dir, "profiles.sqlite"));
      assert.deepEqual(
        await new SqliteProfileStore(() => disk!).load("library:1"),
        profile(),
      );
    } finally {
      disk?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
