import type { CredentialStore } from '../../packages/core/src/index.js';
import { sqliteStore } from './store.js';

const CREDENTIAL_KEYS = new Set(['xBearerToken', 'bskyAppPassword']);

export const sqliteCredentialStore: CredentialStore = {
  getCredentials() {
    const config = sqliteStore.getAllConfig();
    return {
      xBearerToken: config.xBearerToken ?? '',
      bskyAppPassword: config.bskyAppPassword ?? '',
    };
  },

  setCredentials(credentials) {
    for (const [key, value] of Object.entries(credentials)) {
      if (!CREDENTIAL_KEYS.has(key)) continue;
      sqliteStore.setConfig(key, String(value ?? ''));
    }
  },

  clearCredentials(keys) {
    const targetKeys = keys ?? ['xBearerToken', 'bskyAppPassword'];
    for (const key of targetKeys) {
      sqliteStore.setConfig(key, '');
    }
  },
};
