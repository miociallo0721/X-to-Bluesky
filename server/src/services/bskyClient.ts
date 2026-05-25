import { BskyAgent, RichText } from '@atproto/api';
import type { AppConfig } from '../types.js';

const BSKY_MAX_GRAPHEMES = 300;
const SOURCE_TAG = '\n\n[migrated from X]';

let agent: BskyAgent | null = null;
let loggedInHandle: string | null = null;

export async function loginBsky(config: AppConfig): Promise<{ handle: string; did: string }> {
  const { bskyHandle, bskyAppPassword } = config;
  if (!bskyHandle || !bskyAppPassword) {
    throw new Error('请先填写 Bluesky handle 和 App Password。');
  }

  if (agent && loggedInHandle === bskyHandle) {
    return {
      handle: agent.session?.handle ?? bskyHandle,
      did: agent.session?.did ?? '',
    };
  }

  agent = new BskyAgent({ service: 'https://bsky.social' });
  const session = await agent.login({
    identifier: bskyHandle,
    password: bskyAppPassword,
  });

  loggedInHandle = bskyHandle;
  return { handle: session.data.handle, did: session.data.did };
}

function truncateForBsky(text: string, addTag: boolean): string {
  const suffix = addTag ? SOURCE_TAG : '';
  const maxBody = BSKY_MAX_GRAPHEMES - [...suffix].length;
  const chars = [...text];

  if (chars.length <= maxBody) {
    return text + suffix;
  }

  return chars.slice(0, maxBody - 1).join('') + '…' + suffix;
}

export async function postToBsky(
  text: string,
  options: { addSourceTag: boolean; dryRun: boolean }
): Promise<{ uri: string; cid: string } | { dryRun: true }> {
  if (!agent) {
    throw new Error('请先登录 Bluesky。');
  }

  const body = truncateForBsky(text, options.addSourceTag);
  const richText = new RichText({ text: body });
  await richText.detectFacets(agent);

  if (options.dryRun) {
    return { dryRun: true };
  }

  const result = await agent.post({
    text: richText.text,
    facets: richText.facets,
    createdAt: new Date().toISOString(),
  });

  return { uri: result.uri, cid: result.cid };
}

export function resetBskySession(): void {
  agent = null;
  loggedInHandle = null;
}
