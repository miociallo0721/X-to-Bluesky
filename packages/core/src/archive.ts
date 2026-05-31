export interface ImportedTweet {
  id: string;
  text: string;
  created_at: string;
  is_retweet: boolean;
  is_reply: boolean;
  media_urls: string[];
}

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

function normalizeArchiveEnvelope(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (match) {
    return match[1];
  }

  return trimmed.replace(/^window\.YTD\.\w+\s*=\s*/, '').replace(/;\s*$/, '');
}

function parseArchiveTweets(data: unknown): ImportedTweet[] {
  const items = Array.isArray(data) ? data : [];
  const tweets: ImportedTweet[] = [];

  for (const raw of items as ArchiveTweet[]) {
    if (raw.retweeted_status) continue;

    const id = String(raw.id_str ?? raw.id ?? '');
    if (!id) continue;

    const text = (raw.full_text ?? raw.text ?? '').trim();
    if (!text) continue;

    const media = raw.extended_entities?.media ?? raw.entities?.media ?? [];
    const mediaUrls = media
      .map((item) => item.media_url_https ?? item.media_url)
      .filter((url): url is string => Boolean(url));

    let createdAt = raw.created_at ?? new Date().toISOString();
    const parsedDate = new Date(createdAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      createdAt = parsedDate.toISOString();
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

  const uniqueTweets = new Map<string, ImportedTweet>();
  for (const tweet of tweets) {
    uniqueTweets.set(tweet.id, tweet);
  }

  return [...uniqueTweets.values()].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export function parseArchiveJsonString(content: string): ImportedTweet[] {
  const normalized = normalizeArchiveEnvelope(content);
  const parsed = JSON.parse(normalized);
  const tweetArray = Array.isArray(parsed)
    ? parsed.map((item: { tweet?: ArchiveTweet }) => item.tweet ?? item)
    : parsed;

  return parseArchiveTweets(tweetArray);
}

export function parseArchiveJsonBytes(bytes: Uint8Array): ImportedTweet[] {
  return parseArchiveJsonString(new TextDecoder('utf-8').decode(bytes));
}
