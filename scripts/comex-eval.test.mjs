import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { SUITE, suiteHash, measure, evaluateArtifact, openCode, runEvaluation, comparison } from './comex-eval.mjs';

test('missing counters are unknown, explicit zero remains zero and failures are counted', () => {
  assert.equal(measure([]).costUsd, null);
  assert.equal(measure([{ info: { role: 'assistant', cost: 0 } }]).costUsd, 0);
  assert.equal(measure([{ role: 'assistant', cost: 2 }, { role: 'assistant' }]).costUsd, null);
  assert.deepEqual(measure([{ info: { error: {} }, parts: [{ type: 'tool', state: { status: 'error' } }] }]).errors, ['assistant_error', 'tool_error']);
});

test('scores real files, rejects missing, wrong and escaping output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'comex-eval-test-'));
  const task = SUITE.tasks[0];
  assert.equal((await evaluateArtifact(task, dir)).completion, 0);
  await writeFile(join(dir, task.output), JSON.stringify({ totalUnits: 20, sourceIds: ['S1', 'S2'], sourceUrls: ['fabricated'] }));
  assert.equal((await evaluateArtifact(task, dir)).sourcesPassed, false);
  assert.equal((await evaluateArtifact(task, dir)).completion, 2 / 3);
  await symlink(join(dir, task.output), join(dir, 'link.json'));
  const other = await mkdtemp(join(tmpdir(), 'comex-eval-test-'));
  await symlink(join(dir, task.output), join(other, task.output));
  assert.equal((await evaluateArtifact(task, other)).completion, 0);
});

