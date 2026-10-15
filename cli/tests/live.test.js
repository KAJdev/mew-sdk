import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.js';
import { ApiClient } from '../src/client.js';

test('CLI publication and private installation against disposable local API', {
  skip: !process.env.MEW_TEST_API_URL,
}, async (t) => {
  const url = new URL(process.env.MEW_TEST_API_URL);
  assert.equal(url.hostname, '127.0.0.1', 'live tests require literal loopback fixtures');
  assert.ok(process.env.MEW_TEST_TOKEN);
  assert.ok(process.env.MEW_TEST_OTHER_TOKEN);
  const env = { MEW_API_URL: url.href, MEW_TOKEN: process.env.MEW_TEST_TOKEN };
  const api = new ApiClient(env.MEW_API_URL, env.MEW_TOKEN);
  const other = new ApiClient(env.MEW_API_URL, process.env.MEW_TEST_OTHER_TOKEN);
  const root = await mkdtemp(path.join(os.tmpdir(), 'mew-live-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'app');
  await run(['init', folder], { output() {} });
  await run(['deploy', folder], { env, output() {} });
  const config = JSON.parse(await readFile(path.join(folder, 'app.json'), 'utf8'));
  assert.equal(config.expected_version, 1);
  const app = await api.request(`apps/${config.app_id}`);
  assert.equal(app.latest_version, 1);
  assert.equal((await api.request('apps/catalog')).items.some((item) => item.id === app.id), false);
  const first = await api.request(`apps/${app.id}/versions/1`);
  assert.ok(first.ui_html.includes('mew.state'));
  const installed = [];
  await run(['install', app.id, '1', 'personal'], {
    env: { ...env, MEW_ACCEPT_PERMISSIONS: 'storage:private,storage:shared' },
    output: (line) => installed.push(JSON.parse(line)),
  });
  const { installation, channel } = installed[0];
  assert.equal(channel.private, true);
  assert.equal(installation.channel_id, channel.id);
  assert.equal(installation.version, 1);
  const endpoint = `app-installations/${installation.id}`;
  const state = (scope, method = 'GET', body) => api.request(`${endpoint}/state/${scope}`, method, body, installation.revision);
  assert.deepEqual(await state('private'), { revision: 0, value: {} });
  await state('private', 'PUT', { expected_revision: 0, value: { preference: 'violet' } });
  assert.deepEqual((await state('private')).value, { preference: 'violet' });
  await assert.rejects(state('private', 'PUT', { expected_revision: 0, value: { preference: 'stale' } }), /Conflict/);
  await assert.rejects(other.request(endpoint), /HTTP 40[34]/);
  await assert.rejects(other.request(`${endpoint}/state/private`, 'GET', undefined, installation.revision), /HTTP 40[34]/);
  await assert.rejects(other.request(`channels/${channel.id}`), /HTTP 40[34]/);
  await state('shared', 'PUT', { expected_revision: 0, value: { count: 1 } });
  assert.deepEqual((await state('shared')).value, { count: 1 });
  await writeFile(path.join(folder, 'index.html'), '<h1>release two</h1>');
  await run(['deploy', folder], { env, output() {} });
  assert.equal((await api.request(endpoint)).version, 1);
  assert.equal((await api.request(`apps/${app.id}/versions/1`)).ui_html, first.ui_html);
  await run(['disable', installation.id], { env, output() {} });
  await assert.rejects(state('private'), /HTTP 40[349]|Conflict/);
  await run(['uninstall', installation.id], { env, output() {} });
  assert.equal((await api.request(`channels/${channel.id}/apps`)).items.length, 0);
  assert.equal((await api.request(`channels/${channel.id}`)).id, channel.id);
});
