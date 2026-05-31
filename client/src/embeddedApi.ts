import { CapacitorHttp } from '@capacitor/core';
import {
  createMemorySessionStore,
  createSyncController,
  maskConfig,
  parseArchiveJsonBytes,
  serializeImportedTweets,
  type AppConfig,
  type Stats,
  type SyncJobState,
  type SyncSettings,
  type TweetRecord,
  type TweetStatus,
} from '../../packages/core/src/index.ts';
import { clearSecureCredentials, getSecureCredentials, isNativeMobile, setSecureCredentials } from './mobile';
import {
  clearEmbeddedLogs,
  embeddedStore,
  getEmbeddedEngineState,
  loadEmbeddedConfig,
  loadEmbeddedSettings,
  persistEmbeddedConfig,
  persistEmbeddedSettings,
  setEmbeddedEngineState,
} from './embeddedStore';

const BSKY_MAX_GRAPHEMES = 300;
const SOURCE_TAG = '\n\n[migrated from X]';

type HttpResponseShape = {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
};

type LogRecord = { id: number; level: string; message: string; created_at: string };
type ConfigResponse = { config: AppConfig; settings: SyncSettings };
type TweetListResponse = { tweets: TweetRecord[]; total: number };
type EngineResponse = { stats: Stats; engine: SyncJobState };

type AtprotoModule = typeof import('@atproto/api');
type JsZipModule = typeof import('jszip');

interface XApiTweet {
  id: string;
  text: string;
  created_at?: string;
  referenced_tweets?: { type: string; id: string }[];
  attachments?: { media_keys?: string[] };
}

interface XApiMedia {
  media_key: string;
  url?: string;
  preview_image_url?: string;
}

interface BskySessionState {
  agent: import('@atproto/api').BskyAgent;
  handle: string;
}

const bskySessionStore = createMemorySessionStore<BskySessionState>();
let atprotoModulePromise: Promise<AtprotoModule> | null = null;
let jsZipModulePromise: Promise<JsZipModule> | null = null;

function getAtprotoModule(): Promise<AtprotoModule> {
  atprotoModulePromise ??= import('@atproto/api');
  return atprotoModulePromise;
}

function getJsZipModule(): Promise<JsZipModule> {
  jsZipModulePromise ??= import('jszip');
  return jsZipModulePromise;
}

const controller = createSyncController(
  {
    resetSyncingToPending: () => embeddedStore.resetSyncingToPending(),
    skipPendingTweetsByPolicy: (skipRetweets, skipReplies) =>
      embeddedStore.skipPendingTweetsByPolicy(skipRetweets, skipReplies),
    getNextPendingTweet: (skipRetweets, skipReplies) =>
      embeddedStore.getNextPendingTweet(skipRetweets, skipReplies),
    updateTweetStatus: (id, status, extra) => embeddedStore.updateTweetStatus(id, status, extra),
    addLog: (level, message, tweetId) => embeddedStore.addLog(level, message, tweetId),
  },
  {
    login: async (config) => loginBsky(config),
    post: async (text, options) => postToBsky(text, options),
  },
  {
    onStateChange: (state) => {
      setEmbeddedEngineState(state);
    },
  }
);

let engineRecoveryChecked = false;

