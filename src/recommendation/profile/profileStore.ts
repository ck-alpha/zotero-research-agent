import type { ResearchProfile } from "../domain/profile";
import type { ProfileStore } from "../domain/stores";
import { assertNonEmptyId, assertResearchProfile } from "../domain/validation";

export const PROFILE_TABLE = "llm_for_zotero_research_profiles";
export const PROFILE_SCHEMA_VERSION = 1;

/** Small Zotero.DB seam, also exercised against real SQLite in Node tests. */
export interface ProfileDatabase {
  queryAsync(sql: string, params?: unknown[]): Promise<unknown>;
  executeTransaction<T>(task: () => Promise<T>): Promise<T>;
}

type ProfileRow = {
  profile_id: string;
  version: number;
  schema_version: number;
  profile_json: string;
  updated_at: number;
};

export class ProfileVersionConflict extends Error {
  constructor() {
    super("Profile version conflict; reload the profile and retry explicitly");
  }
}

function productionDb(): ProfileDatabase {
  const db = (globalThis as unknown as { Zotero?: { DB?: ProfileDatabase } })
    .Zotero?.DB;
  if (!db?.queryAsync || !db.executeTransaction)
    throw new Error("Persistent ResearchProfile storage requires Zotero.DB");
  return db;
}

export class SqliteProfileStore implements ProfileStore {
  private initialization: Promise<void> | undefined;
  constructor(private readonly getDb: () => ProfileDatabase = productionDb) {}

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        const db = this.getDb();
        await db.queryAsync(`CREATE TABLE IF NOT EXISTS ${PROFILE_TABLE} (
          profile_id TEXT PRIMARY KEY NOT NULL,
          version INTEGER NOT NULL CHECK(version >= 1),
          schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
          profile_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
        )`);
      })().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  private async read(
    db: ProfileDatabase,
    profileId: string,
  ): Promise<ResearchProfile | null> {
    const rows = (await db.queryAsync(
      `SELECT profile_id, version, schema_version, profile_json, updated_at FROM ${PROFILE_TABLE} WHERE profile_id = ?`,
      [profileId],
    )) as ProfileRow[];
    if (!rows.length) return null;
    const row = rows[0];
    if (row.schema_version !== PROFILE_SCHEMA_VERSION)
      throw new Error("Unsupported ResearchProfile schema version");
    const profile: unknown = JSON.parse(row.profile_json);
    assertResearchProfile(profile);
    if (
      profile.profileId !== profileId ||
      row.profile_id !== profileId ||
      profile.version !== row.version ||
      profile.updatedAt !== row.updated_at
    )
      throw new Error("Corrupt ResearchProfile row metadata");
    return profile;
  }

  async load(profileId: string): Promise<ResearchProfile | null> {
    assertNonEmptyId(profileId, "profileId");
    await this.initialize();
    return this.read(this.getDb(), profileId);
  }

  async save(
    profile: ResearchProfile,
    expectedVersion: number | null,
  ): Promise<void> {
    assertResearchProfile(profile);
    if (
      expectedVersion !== null &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    )
      throw new TypeError("Invalid expectedVersion");
    if (profile.version !== (expectedVersion ?? 0) + 1)
      throw new ProfileVersionConflict();
    // Detach before any await; a caller can mutate the original while DB initialization waits.
    const json = JSON.stringify(profile);
    const snapshot: ResearchProfile = JSON.parse(json);
    await this.initialize();
    const db = this.getDb();
    await db.executeTransaction(async () => {
      const current = await this.read(db, snapshot.profileId);
      if ((current?.version ?? null) !== expectedVersion)
        throw new ProfileVersionConflict();
      if (expectedVersion === null) {
        await db.queryAsync(
          `INSERT OR IGNORE INTO ${PROFILE_TABLE} (profile_id, version, schema_version, profile_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [
            snapshot.profileId,
            snapshot.version,
            PROFILE_SCHEMA_VERSION,
            json,
            snapshot.updatedAt,
          ],
        );
      } else {
        await db.queryAsync(
          `UPDATE ${PROFILE_TABLE} SET version = ?, profile_json = ?, updated_at = ? WHERE profile_id = ? AND version = ? AND schema_version = ?`,
          [
            snapshot.version,
            json,
            snapshot.updatedAt,
            snapshot.profileId,
            expectedVersion,
            PROFILE_SCHEMA_VERSION,
          ],
        );
      }
      // Same connection and transaction as the conditional write, no load/save gap.
      const changes = (await db.queryAsync("SELECT changes() AS changed")) as {
        changed: number;
      }[];
      if (changes[0]?.changed !== 1) throw new ProfileVersionConflict();
    });
  }
}
