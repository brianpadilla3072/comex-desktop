#!/usr/bin/env node
/** Headless, file-backed model evaluation. Never treats mocked transport as model evidence. */
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SUITE = {
  version: 1,
  tasks: [
    {
      id: 'informe-con-fuentes',
      files: { 'fuentes.json': JSON.stringify({ sources: [{ id: 'S1', title: 'Registro interno A', url: 'https://example.org/registro-a', units: 12 }, { id: 'S2', title: 'Registro interno B', url: 'https://example.org/registro-b', units: 8 }] }, null, 2) },
      prompts: ['Leé fuentes.json. Creá informe.json con totalUnits (suma de units), sourceIds (IDs de las fuentes usadas), sourceUrls (URLs exactas del archivo). No consultes internet ni inventes datos.'],
      output: 'informe.json',
      checks: [
        { id: 'total', field: 'totalUnits', equals: 20 },
        { id: 'fuentes', field: 'sourceIds', equals: ['S1', 'S2'], source: true },
        { id: 'urls', field: 'sourceUrls', equals: ['https://example.org/registro-a', 'https://example.org/registro-b'], source: true },
      ],
    },
    {
      id: 'continuidad-y-correccion',
      files: { 'pedido.json': JSON.stringify({ client: 'Equipo de prueba', currency: 'ARS', quantity: 3, unitPrice: 1200 }) },
      prompts: [
        'Leé pedido.json. Guardá un checkpoint en progreso.json con client, currency y total (quantity por unitPrice). Conservá el archivo para continuar después.',
        'Retomá el checkpoint de progreso.json. Cambiá la cantidad del pedido a 4. Escribí resultado.json con client, currency, quantity y total corregido. Revisá los valores antes de terminar.',
      ],
      checkpoints: [{ afterTurn: 1, output: 'progreso.json', checks: [{ id: 'checkpoint-total', field: 'total', equals: 3600 }, { id: 'checkpoint-client', field: 'client', equals: 'Equipo de prueba' }] }],
      output: 'resultado.json',
      checks: [
        { id: 'cliente', field: 'client', equals: 'Equipo de prueba' },
        { id: 'moneda', field: 'currency', equals: 'ARS' },
        { id: 'cantidad', field: 'quantity', equals: 4 },
        { id: 'total-corregido', field: 'total', equals: 4800 },
      ],
    },
  ],
};
export const suiteHash = createHash('sha256').update(JSON.stringify(SUITE)).digest('hex');
const unwrap = value => value?.data ?? value;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sumKnown = values => values.length && values.every(finite) ? values.reduce((a, b) => a + b, 0) : null;

export function measure(messages) {
  const assistant = messages.map(m => m.info ?? m).filter(m => (m.role ?? m.type) === 'assistant');
  const errors = messages.flatMap(m => {
    const info = m.info ?? m;
    return [...(info.error ? ['assistant_error'] : []), ...(m.parts ?? m.content ?? []).filter(p => p.type === 'tool' && p.state?.status === 'error').map(() => 'tool_error')];
  });
  return { errors, costUsd: sumKnown(assistant.map(m => m.cost)), inputTokens: sumKnown(assistant.map(m => m.tokens?.input)), outputTokens: sumKnown(assistant.map(m => m.tokens?.output)) };
}

export async function evaluateArtifact(task, directory) {
  let artifact;
  let artifactError = null;
  try {
    const root = await realpath(directory);
    const path = await realpath(join(directory, task.output));
    if (!path.startsWith(root + sep)) throw new Error('Output escapes evaluation workspace');
    artifact = JSON.parse(await readFile(path, 'utf8'));
  } catch { artifactError = 'missing_or_invalid_artifact'; }
  const checks = task.checks.map(check => ({ id: check.id, source: Boolean(check.source), passed: !artifactError && JSON.stringify(artifact?.[check.field]) === JSON.stringify(check.equals) }));
  return { artifactError, checks, completion: checks.filter(c => c.passed).length / checks.length, sourcesPassed: checks.some(c => c.source) ? checks.filter(c => c.source).every(c => c.passed) : null };
}

