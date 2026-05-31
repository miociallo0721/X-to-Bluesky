import type { AppConfig, SyncSettings } from './types.js';

export const SECRET_MASK_PREFIX = '********';

export function maskSecret(value: string): string {
  return `${SECRET_MASK_PREFIX}${value.slice(-4)}`;
}

export function isMaskedSecret(value: string): boolean {
  return value.startsWith(SECRET_MASK_PREFIX);
}

export function maskConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    xBearerToken: config.xBearerToken ? maskSecret(config.xBearerToken) : '',
    bskyAppPassword: config.bskyAppPassword ? maskSecret(config.bskyAppPassword) : '',
  };
}

export function resolveAppConfig(
  saved: Partial<Record<keyof AppConfig, string>>,
  env: Partial<Record<string, string | undefined>>
): AppConfig {
  return {
    xBearerToken: saved.xBearerToken ?? env.X_BEARER_TOKEN ?? '',
    xUserId: saved.xUserId ?? env.X_USER_ID ?? '',
    bskyHandle: saved.bskyHandle ?? env.BSKY_HANDLE ?? '',
    bskyAppPassword: saved.bskyAppPassword ?? env.BSKY_APP_PASSWORD ?? '',
  };
}

export function resolveSyncSettings(saved: Partial<Record<keyof SyncSettings, string>>): SyncSettings {
  return {
    skipRetweets: saved.skipRetweets !== 'false',
    skipReplies: saved.skipReplies === 'true',
    dryRun: saved.dryRun === 'true',
    delayMs: Number(saved.delayMs) || 3000,
    addSourceTag: saved.addSourceTag !== 'false',
  };
}

export function sanitizeConfigUpdate(config?: Partial<AppConfig>, current?: AppConfig): Partial<AppConfig> {
  if (!config) {
    return {};
  }

  const nextConfig: Partial<AppConfig> = {};

  for (const [key, rawValue] of Object.entries(config) as [keyof AppConfig, string | undefined][]) {
    const value = String(rawValue ?? '').trim();
    const currentValue = current?.[key];

    if ((key === 'xBearerToken' || key === 'bskyAppPassword') && isMaskedSecret(value)) {
      nextConfig[key] = currentValue ?? '';
      continue;
    }

    nextConfig[key] = value;
  }

  return nextConfig;
}

export function sanitizeSettingsUpdate(settings?: Partial<SyncSettings>): Partial<Record<keyof SyncSettings, string>> {
  if (!settings) {
    return {};
  }

  const nextSettings: Partial<Record<keyof SyncSettings, string>> = {};

  for (const [key, value] of Object.entries(settings) as [keyof SyncSettings, SyncSettings[keyof SyncSettings] | undefined][]) {
    if (typeof value === 'undefined') continue;
    nextSettings[key] = String(value);
  }

  return nextSettings;
}