async function requestJson<T>(
  url: string,
  options: { method?: string; headers?: Record<string, string>; data?: unknown } = {}
): Promise<T> {
  const response = (await CapacitorHttp.request({
    url,
    method: options.method ?? 'GET',
    headers: options.headers,
    data: options.data,
  })) as HttpResponseShape;

  if (response.status < 200 || response.status >= 300) {
    const payload = response.data as { error?: string } | string | null;
    const message =
      typeof payload === 'string'
        ? payload
        : typeof payload?.error === 'string'
          ? payload.error
          : `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return response.data as T;
}

function truncateForBsky(text: string, addSourceTag: boolean): string {
  const suffix = addSourceTag ? SOURCE_TAG : '';
  const maxBody = BSKY_MAX_GRAPHEMES - [...suffix].length;
  const chars = [...text];

  if (chars.length <= maxBody) {
    return text + suffix;
  }

  return chars.slice(0, Math.max(maxBody - 1, 0)).join('') + '…' + suffix;
}

async function loginBsky(config: AppConfig): Promise<{ handle: string; did: string }> {
  if (!config.bskyHandle || !config.bskyAppPassword) {
    throw new Error('请先填写 Bluesky handle 和 App Password。');
  }

  const current = bskySessionStore.get();
  if (current && current.handle === config.bskyHandle) {
    return {
      handle: current.agent.session?.handle ?? config.bskyHandle,
      did: current.agent.session?.did ?? '',
    };
  }

  const { BskyAgent } = await getAtprotoModule();
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  const session = await agent.login({
    identifier: config.bskyHandle,
    password: config.bskyAppPassword,
  });

  bskySessionStore.set({ agent, handle: config.bskyHandle });
  return { handle: session.data.handle, did: session.data.did };
}

async function postToBsky(
  text: string,
  options: { addSourceTag: boolean; dryRun: boolean }
): Promise<{ uri: string; cid: string } | { dryRun: true }> {
  const body = truncateForBsky(text, options.addSourceTag);

  if (options.dryRun) {
    return { dryRun: true };
  }

  const session = bskySessionStore.get();
  if (!session) {
    throw new Error('请先登录 Bluesky。');
  }

  const { RichText } = await getAtprotoModule();
  const richText = new RichText({ text: body });
  await richText.detectFacets(session.agent);
  const result = await session.agent.post({
    text: richText.text,
    facets: richText.facets,
    createdAt: new Date().toISOString(),
  });

  return { uri: result.uri, cid: result.cid };
}

async function resolveConfig(): Promise<AppConfig> {
  const config = loadEmbeddedConfig();
  const credentials = await getSecureCredentials();

  return {
    ...config,
    xBearerToken: credentials.xBearerToken || config.xBearerToken,
    bskyAppPassword: credentials.bskyAppPassword || config.bskyAppPassword,
  };
}

async function saveConfig(
  body: { config?: Partial<AppConfig>; settings?: Partial<SyncSettings> }
): Promise<ConfigResponse> {
  const current = await resolveConfig();
  const nextConfig: Partial<AppConfig> = { ...body.config };
  const nextCredentials = {
    xBearerToken:
      typeof body.config?.xBearerToken !== 'undefined' ? body.config.xBearerToken : current.xBearerToken,
    bskyAppPassword:
      typeof body.config?.bskyAppPassword !== 'undefined'
        ? body.config.bskyAppPassword
        : current.bskyAppPassword,
  };

  if (
    typeof body.config?.xBearerToken !== 'undefined' ||
    typeof body.config?.bskyAppPassword !== 'undefined'
  ) {
    await setSecureCredentials(nextCredentials);
  }

  delete nextConfig.xBearerToken;
  delete nextConfig.bskyAppPassword;

  persistEmbeddedConfig(nextConfig);
  if (body.settings) {
    persistEmbeddedSettings(body.settings);
  }
  bskySessionStore.clear();

  return {
    config: maskConfig(await resolveConfig()),
    settings: loadEmbeddedSettings(),
  };
}

async function lookupUser(username: string, bearerToken?: string): Promise<{ userId: string }> {
  const token = bearerToken || (await resolveConfig()).xBearerToken;
  const cleanUsername = username.replace(/^@/, '').trim();

  if (!token) {
    throw new Error('请先填写 X Bearer Token。');
  }
  if (!cleanUsername) {
    throw new Error('请输入 X 用户名。');
  }

  const result = await requestJson<{ data?: { id?: string } }>(
    `https://api.x.com/2/users/by/username/${cleanUsername}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!result.data?.id) {
    throw new Error('没有找到对应的 X 用户。');
  }

  persistEmbeddedConfig({ xUserId: result.data.id });
  return { userId: result.data.id };
}

async function fetchFromX(): Promise<{ imported: number; newCount: number; stats: Stats }> {
  const config = await resolveConfig();
  if (!config.xBearerToken || !config.xUserId) {
    throw new Error('请先填写 X Bearer Token 和 User ID。');
  }

  const tweets: {
    id: string;
    text: string;
    created_at: string;
    is_retweet: boolean;
    is_reply: boolean;
    media_urls: string[];
  }[] = [];

  let nextToken: string | undefined;
  let pages = 0;

  while (pages < 50) {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,referenced_tweets,attachments,entities',
      expansions: 'attachments.media_keys',
      'media.fields': 'url,preview_image_url,type',
      exclude: 'retweets',
    });
    if (nextToken) {
      params.set('pagination_token', nextToken);
    }

    const data = await requestJson<{
      data?: XApiTweet[];
      includes?: { media?: XApiMedia[] };
      meta?: { next_token?: string };
    }>(`https://api.x.com/2/users/${config.xUserId}/tweets?${params.toString()}`, {
      headers: { Authorization: `Bearer ${config.xBearerToken}` },
    });

    const mediaMap = new Map<string, XApiMedia>();
    for (const media of data.includes?.media ?? []) {
      mediaMap.set(media.media_key, media);
    }

    for (const tweet of data.data ?? []) {
      const mediaUrls = (tweet.attachments?.media_keys ?? [])
        .map((key) => mediaMap.get(key))
        .map((media) => media?.url ?? media?.preview_image_url)
        .filter((value): value is string => Boolean(value));

      tweets.push({
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at ?? new Date().toISOString(),
        is_retweet: tweet.referenced_tweets?.some((item) => item.type === 'retweeted') ?? false,
        is_reply: tweet.referenced_tweets?.some((item) => item.type === 'replied_to') ?? false,
        media_urls: mediaUrls,
      });
    }

    nextToken = data.meta?.next_token;
    pages += 1;

    if (!nextToken) {
      break;
    }
  }

  tweets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const newCount = embeddedStore.upsertTweets(serializeImportedTweets(tweets));
  embeddedStore.addLog('info', `从 X API 导入了 ${tweets.length} 条推文，其中新增 ${newCount} 条。`);

  return {
    imported: tweets.length,
    newCount,
    stats: embeddedStore.getStats(),
  };
}