export function openCode({ endpoint, engine, token, username, password, timeoutMs = 120000, pollMs = 300, transport = fetch }) {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Endpoint must be an HTTP URL without credentials, query or fragment');
  if (!['v1', 'v2'].includes(engine)) throw new Error('Engine must be v1 or v2');
  const prefix = engine === 'v2' ? '/api' : '';
  async function request(method, path, directory, body, signal) {
    const url = new URL(base.href.replace(/\/$/, '') + prefix + path);
    url.searchParams.set(engine === 'v2' ? 'location[directory]' : 'directory', directory);
    const response = await transport(url, { method, signal, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : username && password ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // Don't serialize response bodies: authentication/proxy failures may contain credentials.
    if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new Error('OpenCode returned invalid JSON (check endpoint and engine)'); }
  }
  return {
    async create(model, directory) {
      const result = unwrap(await request('POST', '/session', directory, { title: 'Comex evaluation', ...(engine === 'v2' ? { location: { directory }, model: { providerID: model.providerID, id: model.modelID } } : {}) }, AbortSignal.timeout(timeoutMs)));
      const id = result?.id ?? result?.info?.id;
      if (typeof id !== 'string' || !id) throw new Error('Invalid session response');
      return id;
    },
    async prompt(sessionID, model, directory, text) {
      const signal = AbortSignal.timeout(timeoutMs);
      const path = `/session/${encodeURIComponent(sessionID)}`;
      try {
        if (engine === 'v1') {
          await request('POST', `${path}/message`, directory, { model, parts: [{ type: 'text', text }] }, signal);
        } else {
          await request('POST', `${path}/model`, directory, { model: { providerID: model.providerID, id: model.modelID } }, signal);
          const before = await this.messages(sessionID, directory, signal);
          const seen = new Set(before.map(m => m.id ?? m.info?.id));
          await request('POST', `${path}/prompt`, directory, { text, delivery: 'steer' }, signal);
          for (;;) {
            signal.throwIfAborted();
            const rows = await this.messages(sessionID, directory, signal);
            const fresh = rows.filter(m => !seen.has(m.id ?? m.info?.id));
            const active = unwrap(await request('GET', '/session/active', directory, undefined, signal));
            const replied = fresh.some(m => ['assistant', 'idle'].includes(m.role ?? m.type ?? m.info?.role));
            if (replied && active?.[sessionID]?.type !== 'running') break;
            await new Promise(r => setTimeout(r, pollMs));
          }
        }
      } catch (error) {
        // Stop the timed-out session; never grant permission or retry spending automatically.
        try { await request('POST', `${path}/${engine === 'v2' ? 'interrupt' : 'abort'}`, directory, {}, AbortSignal.timeout(5000)); } catch { /* best effort */ }
        throw error;
      }
    },
    async messages(id, directory, signal = AbortSignal.timeout(timeoutMs)) {
      const all = [];
      const seen = new Set();
      let cursor;
      for (;;) {
        const query = new URLSearchParams({ limit: '200' });
        if (cursor) query.set('cursor', cursor);
        const payload = await request('GET', `/session/${encodeURIComponent(id)}/message?${query}`, directory, undefined, signal);
        const rows = unwrap(payload);
        if (!Array.isArray(rows)) throw new Error('Invalid message history');
        all.push(...rows);
        cursor = payload?.cursor?.next;
        if (engine === 'v1' || cursor === undefined || cursor === null) return all;
        if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new Error('Invalid message history cursor');
        seen.add(cursor);
      }
    },
  };
}

export async function runEvaluation({ client, models, runs = 1, output, evidence = 'live', only }) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('runs must be between 1 and 20');
  const tasks = SUITE.tasks.filter(task => !only || task.id === only);
  if (!tasks.length || !models.length) throw new Error('No tasks or models selected');
  await mkdir(output, { recursive: true });
  const report = { schemaVersion: 1, suiteVersion: SUITE.version, suiteHash, evidence, startedAt: new Date().toISOString(), rows: [] };
  for (const model of models) for (const task of tasks) for (let run = 1; run <= runs; run++) {
    const directory = await mkdtemp(join(tmpdir(), 'comex-eval-'));
    for (const [name, content] of Object.entries(task.files)) await writeFile(join(directory, name), content);
    const start = performance.now();
    const row = { model: `${model.providerID}/${model.modelID}`, task: task.id, run, directory, sessionID: null, status: 'failed', errors: [], costUsd: null, inputTokens: null, outputTokens: null };
    try {
      row.sessionID = await client.create(model, directory);
      for (const [turn, prompt] of task.prompts.entries()) {
        await client.prompt(row.sessionID, model, directory, `${prompt}\nDirectorio de trabajo: ${directory}. Usá herramientas para guardar los archivos solicitados en ese directorio.`);
        for (const checkpoint of task.checkpoints ?? []) if (checkpoint.afterTurn === turn + 1) {
          const result = await evaluateArtifact(checkpoint, directory);
          if (result.completion !== 1) row.errors.push('checkpoint_invalid');
        }
      }
      const messages = await client.messages(row.sessionID, directory);
      const measured = measure(messages);
      measured.errors.unshift(...row.errors);
      Object.assign(row, measured);
    } catch (error) { row.errors.push(error?.name === 'TimeoutError' ? 'timeout' : /^OpenCode HTTP \d+$/.test(error.message) ? error.message : 'execution_error'); }
    Object.assign(row, await evaluateArtifact(task, directory), { elapsedMs: Math.round(performance.now() - start) });
    row.status = row.completion === 1 && row.errors.length === 0 ? 'passed' : 'failed';
    report.rows.push(row);
    // Persist after each task so an interrupted evaluation retains completed observations.
    await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(output, 'comparison.md'), comparison([report]));
  }
  return report;
}

