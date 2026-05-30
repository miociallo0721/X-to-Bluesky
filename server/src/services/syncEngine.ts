import * as db from '../db.js';
import type { AppConfig, SyncSettings } from '../types.js';
import { loginBsky, postToBsky } from './bskyClient.js';

export interface SyncEngineState {
  running: boolean;
  paused: boolean;
  currentTweetId: string | null;
  startedAt: string | null;
}

let state: SyncEngineState = {
  running: false,
  paused: false,
  currentTweetId: null,
  startedAt: null,
};

let abortRequested = false;

export function getEngineState(): SyncEngineState {
  return { ...state };
}

export function pauseSync(): void {
  if (!state.running || state.paused) {
    return;
  }

  state.paused = true;
  db.addLog('info', '同步已暂停。');
}

export function resumeSync(): void {
  if (!state.running || !state.paused) {
    return;
  }

  state.paused = false;
  db.addLog('info', '同步已继续。');
}

export function stopSync(): void {
  if (!state.running) {
    return;
  }

  abortRequested = true;
  state.paused = false;
  db.addLog('info', '已请求停止同步。');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipPreview(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

export async function startSync(config: AppConfig, settings: SyncSettings): Promise<void> {
  if (state.running) {
    throw new Error('同步任务已经在运行中了。');
  }

  abortRequested = false;
  db.resetSyncingToPending();
  state = {
    running: true,
    paused: false,
    currentTweetId: null,
    startedAt: new Date().toISOString(),
  };
  db.addLog('info', `开始同步（dryRun=${settings.dryRun}）。`);

  try {
    const skipped = db.skipPendingTweetsByPolicy(settings.skipRetweets, settings.skipReplies);
    if (skipped > 0) {
      db.addLog('info', `根据同步策略跳过了 ${skipped} 条推文。`);
    }

    if (!settings.dryRun) {
      await loginBsky(config);
      db.addLog('success', 'Bluesky 登录成功。');
    } else {
      db.addLog('info', '试运行模式：不会登录 Bluesky 或实际发帖。');
    }

    while (!abortRequested) {
      if (state.paused) {
        await sleep(500);
        continue;
      }

      const tweet = db.getNextPendingTweet(settings.skipRetweets, settings.skipReplies);
      if (!tweet) {
        db.addLog('info', '没有更多待同步的推文了。');
        break;
      }

      state.currentTweetId = tweet.id;
      db.updateTweetStatus(tweet.id, 'syncing', { error_message: '' });

      try {
        const result = await postToBsky(tweet.text, {
          addSourceTag: settings.addSourceTag,
          dryRun: settings.dryRun,
        });

        if ('dryRun' in result) {
          db.updateTweetStatus(tweet.id, 'success', { bsky_uri: 'dry-run', error_message: '' });
          db.addLog('info', `[试运行] ${tweet.id}: ${clipPreview(tweet.text)}`, tweet.id);
        } else {
          db.updateTweetStatus(tweet.id, 'success', { bsky_uri: result.uri, error_message: '' });
          db.addLog('success', `已发布到 Bluesky: ${result.uri}`, tweet.id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.updateTweetStatus(tweet.id, 'failed', { error_message: message });
        db.addLog('error', `同步失败 ${tweet.id}: ${message}`, tweet.id);
      }

      state.currentTweetId = null;
      if (settings.delayMs > 0 && !abortRequested) {
        await sleep(settings.delayMs);
      }
    }

    if (abortRequested) {
      db.addLog('info', '同步已停止。');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.addLog('error', `同步引擎异常: ${message}`);
  } finally {
    state.running = false;
    state.paused = false;
    state.currentTweetId = null;
    abortRequested = false;
    db.resetSyncingToPending();
    db.addLog('info', '同步任务结束。');
  }
}
