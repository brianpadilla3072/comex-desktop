import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from './live-browser-debug.mjs';
import { browserCandidates, parseArgs, safeUrl, summarizeStates } from './live-browser-debug-core.mjs';

test('diagnostic URLs omit credentials, query values and OAuth hashes', () => {
  assert.equal(safeUrl('http://user:secret@localhost:4000/path?token=secret#access_token=secret'), 'http://localhost:4000/path?redacted#redacted');
  assert.equal(safeUrl('http://localhost:4000/#/workspace/ws_example/session/ses_example?token=secret'), 'http://localhost:4000/#/workspace/ws_example/session/ses_example');
});
test('browser discovery supports platform locations and overrides without running a shell', () => {
  assert.equal(browserCandidates('linux', { CHROME_PATH: '/custom/chrome', PATH: '/usr/bin:/opt/bin' })[0], '/custom/chrome');
  assert.ok(browserCandidates('linux', { PATH: '/usr/bin:/opt/bin' }).some(path => path.endsWith('/opt/bin/chromium')));
  assert.ok(browserCandidates('darwin', {}).includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  const windows = browserCandidates('win32', { PROGRAMFILES: 'C:/Program Files', PATH: 'C:/Browser;D:/Tools' });
  assert.ok(windows.some(path => path.replaceAll('\\', '/').endsWith('D:/Tools/msedge.exe')));
  assert.ok(windows.some(path => path.includes('Program Files') && path.endsWith('chrome.exe')));
});
test('live diagnostics require an explicit CDP endpoint and bounded observation', async () => {
  assert.throws(() => parseArgs(['web', '--seconds', '0']), /1–60/);
  assert.throws(() => parseArgs(['web', '--seconds', '61']), /1–60/);
  assert.throws(() => parseArgs(['web', '--wat']), /Unknown/);
  await assert.rejects(main(['native', '--cdp', 'http://localhost:9000', '--url', 'http://localhost:4000']), /requires --session/);
  await assert.rejects(main(['web', '--url', 'file:///tmp/example']), /HTTP/);
});

test('portable JSON vectors pin URL redaction and redirect decisions for Rust', async () => {
  const { readFile } = await import('node:fs/promises');
  const vectors = JSON.parse(await readFile(new URL('../contracts/live-browser-debug/v1/cases.json', import.meta.url), 'utf8'));
  assert.equal(vectors.version, 1);
  for (const vector of vectors.redaction) assert.equal(safeUrl(vector.input), vector.expected);
  for (const vector of vectors.observation) assert.deepEqual(summarizeStates(vector.input), vector.expected);
});
