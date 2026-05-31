import type {
  AppConfig,
  SyncJobState,
  Stats,
  SyncSettings,
  TweetRecord,
  TweetStatus,
} from '../../packages/core/src/index.ts';
import type { AppStore, SyncLogRecord, TweetImportRecord, TweetListOptions } from '../../packages/core/src/index.ts';

interface EmbeddedState {
  config: Record<string, string>;
  tweets: TweetRecord[];
  logs: SyncLogRecord[];
  nextLogId: number;
  engineState: SyncJobState;
}

const storageKey = 'x-to-bsky.embedded-store';

function createInitialState(): EmbeddedState {
  return {
    config: {},
    tweets: [],
    logs: [],
    nextLogId: 1,
    engineState: {
      running: false,
      paused: false,
      currentTweetId: null,
      startedAt: null,
    },
  };
}

function cloneTweet(tweet: TweetRecord): TweetRecord {
  return { ...tweet };
}

function parseState(raw: string | null): EmbeddedState {
  if (!raw) {
    return createInitialState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EmbeddedState>;
    return {
      config: parsed.config ?? {},
      tweets: Array.isArray(parsed.tweets) ? parsed.tweets.map(cloneTweet) : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs.map((item) => ({ ...item })) : [],
      nextLogId: typeof parsed.nextLogId === 'number' && parsed.nextLogId > 0 ? parsed.nextLogId : 1,
      engineState: parsed.engineState ?? createInitialState().engineState,
    };
  } catch {
    return createInitialState();
  }
}

function readState(): EmbeddedState {
  if (typeof window === 'undefined') {
    return createInitialState();
  }

  return parseState(window.localStorage.getItem(storageKey));
}

function writeState(state: EmbeddedState): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function withState<T>(updater: (state: EmbeddedState) => T): T {
  const state = readState();
  const result = updater(state);
  writeState(state);
  return result;
}

function normalizeTweet(row: TweetImportRecord): TweetRecord {
  return {
    id: row.id,
    text: row.text,
    created_at: row.created_at,
    is_retweet: row.is_retweet,
    is_reply: row.is_reply,
    media_urls: row.media_urls,
    status: 'pending',
    bsky_uri: null,
    error_message: null,
    synced_at: null,
  };
}

