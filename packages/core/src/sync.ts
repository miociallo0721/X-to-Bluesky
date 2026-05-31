import type { AppConfig, SyncJobState, SyncSettings, TweetRecord, TweetStatus } from './types.js';

type LogLevel = 'info' | 'success' | 'error';

export interface SyncRepository {
  resetSyncingToPending(): number;
  skipPendingTweetsByPolicy(skipRetweets: boolean, skipReplies: boolean): number;
  getNextPendingTweet(skipRetweets: boolean, skipReplies: boolean): TweetRecord | null;
  updateTweetStatus(
    id: string,
    status: TweetStatus,
    extra?: { bsky_uri?: string; error_message?: string }
  ): void;
  addLog(level: LogLevel, message: string, tweetId?: string): void;
}

export interface SyncPublisher {
  login(config: AppConfig): Promise<{ handle: string; did: string }>;
  post(
    text: string,
    options: { addSourceTag: boolean; dryRun: boolean }
  ): Promise<{ uri: string; cid: string } | { dryRun: true }>;
}

export interface SyncControllerOptions {
  sleep?(ms: number): Promise<void>;
  onStateChange?(state: SyncJobState): void;
}

export interface SyncController {
  getState(): SyncJobState;
  pause(): void;
  resume(): void;
  stop(): void;
  start(config: AppConfig, settings: SyncSettings): Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipPreview(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

export function createSyncController(
  repository: SyncRepository,
  publisher: SyncPublisher,
  options: SyncControllerOptions = {}
): SyncController {
  const sleep = options.sleep ?? defaultSleep;

  let state: SyncJobState = {
    running: false,
    paused: false,
    currentTweetId: null,
    startedAt: null,
  };

  let abortRequested = false;

  function emitState(): void {
    options.onStateChange?.({ ...state });
  }

  function setState(nextState: Partial<SyncJobState>): void {
    state = { ...state, ...nextState };
    emitState();
  }

  return {
    getState() {
      return { ...state };
    },

    pause() {
      if (!state.running || state.paused) {
        return;
      }

      setState({ paused: true });
      repository.addLog('info', '同步已暂停。');
    },

    resume() {
      if (!state.running || !state.paused) {
        return;
      }

      setState({ paused: false });
      repository.addLog('info', '同步已继续。');
    },

    stop() {
      if (!state.running) {
        return;
      }

      abortRequested = true;
      setState({ paused: false });
      repository.addLog('info', '已请求停止同步。');
    },

    async start(config: AppConfig, settings: SyncSettings) {
      if (state.running) {
        throw new Error('同步任务已经在运行中了。');
      }

      abortRequested = false;
      repository.resetSyncingToPending();
      state = {
        running: true,
        paused: false,
        currentTweetId: null,
        startedAt: new Date().toISOString(),
      };
      emitState();
      repository.addLog('info', `开始同步（dryRun=${settings.dryRun}）。`);

      try {
        const skipped = repository.skipPendingTweetsByPolicy(settings.skipRetweets, settings.skipReplies);
        if (skipped > 0) {
          repository.addLog('info', `根据同步策略跳过了 ${skipped} 条推文。`);
        }

        if (!settings.dryRun) {
          await publisher.login(config);
          repository.addLog('success', 'Bluesky 登录成功。');
        } else {
          repository.addLog('info', '试运行模式：不会登录 Bluesky 或实际发帖。');
        }

        while (!abortRequested) {
          if (state.paused) {
            await sleep(500);
            continue;
          }

          const tweet = repository.getNextPendingTweet(settings.skipRetweets, settings.skipReplies);
          if (!tweet) {
            repository.addLog('info', '没有更多待同步的推文了。');
            break;
          }

          setState({ currentTweetId: tweet.id });
          repository.updateTweetStatus(tweet.id, 'syncing', { error_message: '' });

          try {
            const result = await publisher.post(tweet.text, {
              addSourceTag: settings.addSourceTag,
              dryRun: settings.dryRun,
            });

            if ('dryRun' in result) {
              repository.updateTweetStatus(tweet.id, 'success', {
                bsky_uri: 'dry-run',
                error_message: '',
              });
              repository.addLog('info', `[试运行] ${tweet.id}: ${clipPreview(tweet.text)}`, tweet.id);
            } else {
              repository.updateTweetStatus(tweet.id, 'success', {
                bsky_uri: result.uri,
                error_message: '',
              });
              repository.addLog('success', `已发布到 Bluesky: ${result.uri}`, tweet.id);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            repository.updateTweetStatus(tweet.id, 'failed', { error_message: message });
            repository.addLog('error', `同步失败 ${tweet.id}: ${message}`, tweet.id);
          }

          setState({ currentTweetId: null });
          if (settings.delayMs > 0 && !abortRequested) {
            await sleep(settings.delayMs);
          }
        }

        if (abortRequested) {
          repository.addLog('info', '同步已停止。');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        repository.addLog('error', `同步引擎异常: ${message}`);
      } finally {
        state = {
          running: false,
          paused: false,
          currentTweetId: null,
          startedAt: null,
        };
        abortRequested = false;
        emitState();
        repository.resetSyncingToPending();
        repository.addLog('info', '同步任务结束。');
      }
    },
  };
}
