import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ProfileDatabase } from "../../src/recommendation/profile/profileStore";

/** Real SQLite engine, with an async serialized transaction seam like Zotero.DB. */
export class ResearchProfileTestDb implements ProfileDatabase {
  readonly db: DatabaseSync;
  readonly statements: string[] = [];
  private transactions = Promise.resolve();
  failWhen?: (sql: string) => boolean;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
  }
  async queryAsync(sql: string, params: unknown[] = []): Promise<unknown> {
    this.statements.push(sql);
    if (this.failWhen?.(sql)) throw new Error("Injected database failure");
    const statement = this.db.prepare(sql);
    if (/^\s*(SELECT|PRAGMA)/i.test(sql))
      return statement.all(...(params as SQLInputValue[]));
    statement.run(...(params as SQLInputValue[]));
    return [];
  }
  executeTransaction<T>(task: () => Promise<T>): Promise<T> {
    const run = this.transactions.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await task();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.transactions = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  close(): void {
    this.db.close();
  }
}
