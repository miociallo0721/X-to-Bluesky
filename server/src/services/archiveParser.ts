import AdmZip, { type IZipEntry } from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { parseArchiveJsonBytes, type ImportedTweet } from '../../../packages/core/src/index.js';

export type RawTweet = ImportedTweet;

export function parseArchiveJson(buffer: Buffer): RawTweet[] {
  return parseArchiveJsonBytes(buffer);
}

export function parseArchiveZip(buffer: Buffer): RawTweet[] {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const tweetEntry =
    entries.find((entry: IZipEntry) => entry.entryName.endsWith('tweets.js')) ??
    entries.find((entry: IZipEntry) => entry.entryName.endsWith('tweet.js')) ??
    entries.find((entry: IZipEntry) => entry.entryName.endsWith('tweets.json'));

  if (!tweetEntry) {
    throw new Error('压缩包中未找到 tweets.js 或 tweets.json（请使用 X 官方数据导出包）');
  }

  return parseArchiveJsonBytes(tweetEntry.getData());
}

export function parseArchiveFile(filePath: string): RawTweet[] {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  if (ext === '.zip') return parseArchiveZip(buffer);
  if (ext === '.json') return parseArchiveJson(buffer);
  throw new Error('仅支持 .zip（官方导出）或 .json 文件');
}
