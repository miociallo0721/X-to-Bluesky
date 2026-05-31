import type { AppConfig } from '../types.js';
import type { ImportedTweet } from '../../../packages/core/src/index.js';

export type RawTweet = ImportedTweet;

interface XApiTweet {
  id: string;
  text: string;
  created_at?: string;
  referenced_tweets?: { type: string; id: string }[];
  attachments?: { media_keys?: string[] };
}

interface XApiMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
}

export async function fetchTweetsFromApi(config: AppConfig, maxPages = 50): Promise<RawTweet[]> {
  const { xBearerToken, xUserId } = config;
  if (!xBearerToken || !xUserId) {
    throw new Error('请先填写 X Bearer Token 和 User ID。');
  }

  const tweets: RawTweet[] = [];
  let paginationToken: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,referenced_tweets,attachments,entities',
      expansions: 'attachments.media_keys',
      'media.fields': 'url,preview_image_url,type',
      exclude: 'retweets',
    });
    if (paginationToken) {
      params.set('pagination_token', paginationToken);
    }

    const url = `https://api.x.com/2/users/${xUserId}/tweets?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${xBearerToken}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X API 请求失败 (${res.status}): ${err}`);
    }

    const data = (await res.json()) as {
      data?: XApiTweet[];
      includes?: { media?: XApiMedia[] };
      meta?: { next_token?: string };
    };

    const mediaMap = new Map<string, XApiMedia>();
    for (const media of data.includes?.media ?? []) {
      mediaMap.set(media.media_key, media);
    }

    for (const tweet of data.data ?? []) {
      const isRetweet = tweet.referenced_tweets?.some((item) => item.type === 'retweeted') ?? false;
      const isReply = tweet.referenced_tweets?.some((item) => item.type === 'replied_to') ?? false;
      const mediaUrls: string[] = [];

      for (const key of tweet.attachments?.media_keys ?? []) {
        const media = mediaMap.get(key);
        if (media?.url) {
          mediaUrls.push(media.url);
        } else if (media?.preview_image_url) {
          mediaUrls.push(media.preview_image_url);
        }
      }

      tweets.push({
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at ?? new Date().toISOString(),
        is_retweet: isRetweet,
        is_reply: isReply,
        media_urls: mediaUrls,
      });
    }

    paginationToken = data.meta?.next_token;
    pages += 1;
    if (!paginationToken) {
      break;
    }
  }

  return tweets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function lookupUserId(username: string, bearerToken: string): Promise<string> {
  const cleanUsername = username.replace(/^@/, '').trim();
  if (!cleanUsername) {
    throw new Error('请输入 X 用户名。');
  }

  const res = await fetch(`https://api.x.com/2/users/by/username/${cleanUsername}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!res.ok) {
    throw new Error(`无法查询用户 @${cleanUsername}: ${await res.text()}`);
  }

  const data = (await res.json()) as { data?: { id: string } };
  if (!data.data?.id) {
    throw new Error('没有找到对应的 X 用户。');
  }

  return data.data.id;
}
