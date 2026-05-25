import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Stats, TweetRecord, TweetStatus } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'sync.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tweets (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_retweet INTEGER NOT NULL DEFAULT 0,
      is_reply INTEGER NOT NULL DEFAULT 0,
      media_urls TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      bsky_uri TEXT,
      error_message TEXT,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tweets_status ON tweets(status);
    CREATE INDEX IF NOT EXISTS idx_tweets_created ON tweets(created_at);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      tweet_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function upsertTweets(tweets: Omit<TweetRecord, 'status' | 'bsky_uri' | 'error_message' | 'synced_at'>[]): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO tweets (id, text, created_at, is_retweet, is_reply, media_urls)
    VALUES (@id, @text, @created_at, @is_retweet, @is_reply, @media_urls)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      created_at = excluded.created_at,
      is_retweet = excluded.is_retweet,
      is_reply = excluded.is_reply,
      media_urls = excluded.media_urls
    WHERE tweets.status = 'pending' OR tweets.status = 'failed'
  `);

  let inserted = 0;
  const tx = database.transaction(() => {
    for (const t of tweets) {
      const before = database.prepare('SELECT status FROM tweets WHERE id = ?').get(t.id) as { status: string } | undefined;
      const info = stmt.run({
        id: t.id,
        text: t.text,
        created_at: t.created_at,
        is_retweet: t.is_retweet ? 1 : 0,
        is_reply: t.is_reply ? 1 : 0,
        media_urls: t.media_urls,
      });
      if (info.changes > 0 && !before) inserted++;
    }
  });
  tx();
  return inserted;
}

function rowToTweet(row: Record<string, unknown>): TweetRecord {
  return {
    id: row.id as string,
    text: row.text as string,
    created_at: row.created_at as string,
    is_retweet: Boolean(row.is_retweet),
    is_reply: Boolean(row.is_reply),
    media_urls: row.media_urls as string,
    status: row.status as TweetStatus,
    bsky_uri: (row.bsky_uri as string) ?? null,
    error_message: (row.error_message as string) ?? null,
    synced_at: (row.synced_at as string) ?? null,
  };
}

export function listTweets(opts: {
  status?: TweetStatus;
  limit?: number;
  offset?: number;
  search?: string;
}): { tweets: TweetRecord[]; total: number } {
  const database = getDb();
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (opts.status) {
    conditions.push('status = @status');
    params.status = opts.status;
  }
  if (opts.search) {
    conditions.push('text LIKE @search');
    params.search = `%${opts.search}%`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = (database.prepare(`SELECT COUNT(*) as c FROM tweets ${where}`).get(params) as { c: number }).c;

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rows = database
    .prepare(`SELECT * FROM tweets ${where} ORDER BY created_at ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as Record<string, unknown>[];

  return { tweets: rows.map(rowToTweet), total };
}

export function getStats(): Stats {
  const database = getDb();
  const rows = database
    .prepare(`SELECT status, COUNT(*) as c FROM tweets GROUP BY status`)
    .all() as { status: string; c: number }[];

  const stats: Stats = { total: 0, pending: 0, success: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    if (r.status === 'syncing') {
      stats.pending += r.c;
    } else if (r.status === 'pending') {
      stats.pending = r.c;
    } else if (r.status === 'success') {
      stats.success = r.c;
    } else if (r.status === 'failed') {
      stats.failed = r.c;
    } else if (r.status === 'skipped') {
      stats.skipped = r.c;
    }
    stats.total += r.c;
  }
  return stats;
}

export function updateTweetStatus(
  id: string,
  status: TweetStatus,
  extra?: { bsky_uri?: string; error_message?: string }
): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE tweets SET status = @status, bsky_uri = COALESCE(@bsky_uri, bsky_uri),
       error_message = @error_message, synced_at = CASE WHEN @status = 'success' THEN datetime('now') ELSE synced_at END
       WHERE id = @id`
    )
    .run({
      id,
      status,
      bsky_uri: extra?.bsky_uri ?? null,
      error_message: extra?.error_message ?? null,
    });
}

export function getNextPendingTweet(skipRetweets: boolean, skipReplies: boolean): TweetRecord | null {
  const database = getDb();
  const conditions = ["status = 'pending'"];
  if (skipRetweets) conditions.push('is_retweet = 0');
  if (skipReplies) conditions.push('is_reply = 0');

  const row = database
    .prepare(`SELECT * FROM tweets WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT 1`)
    .get() as Record<string, unknown> | undefined;

  return row ? rowToTweet(row) : null;
}

export function resetFailedToPending(): number {
  const database = getDb();
  const info = database.prepare(`UPDATE tweets SET status = 'pending', error_message = NULL WHERE status = 'failed'`).run();
  return info.changes;
}

export function resetSyncingToPending(): number {
  const database = getDb();
  const info = database
    .prepare(`UPDATE tweets SET status = 'pending', error_message = NULL WHERE status = 'syncing'`)
    .run();
  return info.changes;
}

export function clearAllTweets(): void {
  getDb().prepare('DELETE FROM tweets').run();
}

export function setConfig(key: string, value: string): void {
  getDb().prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getConfig(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getAllConfig(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM config').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function addLog(level: string, message: string, tweetId?: string): void {
  getDb()
    .prepare('INSERT INTO sync_log (level, message, tweet_id) VALUES (?, ?, ?)')
    .run(level, message, tweetId ?? null);
}

export function getLogs(limit = 100): { id: number; level: string; message: string; tweet_id: string | null; created_at: string }[] {
  return getDb()
    .prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?')
    .all(limit) as { id: number; level: string; message: string; tweet_id: string | null; created_at: string }[];
}