test('v2 HTTP fixture exercises admission, polling, multi-turn continuity and persisted comparison', async t => {
  const sessions = new Map();
  let id = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    assert.ok(url.searchParams.has('location[directory]'));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    res.setHeader('Content-Type', 'application/json');
    const send = data => res.end(JSON.stringify({ data }));
    if (req.method === 'POST' && url.pathname === '/api/session') {
      const sessionID = `fixture-${++id}`;
      sessions.set(sessionID, { directory: body.location.directory, messages: [], prompts: 0 });
      return send({ id: sessionID });
    }
    if (url.pathname === '/api/session/active') return send({});
    const [, sessionID, operation] = url.pathname.match(/\/session\/([^/]+)\/(\w+)$/) ?? [];
    const session = sessions.get(sessionID);
    if (!session) { res.writeHead(404); return res.end('{}'); }
    if (operation === 'model') return send({});
    if (operation === 'message') return send(session.messages);
    if (operation === 'prompt') {
      session.prompts++;
      if (body.text.includes('informe.json')) await writeFile(join(session.directory, 'informe.json'), JSON.stringify({ totalUnits: 20, sourceIds: ['S1', 'S2'], sourceUrls: ['https://example.org/registro-a', 'https://example.org/registro-b'] }));
      if (body.text.includes('progreso.json') && session.prompts === 1) await writeFile(join(session.directory, 'progreso.json'), JSON.stringify({ client: 'Equipo de prueba', currency: 'ARS', total: 3600 }));
      if (body.text.includes('resultado.json')) {
        assert.equal(session.prompts, 2);
        await writeFile(join(session.directory, 'resultado.json'), JSON.stringify({ client: 'Equipo de prueba', currency: 'ARS', quantity: 4, total: 4800 }));
      }
      session.messages.push({ id: `m${session.prompts}`, role: 'assistant', cost: 0, tokens: { input: 10, output: 4 }, parts: [] });
      return send({});
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const output = await mkdtemp(join(tmpdir(), 'comex-eval-reports-'));
  const report = await runEvaluation({ client: openCode({ endpoint: `http://127.0.0.1:${server.address().port}`, engine: 'v2' }), models: [{ providerID: 'fixture', modelID: 'transport-only' }], evidence: 'fixture', output });
  assert.equal(report.rows.length, 2);
  assert.ok(report.rows.every(r => r.status === 'passed'));
  assert.equal(report.rows[1].inputTokens, 20);
  assert.equal(report.evidence, 'fixture');
  assert.match(await readFile(join(output, 'comparison.md'), 'utf8'), /fixture/);
  assert.match(await readFile(join(output, 'results.json'), 'utf8'), /"suiteHash"/);
});

test('v1 sends native model prompt and preserves provider failures', async () => {
  const calls = [];
  const client = openCode({ endpoint: 'http://localhost:9999', engine: 'v1', token: 'secret', transport: async (url, init) => {
    calls.push({ url: String(url), ...init });
    return new Response(JSON.stringify({ id: 's' }), { status: 200 });
  } });
  const model = { providerID: 'provider', modelID: 'model/name' };
  const id = await client.create(model, '/tmp/example');
  await client.prompt(id, model, '/tmp/example', 'hello');
  assert.match(calls[1].url, /\/session\/s\/message/);
  assert.deepEqual(JSON.parse(calls[1].body).model, model);
  const failing = openCode({ endpoint: 'http://localhost', engine: 'v2', transport: async () => new Response('sensitive response', { status: 401 }) });
  await assert.rejects(failing.create(model, '/tmp/example'), /^Error: OpenCode HTTP 401$/);
});

test('comparison refuses mismatched suites and reports unknown cost', () => {
  assert.throws(() => comparison([{ schemaVersion: 1, suiteHash: 'wrong', rows: [] }]));
  assert.match(comparison([{ schemaVersion: 1, suiteHash, evidence: 'live', rows: [{ model: 'p/m', checks: [], errors: [], costUsd: null, elapsedMs: 1, sourcesPassed: null }] }]), /desconocido/);
});


test('native v2 content tool errors and Basic auth are supported without secrets in results', async () => {
  assert.deepEqual(measure([{ type: 'assistant', content: [{ type: 'tool', state: { status: 'error' } }] }]).errors, ['tool_error']);
  let auth;
  const client = openCode({ endpoint: 'http://localhost', engine: 'v2', username: 'opencode', password: 'fixture-secret', transport: async (_url, init) => { auth = init.headers.Authorization; return new Response('{"data":{"id":"s"}}'); } });
  assert.equal(await client.create({ providerID: 'p', modelID: 'm' }, '/tmp/test'), 's');
  assert.equal(auth, 'Basic ' + Buffer.from('opencode:fixture-secret').toString('base64'));
});

test('failed tasks retain a report and never pass because a client merely said done', async () => {
  const output = await mkdtemp(join(tmpdir(), 'comex-eval-fail-'));
  const report = await runEvaluation({ client: { create: async () => { throw new Error('private credential text'); } }, models: [{providerID:'fixture', modelID:'failing'}], output, evidence: 'fixture' });
  assert.ok(report.rows.every(r => r.status === 'failed' && r.costUsd === null));
  assert.doesNotMatch(await readFile(join(output, 'results.json'), 'utf8'), /private credential/);
});

test('reads all v2 history pages and rejects a cycling cursor', async () => {
  let calls = 0;
  const client = openCode({ endpoint: 'http://localhost', engine: 'v2', transport: async url => {
    calls++;
    const cursor = new URL(url).searchParams.get('cursor');
    return new Response(JSON.stringify(cursor ? { data: [{ id: 'b', type: 'assistant' }], cursor: { next: null } } : { data: [{ id: 'a', type: 'assistant' }], cursor: { next: 'page-2' } }));
  } });
  assert.equal((await client.messages('s', '/tmp/test')).length, 2);
  assert.equal(calls, 2);
  const cyclic = openCode({ endpoint: 'http://localhost', engine: 'v2', transport: async () => new Response('{"data":[],"cursor":{"next":"same"}}') });
  await assert.rejects(cyclic.messages('s', '/tmp/test'), /cursor/);
});

test('a timed-out prompt interrupts its session without granting permissions', async () => {
  const calls = [];
  const client = openCode({ endpoint: 'http://localhost', engine: 'v2', timeoutMs: 30, transport: async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith('/prompt')) return await new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      // Keep the process alive while AbortSignal.timeout's unref timer expires.
      setTimeout(() => reject(new Error('test failed to abort')), 100).unref?.();
    });
    return new Response(path.endsWith('/message') ? '{"data":[]}' : '{}');
  } });
  const keepAlive = setTimeout(() => {}, 200);
  try { await assert.rejects(client.prompt('s', {providerID:'p',modelID:'m'}, '/tmp/test', 'hello'), error => error.name === 'TimeoutError'); }
  finally { clearTimeout(keepAlive); }
  assert.ok(calls.includes('/api/session/s/interrupt'));
  assert.ok(calls.every(path => !path.includes('permission')));
});
