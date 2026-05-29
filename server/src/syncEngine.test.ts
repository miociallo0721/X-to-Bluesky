import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as db from './db.js';
import { startSync } from './services/syncEngine.js';

function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-to-bsky-'));
  process.env.X_TO_BSKY_DB_PATH = path.join(dir, 'test.db');

  return () => {
    db.closeDb();
    delete process.env.X_TO_BSKY_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

test('dry-run sync succeeds without Bluesky credentials and marks policy skips', async () => {
  const cleanup = useTempDb();
  try {
    await db.initDb();
    db.upsertTweets([
      {
        id: '1',
        text: 'hello bsky',
        created_at: '2020-01-01T00:00:00.000Z',
        is_retweet: false,
        is_reply: false,
        media_urls: '[]',
      },
      {
        id: '2',
        text: 'reply',
        created_at: '2020-01-02T00:00:00.000Z',
        is_retweet: false,
        is_reply: true,
        media_urls: '[]',
      },
      {
        id: '3',
        text: 'retweet',
        created_at: '2020-01-03T00:00:00.000Z',
        is_retweet: true,
        is_reply: false,
        media_urls: '[]',
      },
    ]);

    await startSync(
      { xBearerToken: '', xUserId: '', bskyHandle: '', bskyAppPassword: '' },
      { skipRetweets: true, skipReplies: true, dryRun: true, delayMs: 0, addSourceTag: true }
    );

    const stats = db.getStats();
    assert.deepEqual(stats, { total: 3, pending: 0, success: 1, failed: 0, skipped: 2 });

    const { tweets } = db.listTweets({ limit: 10 });
    assert.equal(tweets.find((tweet) => tweet.id === '1')?.bsky_uri, 'dry-run');
    assert.equal(tweets.find((tweet) => tweet.id === '2')?.status, 'skipped');
    assert.equal(tweets.find((tweet) => tweet.id === '3')?.status, 'skipped');
  } finally {
    cleanup();
  }
});
