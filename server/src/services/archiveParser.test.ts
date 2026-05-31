import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArchiveJsonString } from '../../../packages/core/src/index.js';

test('parseArchiveJsonString accepts raw tweet arrays', () => {
  const tweets = parseArchiveJsonString(
    JSON.stringify([
      {
        id_str: '2',
        full_text: 'second',
        created_at: '2020-01-02T00:00:00.000Z',
      },
      {
        id_str: '1',
        full_text: 'first',
        created_at: '2020-01-01T00:00:00.000Z',
        entities: { media: [{ media_url_https: 'https://example.com/1.jpg' }] },
      },
    ])
  );

  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].id, '1');
  assert.deepEqual(tweets[0].media_urls, ['https://example.com/1.jpg']);
});

test('parseArchiveJsonString accepts official X tweet wrappers and skips retweets', () => {
  const tweets = parseArchiveJsonString(
    JSON.stringify([
      {
        tweet: {
          id_str: '1',
          full_text: 'original',
          created_at: '2020-01-01T00:00:00.000Z',
          in_reply_to_status_id_str: '99',
        },
      },
      {
        tweet: {
          id_str: '2',
          full_text: 'retweeted',
          created_at: '2020-01-02T00:00:00.000Z',
          retweeted_status: {},
        },
      },
    ])
  );

  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].id, '1');
  assert.equal(tweets[0].is_reply, true);
});

test('parseArchiveJsonString accepts tweets.js assignment syntax', () => {
  const tweets = parseArchiveJsonString(
    `window.YTD.tweets.part0 = ${JSON.stringify([
      { tweet: { id_str: '1', full_text: 'from js', created_at: '2020-01-01T00:00:00.000Z' } },
    ])};`
  );

  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].text, 'from js');
});
