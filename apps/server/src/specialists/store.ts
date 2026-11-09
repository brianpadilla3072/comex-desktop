import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { chmod, mkdir } from "node:fs/promises";
import { z } from "zod";
import { openRuntimeSqliteDatabase, runtimeStorageDir } from "../runtime-db.js";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";

export const applicationInput = z.object({
  userName: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(80),
  specialty: z.string().trim().min(1).max(500),
  personality: z.string().trim().max(8_000).default("Respondé en castellano, con claridad, fuentes verificables y pasos concretos. Preguntá cuando falten datos y distinguí hechos de supuestos."),
  template: z.enum(["comex", "custom"]).default("custom"),
  packPath: z.string().trim().min(1).max(4_096).optional(),
});
const userSchema = z.object({ id: z.string(), displayName: z.string() });
const applicationId = z.string().regex(/^app_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const applicationSchema = z.object({ id: applicationId, name: z.string(), specialty: z.string(), personality: z.string(), template: z.enum(["comex", "custom"]), agentCount: z.number(), skillCount: z.number(), createdAt: z.number() });
const projectSchema = z.object({ workspaceId: z.string(), applicationId: z.string(), rootPath: z.string() });
export type SpecialistApplication = z.infer<typeof applicationSchema>;
export type SpecialistUser = z.infer<typeof userSchema>;
type Binding = string | number | null;
const APP_COLUMNS = "id, name, specialty, personality, template, agent_count AS agentCount, skill_count AS skillCount, created_at AS createdAt";
const stores = new Map<string, ReturnType<typeof openSpecialistStore>>();
export const specialistDirectory = (config: Pick<ServerConfig, "configPath">) => join(runtimeStorageDir(config), "specialists");
export function specialistStore(config: Pick<ServerConfig, "configPath">) {
  const path = join(specialistDirectory(config), "profiles.sqlite");
  let store = stores.get(path);
  if (!store) {
    store = openSpecialistStore(path); stores.set(path, store);
    const pending = store;
    void pending.catch(() => { if (stores.get(path) === pending) stores.delete(path); });
  }
  return store;
}

/** Normalized local SQLite tables. No names, persona or associations live in localStorage. */
export async function openSpecialistStore(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const runtime = await openRuntimeSqliteDatabase(path);
  await chmod(path, 0o600);
  const sql = runtime.kind === "bun" ? {
    exec: (statement: string) => { runtime.sqlite.run(statement); },
    run: (statement: string, args: Binding[] = []) => { runtime.sqlite.query(statement).run(...args); },
    get: (statement: string, args: Binding[] = []): unknown => runtime.sqlite.query(statement).get(...args),
    all: (statement: string, args: Binding[] = []): unknown[] => runtime.sqlite.query(statement).all(...args),
  } : {
    exec: (statement: string) => { runtime.sqlite.exec(statement); },
    run: (statement: string, args: Binding[] = []) => { runtime.sqlite.prepare(statement).run(...args); },
    get: (statement: string, args: Binding[] = []): unknown => runtime.sqlite.prepare(statement).get(...args),
    all: (statement: string, args: Binding[] = []): unknown[] => runtime.sqlite.prepare(statement).all(...args),
  };
  for (const statement of [
    "PRAGMA foreign_keys = ON", "PRAGMA busy_timeout = 5000", "PRAGMA journal_mode = WAL",
    "CREATE TABLE IF NOT EXISTS specialist_users (id TEXT PRIMARY KEY CHECK(id = 'local'), display_name TEXT NOT NULL)",
    `CREATE TABLE IF NOT EXISTS specialist_applications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES specialist_users(id),
      name TEXT NOT NULL COLLATE NOCASE, specialty TEXT NOT NULL, personality TEXT NOT NULL,
      template TEXT NOT NULL CHECK(template IN ('comex','custom')),
      agent_count INTEGER NOT NULL, skill_count INTEGER NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(user_id, name))`,
    "CREATE TABLE IF NOT EXISTS specialist_user_state (id TEXT PRIMARY KEY CHECK(id = 'local'), application_id TEXT NOT NULL REFERENCES specialist_applications(id))",
    "CREATE TABLE IF NOT EXISTS specialist_provider_settings (application_id TEXT NOT NULL REFERENCES specialist_applications(id), provider_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), PRIMARY KEY(application_id, provider_id))",
    `CREATE TABLE IF NOT EXISTS specialist_projects (
      workspace_id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES specialist_applications(id),
      root_path TEXT NOT NULL UNIQUE)`,
  ]) sql.exec(statement);
  const application = (id: string) => {
    const value = sql.get(`SELECT ${APP_COLUMNS} FROM specialist_applications WHERE id = ?`, [id]);
    if (!value) throw new ApiError(404, "application_not_found", "No se encontró esa aplicación.");
    return applicationSchema.parse(value);
  };
  const user = () => { const value = sql.get("SELECT id, display_name AS displayName FROM specialist_users WHERE id = 'local'"); return value ? userSchema.parse(value) : null; };
  return {
    user, application,
    researchEnabled: (id: string, providerId = "tavily") => {
      application(id);
      const row = sql.get("SELECT enabled FROM specialist_provider_settings WHERE application_id = ? AND provider_id = ?", [id, providerId]);
      return row ? z.object({ enabled: z.number() }).parse(row).enabled === 1 : false;
    },
    setResearchEnabled: (id: string, enabled: boolean, providerId = "tavily") => {
      application(id);
      sql.run("INSERT INTO specialist_provider_settings(application_id, provider_id, enabled) VALUES (?, ?, ?) ON CONFLICT(application_id, provider_id) DO UPDATE SET enabled = excluded.enabled", [id, providerId, enabled ? 1 : 0]);
    },
    updatePackCounts: (id: string, counts: { agents: number; skills: number }) => {
      application(id);
      sql.run("UPDATE specialist_applications SET agent_count = ?, skill_count = ? WHERE id = ?", [counts.agents, counts.skills, id]);
    },
    list: () => {
      const projects = sql.all("SELECT workspace_id AS workspaceId, application_id AS applicationId, root_path AS rootPath FROM specialist_projects").map(value => projectSchema.parse(value));
      const active = sql.get("SELECT application_id AS id FROM specialist_user_state WHERE id = 'local'");
      return { user: user(), activeApplicationId: active ? z.object({ id: z.string() }).parse(active).id : null, applications: sql.all(`SELECT ${APP_COLUMNS} FROM specialist_applications ORDER BY created_at, id`).map(value => {
        const app = applicationSchema.parse(value);
        return { ...app, workspaceIds: projects.filter(project => project.applicationId === app.id).map(project => project.workspaceId) };
      }) };
    },
    create: (input: z.infer<typeof applicationInput>, counts: { agents: number; skills: number }, id = `app_${randomUUID()}`) => {
      applicationId.parse(id);
      if (sql.all("SELECT id FROM specialist_applications LIMIT 100").length >= 100) throw new ApiError(409, "application_limit", "Ya hay 100 aplicaciones locales.");
      if (sql.get("SELECT id FROM specialist_applications WHERE name = ? COLLATE NOCASE", [input.name])) throw new ApiError(409, "application_name_exists", "Ya tenés una aplicación con ese nombre.");
      const local = user();
      if (!local && !input.userName) throw new ApiError(400, "user_name_required", "Ingresá tu nombre para crear el perfil local.");
      sql.exec("BEGIN IMMEDIATE");
      try {
        if (!local) sql.run("INSERT INTO specialist_users(id, display_name) VALUES ('local', ?)", [input.userName!]);
        sql.run("INSERT INTO specialist_applications(id,user_id,name,specialty,personality,template,agent_count,skill_count,created_at) VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)", [id, input.name, input.specialty, input.personality, input.template, counts.agents, counts.skills, Date.now()]);
        sql.run("INSERT INTO specialist_user_state(id, application_id) VALUES ('local', ?) ON CONFLICT(id) DO UPDATE SET application_id = excluded.application_id", [id]);
        sql.exec("COMMIT");
      } catch (error) { sql.exec("ROLLBACK"); throw error; }
      return application(id);
    },
    activate: (id: string) => {
      application(id);
      sql.run("INSERT INTO specialist_user_state(id, application_id) VALUES ('local', ?) ON CONFLICT(id) DO UPDATE SET application_id = excluded.application_id", [id]);
    },
    update: (id: string, input: Pick<SpecialistApplication, "name" | "specialty" | "personality">) => {
      application(id);
      if (sql.get("SELECT id FROM specialist_applications WHERE name = ? COLLATE NOCASE AND id <> ?", [input.name, id])) throw new ApiError(409, "application_name_exists", "Ya tenés una aplicación con ese nombre.");
      sql.run("UPDATE specialist_applications SET name = ?, specialty = ?, personality = ? WHERE id = ?", [input.name, input.specialty, input.personality, id]);
      return application(id);
    },
    bind: (workspaceId: string, applicationId: string, rootPath: string) => {
      application(applicationId);
      const current = sql.get("SELECT workspace_id AS workspaceId, application_id AS applicationId, root_path AS rootPath FROM specialist_projects WHERE workspace_id = ? OR root_path = ?", [workspaceId, rootPath]);
      if (current && projectSchema.parse(current).applicationId !== applicationId) throw new ApiError(409, "project_already_bound", "Ese proyecto pertenece a otra aplicación.");
      sql.run("INSERT INTO specialist_projects(workspace_id, application_id, root_path) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO NOTHING", [workspaceId, applicationId, rootPath]);
    },
    projectsFor: (id: string) => {
      application(id);
      return sql.all("SELECT workspace_id AS workspaceId, application_id AS applicationId, root_path AS rootPath FROM specialist_projects WHERE application_id = ?", [id]).map(value => projectSchema.parse(value));
    },
    forWorkspace: (workspaceId: string) => {
      const row = sql.get("SELECT application_id AS applicationId FROM specialist_projects WHERE workspace_id = ?", [workspaceId]);
      if (!row) return null;
      return application(z.object({ applicationId: z.string() }).parse(row).applicationId);
    },
    close: () => runtime.close(),
  };
}