async function readArchive(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

async function importArchive(file: File): Promise<{ imported: number; newCount: number; stats: Stats }> {
  const bytes = await readArchive(file);
  let tweets;

  if (file.name.toLowerCase().endsWith('.zip')) {
    const { default: JSZip } = await getJsZipModule();
    const zip = await JSZip.loadAsync(bytes);
    const target =
      zip.file(/(^|\/)tweets\.js$/i)[0] ??
      zip.file(/(^|\/)tweet\.js$/i)[0] ??
      zip.file(/(^|\/)tweets\.json$/i)[0];

    if (!target) {
      throw new Error('压缩包中未找到 tweets.js 或 tweets.json。');
    }

    tweets = parseArchiveJsonBytes(new Uint8Array(await target.async('uint8array')));
  } else {
    tweets = parseArchiveJsonBytes(bytes);
  }

  const newCount = embeddedStore.upsertTweets(serializeImportedTweets(tweets));
  embeddedStore.addLog('info', `从归档中导入了 ${tweets.length} 条推文，其中新增 ${newCount} 条。`);

  return {
    imported: tweets.length,
    newCount,
    stats: embeddedStore.getStats(),
  };
}

function getStats(): EngineResponse {
  if (!engineRecoveryChecked) {
    const persisted = getEmbeddedEngineState();
    engineRecoveryChecked = true;

    if (persisted.running || persisted.paused || persisted.currentTweetId || persisted.startedAt) {
      embeddedStore.resetSyncingToPending();
      embeddedStore.addLog('info', '检测到上次同步未正常结束，已将进行中的项目恢复为待同步。');
      setEmbeddedEngineState({
        running: false,
        paused: false,
        currentTweetId: null,
        startedAt: null,
      });
    }
  }

  return {
    stats: embeddedStore.getStats(),
    engine: controller.getState(),
  };
}

function getTweets(params: { status?: TweetStatus; search?: string; limit?: number; offset?: number }): TweetListResponse {
  return embeddedStore.listTweets(params);
}

function getLogs(): { logs: LogRecord[] } {
  return {
    logs: embeddedStore.getLogs(100).map((item) => ({
      id: item.id,
      level: item.level,
      message: item.message,
      created_at: item.created_at,
    })),
  };
}

async function testBskyLogin(): Promise<{ handle: string; did: string }> {
  return loginBsky(await resolveConfig());
}

async function startSync(): Promise<{ ok: true; message: string }> {
  if (controller.getState().running) {
    throw new Error('同步任务已经在运行中了。');
  }

  clearEmbeddedLogs();
  embeddedStore.resetSyncingToPending();
  void controller.start(await resolveConfig(), loadEmbeddedSettings());
  return { ok: true, message: '同步已启动。' };
}

async function pauseSync(): Promise<{ ok: true }> {
  controller.pause();
  return { ok: true };
}

async function resumeSync(): Promise<{ ok: true }> {
  controller.resume();
  return { ok: true };
}

async function stopSync(): Promise<{ ok: true }> {
  controller.stop();
  return { ok: true };
}

async function resetFailed(): Promise<{ reset: number }> {
  return { reset: embeddedStore.resetFailedToPending() };
}

async function clearTweets(): Promise<{ ok: true }> {
  if (controller.getState().running) {
    throw new Error('请先停止同步，再清空数据。');
  }

  embeddedStore.clearAllTweets();
  embeddedStore.addLog('info', '已清空所有推文记录。');
  return { ok: true };
}

async function clearLocalCredentials(): Promise<void> {
  await clearSecureCredentials();
  persistEmbeddedConfig({
    xBearerToken: '',
    bskyAppPassword: '',
    xUserId: '',
    bskyHandle: '',
  });
  bskySessionStore.clear();
}

export const embeddedApi = {
  isEnabled(): boolean {
    return isNativeMobile();
  },

  async getConfig(): Promise<ConfigResponse> {
    return {
      config: maskConfig(await resolveConfig()),
      settings: loadEmbeddedSettings(),
    };
  },

  saveConfig,
  lookupUser,
  fetchFromX,
  importArchive,
  getStats,
  getTweets,
  getLogs,
  testBskyLogin,
  startSync,
  pauseSync,
  resumeSync,
  stopSync,
  resetFailed,
  clearTweets,
  clearLocalCredentials,
};
