import { Capacitor, registerPlugin } from '@capacitor/core';

export interface RuntimeConfigValue {
  apiBaseUrl: string;
}

export interface PickArchiveResult {
  name: string;
  mimeType: string;
  data: string;
}

interface MobileBridgePlugin {
  getRuntimeConfig(): Promise<RuntimeConfigValue>;
  setRuntimeConfig(value: RuntimeConfigValue): Promise<void>;
  clearRuntimeConfig(): Promise<void>;
  getSecureCredentials(): Promise<{ xBearerToken: string; bskyAppPassword: string }>;
  setSecureCredentials(value: { xBearerToken: string; bskyAppPassword: string }): Promise<void>;
  clearSecureCredentials(): Promise<void>;
  pickArchive(): Promise<PickArchiveResult>;
  notifySyncStatus(value: { title: string; body: string; ongoing: boolean }): Promise<void>;
  clearSyncStatus(): Promise<void>;
  startBackgroundSyncMonitor(): Promise<void>;
  stopBackgroundSyncMonitor(): Promise<void>;
}

const mobileBridge = registerPlugin<MobileBridgePlugin>('MobileBridge');
const runtimeStorageKey = 'x-to-bsky.runtime-config';

function readWebRuntimeConfig(): RuntimeConfigValue {
  try {
    const raw = window.localStorage.getItem(runtimeStorageKey);
    if (!raw) return { apiBaseUrl: '' };
    const parsed = JSON.parse(raw) as Partial<RuntimeConfigValue>;
    return { apiBaseUrl: (parsed.apiBaseUrl ?? '').trim() };
  } catch {
    return { apiBaseUrl: '' };
  }
}

function writeWebRuntimeConfig(value: RuntimeConfigValue): void {
  window.localStorage.setItem(runtimeStorageKey, JSON.stringify(value));
}

export function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform();
}

export async function getRuntimeConfig(): Promise<RuntimeConfigValue> {
  if (!isNativeMobile()) {
    return readWebRuntimeConfig();
  }

  try {
    return await mobileBridge.getRuntimeConfig();
  } catch {
    return { apiBaseUrl: '' };
  }
}

export async function setRuntimeConfig(value: RuntimeConfigValue): Promise<void> {
  if (!isNativeMobile()) {
    writeWebRuntimeConfig(value);
    return;
  }

  await mobileBridge.setRuntimeConfig(value);
}

export async function clearRuntimeConfig(): Promise<void> {
  if (!isNativeMobile()) {
    window.localStorage.removeItem(runtimeStorageKey);
    return;
  }

  await mobileBridge.clearRuntimeConfig();
}

export async function pickArchiveFile(): Promise<File | null> {
  if (!isNativeMobile()) {
    return null;
  }

  const picked = await mobileBridge.pickArchive();
  const binary = atob(picked.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], picked.name, { type: picked.mimeType || 'application/octet-stream' });
}

export async function getSecureCredentials(): Promise<{ xBearerToken: string; bskyAppPassword: string }> {
  if (!isNativeMobile()) {
    return { xBearerToken: '', bskyAppPassword: '' };
  }

  try {
    return await mobileBridge.getSecureCredentials();
  } catch {
    return { xBearerToken: '', bskyAppPassword: '' };
  }
}

export async function setSecureCredentials(value: { xBearerToken: string; bskyAppPassword: string }): Promise<void> {
  if (!isNativeMobile()) {
    return;
  }

  await mobileBridge.setSecureCredentials(value);
}

export async function clearSecureCredentials(): Promise<void> {
  if (!isNativeMobile()) {
    return;
  }

  await mobileBridge.clearSecureCredentials();
}

export async function notifySyncStatus(payload: { title: string; body: string; ongoing: boolean }): Promise<void> {
  if (!isNativeMobile()) {
    return;
  }

  try {
    await mobileBridge.notifySyncStatus(payload);
  } catch {
    // Ignore notification failures on unsupported platforms.
  }
}

export async function clearSyncStatus(): Promise<void> {
  if (!isNativeMobile()) {
    return;
  }

  try {
    await mobileBridge.clearSyncStatus();
  } catch {
    // Ignore notification failures on unsupported platforms.
  }
}

export async function startBackgroundSyncMonitor(): Promise<void> {
  if (!isNativeMobile()) {
    return;
  }

  try {
    await mobileBridge.startBackgroundSyncMonitor();
  } catch {
    // Ignore unsupported platforms.
  }
}

export async function stopBackgroundSyncMonitor(): Promise<void> {
  if (!isNativeMobile()) {
    return;
  }

  try {
    await mobileBridge.stopBackgroundSyncMonitor();
  } catch {
    // Ignore unsupported platforms.
  }
}
