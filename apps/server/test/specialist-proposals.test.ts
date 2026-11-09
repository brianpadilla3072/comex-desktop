import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiError } from "../src/errors.js";
import { addProposal, listProposals, removeProposal } from "../src/specialists/proposals.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialists-proposals-"));
  return { config: { configPath: join(root, "server.json") }, root };
}

const base = { description: "Lo que aprendí.", reason: "Se repite cada lunes." };

test("task proposals are validated at rest and land in the inbox", async () => {
  const { config, root } = await fixture();
  try {
    const bad = await addProposal(config, "app_x", { ...base, kind: "skill" as const, name: "ok-skill", content: "# ok" }).then(() => "ok");
    assert.equal(bad, "ok");
    await assert.rejects(addProposal(config, "app_x", { ...base, kind: "task", name: "Cualquier nombre legible", content: "no-json" }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
    await assert.rejects(addProposal(config, "app_x", { ...base, kind: "task", name: "refrescar", content: JSON.stringify({ prompt: "", schedule: { kind: "interval", everyMinutes: 20 } }) }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
    await assert.rejects(addProposal(config, "app_x", { ...base, kind: "task", name: "refrescar", content: JSON.stringify({ prompt: "Hazlo", schedule: { kind: "interval", everyMinutes: 0 } }) }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
    const accepted = await addProposal(config, "app_x", { ...base, kind: "task", name: "refrescar datos", content: JSON.stringify({ prompt: "Consultá las fuentes.", schedule: { kind: "weekly", daysOfWeek: [1], hour: 9, minute: 0 } }) });
    assert.equal(accepted.proposals[0]?.kind, "task");
    // Un tarea vieja con el mismo nombre se reemplaza, no se duplica.
    await addProposal(config, "app_x", { ...base, kind: "task", name: "refrescar datos", content: JSON.stringify({ prompt: "Actualizado.", schedule: { kind: "daily", hour: 8, minute: 0 } }) });
    const inbox = await listProposals(config, "app_x");
    assert.equal(inbox.filter(entry => entry.kind === "task").length, 1);
    assert.equal((await removeProposal(config, "app_x", inbox[0]!.id)).kind, "task");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("plan proposals validate each piece and refuse empty composites", async () => {
  const { config, root } = await fixture();
  try {
    await assert.rejects(addProposal(config, "app_y", { ...base, kind: "plan", name: "programa semanal", content: "{}" }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
    const plan = {
      skill: { name: "traer-aranceles", description: "Busca aranceles.", content: "# pasos" },
      dataset: { name: "aranceles", query: { provider: "tavily", operation: "search", input: { query: "arancel soja" } } },
      task: { prompt: "Refrescá el dataset y repintá el panel.", schedule: { kind: "interval", everyMinutes: 20 } },
    };
    const accepted = await addProposal(config, "app_y", { ...base, kind: "plan", name: "programa semanal", content: JSON.stringify(plan) });
    assert.equal(accepted.proposals[0]?.kind, "plan");
    assert.match(accepted.proposals[0]!.content, /traer-aranceles/);
    await assert.rejects(addProposal(config, "app_y", { ...base, kind: "plan", name: "roto", content: JSON.stringify({ ...plan, task: { prompt: "", schedule: plan.task.schedule } }) }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
    await assert.rejects(addProposal(config, "app_y", { ...base, kind: "plan", name: "extraño", content: JSON.stringify({ ...plan, desconocido: true }) }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
    // Los kinds clásicos siguen con su regla kebab-case.
    await assert.rejects(addProposal(config, "app_y", { ...base, kind: "skill", name: "Con Espacios", content: "# x" }),
      (error) => error instanceof ApiError && error.code === "invalid_proposal");
  } finally { await rm(root, { recursive: true, force: true }); }
});
