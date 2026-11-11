#!/usr/bin/env node
/** Sequential working-tree gates. External acceptance never inherits local test success. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secretName = /(?:password|token|secret|credential|api[_-]?key|private[_-]?key|access[_-]?key|(?:^|_)key(?:$|_)|github[_-]?pat|authorization)/i;
export function redactLog(text, env = process.env) {
  let result = text;
  for (const [name, value] of Object.entries(env)) {
    if (secretName.test(name) && typeof value === 'string' && value.length >= 4) result = result.split(value).join('[REDACTED]');
  }
  return result
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}
export function classify({ exitCode, timedOut, error, truncated, log }) {
  const plainLog = log.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  if (timedOut || error || exitCode !== 0) return 'Failed';
  if (truncated || /(?:# skipped\s+[1-9]|ℹ skipped\s+[1-9]|[1-9]\d*\s+(?:skip|skipped)|skipped\s*=\s*[1-9]|# tests\s+0\b|No tests found)/i.test(plainLog)) return 'Incomplete';
  return 'Passed';
}

/** No command bodies, environment or raw output is printed. Logs are bounded and redacted before saving. */
export async function runStep(step, { cwd = repositoryRoot, env = process.env, timeoutMs = 180000, maxLogBytes = 8 * 1024 * 1024 } = {}) {
  const started = Date.now();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  let timedOut = false;
  let spawnFailed = false;
  let hardKill;
  const outcome = await new Promise(done => {
    let child;
    try { child = spawn(step.binary, step.args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' }); }
    catch { spawnFailed = true; done(null); return; }
    function terminate(signal) {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); });
      } else {
        try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
      }
    }
    const timer = setTimeout(() => { timedOut = true; terminate('SIGTERM'); hardKill = setTimeout(() => terminate('SIGKILL'), 2000); }, timeoutMs);
    function capture(chunk) {
      const remaining = maxLogBytes - bytes;
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); bytes += Math.min(chunk.length, remaining); }
    }
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', () => { spawnFailed = true; });
    child.on('close', code => { clearTimeout(timer); clearTimeout(hardKill); done(code); });
  });
  const log = redactLog(Buffer.concat(chunks).toString('utf8'), env) + (truncated ? '\n[Log truncated]\n' : '');
  const result = { id: step.id, status: classify({ exitCode: outcome, timedOut, error: spawnFailed, truncated, log }), exitCode: outcome, timedOut, spawnFailed, truncated, durationMs: Date.now() - started, log: `${step.id}.log` };
  return { result, log };
}

export async function buildSteps({ root = repositoryRoot, env = process.env, node = process.execPath } = {}) {
  const features = (await readdir(resolve(root, 'packages/features/src'))).filter(name => name.endsWith('.test.ts')).sort().map(name => `packages/features/src/${name}`);
  if (!features.length) throw new Error('Feature tests not found');
  const nodeTests = (id, files, loader = false) => ({ id, binary: node, args: [...(loader ? ['--import', './apps/server/node_modules/tsx/dist/loader.mjs'] : []), '--test', '--test-concurrency=1', ...files] });
  const serverTests = ['comex-workspace', 'comex-installed-opencode', 'comex-installed-browser', 'comex-continuity', 'comex-continuity-routes', 'comex-git', 'comex-git-routes', 'specialist-applications'];
  return [
    nodeTests('features', features),
    nodeTests('server', serverTests.map(name => `apps/server/test/${name}.test.ts`), true),
    nodeTests('evaluation', ['scripts/comex-eval.test.mjs']),
    nodeTests('maintenance', ['scripts/local-backup.test.mjs', 'scripts/refresh-model-catalog.test.mjs', 'scripts/fork-maintenance.test.mjs']),
    nodeTests('verification-runner', ['scripts/comex-verify.test.mjs']),
    nodeTests('distribution', ['apps/desktop/electron/updater.test.mjs', 'scripts/release/comex-artifacts.test.mjs', 'scripts/release/comex-python-runtime.test.mjs']),
    { id: 'pack', binary: env.COMEX_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), args: ['-X', 'utf8', '-B', '-m', 'unittest', 'discover', '-s', 'pack/tests', '-v'] },
    { id: 'pack-format', binary: env.COMEX_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), args: ['-X', 'utf8', 'pack/scripts/validar.py'] },
    { id: 'interface', binary: env.COMEX_BUN ?? 'bun', args: ['test', 'apps/app/tests/comex-continuity-panel.test.tsx', 'apps/app/tests/comex-git-panel.test.tsx', 'apps/app/tests/comex-project-panel.test.tsx'] },
    { id: 'server-types', binary: node, args: ['apps/server/node_modules/typescript/bin/tsc', '-p', 'apps/server/tsconfig.json', '--noEmit'] },
    { id: 'interface-types', binary: node, args: ['apps/app/node_modules/typescript/bin/tsc', '-p', 'apps/app/tsconfig.json', '--noEmit'] },
  ];
}

export function verificationReport(results, complete) {
  const localStatus = results.some(r => r.status === 'Failed') ? 'Failed' : !complete || results.some(r => r.status !== 'Passed') ? 'Incomplete' : 'Passed';
  return {
    schemaVersion: 1, verifiedAt: new Date().toISOString(), scope: 'local-working-tree',
    status: localStatus === 'Failed' ? 'Failed' : 'Incomplete', localStatus, complete, results,
    externalAcceptance: { status: 'Incomplete', pending: ['casos generales con modelo autenticado, fuentes reales y revisión del resultado', 'instalación Windows limpia', 'actualización instalada A a B preservando datos', 'runtime documental en instalación empaquetada limpia', 'revisión visual de entregables'] },
  };
}

export async function verify({ steps, output, cwd = repositoryRoot, env = process.env, timeoutMs, onProgress = () => {}, execute = runStep }) {
  await mkdir(output, { recursive: true });
  const results = [];
  const save = async complete => { const report = verificationReport(results, complete); await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n'); return report; };
  await save(false);
  for (const step of steps) {
    if (!/^[a-z0-9-]+$/.test(step.id)) throw new Error('Invalid verification step ID');
    onProgress(`Verificando ${step.id}…`);
    const { result, log } = await execute(step, { cwd, env, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    await writeFile(resolve(output, result.log), redactLog(log, env));
    results.push(result);
    await save(false);
    onProgress(`${step.id}: ${result.status}`);
  }
  return save(true);
}

export async function main(args = process.argv.slice(2)) {
  const index = args.indexOf('--out');
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('Missing --out directory');
  const output = resolve(index < 0 ? resolve(repositoryRoot, 'tmp/comex-verification') : args[index + 1]);
  const report = await verify({ steps: await buildSteps(), output, onProgress: console.log });
  if (report.localStatus !== 'Passed') process.exitCode = 1;
  console.log(`Gates locales: ${report.localStatus}. Aceptación externa: ${report.externalAcceptance.status}.`);
  console.log(`Evidencia: ${resolve(output, 'verification.json')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('No se pudo completar la verificación. Revisá la ruta de salida y las herramientas requeridas.'); process.exitCode = 2; });
