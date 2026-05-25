const BASE = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }
  return data as T;
}

export type TweetStatus = 'pending' | 'syncing' | 'success' | 'failed' | 'skipped';

export interface Stats {
  total: number;
  pending: number;
  success: number;
  failed: number;
  skipped: number;
}

export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  is_retweet: boolean;
  is_reply: boolean;
  media_urls: string;
  status: TweetStatus;
  bsky_uri: string | null;
  error_message: string | null;
}

export interface EngineState {
  running: boolean;
  paused: boolean;
  currentTweetId: string | null;
  startedAt: string | null;
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

export interface ConfigResponse {
  config: AppConfig;
  settings: SyncSettings;
}

export const api = {
  getConfig: () => request<ConfigResponse>('/api/config'),
  saveConfig: (body: { config?: Partial<AppConfig>; settings?: Partial<SyncSettings> }) =>
    request<ConfigResponse>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  lookupUser: (username: string, bearerToken?: string) =>
    request<{ userId: string }>('/api/x/lookup-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, bearerToken }),
    }),
  fetchFromX: () => request<{ imported: number; newCount: number; stats: Stats }>('/api/x/fetch', { method: 'POST' }),
  importArchive: async (file: File) => {
    const formData = new FormData();
    formData.append('archive', file);
    const res = await fetch('/api/x/import-archive', { method: 'POST', body: formData });
    const data = (await res.json()) as { error?: string; imported: number; newCount: number; stats: Stats };
    if (!res.ok) {
      throw new Error(data.error ?? '导入归档失败。');
    }
    return data;
  },
  getStats: () => request<{ stats: Stats; engine: EngineState }>('/api/stats'),
  getTweets: (params: { status?: TweetStatus; search?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    return request<{ tweets: Tweet[]; total: number }>(`/api/tweets?${query.toString()}`);
  },
  getLogs: () => request<{ logs: { id: number; level: string; message: string; created_at: string }[] }>('/api/logs'),
  testBskyLogin: () => request<{ handle: string; did: string }>('/api/bsky/test-login', { method: 'POST' }),
  startSync: () => request<{ ok: true; message: string }>('/api/sync/start', { method: 'POST' }),
  pauseSync: () => request<{ ok: true }>('/api/sync/pause', { method: 'POST' }),
  resumeSync: () => request<{ ok: true }>('/api/sync/resume', { method: 'POST' }),
  stopSync: () => request<{ ok: true }>('/api/sync/stop', { method: 'POST' }),
  resetFailed: () => request<{ reset: number }>('/api/tweets/reset-failed', { method: 'POST' }),
  clearTweets: () => request<{ ok: true }>('/api/tweets', { method: 'DELETE' }),
};
