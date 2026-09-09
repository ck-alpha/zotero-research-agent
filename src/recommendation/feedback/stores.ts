import type { RecommendationImpression } from "../domain/recommendation";
import type { RecommendationFeedback } from "../domain/feedback";
import type {
  FeedbackQuery,
  FeedbackStore,
  ImpressionStore,
} from "../domain/stores";
import {
  assertNonEmptyId,
  assertRecommendationFeedback,
  assertRecommendationImpression,
} from "../domain/validation";
import { productionDb, type ProfileDatabase } from "../profile/profileStore";

export const IMPRESSION_TABLE = "llm_for_zotero_recommendation_impressions";
export const FEEDBACK_TABLE = "llm_for_zotero_recommendation_feedback";
export const IMPRESSION_SCHEMA_VERSION = 1;
export const FEEDBACK_SCHEMA_VERSION = 1;

/** Scoped repository extension: profile identity is row metadata, not model input. */
export interface ScopedFeedbackStore extends Omit<FeedbackStore, "append"> {
  append(event: RecommendationFeedback, profileId: string): Promise<void>;
  load(eventId: string): Promise<RecommendationFeedback | null>;
  list(
    query?: FeedbackQuery & { profileId?: string },
  ): Promise<RecommendationFeedback[]>;
}

abstract class SqliteMemoryStore {
  private initialization?: Promise<void>;
  constructor(protected readonly getDb: () => ProfileDatabase = productionDb) {}
  protected abstract schema(): string[];
  async initialize(): Promise<void> {
    if (!this.initialization)
      this.initialization = (async () => {
        for (const sql of this.schema()) await this.getDb().queryAsync(sql);
      })().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    await this.initialization;
  }
}

type Row = Record<string, string | number>;
export class SqliteImpressionStore
  extends SqliteMemoryStore
  implements ImpressionStore
{
  protected schema() {
    return [
      `CREATE TABLE IF NOT EXISTS ${IMPRESSION_TABLE} (
    recommendation_id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
    profile_version INTEGER NOT NULL, timestamp INTEGER NOT NULL,
    schema_version INTEGER NOT NULL, impression_json TEXT NOT NULL)`,
    ];
  }
  async save(impression: RecommendationImpression): Promise<void> {
    assertRecommendationImpression(impression);
    if (!impression.topicSnapshot)
      throw new TypeError("Impression requires durable topicSnapshot");
    const json = JSON.stringify(impression);
    const p: RecommendationImpression = JSON.parse(json);
    await this.initialize();
    await this.getDb().queryAsync(
      `INSERT INTO ${IMPRESSION_TABLE} (recommendation_id, profile_id, profile_version, timestamp, schema_version, impression_json) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        p.recommendationId,
        p.profileId,
        p.profileVersion,
        p.timestamp,
        IMPRESSION_SCHEMA_VERSION,
        json,
      ],
    );
  }
  async load(id: string): Promise<RecommendationImpression | null> {
    assertNonEmptyId(id);
    await this.initialize();
    const rows = (await this.getDb().queryAsync(
      `SELECT * FROM ${IMPRESSION_TABLE} WHERE recommendation_id = ?`,
      [id],
    )) as Row[];
    if (!rows.length) return null;
    const r = rows[0];
    if (r.schema_version !== IMPRESSION_SCHEMA_VERSION)
      throw new Error("Unsupported impression schema");
    const p: unknown = JSON.parse(String(r.impression_json));
    assertRecommendationImpression(p);
    if (
      !p.topicSnapshot ||
      p.recommendationId !== id ||
      r.recommendation_id !== id ||
      p.profileId !== r.profile_id ||
      p.profileVersion !== r.profile_version ||
      p.timestamp !== r.timestamp
    )
      throw new Error("Corrupt impression metadata");
    return p;
  }
}

export class SqliteFeedbackStore
  extends SqliteMemoryStore
  implements ScopedFeedbackStore
{
  protected schema() {
    return [
      `CREATE TABLE IF NOT EXISTS ${FEEDBACK_TABLE} (event_id TEXT PRIMARY KEY NOT NULL,
    recommendation_id TEXT NOT NULL, paper_id TEXT NOT NULL, action TEXT NOT NULL,
    timestamp INTEGER NOT NULL, profile_id TEXT NOT NULL, schema_version INTEGER NOT NULL,
    feedback_json TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS llm_recommendation_feedback_profile ON ${FEEDBACK_TABLE}(profile_id)`,
      `CREATE INDEX IF NOT EXISTS llm_recommendation_feedback_recommendation ON ${FEEDBACK_TABLE}(recommendation_id)`,
      `CREATE INDEX IF NOT EXISTS llm_recommendation_feedback_paper ON ${FEEDBACK_TABLE}(paper_id)`,
    ];
  }
  async append(
    event: RecommendationFeedback,
    profileId?: string,
  ): Promise<void> {
    assertRecommendationFeedback(event);
    assertNonEmptyId(profileId, "profileId");
    const json = JSON.stringify(event);
    const e: RecommendationFeedback = JSON.parse(json);
    await this.initialize();
    await this.getDb().queryAsync(
      `INSERT INTO ${FEEDBACK_TABLE} (event_id, recommendation_id, paper_id, action, timestamp, profile_id, schema_version, feedback_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.eventId,
        e.recommendationId,
        e.paperId,
        e.action,
        e.timestamp,
        profileId,
        FEEDBACK_SCHEMA_VERSION,
        json,
      ],
    );
  }
  private decode(r: Row): RecommendationFeedback {
    if (r.schema_version !== FEEDBACK_SCHEMA_VERSION)
      throw new Error("Unsupported feedback schema");
    const e: unknown = JSON.parse(String(r.feedback_json));
    assertRecommendationFeedback(e);
    assertNonEmptyId(r.profile_id);
    if (
      e.eventId !== r.event_id ||
      e.recommendationId !== r.recommendation_id ||
      e.paperId !== r.paper_id ||
      e.action !== r.action ||
      e.timestamp !== r.timestamp
    )
      throw new Error("Corrupt feedback metadata");
    return e;
  }
  async load(id: string): Promise<RecommendationFeedback | null> {
    assertNonEmptyId(id);
    await this.initialize();
    const rows = (await this.getDb().queryAsync(
      `SELECT * FROM ${FEEDBACK_TABLE} WHERE event_id = ?`,
      [id],
    )) as Row[];
    return rows.length ? this.decode(rows[0]) : null;
  }
  async list(
    query: FeedbackQuery & { profileId?: string } = {},
  ): Promise<RecommendationFeedback[]> {
    const columns = {
      paperId: "paper_id",
      recommendationId: "recommendation_id",
      profileId: "profile_id",
    };
    const filters: string[] = [],
      params: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (!Object.hasOwn(columns, key))
        throw new TypeError("Invalid feedback query");
      assertNonEmptyId(value);
      filters.push(`${columns[key as keyof typeof columns]} = ?`);
      params.push(value);
    }
    await this.initialize();
    const rows = (await this.getDb().queryAsync(
      `SELECT * FROM ${FEEDBACK_TABLE}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY rowid`,
      params,
    )) as Row[];
    return rows.map((r) => this.decode(r));
  }
}
