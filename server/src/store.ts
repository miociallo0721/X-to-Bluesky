import type { AppStore } from '../../packages/core/src/index.js';
import * as db from './db.js';

export const sqliteStore: AppStore = {
  getAllConfig: () => db.getAllConfig(),
  setConfig: (key, value) => db.setConfig(key, value),
  upsertTweets: (tweets) => db.upsertTweets(tweets),
  listTweets: (options) => db.listTweets(options),
  getStats: () => db.getStats(),
  getLogs: (limit) => db.getLogs(limit),
  addLog: (level, message, tweetId) => db.addLog(level, message, tweetId),
  clearAllTweets: () => db.clearAllTweets(),
  resetFailedToPending: () => db.resetFailedToPending(),
  resetSyncingToPending: () => db.resetSyncingToPending(),
  skipPendingTweetsByPolicy: (skipRetweets, skipReplies) => db.skipPendingTweetsByPolicy(skipRetweets, skipReplies),
  getNextPendingTweet: (skipRetweets, skipReplies) => db.getNextPendingTweet(skipRetweets, skipReplies),
  updateTweetStatus: (id, status, extra) => db.updateTweetStatus(id, status, extra),
};
