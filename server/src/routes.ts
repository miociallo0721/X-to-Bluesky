import { Router } from 'express';
import multer from 'multer';
import * as db from './db.js';
import type { AppConfig, SyncSettings, TweetStatus } from './types.js';
import { parseArchiveJson, parseArchiveZip } from './services/archiveParser.js';
import { loginBsky, resetBskySession } from './services/bskyClient.js';
import * as syncEngine from './services/syncEngine.js';
import { fetchTweetsFromApi, lookupUserId } from './services/xClient.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
const SECRET_MASK_PREFIX = '********';

export const router = Router();

function maskSecret(value: string): string {
  return `${SECRET_MASK_PREFIX}${value.slice(-4)}`;
}

function isMaskedSecret(value: string): boolean {
  return value.startsWith(SECRET_MASK_PREFIX);
}

function maskConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    xBearerToken: config.xBearerToken ? maskSecret(config.xBearerToken) : '',
    bskyAppPassword: config.bskyAppPassword ? maskSecret(config.bskyAppPassword) : '',
  };
}

function loadAppConfig(): AppConfig {
  const saved = db.getAllConfig();
  return {
    xBearerToken: saved.xBearerToken ?? process.env.X_BEARER_TOKEN ?? '',
    xUserId: saved.xUserId ?? process.env.X_USER_ID ?? '',
    bskyHandle: saved.bskyHandle ?? process.env.BSKY_HANDLE ?? '',
    bskyAppPassword: saved.bskyAppPassword ?? process.env.BSKY_APP_PASSWORD ?? '',
  };
}

function loadSyncSettings(): SyncSettings {
  const saved = db.getAllConfig();
  return {
    skipRetweets: saved.skipRetweets !== 'false',
    skipReplies: saved.skipReplies === 'true',
    dryRun: saved.dryRun === 'true',
    delayMs: Number(saved.delayMs) || 3000,
    addSourceTag: saved.addSourceTag !== 'false',
  };
}

function persistConfig(config?: Partial<AppConfig>): void {
  if (!config) return;

  for (const [key, rawValue] of Object.entries(config)) {
    const value = String(rawValue ?? '');
    if ((key === 'xBearerToken' || key === 'bskyAppPassword') && isMaskedSecret(value)) {
      continue;
    }
    db.setConfig(key, value.trim());
  }
}

function persistSettings(settings?: Partial<SyncSettings>): void {
  if (!settings) return;

  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'undefined') continue;
    db.setConfig(key, String(value));
  }
}

router.get('/api/health', (_req, res) => {
  res.json({ ok: true, engine: syncEngine.getEngineState() });
});

router.get('/api/config', (_req, res) => {
  res.json({ config: maskConfig(loadAppConfig()), settings: loadSyncSettings() });
});

router.post('/api/config', (req, res) => {
  const { config, settings } = req.body as {
    config?: Partial<AppConfig>;
    settings?: Partial<SyncSettings>;
  };

  persistConfig(config);
  persistSettings(settings);
  resetBskySession();

  res.json({ ok: true, config: maskConfig(loadAppConfig()), settings: loadSyncSettings() });
});

router.post('/api/x/lookup-user', async (req, res) => {
  try {
    const { username, bearerToken } = req.body as { username: string; bearerToken?: string };
    const token = bearerToken || loadAppConfig().xBearerToken;
    if (!token) {
      throw new Error('请先填写 X Bearer Token。');
    }

    const userId = await lookupUserId(username, token);
    db.setConfig('xUserId', userId);
    res.json({ userId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/x/fetch', async (_req, res) => {
  try {
    const tweets = await fetchTweetsFromApi(loadAppConfig());
    const count = db.upsertTweets(
      tweets.map((tweet) => ({
        ...tweet,
        media_urls: JSON.stringify(tweet.media_urls),
      }))
    );

    db.addLog('info', `从 X API 导入了 ${tweets.length} 条推文，其中新增 ${count} 条。`);
    res.json({ imported: tweets.length, newCount: count, stats: db.getStats() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/x/import-archive', upload.single('archive'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '请上传 .zip 或 .json 文件。' });
      return;
    }

    const tweets =
      req.file.originalname.endsWith('.zip')
        ? parseArchiveZip(req.file.buffer)
        : parseArchiveJson(req.file.buffer);

    const count = db.upsertTweets(
      tweets.map((tweet) => ({
        ...tweet,
        media_urls: JSON.stringify(tweet.media_urls),
      }))
    );

    db.addLog('info', `从归档中导入了 ${tweets.length} 条推文，其中新增 ${count} 条。`);
    res.json({ imported: tweets.length, newCount: count, stats: db.getStats() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/api/tweets', (req, res) => {
  const status = req.query.status as TweetStatus | undefined;
  const search = req.query.search as string | undefined;
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;

  res.json(
    db.listTweets({
      status,
      search,
      limit,
      offset,
    })
  );
});

router.get('/api/stats', (_req, res) => {
  res.json({ stats: db.getStats(), engine: syncEngine.getEngineState() });
});

router.get('/api/logs', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json({ logs: db.getLogs(limit) });
});

router.post('/api/bsky/test-login', async (_req, res) => {
  try {
    const info = await loginBsky(loadAppConfig());
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/sync/start', (_req, res) => {
  if (syncEngine.getEngineState().running) {
    res.status(409).json({ error: '同步任务已经在运行中了。' });
    return;
  }

  void syncEngine.startSync(loadAppConfig(), loadSyncSettings());
  res.json({ ok: true, message: '同步已启动。' });
});

router.post('/api/sync/pause', (_req, res) => {
  syncEngine.pauseSync();
  res.json({ ok: true });
});

router.post('/api/sync/resume', (_req, res) => {
  syncEngine.resumeSync();
  res.json({ ok: true });
});

router.post('/api/sync/stop', (_req, res) => {
  syncEngine.stopSync();
  res.json({ ok: true });
});

router.post('/api/tweets/reset-failed', (_req, res) => {
  const count = db.resetFailedToPending();
  res.json({ reset: count });
});

router.delete('/api/tweets', (_req, res) => {
  if (syncEngine.getEngineState().running) {
    res.status(409).json({ error: '请先停止同步，再清空数据。' });
    return;
  }

  db.clearAllTweets();
  db.addLog('info', '已清空所有推文记录。');
  res.json({ ok: true });
});
