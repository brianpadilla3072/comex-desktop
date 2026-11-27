import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureRelaunchEnvironment, desktopRelaunchPlan } from '../electron/relaunch-environment.mjs';

test('relaunch restores launcher paths, pins the profile and never inherits runtime nesting', () => {
  const snapshot = captureRelaunchEnvironment({ HOME: '/home/example', XDG_CONFIG_HOME: '/config/example' });
  const first = desktopRelaunchPlan(snapshot, '/config/example/app.dev');
  assert.equal(first.paths.HOME, '/home/example');
  assert.equal(first.paths.XDG_CONFIG_HOME, '/config/example');
  assert.equal(first.paths.OPENWORK_ELECTRON_USERDATA, '/config/example/app.dev');
  assert.equal(first.paths.OPENWORK_SERVER_CONFIG, null);
  assert.deepEqual(desktopRelaunchPlan(snapshot, '/config/example/app.dev'), first);
  const relaunched = Object.fromEntries(Object.entries(first.paths).filter(([, value]) => value !== null));
  assert.deepEqual(desktopRelaunchPlan(captureRelaunchEnvironment(relaunched), '/config/example/app.dev'), first);
});

test('portable relaunch vectors preserve platform paths without rewriting them', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../../contracts/desktop-relaunch/v1/paths.json', import.meta.url), 'utf8'));
  for (const vector of vectors.cases) {
    const result = desktopRelaunchPlan(captureRelaunchEnvironment(vector.env), vector.userData);
    for (const [key, value] of Object.entries(vector.expected)) assert.equal(result.paths[key], value, vector.name + ': ' + key);
  }
});
