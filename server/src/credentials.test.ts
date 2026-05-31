import assert from 'node:assert/strict';
import test from 'node:test';
import { createInlineTaskRunner, mergeAppConfig, splitConfigBySensitivity } from '../../packages/core/src/index.js';

test('splitConfigBySensitivity separates secrets from regular config', () => {
  const result = splitConfigBySensitivity({
    xBearerToken: 'token',
    xUserId: '123',
    bskyHandle: 'user.bsky.social',
    bskyAppPassword: 'app-password',
  });

  assert.deepEqual(result.config, {
    xUserId: '123',
    bskyHandle: 'user.bsky.social',
  });
  assert.deepEqual(result.credentials, {
    xBearerToken: 'token',
    bskyAppPassword: 'app-password',
  });
});

test('mergeAppConfig rebuilds full app config from config and credential stores', () => {
  const config = mergeAppConfig(
    {
      xUserId: '123',
      bskyHandle: 'user.bsky.social',
    },
    {
      xBearerToken: 'token',
      bskyAppPassword: 'app-password',
    },
    {}
  );

  assert.deepEqual(config, {
    xBearerToken: 'token',
    xUserId: '123',
    bskyHandle: 'user.bsky.social',
    bskyAppPassword: 'app-password',
  });
});

test('inline task runner executes tasks immediately', async () => {
  const runner = createInlineTaskRunner();
  const result = await runner.run('demo.task', async () => 'ok');

  assert.equal(result, 'ok');
});
