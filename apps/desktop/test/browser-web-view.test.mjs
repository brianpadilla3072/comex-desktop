import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserWebRequestSchema } from '@openwork/types/browser-web-view';
import { createBrowserWebView } from '../electron/browser-web-view.mjs';

function fixture() {
  const tab = { tabId: 'tab_example', owner: 'ses_example', url: 'https://example.invalid/' };
  const other = { tabId: 'tab_other', owner: 'ses_other', url: 'https://other.invalid/' };
  const calls = [];
  let paused = false;
  const host = {
    getTab: id => [tab, other].find(tab => tab.tabId === id),
    tabsFor: sessionId => [tab, other].filter(tab => tab.owner === sessionId),
    ownerOf: id => [tab, other].find(tab => tab.tabId === id)?.owner,
    open: async () => { calls.push('open'); return { ok: true, tabId: tab.tabId }; },
    pause: () => { calls.push('pause'); paused = true; }, resume: () => { calls.push('resume'); paused = false; },
    paused: () => paused,
    describe: tab => ({ id: tab.tabId, url: tab.url, title: 'Fixture', control: paused ? 'person' : 'agent', canGoBack: false, canGoForward: false }),
    capture: async () => { calls.push('capture'); return { mimeType: 'image/jpeg', data: 'AQ==', width: 32, height: 24 }; },
    interact: async (_tab, request) => { calls.push(request.input?.type ?? request.operation); },
  };
  return { host, calls, controller: createBrowserWebView(host) };
}

test('viewing has no observe side effects and never captures another conversation', async () => {
  const f = fixture();
  const view = await f.controller.request({ sessionId: 'ses_example', operation: 'state' });
  assert.equal(view.ok, true); assert.equal(view.tab.control, 'agent'); assert.ok(view.frame);
  const foreign = await f.controller.request({ sessionId: 'ses_example', tabId: 'tab_other', operation: 'state' });
  assert.equal(foreign.code, 'browser_tab_not_found');
  assert.deepEqual(f.calls, ['capture']);
});
test('human input requires takeover, and resuming revokes it', async () => {
  const f = fixture();
  const request = { sessionId: 'ses_example', tabId: 'tab_example', operation: 'input', input: { type: 'text', text: 'synthetic' } };
  assert.equal((await f.controller.request(request)).code, 'browser_control_required');
  assert.equal((await f.controller.request({ ...request, operation: 'pause' })).tab.control, 'person');
  const typed = await f.controller.request(request);
  assert.equal(typed.ok, true); assert.equal(typed.frame, undefined, 'keystrokes do not encode a full frame');
  assert.equal((await f.controller.request({ ...request, operation: 'resume' })).tab.control, 'agent');
  assert.equal((await f.controller.request(request)).code, 'browser_control_required');
  assert.equal(f.calls.filter(call => call === 'text').length, 1);
});
test('opening an owned exact URL reuses its tab even during human control', async () => {
  const f = fixture();
  await f.controller.request({ sessionId: 'ses_example', tabId: 'tab_example', operation: 'pause' });
  assert.equal((await f.controller.request({ sessionId: 'ses_example', operation: 'open', url: 'https://example.invalid/' })).ok, true);
  assert.ok(!f.calls.includes('open'));
});
test('canceled queued input never dispatches', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  const result = await f.controller.request({ sessionId: 'ses_example', operation: 'pause' }, { signal: abort.signal });
  assert.equal(result.code, 'browser_view_canceled'); assert.deepEqual(f.calls, []);
});
test('capture failures return a stable error rather than a stale successful frame', async () => {
  const f = fixture(); f.host.capture = async () => { throw new Error('destroyed'); };
  assert.equal((await f.controller.request({ sessionId: 'ses_example', operation: 'state' })).code, 'browser_view_unavailable');
});
test('portable request vectors pin the boundary validation for Rust', async () => {
  const vectors = JSON.parse(await readFile(new URL('../../../contracts/browser-web-view/v1/requests.json', import.meta.url), 'utf8'));
  assert.equal(vectors.version, 1);
  for (const vector of vectors.cases) assert.equal(browserWebRequestSchema.safeParse(vector.input).success, vector.valid, vector.name);
});