export function comparison(reports) {
  if (!reports.length || reports.some(r => r.schemaVersion !== 1 || r.suiteHash !== suiteHash)) throw new Error('Reports must use the same evaluation suite');
  const groups = new Map();
  for (const report of reports) for (const row of report.rows) {
    const key = JSON.stringify([report.evidence, row.model]);
    if (!groups.has(key)) groups.set(key, { evidence: report.evidence, model: row.model, rows: [] });
    groups.get(key).rows.push(row);
  }
  const lines = ['# Evaluación Comex', '', `Suite: ${suiteHash}`, '', 'Checks deterministas sobre archivos; no miden calidad general ni veracidad en internet. Fixture no demuestra capacidad del modelo.', '', '| Evidencia | Modelo | Tareas aprobadas | Checks aprobados | Errores | Fuentes correctas | Tiempo total ms | Costo USD |', '|---|---|---:|---:|---:|---:|---:|---:|'];
  for (const group of groups.values()) {
    const rows = group.rows;
    const checks = rows.flatMap(r => r.checks);
    const sourceRows = rows.filter(r => r.sourcesPassed !== null);
    const cost = sumKnown(rows.map(r => r.costUsd));
    const safe = text => String(text).replace(/[|\n\r]/g, ' ');
    lines.push(`| ${safe(group.evidence)} | ${safe(group.model)} | ${rows.filter(r => r.status === 'passed').length}/${rows.length} | ${checks.filter(c => c.passed).length}/${checks.length} | ${rows.reduce((n, r) => n + r.errors.length + Number(Boolean(r.artifactError)), 0)} | ${sourceRows.length ? `${sourceRows.filter(r => r.sourcesPassed).length}/${sourceRows.length}` : 'N/A'} | ${rows.reduce((n, r) => n + r.elapsedMs, 0)} | ${cost === null ? 'desconocido' : cost} |`);
  }
  lines.push('', 'Elegir con el mismo conjunto de tareas y repeticiones. Priorizar aprobación y errores; comparar costo/tiempo después. No hay ranking automático ni cambio del modelo de la app.', '');
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  const value = name => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  if (args.includes('--help')) {
    console.log('node scripts/comex-eval.mjs --endpoint URL --engine v1|v2 --models provider/model[,provider/model] [--runs 3] [--only TASK] [--out DIR]\nCOMEX_EVAL_TOKEN: bearer token; or COMEX_EVAL_USERNAME / COMEX_EVAL_PASSWORD for Basic (optional). Existing server and authenticated providers required.\nCompare: --compare result1.json,result2.json [--out DIR]');
    return;
  }
  const output = resolve(value('--out') ?? join(tmpdir(), `comex-eval-report-${Date.now()}`));
  if (value('--compare')) {
    const reports = await Promise.all(value('--compare').split(',').map(async path => JSON.parse(await readFile(path, 'utf8'))));
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'comparison.md'), comparison(reports));
  } else {
    const timeoutMs = Number(value('--timeout-ms') ?? 120000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw new Error('timeout-ms must be between 100 and 600000');
    const endpoint = value('--endpoint') ?? process.env.COMEX_EVAL_ENDPOINT;
    const engine = value('--engine') ?? process.env.COMEX_EVAL_ENGINE;
    const modelNames = value('--models') ?? process.env.COMEX_EVAL_MODELS;
    if (!endpoint || !engine || !modelNames) throw new Error('Required: --endpoint, --engine and --models (see --help)');
    const models = modelNames.split(',').map(name => {
      const slash = name.indexOf('/');
      if (slash < 1 || slash === name.length - 1) throw new Error('Models must use provider/model');
      return { providerID: name.slice(0, slash), modelID: name.slice(slash + 1) };
    });
    const report = await runEvaluation({ client: openCode({ endpoint, engine, token: process.env.COMEX_EVAL_TOKEN, username: process.env.COMEX_EVAL_USERNAME, password: process.env.COMEX_EVAL_PASSWORD, timeoutMs }), models, runs: Number(value('--runs') ?? 1), output, only: value('--only') });
    if (report.rows.some(r => r.status !== 'passed')) process.exitCode = 1;
  }
  console.log(`Report: ${join(output, 'comparison.md')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Evaluation configuration or execution failed. Check --help, endpoint authentication and output directory. No credentials were logged.'); process.exitCode = 2; });
