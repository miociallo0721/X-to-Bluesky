export interface RuntimeConfigValue {
  apiBaseUrl: string;
}

export interface PickArchiveResult {
  name: string;
  mimeType: string;
  data: string;
}

export interface MobileBridgePlugin {
  getRuntimeConfig(): Promise<RuntimeConfigValue>;
  setRuntimeConfig(value: RuntimeConfigValue): Promise<void>;
  clearRuntimeConfig(): Promise<void>;
  pickArchive(): Promise<PickArchiveResult>;
  notifySyncStatus(value: { title: string; body: string; ongoing: boolean }): Promise<void>;
  clearSyncStatus(): Promise<void>;
}
