import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { getDefaultDbPath } from './paths.js';
import type { Stats, TweetRecord, TweetStatus } from './types.js';

type SqlParam = string | number | null;

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let activeDbPath: string | null = null;

function getDbPath(): string {
  return process.env.X_TO_BSKY_DB_PATH || getDefaultDbPath();
}

function ensureInitialized(): Database {
  if (!db) {
    throw new Error('数据库尚未初始化，请先调用 initDb()。');
  }
  return db;
}

function persistDb(): void {
  const database = ensureInitialized();
  const dbPath = activeDbPath ?? getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(database.export()));
}

function bindParams(stmt: { bind(params: Record<string, SqlParam> | SqlParam[]): boolean }, params?: Record<string, SqlParam> | SqlParam[]): void {
  if (!params) return;
  stmt.bind(params);
}

function queryAll<T extends Record<string, unknown>>(sql: string, params?: Record<string, SqlParam> | SqlParam[]): T[] {
  const stmt = ensureInitialized().prepare(sql);
  try {
    bindParams(stmt, params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function queryOne<T extends Record<string, unknown>>(sql: string, params?: Record<string, SqlParam> | SqlParam[]): T | null {
  return queryAll<T>(sql, params)[0] ?? null;
}

function execute(sql: string, params?: Record<string, SqlParam> | SqlParam[]): number {
  const database = ensureInitialized();
  const before = database.getRowsModified();
  const stmt = database.prepare(sql);
  try {
    bindParams(stmt, params);
    stmt.step();
  } finally {
    stmt.free();
  }
  const changes = database.getRowsModified() - before;
  persistDb();
  return changes;
}

export async function initDb(): Promise<void> {
  const dbPath = getDbPath();
  if (db && activeDbPath === dbPath) return;

  closeDb();
  SQL ??= await initSqlJs();

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const data = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
  db = data ? new SQL.Database(data) : new SQL.Database();
  activeDbPath = dbPath;
  initSchema(db);
  persistDb();
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    activeDbPath = null;
  }
}

function initSchema(database: Database): void {
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
  let inserted = 0;

  for (const t of tweets) {
    const before = queryOne<{ status: string }>('SELECT status FROM tweets WHERE id = ?', [t.id]);
    const changes = execute(
      `
        INSERT INTO tweets (id, text, created_at, is_retweet, is_reply, media_urls)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          text = excluded.text,
          created_at = excluded.created_at,
          is_retweet = excluded.is_retweet,
          is_reply = excluded.is_reply,
          media_urls = excluded.media_urls
        WHERE tweets.status = 'pending' OR tweets.status = 'failed'
      `,
      [t.id, t.text, t.created_at, t.is_retweet ? 1 : 0, t.is_reply ? 1 : 0, t.media_urls]
    );

    if (changes > 0 && !before) inserted++;
  }

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
    bsky_uri: (row.bsky_uri as string | undefined) ?? null,
    error_message: (row.error_message as string | undefined) ?? null,
    synced_at: (row.synced_at as string | undefined) ?? null,
  };
}

export function listTweets(opts: {
  status?: TweetStatus;
  limit?: number;
  offset?: number;
  search?: string;
}): { tweets: TweetRecord[]; total: number } {
  const conditions: string[] = [];
  const params: SqlParam[] = [];

  if (opts.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts.search) {
    conditions.push('text LIKE ?');
    params.push(`%${opts.search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tweets ${where}`, params)?.c ?? 0;
  const rows = queryAll<Record<string, unknown>>(
    `SELECT * FROM tweets ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    [...params, opts.limit ?? 50, opts.offset ?? 0]
  );

  return { tweets: rows.map(rowToTweet), total };
}

export function getStats(): Stats {
  const rows = queryAll<{ status: string; c: number }>('SELECT status, COUNT(*) as c FROM tweets GROUP BY status');
  const stats: Stats = { total: 0, pending: 0, success: 0, failed: 0, skipped: 0 };

  for (const r of rows) {
    if (r.status === 'syncing' || r.status === 'pending') {
      stats.pending += r.c;
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
  execute(
    `UPDATE tweets SET status = ?, bsky_uri = COALESCE(?, bsky_uri),
     error_message = ?, synced_at = CASE WHEN ? = 'success' THEN datetime('now') ELSE synced_at END
     WHERE id = ?`,
    [status, extra?.bsky_uri ?? null, extra?.error_message ?? null, status, id]
  );
}

export function getNextPendingTweet(skipRetweets: boolean, skipReplies: boolean): TweetRecord | null {
  const conditions = ["status = 'pending'"];
  if (skipRetweets) conditions.push('is_retweet = 0');
  if (skipReplies) conditions.push('is_reply = 0');

  const row = queryOne<Record<string, unknown>>(
    `SELECT * FROM tweets WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT 1`
  );

  return row ? rowToTweet(row) : null;
}

export function skipPendingTweetsByPolicy(skipRetweets: boolean, skipReplies: boolean): number {
  const skipConditions: string[] = [];
  if (skipRetweets) skipConditions.push('is_retweet = 1');
  if (skipReplies) skipConditions.push('is_reply = 1');
  if (skipConditions.length === 0) return 0;

  return execute(
    `UPDATE tweets
     SET status = 'skipped', error_message = NULL
     WHERE status = 'pending' AND (${skipConditions.join(' OR ')})`
  );
}

export function resetFailedToPending(): number {
  return execute(`UPDATE tweets SET status = 'pending', error_message = NULL WHERE status = 'failed'`);
}

export function resetSyncingToPending(): number {
  return execute(`UPDATE tweets SET status = 'pending', error_message = NULL WHERE status = 'syncing'`);
}

export function clearAllTweets(): void {
  execute('DELETE FROM tweets');
}

export function setConfig(key: string, value: string): void {
  execute('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

export function getConfig(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM config WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function getAllConfig(): Record<string, string> {
  const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM config');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function addLog(level: string, message: string, tweetId?: string): void {
  execute('INSERT INTO sync_log (level, message, tweet_id) VALUES (?, ?, ?)', [level, message, tweetId ?? null]);
}

export function getLogs(limit = 100): { id: number; level: string; message: string; tweet_id: string | null; created_at: string }[] {
  return queryAll('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?', [limit]) as {
    id: number;
    level: string;
    message: string;
    tweet_id: string | null;
    created_at: string;
  }[];
}
