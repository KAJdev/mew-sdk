import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApiClient } from '../src/client.js';
import { run } from '../src/cli.js';

async function fixture(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const request = { method: req.method, path: req.url, authorization: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
    requests.push(request);
    respond(request, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const env = { MEW_API_URL: `http://127.0.0.1:${server.address().port}`, MEW_TOKEN: 'fixture-token' };
  return { requests, env };
}

async function app(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mew-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), '<h1>fixture</h1>');
  await writeFile(path.join(dir, 'app.json'), JSON.stringify({
    name: 'fixture app', description: 'fixture', visibility: 'unlisted', expected_version: 0,
    ui: 'index.html', manifest: { sdk_version: 1, state_version: 1, permissions: ['storage:private'] },
  }));
  return dir;
}

test('listing follows only an explicit bounded cursor and returns next cursor without eager requests', async (t) => {
  const { env, requests } = await fixture(t, (_req, res) => res.end(JSON.stringify({ items: [{ id: 'app' }], next_cursor: 'next' })));
  const output = [];
  await run(['list'], { env, output: (value) => output.push(JSON.parse(value)) });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/v1/apps');
  assert.equal(output[0].next_cursor, 'next');
  await run(['catalog', '--after', 'app?x=1&y=2'], { env, output() {} });
  assert.equal(requests[1].path, '/v1/apps/catalog?after=app%3Fx%3D1%26y%3D2');
  await run(['installations', 'channel', '--after', 'cursor'], { env, output() {} });
  assert.equal(requests[2].path, '/v1/channels/channel/apps?after=cursor');
  for (const args of [['list', '--all'], ['list', '--after'], ['list', '--after', ''], ['list', '--after', 'x'.repeat(129)], ['list', '--after', '\n'], ['catalog', '--after', 'ok', 'extra'], ['installations']]) await assert.rejects(run(args, { env }), /Usage/);
  assert.equal(requests.length, 3);
});

test('API URL rejects insecure remote and credential-bearing URLs', () => {
  for (const url of ['http://example.com', 'https://name:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#secret']) {
    assert.throws(() => new ApiClient(url, 'fixture'));
  }
  assert.doesNotThrow(() => new ApiClient('https://example.com/api', 'fixture'));
  assert.doesNotThrow(() => new ApiClient('http://127.0.0.1:8000', 'fixture'));
});

test('redirects cannot forward account authorization', async (t) => {
  const { env, requests } = await fixture(t, (_req, res) => { res.writeHead(302, { location: '/stolen' }); res.end(); });
  await assert.rejects(new ApiClient(env.MEW_API_URL, env.MEW_TOKEN).request('apps'));
  assert.equal(requests.length, 1);
});

test('deploy shares API manifest and records immutable publication head without credentials', async (t) => {
  const dir = await app(t);
  const { env, requests } = await fixture(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.path === '/v1/apps' ? { id: 'app1' } : { version: 1 }));
  });
  const output = [];
  await run(['deploy', dir], { env, output: (line) => output.push(line) });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].path, '/v1/apps/app1/versions');
  assert.equal(requests[1].body.ui_html, '<h1>fixture</h1>');
  assert.equal(requests[1].body.expected_version, 0);
  assert.deepEqual(requests[1].body.manifest.permissions, ['storage:private']);
  const saved = await readFile(path.join(dir, 'app.json'), 'utf8');
  assert.equal(JSON.parse(saved).expected_version, 1);
  assert.equal(JSON.parse(saved).app_id, 'app1');
  assert.ok(!saved.includes(env.MEW_TOKEN));
  assert.ok(!output.join('').includes(env.MEW_TOKEN));
});

test('stale publication does not silently advance expected version or recreate app', async (t) => {
  const dir = await app(t);
  const { env, requests } = await fixture(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.path === '/v1/apps') res.end(JSON.stringify({ id: 'app1' }));
    else { res.statusCode = 409; res.end('{}'); }
  });
  await assert.rejects(run(['deploy', dir], { env }), /Conflict/);
  await assert.rejects(run(['deploy', dir], { env }), /Conflict/);
  const saved = JSON.parse(await readFile(path.join(dir, 'app.json'), 'utf8'));
  assert.equal(saved.expected_version, 0);
  assert.equal(saved.app_id, 'app1');
  assert.equal(requests.filter((req) => req.path === '/v1/apps').length, 1);
});

test('install requires exact explicit permission consent before private channel creation', async (t) => {
  const { env, requests } = await fixture(t, (_req, res) => { res.end(JSON.stringify({ manifest: { permissions: ['storage:private'] } })); });
  await assert.rejects(run(['install', 'app1', '1', 'personal'], { env }), /consent/);
  assert.equal(requests.length, 1);
  await run(['install', 'app1', '1', 'personal'], { env: { ...env, MEW_ACCEPT_PERMISSIONS: 'storage:private' }, output() {} });
  assert.deepEqual(requests.at(-1).body.target, { type: 'personal' });
  assert.deepEqual(requests.at(-1).body.accepted_permissions, ['storage:private']);
});

test('artifact paths cannot read outside the project through symlinks', async (t) => {
  const dir = await app(t);
  await rm(path.join(dir, 'index.html'));
  await symlink('/etc/passwd', path.join(dir, 'index.html'));
  await assert.rejects(run(['deploy', dir], { env: { MEW_TOKEN: 'fixture' } }), /inside the app folder/);
});

test('API responses are bounded and private error content is not echoed', async (t) => {
  const { env } = await fixture(t, (_req, res) => { res.statusCode = 403; res.end(JSON.stringify({ message: 'private fixture detail' })); });
  await assert.rejects(new ApiClient(env.MEW_API_URL, env.MEW_TOKEN).request('apps'), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes('private fixture detail'));
    return true;
  });
});

test('init scaffolds the SDK sample and dev previews it on loopback', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mew-cli-dev-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'counter');
  await run(['init', dir], { output: () => {} });
  assert.match(await readFile(path.join(dir, 'index.html'), 'utf8'), /mew\.state\.get\('shared'\)/);
  const lines = [];
  const server = await run(['dev', dir, '--port', '0'], { output: (line) => lines.push(line) });
  t.after(() => server.close());
  assert.match(lines[0], /^Previewing .* at http:\/\/127\.0\.0\.1:\d+\/\./);
  const app = await (await fetch(new URL('/app', server.url))).json();
  assert.deepEqual(app.permissions, ['storage:private', 'storage:shared']);
  await assert.rejects(run(['dev', dir, '--port', 'x']), /Usage: mew dev \[folder\] \[--port <port>\]/);
  await assert.rejects(run(['dev', dir, '--host', '1']), /Usage: mew dev/);
});
