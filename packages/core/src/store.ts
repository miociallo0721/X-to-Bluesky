import type { AppConfig, Stats, SyncSettings, TweetRecord, TweetStatus } from './types.js';

export interface TweetImportRecord {
  id: string;
  text: string;
  created_at: string;
  is_retweet: boolean;
  is_reply: boolean;
  media_urls: string;
}

export interface SyncLogRecord {
  id: number;
  level: string;
  message: string;
  tweet_id: string | null;
  created_at: string;
}

export interface TweetListOptions {
  status?: TweetStatus;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface AppStore {
  getAllConfig(): Record<string, string>;
  setConfig(key: string, value: string): void;
  upsertTweets(tweets: TweetImportRecord[]): number;
  listTweets(options: TweetListOptions): { tweets: TweetRecord[]; total: number };
  getStats(): Stats;
  getLogs(limit?: number): SyncLogRecord[];
  addLog(level: string, message: string, tweetId?: string): void;
  clearAllTweets(): void;
  resetFailedToPending(): number;
  resetSyncingToPending(): number;
  skipPendingTweetsByPolicy(skipRetweets: boolean, skipReplies: boolean): number;
  getNextPendingTweet(skipRetweets: boolean, skipReplies: boolean): TweetRecord | null;
  updateTweetStatus(
    id: string,
    status: TweetStatus,
    extra?: { bsky_uri?: string; error_message?: string }
  ): void;
}

export function serializeImportedTweets(
  tweets: { id: string; text: string; created_at: string; is_retweet: boolean; is_reply: boolean; media_urls: string[] }[]
): TweetImportRecord[] {
  return tweets.map((tweet) => ({
    ...tweet,
    media_urls: JSON.stringify(tweet.media_urls),
  }));
}

export function loadConfigFromStore(store: AppStore, env: Partial<Record<string, string | undefined>>): AppConfig {
  const saved = store.getAllConfig();
  return {
    xBearerToken: saved.xBearerToken ?? env.X_BEARER_TOKEN ?? '',
    xUserId: saved.xUserId ?? env.X_USER_ID ?? '',
    bskyHandle: saved.bskyHandle ?? env.BSKY_HANDLE ?? '',
    bskyAppPassword: saved.bskyAppPassword ?? env.BSKY_APP_PASSWORD ?? '',
  };
}

export function loadSettingsFromStore(store: AppStore): SyncSettings {
  const saved = store.getAllConfig();
  return {
    skipRetweets: saved.skipRetweets !== 'false',
    skipReplies: saved.skipReplies === 'true',
    dryRun: saved.dryRun === 'true',
    delayMs: Number(saved.delayMs) || 3000,
    addSourceTag: saved.addSourceTag !== 'false',
  };
}