function sortTweets(tweets: TweetRecord[]): void {
  tweets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function matchesSearch(tweet: TweetRecord, search?: string): boolean {
  if (!search) return true;
  return tweet.text.toLowerCase().includes(search.toLowerCase());
}

function upsertTweet(state: EmbeddedState, next: TweetImportRecord): boolean {
  const existing = state.tweets.find((tweet) => tweet.id === next.id);

  if (!existing) {
    state.tweets.push(normalizeTweet(next));
    return true;
  }

  if (existing.status === 'pending' || existing.status === 'failed') {
    existing.text = next.text;
    existing.created_at = next.created_at;
    existing.is_retweet = next.is_retweet;
    existing.is_reply = next.is_reply;
    existing.media_urls = next.media_urls;
    return false;
  }

  return false;
}

export const embeddedStore: AppStore = {
  getAllConfig() {
    return readState().config;
  },

  setConfig(key, value) {
    withState((state) => {
      state.config[key] = value;
    });
  },

  upsertTweets(tweets) {
    return withState((state) => {
      let inserted = 0;

      for (const tweet of tweets) {
        if (upsertTweet(state, tweet)) {
          inserted += 1;
        }
      }

      sortTweets(state.tweets);
      return inserted;
    });
  },

  listTweets(options: TweetListOptions) {
    const state = readState();
    const tweets = state.tweets
      .filter((tweet) => !options.status || tweet.status === options.status)
      .filter((tweet) => matchesSearch(tweet, options.search));

    const total = tweets.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;

    return {
      tweets: tweets.slice(offset, offset + limit).map(cloneTweet),
      total,
    };
  },

  getStats() {
    const state = readState();
    const stats: Stats = {
      total: state.tweets.length,
      pending: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    };

    for (const tweet of state.tweets) {
      if (tweet.status === 'pending' || tweet.status === 'syncing') {
        stats.pending += 1;
      } else if (tweet.status === 'success') {
        stats.success += 1;
      } else if (tweet.status === 'failed') {
        stats.failed += 1;
      } else if (tweet.status === 'skipped') {
        stats.skipped += 1;
      }
    }

    return stats;
  },

  getLogs(limit = 100) {
    const state = readState();
    return state.logs.slice(0, limit).map((item) => ({ ...item }));
  },

  addLog(level, message, tweetId) {
    withState((state) => {
      state.logs.unshift({
        id: state.nextLogId,
        level,
        message,
        tweet_id: tweetId ?? null,
        created_at: new Date().toISOString(),
      });
      state.nextLogId += 1;
      if (state.logs.length > 500) {
        state.logs.length = 500;
      }
    });
  },

  clearAllTweets() {
    withState((state) => {
      state.tweets = [];
    });
  },

  resetFailedToPending() {
    return withState((state) => {
      let count = 0;
      for (const tweet of state.tweets) {
        if (tweet.status === 'failed') {
          tweet.status = 'pending';
          tweet.error_message = null;
          count += 1;
        }
      }
      return count;
    });
  },

  resetSyncingToPending() {
    return withState((state) => {
      let count = 0;
      for (const tweet of state.tweets) {
        if (tweet.status === 'syncing') {
          tweet.status = 'pending';
          tweet.error_message = null;
          count += 1;
        }
      }
      return count;
    });
  },

  skipPendingTweetsByPolicy(skipRetweets, skipReplies) {
    return withState((state) => {
      let count = 0;
      for (const tweet of state.tweets) {
        if (tweet.status !== 'pending') continue;
        if ((skipRetweets && tweet.is_retweet) || (skipReplies && tweet.is_reply)) {
          tweet.status = 'skipped';
          tweet.error_message = null;
          count += 1;
        }
      }
      return count;
    });
  },

  getNextPendingTweet(skipRetweets, skipReplies) {
    const state = readState();
    const tweet = state.tweets.find((item) => {
      if (item.status !== 'pending') return false;
      if (skipRetweets && item.is_retweet) return false;
      if (skipReplies && item.is_reply) return false;
      return true;
    });

    return tweet ? cloneTweet(tweet) : null;
  },

  updateTweetStatus(id, status, extra) {
    withState((state) => {
      const tweet = state.tweets.find((item) => item.id === id);
      if (!tweet) return;

      tweet.status = status;
      if (typeof extra?.bsky_uri !== 'undefined') {
        tweet.bsky_uri = extra.bsky_uri ?? null;
      }
      tweet.error_message = extra?.error_message ?? null;
      if (status === 'success') {
        tweet.synced_at = new Date().toISOString();
      }
    });
  },
};

export function loadEmbeddedConfig(): AppConfig {
  const config = embeddedStore.getAllConfig();
  return {
    xBearerToken: config.xBearerToken ?? '',
    xUserId: config.xUserId ?? '',
    bskyHandle: config.bskyHandle ?? '',
    bskyAppPassword: config.bskyAppPassword ?? '',
  };
}

export function loadEmbeddedSettings(): SyncSettings {
  const config = embeddedStore.getAllConfig();
  return {
    skipRetweets: config.skipRetweets !== 'false',
    skipReplies: config.skipReplies === 'true',
    dryRun: config.dryRun === 'true',
    delayMs: Number(config.delayMs) || 3000,
    addSourceTag: config.addSourceTag !== 'false',
  };
}

export function persistEmbeddedSettings(settings: Partial<SyncSettings>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'undefined') continue;
    embeddedStore.setConfig(key, String(value));
  }
}

export function persistEmbeddedConfig(config: Partial<AppConfig>): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'undefined') continue;
    embeddedStore.setConfig(key, String(value));
  }
}

export function clearEmbeddedLogs(): void {
  withState((state) => {
    state.logs = [];
    state.nextLogId = 1;
  });
}

export function getEmbeddedEngineState(): SyncJobState {
  return readState().engineState;
}

export function setEmbeddedEngineState(engineState: SyncJobState): void {
  withState((state) => {
    state.engineState = { ...engineState };
  });
}
