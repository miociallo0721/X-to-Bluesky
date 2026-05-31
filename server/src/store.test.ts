import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfigFromStore, loadSettingsFromStore, serializeImportedTweets, type AppStore } from '../../packages/core/src/index.js';

function createMockStore(config: Record<string, string>): AppStore {
  return {
    getAllConfig: () => ({ ...config }),
    setConfig: (key, value) => {
      config[key] = value;
    },
    upsertTweets: () => 0,
    listTweets: () => ({ tweets: [], total: 0 }),
    getStats: () => ({ total: 0, pending: 0, success: 0, failed: 0, skipped: 0 }),
    getLogs: () => [],
    addLog: () => {},
    clearAllTweets: () => {},
    resetFailedToPending: () => 0,
    resetSyncingToPending: () => 0,
    skipPendingTweetsByPolicy: () => 0,
    getNextPendingTweet: () => null,
    updateTweetStatus: () => {},
  };
}

test('store helpers resolve config and settings from store data', () => {
  const store = createMockStore({
    xBearerToken: 'saved-token',
    bskyHandle: 'saved.bsky.social',
    skipRetweets: 'false',
    dryRun: 'true',
    delayMs: '1500',
  });

  const config = loadConfigFromStore(store, {
    X_USER_ID: 'env-user-id',
    BSKY_APP_PASSWORD: 'env-password',
  });
  const settings = loadSettingsFromStore(store);

  assert.deepEqual(config, {
    xBearerToken: 'saved-token',
    xUserId: 'env-user-id',
    bskyHandle: 'saved.bsky.social',
    bskyAppPassword: 'env-password',
  });
  assert.deepEqual(settings, {
    skipRetweets: false,
    skipReplies: false,
    dryRun: true,
    delayMs: 1500,
    addSourceTag: true,
  });
});

test('serializeImportedTweets converts media url arrays to persisted strings', () => {
  const serialized = serializeImportedTweets([
    {
      id: '1',
      text: 'hello',
      created_at: '2020-01-01T00:00:00.000Z',
      is_retweet: false,
      is_reply: false,
      media_urls: ['https://example.com/a.jpg'],
    },
  ]);

  assert.deepEqual(serialized, [
    {
      id: '1',
      text: 'hello',
      created_at: '2020-01-01T00:00:00.000Z',
      is_retweet: false,
      is_reply: false,
      media_urls: '["https://example.com/a.jpg"]',
    },
  ]);
});
