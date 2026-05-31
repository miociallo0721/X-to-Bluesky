import { createSyncController, type AppConfig, type SyncJobState, type SyncSettings } from '../../../packages/core/src/index.js';
import { sqliteStore } from '../store.js';
import { loginBsky, postToBsky } from './bskyClient.js';

export type SyncEngineState = SyncJobState;

const controller = createSyncController(
  {
    resetSyncingToPending: () => sqliteStore.resetSyncingToPending(),
    skipPendingTweetsByPolicy: (skipRetweets, skipReplies) =>
      sqliteStore.skipPendingTweetsByPolicy(skipRetweets, skipReplies),
    getNextPendingTweet: (skipRetweets, skipReplies) => sqliteStore.getNextPendingTweet(skipRetweets, skipReplies),
    updateTweetStatus: (id, status, extra) => sqliteStore.updateTweetStatus(id, status, extra),
    addLog: (level, message, tweetId) => sqliteStore.addLog(level, message, tweetId),
  },
  {
    login: (config) => loginBsky(config),
    post: (text, options) => postToBsky(text, options),
  }
);

export const getEngineState = controller.getState;
export const pauseSync = controller.pause;
export const resumeSync = controller.resume;
export const stopSync = controller.stop;
export const startSync = controller.start;
