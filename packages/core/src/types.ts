export type TweetStatus = 'pending' | 'syncing' | 'success' | 'failed' | 'skipped';

export interface TweetRecord {
  id: string;
  text: string;
  created_at: string;
  is_retweet: boolean;
  is_reply: boolean;
  media_urls: string;
  status: TweetStatus;
  bsky_uri: string | null;
  error_message: string | null;
  synced_at: string | null;
}

export interface SyncSettings {
  skipRetweets: boolean;
  skipReplies: boolean;
  dryRun: boolean;
  delayMs: number;
  addSourceTag: boolean;
}

export interface AppConfig {
  xBearerToken: string;
  xUserId: string;
  bskyHandle: string;
  bskyAppPassword: string;
}

export interface SyncJobState {
  running: boolean;
  paused: boolean;
  currentTweetId: string | null;
  startedAt: string | null;
}

export interface Stats {
  total: number;
  pending: number;
  success: number;
  failed: number;
  skipped: number;
}
