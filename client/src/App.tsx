import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type AppConfig, type EngineState, type Stats, type SyncSettings, type Tweet, type TweetStatus } from './api';
import {
  clearSyncStatus,
  getSecureCredentials,
  isNativeMobile,
  notifySyncStatus,
  pickArchiveFile,
  setSecureCredentials,
  startBackgroundSyncMonitor,
  stopBackgroundSyncMonitor,
} from './mobile';

const SECRET_MASK_PREFIX = '********';

const defaultConfig: AppConfig = {
  xBearerToken: '',
  xUserId: '',
  bskyHandle: '',
  bskyAppPassword: '',
};

const defaultSettings: SyncSettings = {
  skipRetweets: true,
  skipReplies: false,
  dryRun: false,
  delayMs: 3000,
  addSourceTag: true,
};

const defaultStats: Stats = {
  total: 0,
  pending: 0,
  success: 0,
  failed: 0,
  skipped: 0,
};

const defaultEngine: EngineState = {
  running: false,
  paused: false,
  currentTweetId: null,
  startedAt: null,
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

function isMaskedSecret(value: string | undefined): boolean {
  return Boolean(value?.startsWith(SECRET_MASK_PREFIX));
}

function statusLabel(status: TweetStatus): string {
  switch (status) {
    case 'pending':
      return '待同步';
    case 'syncing':
      return '同步中';
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'skipped':
      return '已跳过';
  }
}

export default function App() {
  const mobileMode = isNativeMobile();
  const embeddedMode = mobileMode && api.isEnabled();
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [settings, setSettings] = useState<SyncSettings>(defaultSettings);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [engine, setEngine] = useState<EngineState>(defaultEngine);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [tweetTotal, setTweetTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<TweetStatus | ''>('');
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState<{ level: string; message: string; created_at: string }[]>([]);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [xUsername, setXUsername] = useState('');
  const [loading, setLoading] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [bootReady, setBootReady] = useState(false);

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [{ stats: latestStats, engine: latestEngine }, { tweets: latestTweets, total }, { logs: latestLogs }] =
        await Promise.all([
          api.getStats(),
          api.getTweets({ status: filterStatus || undefined, search: search || undefined, limit: 50 }),
          api.getLogs(),
        ]);

      setStats(latestStats);
      setEngine(latestEngine);
      setTweets(latestTweets);
      setTweetTotal(total);
      setLogs(latestLogs);
    } catch {
      // Ignore transient refresh failures.
    }
  }, [filterStatus, search]);

  useEffect(() => {
    let cancelled = false;

    void api.getConfig().then(({ config: nextConfig, settings: nextSettings }) => {
      if (cancelled) return;

      void (async () => {
        const secureCredentials = mobileMode
          ? await getSecureCredentials()
          : { xBearerToken: '', bskyAppPassword: '' };

        if (cancelled) return;

        setConfig({
          ...nextConfig,
          xBearerToken: secureCredentials.xBearerToken || nextConfig.xBearerToken,
          bskyAppPassword: secureCredentials.bskyAppPassword || nextConfig.bskyAppPassword,
        });
        setSettings(nextSettings);
        setConfigLoaded(true);
        setBootReady(true);
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [mobileMode]);

  useEffect(() => {
    if (!bootReady) {
      return;
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [bootReady, refresh]);

  useEffect(() => {
    if (!mobileMode) {
      return;
    }

    if (engine.running) {
      void notifySyncStatus({
        title: engine.paused ? '同步已暂停' : '同步进行中',
        body: engine.currentTweetId ? `当前推文 ${engine.currentTweetId}` : `待处理 ${stats.pending} 条`,
        ongoing: !engine.paused,
      });
      void startBackgroundSyncMonitor();
      return;
    }

    void clearSyncStatus();
    void stopBackgroundSyncMonitor();
  }, [engine, mobileMode, stats.pending]);

  const progress = useMemo(() => {
    if (stats.total === 0) return 0;
    return Math.round(((stats.success + stats.skipped) / stats.total) * 100);
  }, [stats]);

  const importSummary = useMemo(() => {
    if (stats.total === 0) {
      return '还没有导入任何推文。';
    }

    return `当前库中共有 ${stats.total} 条推文，其中 ${stats.pending} 条待处理。`;
  }, [stats]);

  const saveConfig = useCallback(async () => {
    setLoading('save');
    try {
      const result = await api.saveConfig({ config, settings });
      if (mobileMode) {
        await setSecureCredentials({
          xBearerToken: isMaskedSecret(config.xBearerToken) ? '' : config.xBearerToken,
          bskyAppPassword: isMaskedSecret(config.bskyAppPassword) ? '' : config.bskyAppPassword,
        });
      }
      setConfig(result.config);
      setSettings(result.settings);
      showToast('配置已保存。');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存配置失败。', true);
      return false;
    } finally {
      setLoading('');
    }
  }, [config, mobileMode, settings, showToast]);

  const lookupUser = async () => {
    if (!xUsername.trim()) {
      showToast('请输入要查询的 X 用户名。', true);
      return;
    }

    setLoading('lookup');
    try {
      const token = isMaskedSecret(config.xBearerToken) ? undefined : config.xBearerToken;
      const { userId } = await api.lookupUser(xUsername, token);
      setConfig((current) => ({ ...current, xUserId: userId }));
      showToast(`已找到用户 ID: ${userId}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '查询用户失败。', true);
    } finally {
      setLoading('');
    }
  };

  const fetchX = async () => {
    setLoading('fetch');
    try {
      const result = await api.fetchFromX();
      showToast(`已从 API 导入 ${result.imported} 条推文。`);
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '从 X 拉取推文失败。', true);
    } finally {
      setLoading('');
    }
  };

  const importArchive = async (file: File) => {
    setLoading('import');
    try {
      const result = await api.importArchive(file);
      showToast(`已从归档导入 ${result.imported} 条推文。`);
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入归档失败。', true);
    } finally {
      setLoading('');
    }
  };

  const importArchiveFromDevice = async () => {
    try {
      const file = await pickArchiveFile();
      if (!file) {
        showToast('当前平台不支持原生归档选择。', true);
        return;
      }

      await importArchive(file);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '选择归档失败。', true);
    }
  };

  const testBsky = async () => {
    setLoading('bsky');
    try {
      const result = await api.testBskyLogin();
      showToast(`Bluesky 登录成功：${result.handle}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Bluesky 登录失败。', true);
    } finally {
      setLoading('');
    }
  };

  const startSync = async () => {
    const saved = await saveConfig();
    if (!saved) return;

    setLoading('sync');
    try {
      const result = await api.startSync();
      showToast(result.message);
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动同步失败。', true);
    } finally {
      setLoading('');
    }
  };

  const pauseSync = async () => {
    try {
      await api.pauseSync();
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '暂停同步失败。', true);
    }
  };

  const resumeSync = async () => {
    try {
      await api.resumeSync();
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '继续同步失败。', true);
    }
  };

  const stopSync = async () => {
    try {
      await api.stopSync();
      if (mobileMode) {
        await stopBackgroundSyncMonitor();
      }
      showToast('已请求停止同步。');
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '停止同步失败。', true);
    }
  };

  const resetFailed = async () => {
    try {
      const result = await api.resetFailed();
      showToast(`已重置 ${result.reset} 条失败记录。`);
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重置失败记录失败。', true);
    }
  };

  const clearTweets = async () => {
    if (!window.confirm('确定要清空所有推文记录吗？这个操作不会撤销。')) {
      return;
    }

    try {
      await api.clearTweets();
      showToast('已清空所有推文记录。');
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '清空推文失败。', true);
    }
  };

  const clearLocalCredentials = async () => {
    if (!window.confirm('确定要清除当前设备里的账号凭证和本地登录信息吗？')) {
      return;
    }

    try {
      await api.clearLocalCredentials();
      setConfig((current) => ({
        ...current,
        xBearerToken: '',
        xUserId: '',
        bskyHandle: '',
        bskyAppPassword: '',
      }));
      showToast('本地凭证已清除。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '清除本地凭证失败。', true);
    }
  };

  if (!bootReady) {
    return (
      <div className="mobile-gate">
        <div className="mobile-gate-card">
          <p className="eyebrow">Mobile Boot</p>
          <h1>正在准备移动控制台</h1>
          <p className="subtitle">正在恢复本地数据并初始化应用环境。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${mobileMode ? 'mobile-mode' : ''}`}>
      <header className="header">
        <div>
          <p className="eyebrow">{mobileMode ? 'Android Migration Console' : 'Migration Console'}</p>
          <h1>
            X <span>to</span> Bluesky
          </h1>
          <p className="subtitle">把你的推文历史迁移到 Bluesky，并在一个面板里管理导入、同步和进度回放。</p>
        </div>

        <div className="header-actions">
          <div className="header-status">
            {engine.running ? (
              <span className={`badge ${engine.paused ? 'paused' : 'running'}`}>
                <span className="dot" />
                {engine.paused ? '同步已暂停' : '同步进行中'}
                {engine.currentTweetId ? ` · ${engine.currentTweetId}` : ''}
              </span>
            ) : (
              <span className="badge">等待开始</span>
            )}
          </div>
        </div>
      </header>

      <div className="grid">
        <aside>
          {embeddedMode && (
            <section className="panel">
              <h2>本地运行模式</h2>
              <p className="hint">
                当前安卓应用正在设备内直接保存数据、运行同步逻辑并调用 X / Bluesky，不依赖你额外部署的后端服务。
              </p>
              <div className="runtime-chip-row">
                <span className="runtime-chip">Single APK</span>
                <span className="runtime-chip">Local Store</span>
                <span className="runtime-chip">Native HTTP</span>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>X 数据源</h2>

            <div className="field">
              <label>Bearer Token</label>
              <input
                type="password"
                placeholder="X API v2 Bearer Token"
                value={config.xBearerToken}
                onChange={(event) => setConfig({ ...config, xBearerToken: event.target.value })}
              />
            </div>

            <div className="field">
              <label>User ID</label>
              <input
                placeholder="数字用户 ID"
                value={config.xUserId}
                onChange={(event) => setConfig({ ...config, xUserId: event.target.value })}
              />
            </div>

            <div className="field">
              <label>通过用户名查询 User ID</label>
              <div className="field-row">
                <input placeholder="@username" value={xUsername} onChange={(event) => setXUsername(event.target.value)} />
                <button type="button" className="btn-secondary" onClick={lookupUser} disabled={Boolean(loading)}>
                  查询
                </button>
              </div>
            </div>

            <div className="btn-group">
              <button type="button" className="btn-primary" onClick={fetchX} disabled={Boolean(loading) || engine.running}>
                从 API 导入
              </button>
            </div>

            <p className="hint">X API 免费额度通常只能获取最近约 3200 条推文，完整历史更推荐使用官方归档导入。</p>

            <div className="divider" />

            <label>导入 X 归档（.zip / .json）</label>
            <label className="file-upload">
              <input
                type="file"
                accept=".zip,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void importArchive(file);
                  }
                  event.target.value = '';
                }}
              />
              点击选择，或把官方导出文件拖到这里
            </label>

            {mobileMode && (
              <div className="btn-group top-gap">
                <button type="button" className="btn-secondary" onClick={() => void importArchiveFromDevice()} disabled={loading === 'import'}>
                  从手机文件导入
                </button>
              </div>
            )}

            <p className="hint">
              路径参考：X 设置 -&gt; 你的账户 -&gt; 下载数据归档。上传官方 <code>.zip</code>，或解包后的
              <code> tweets.json </code>
              /<code> tweets.js </code>。
            </p>
          </section>

          <section className="panel stack-gap">
            <h2>Bluesky 配置</h2>

            <div className="field">
              <label>Handle</label>
              <input
                placeholder="name.bsky.social"
                value={config.bskyHandle}
                onChange={(event) => setConfig({ ...config, bskyHandle: event.target.value })}
              />
            </div>

            <div className="field">
              <label>App Password</label>
              <input
                type="password"
                placeholder="在 Bluesky 设置里创建的应用密码"
                value={config.bskyAppPassword}
                onChange={(event) => setConfig({ ...config, bskyAppPassword: event.target.value })}
              />
            </div>

            <div className="btn-group">
              <button type="button" className="btn-secondary" onClick={testBsky} disabled={Boolean(loading) || !configLoaded}>
                测试登录
              </button>
              <button type="button" className="btn-primary" onClick={() => void saveConfig()} disabled={Boolean(loading) || !configLoaded}>
                保存配置
              </button>
            </div>

            {embeddedMode && (
              <div className="btn-group">
                <button type="button" className="btn-danger" onClick={() => void clearLocalCredentials()}>
                  清除本地凭证
                </button>
              </div>
            )}
          </section>

          <section className="panel stack-gap">
            <h2>同步策略</h2>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.skipRetweets}
                onChange={(event) => setSettings({ ...settings, skipRetweets: event.target.checked })}
              />
              跳过转推
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.skipReplies}
                onChange={(event) => setSettings({ ...settings, skipReplies: event.target.checked })}
              />
              跳过回复
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.dryRun}
                onChange={(event) => setSettings({ ...settings, dryRun: event.target.checked })}
              />
              试运行，不真正发布
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.addSourceTag}
                onChange={(event) => setSettings({ ...settings, addSourceTag: event.target.checked })}
              />
              在文末添加来源标记
            </label>

            <div className="field">
              <label>发帖间隔（毫秒）</label>
              <input
                type="number"
                min={1000}
                step={500}
                value={settings.delayMs}
                onChange={(event) =>
                  setSettings({ ...settings, delayMs: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </div>
          </section>
        </aside>

        <main>
          <section className="panel">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="value">{stats.total}</div>
                <div className="label">总数</div>
              </div>
              <div className="stat-card pending">
                <div className="value">{stats.pending}</div>
                <div className="label">待同步</div>
              </div>
              <div className="stat-card success">
                <div className="value">{stats.success}</div>
                <div className="label">成功</div>
              </div>
              <div className="stat-card failed">
                <div className="value">{stats.failed}</div>
                <div className="label">失败</div>
              </div>
              <div className="stat-card">
                <div className="value">{stats.skipped}</div>
                <div className="label">跳过</div>
              </div>
            </div>

            <div className="progress-wrap">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-label">
                <span>同步进度</span>
                <span>{progress}%</span>
              </div>
              <p className="hint">{importSummary}</p>
            </div>

            <div className="btn-group">
              {!engine.running ? (
                <button type="button" className="btn-primary" onClick={() => void startSync()} disabled={Boolean(loading) || stats.pending === 0}>
                  开始同步
                </button>
              ) : engine.paused ? (
                <button type="button" className="btn-success" onClick={() => void resumeSync()}>
                  继续
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => void pauseSync()}>
                  暂停
                </button>
              )}

              {engine.running && (
                <button type="button" className="btn-danger" onClick={() => void stopSync()}>
                  停止
                </button>
              )}

              <button type="button" className="btn-secondary" onClick={() => void resetFailed()} disabled={Boolean(loading)}>
                重试失败项
              </button>

              <button type="button" className="btn-danger" onClick={() => void clearTweets()} disabled={engine.running}>
                清空数据
              </button>
            </div>

            <div className="divider" />

            <div className="toolbar">
              <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as TweetStatus | '')}>
                <option value="">全部状态</option>
                <option value="pending">待同步</option>
                <option value="syncing">同步中</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="skipped">已跳过</option>
              </select>

              <input
                type="search"
                placeholder="搜索推文内容"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              <span className="toolbar-meta">共 {tweetTotal} 条</span>
            </div>

            <div className="tweet-list">
              {tweets.length === 0 ? (
                <div className="tweet-item empty-state">还没有推文记录。先从左侧导入 API 数据或归档文件吧。</div>
              ) : (
                tweets.map((tweet) => (
                  <article key={tweet.id} className="tweet-item">
                    <div className="tweet-meta">
                      <span className={`status-pill ${tweet.status}`}>{statusLabel(tweet.status)}</span>
                      <span>{formatDate(tweet.created_at)}</span>
                      {tweet.is_reply && <span>回复</span>}
                      {tweet.is_retweet && <span>转推</span>}
                    </div>

                    <p className="tweet-text">{tweet.text}</p>

                    {tweet.error_message && <p className="tweet-error">{tweet.error_message}</p>}

                    {tweet.bsky_uri && (
                      <p className="tweet-meta tweet-uri">
                        {tweet.bsky_uri === 'dry-run' ? '试运行：未实际发布' : tweet.bsky_uri}
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>

            <div className="log-panel">
              {logs.length === 0 ? (
                <div className="log-line">日志会在导入、测试登录和同步过程中实时显示。</div>
              ) : (
                logs.map((log) => (
                  <div key={`${log.created_at}-${log.message}`} className={`log-line ${log.level}`}>
                    [{formatDate(log.created_at)}] {log.message}
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      </div>

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
