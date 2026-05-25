import AdmZip, { type IZipEntry } from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import type { RawTweet } from './xClient.js';

interface ArchiveTweet {
  id_str?: string;
  id?: string | number;
  full_text?: string;
  text?: string;
  created_at?: string;
  in_reply_to_status_id_str?: string | null;
  retweeted_status?: unknown;
  entities?: {
    media?: { media_url_https?: string; media_url?: string }[];
  };
  extended_entities?: {
    media?: { media_url_https?: string; media_url?: string }[];
  };
}

function parseArchiveTweets(data: unknown): RawTweet[] {
  const items = Array.isArray(data) ? data : [];
  const tweets: RawTweet[] = [];

  for (const raw of items as ArchiveTweet[]) {
    if (raw.retweeted_status) continue;

    const id = String(raw.id_str ?? raw.id ?? '');
    if (!id) continue;

    const text = (raw.full_text ?? raw.text ?? '').trim();
    if (!text) continue;

    const media =
      raw.extended_entities?.media ?? raw.entities?.media ?? [];
    const mediaUrls = media
      .map((m) => m.media_url_https ?? m.media_url)
      .filter((u): u is string => Boolean(u));

    let createdAt = raw.created_at ?? new Date().toISOString();
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      createdAt = parsed.toISOString();
    }

    tweets.push({
      id,
      text,
      created_at: createdAt,
      is_retweet: false,
      is_reply: Boolean(raw.in_reply_to_status_id_str),
      media_urls: mediaUrls,
    });
  }

  const byId = new Map<string, RawTweet>();
  for (const t of tweets) byId.set(t.id, t);
  return [...byId.values()].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export function parseArchiveJson(buffer: Buffer): RawTweet[] {
  const data = JSON.parse(buffer.toString('utf-8'));
  return parseArchiveTweets(data);
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

  let content = tweetEntry.getData().toString('utf-8');
  // tweets.js 格式: window.YTD.tweets.part0 = [...]
  const match = content.match(/=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (match) {
    content = match[1];
  } else {
    content = content.replace(/^window\.YTD\.\w+\s*=\s*/, '').replace(/;\s*$/, '');
  }

  const parsed = JSON.parse(content);
  const tweetArray = Array.isArray(parsed)
    ? parsed.map((item: { tweet?: ArchiveTweet }) => item.tweet ?? item)
    : parsed;

  return parseArchiveTweets(tweetArray);
}

export function parseArchiveFile(filePath: string): RawTweet[] {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);
  if (ext === '.zip') return parseArchiveZip(buffer);
  if (ext === '.json') return parseArchiveJson(buffer);
  throw new Error('仅支持 .zip（官方导出）或 .json 文件');
}
