import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { redactLog, classify, runStep, buildSteps, verificationReport, verify } from './comex-verify.mjs';

test('classifies skipped Node, Bun and unittest output as incomplete', () => {
  for (const log of ['# skipped 2', 'ℹ skipped 1', '2 skip', '2 skipped', 'OK (skipped=1)', '# tests 0', 'No tests found', '\x1b[32m# skipped \x1b[0m2']) assert.equal(classify({exitCode:0,log}), 'Incomplete', log);
  assert.equal(classify({exitCode:0,log:'# skipped 0'}), 'Passed');
  assert.equal(classify({exitCode:1,log:'# skipped 0'}), 'Failed');
  assert.equal(classify({exitCode:0,timedOut:true,log:''}), 'Failed');
  assert.equal(classify({exitCode:0,truncated:true,log:''}), 'Incomplete');
});

test('redacts secret environment values and standard authorization before saving', () => {
  const value = 'sensitive-test-token';
  const text = redactLog(`debug ${value}\nAuthorization: Basic dXNlcjpwYXNz\nBearer abc.def.ghi\nhttps://user:password@example.test/`, {AWS_ACCESS_KEY_ID:value});
  assert.doesNotMatch(text, /sensitive-test-token|dXNlcjpwYXNz|abc\.def\.ghi|user:password/);
  assert.match(text, /REDACTED/);
});

test('local success never approves unperformed external acceptance', () => {
  const report = verificationReport([{id:'a',status:'Passed'}], true);
  assert.equal(report.localStatus, 'Passed');
  assert.equal(report.status, 'Incomplete');
  assert.equal(report.externalAcceptance.status, 'Incomplete');
  assert.equal(verificationReport([], false).localStatus, 'Incomplete');
  assert.equal(verificationReport([{status:'Failed'}], true).localStatus, 'Failed');
  assert.ok(report.externalAcceptance.pending.includes('runtime documental en instalación empaquetada limpia'));
});

test('real subprocess timeout and nonexistent binary report failures', async () => {
  const timeout = await runStep({id:'timeout',binary:process.execPath,args:['-e','setInterval(() => {}, 100)']}, {timeoutMs:30});
  assert.equal(timeout.result.status, 'Failed');
  assert.equal(timeout.result.timedOut, true);
  const missing = await runStep({id:'missing',binary:'comex-binary-that-does-not-exist',args:[]});
  assert.equal(missing.result.status, 'Failed');
  assert.equal(missing.result.spawnFailed, true);
});

test('bounded output is redacted and cannot produce Passed with lost evidence', async () => {
  const result = await runStep({id:'bounded',binary:process.execPath,args:['-e','process.stdout.write("x".repeat(1000))']}, {maxLogBytes:20});
  assert.equal(result.result.truncated, true);
  assert.equal(result.result.status, 'Incomplete');
  assert.ok(result.log.length < 100);
});

test('orchestration runs steps in order, persists failures and continues independent gates', async () => {
  const output = await mkdtemp(join(tmpdir(), 'comex-verify-'));
  const called = [];
  let running = false;
  const report = await verify({output,steps:[{id:'one'},{id:'two'}],env:{API_TOKEN:'test-private-secret'},execute:async step => {
    assert.equal(running, false);
    running = true;
    if (step.id === 'two') {
      const previous = JSON.parse(await readFile(join(output, 'verification.json'), 'utf8'));
      assert.equal(previous.complete, false);
      assert.equal(previous.results[0].status, 'Failed');
    }
    called.push(step.id);
    await new Promise(r=>setTimeout(r,5));
    running = false;
    return {result:{id:step.id,status:step.id==='one'?'Failed':'Passed',exitCode:step.id==='one'?1:0,log:`${step.id}.log`},log:'test-private-secret'};
  }});
  assert.deepEqual(called, ['one','two']);
  assert.equal(report.complete, true);
  assert.equal(report.localStatus, 'Failed');
  assert.equal(report.externalAcceptance.status, 'Incomplete');
  assert.doesNotMatch(await readFile(join(output,'one.log'),'utf8'), /test-private-secret/);
});

test('step manifest references existing files and serializes Node test files', async () => {
  const steps = await buildSteps();
  for (const step of steps) {
    if (step.args.includes('--test')) assert.ok(step.args.includes('--test-concurrency=1'));
    for (const arg of step.args) if (/\.(?:test\.(?:ts|tsx|mjs)|py)$/.test(arg)) await access(arg);
  }
});
