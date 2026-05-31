import type { AppConfig } from './types.js';

export type AppCredentials = Pick<AppConfig, 'xBearerToken' | 'bskyAppPassword'>;
export type NonSecretAppConfig = Omit<AppConfig, keyof AppCredentials>;

export interface CredentialStore {
  getCredentials(): Partial<AppCredentials>;
  setCredentials(credentials: Partial<AppCredentials>): void;
  clearCredentials(keys?: (keyof AppCredentials)[]): void;
}

export function splitConfigBySensitivity(config?: Partial<AppConfig>): {
  config: Partial<NonSecretAppConfig>;
  credentials: Partial<AppCredentials>;
} {
  const nextConfig: Partial<NonSecretAppConfig> = {};
  const credentials: Partial<AppCredentials> = {};

  if (!config) {
    return { config: nextConfig, credentials };
  }

  for (const [key, value] of Object.entries(config) as [keyof AppConfig, string | undefined][]) {
    if (key === 'xBearerToken' || key === 'bskyAppPassword') {
      credentials[key] = value ?? '';
      continue;
    }

    nextConfig[key as keyof NonSecretAppConfig] = value ?? '';
  }

  return { config: nextConfig, credentials };
}

export function mergeAppConfig(
  config: Partial<NonSecretAppConfig>,
  credentials: Partial<AppCredentials>,
  env: Partial<Record<string, string | undefined>>
): AppConfig {
  return {
    xBearerToken: credentials.xBearerToken ?? env.X_BEARER_TOKEN ?? '',
    xUserId: config.xUserId ?? env.X_USER_ID ?? '',
    bskyHandle: config.bskyHandle ?? env.BSKY_HANDLE ?? '',
    bskyAppPassword: credentials.bskyAppPassword ?? env.BSKY_APP_PASSWORD ?? '',
  };
}
