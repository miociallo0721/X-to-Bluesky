import { Router } from 'express';
import multer from 'multer';
import {
  loadSettingsFromStore,
  maskConfig,
  mergeAppConfig,
  sanitizeConfigUpdate,
  sanitizeSettingsUpdate,
  serializeImportedTweets,
  splitConfigBySensitivity,
} from '../../packages/core/src/index.js';
import type { AppConfig, SyncSettings, TweetStatus } from './types.js';
import { sqliteCredentialStore } from './credentials.js';
import { loginBsky, resetBskySession } from './services/bskyClient.js';
import { parseArchiveJson, parseArchiveZip } from './services/archiveParser.js';
import * as syncEngine from './services/syncEngine.js';
import { fetchTweetsFromApi, lookupUserId } from './services/xClient.js';
import { sqliteStore } from './store.js';
import { taskRunner } from './taskRunner.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

export const router = Router();

function loadAppConfig(): AppConfig {
  const config = sqliteStore.getAllConfig();
  const credentials = sqliteCredentialStore.getCredentials();
  return mergeAppConfig(config, credentials, process.env);
}

function loadSyncSettings(): SyncSettings {
  return loadSettingsFromStore(sqliteStore);
}

function persistConfig(config?: Partial<AppConfig>): void {
  const current = loadAppConfig();
  const sanitized = sanitizeConfigUpdate(config, current);
  const { config: nextConfig, credentials } = splitConfigBySensitivity(sanitized);

  for (const [key, value] of Object.entries(nextConfig)) {
    sqliteStore.setConfig(key, String(value));
  }

  sqliteCredentialStore.setCredentials(credentials);
}

function persistSettings(settings?: Partial<SyncSettings>): void {
  const nextSettings = sanitizeSettingsUpdate(settings);

  for (const [key, value] of Object.entries(nextSettings)) {
    sqliteStore.setConfig(key, value);
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
    sqliteStore.setConfig('xUserId', userId);
    res.json({ userId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/api/x/fetch', async (_req, res) => {
  try {
    const tweets = await fetchTweetsFromApi(loadAppConfig());
    const count = sqliteStore.upsertTweets(serializeImportedTweets(tweets));

    sqliteStore.addLog('info', `从 X API 导入了 ${tweets.length} 条推文，其中新增 ${count} 条。`);
    res.json({ imported: tweets.length, newCount: count, stats: sqliteStore.getStats() });
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

    const count = sqliteStore.upsertTweets(serializeImportedTweets(tweets));

    sqliteStore.addLog('info', `从归档中导入了 ${tweets.length} 条推文，其中新增 ${count} 条。`);
    res.json({ imported: tweets.length, newCount: count, stats: sqliteStore.getStats() });
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
    sqliteStore.listTweets({
      status,
      search,
      limit,
      offset,
    })
  );
});

router.get('/api/stats', (_req, res) => {
  res.json({ stats: sqliteStore.getStats(), engine: syncEngine.getEngineState() });
});

router.get('/api/logs', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json({ logs: sqliteStore.getLogs(limit) });
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

  void taskRunner.run('sync.start', () => syncEngine.startSync(loadAppConfig(), loadSyncSettings()));
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
  const count = sqliteStore.resetFailedToPending();
  res.json({ reset: count });
});

router.delete('/api/tweets', (_req, res) => {
  if (syncEngine.getEngineState().running) {
    res.status(409).json({ error: '请先停止同步，再清空数据。' });
    return;
  }

  sqliteStore.clearAllTweets();
  sqliteStore.addLog('info', '已清空所有推文记录。');
  res.json({ ok: true });
});
