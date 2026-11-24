import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveWorkspaceResource, credentialStorePath, listWorkspaceResources } from "../src/specialists/workspace-resources.js";
import { writeArtifact } from "../src/specialists/artifacts.js";
import { workspaceIdForPath } from "../src/workspaces.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "workspace-resources-"));
  await mkdir(join(root, "proyecto"), { recursive: true });
  await mkdir(join(root, "config"), { recursive: true });
  return { root, config: { configPath: join(root, "config", "server.json") } };
}

const metadata = { workspaceId: "ws_test", schemaVersion: 1 as const, workspaceName: "Proyecto de prueba" };

test("guardar un archivo lo copia al workspace y no duplica contenido idéntico", async () => {
  const { root, config } = await fixture();
  try {
    const source = join(root, "adjunto.md");
    await writeFile(source, "# Adjunto\n\nDatos.\n", "utf8");
    const first = await saveWorkspaceResource(config, root, { kind: "file", path: "adjunto.md" });
    assert.equal(first.created, true);
    assert.equal(first.resource.kind, "file");
    assert.match(first.workspacePath, /^proyecto\/recursos\/archivos\//);
    assert.equal(await readFile(join(root, first.workspacePath!), "utf8"), "# Adjunto\n\nDatos.\n");

    const again = await saveWorkspaceResource(config, root, { kind: "file", path: "adjunto.md" });
    assert.equal(again.created, false);
    assert.equal(again.resource.id, first.resource.id);
    assert.equal((await listWorkspaceResources(root)).length, 1);

    await writeFile(source, "# Adjunto\n\nDatos revisados.\n", "utf8");
    const changed = await saveWorkspaceResource(config, root, { kind: "file", path: "adjunto.md" });
    assert.equal(changed.created, true);
    assert.equal((await listWorkspaceResources(root)).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("guardar una URL conserva el enlace sin credenciales embebidas", async () => {
  const { root, config } = await fixture();
  try {
    const result = await saveWorkspaceResource(config, root, { kind: "url", url: "https://example.org/informe", title: "Informe" });
    assert.equal(result.resource.url, "https://example.org/informe");
    assert.equal(await readFile(join(root, result.workspacePath!), "utf8"), "https://example.org/informe\n");
    const again = await saveWorkspaceResource(config, root, { kind: "url", url: "https://example.org/informe" });
    assert.equal(again.created, false);
    await assert.rejects(saveWorkspaceResource(config, root, { kind: "url", url: "https://user:pass@example.org" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("las credenciales quedan como alias en el workspace y el valor en una carpeta privada 0600", async () => {
  const { root, config } = await fixture();
  try {
    const result = await saveWorkspaceResource(config, root, {
      kind: "credential", origin: "https://example.org/login?token=publico", alias: "sitio-ejemplo", secret: "valor-privado-de-prueba",
    });
    assert.equal(result.resource.origin, "https://example.org");
    assert.equal(result.resource.alias, "sitio-ejemplo");
    assert.ok(result.resource.secretRef);
    assert.equal(result.workspacePath, "proyecto/recursos/index.json");

    const onDisk = await readFile(join(root, "proyecto", "recursos", "index.json"), "utf8");
    assert.ok(!onDisk.includes("valor-privado-de-prueba"), "el workspace no debe contener el secreto");
    const privateFile = credentialStorePath(config, workspaceIdForPath(root));
    const secret = await readFile(privateFile, "utf8");
    assert.ok(secret.includes("valor-privado-de-prueba"));
    assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "config", "workspaces"))).mode & 0o777, 0o700);

    // Guardar solo la referencia no sobrescribe el secreto.
    await saveWorkspaceResource(config, root, { kind: "credential", origin: "https://example.org", alias: "sitio-ejemplo" });
    assert.ok((await readFile(privateFile, "utf8")).includes("valor-privado-de-prueba"));

    // Rotar el secreto con el mismo alias sí lo actualiza, sin duplicar el recurso.
    const rotated = await saveWorkspaceResource(config, root, {
      kind: "credential", origin: "https://example.org", alias: "sitio-ejemplo", secret: "valor-rotado-de-prueba",
    });
    assert.equal(rotated.created, false);
    const afterRotation = await readFile(privateFile, "utf8");
    assert.ok(afterRotation.includes("valor-rotado-de-prueba"));
    assert.ok(!afterRotation.includes("valor-privado-de-prueba"));
    assert.equal((await listWorkspaceResources(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("guardar un artefacto por id vuelca su contenido al workspace", async () => {
  const { root, config } = await fixture();
  try {
    const { meta } = await writeArtifact(root, {
      type: "doc", title: "Informe", content: "# Informe\n\nCifras.\n", metadata,
    });
    const result = await saveWorkspaceResource(config, root, { kind: "artifact", id: meta.id });
    assert.equal(result.resource.sourceId, meta.id);
    assert.equal(await readFile(join(root, result.workspacePath!), "utf8"), "# Informe\n\nCifras.\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("acepta una ruta absoluta dentro del workspace (panel de artefactos)", async () => {
  const { root, config } = await fixture();
  try {
    const source = join(root, "documento.txt");
    await writeFile(source, "contenido del panel\n", "utf8");
    const result = await saveWorkspaceResource(config, root, { kind: "file", path: source });
    assert.equal(result.created, true);
    assert.equal(await readFile(join(root, result.workspacePath!), "utf8"), "contenido del panel\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rechaza rutas que salen del workspace, relativas o absolutas", async () => {
  const { root, config } = await fixture();
  try {
    await assert.rejects(saveWorkspaceResource(config, root, { kind: "file", path: "../../secreto.txt", content: "x" }));
    await assert.rejects(saveWorkspaceResource(config, root, { kind: "file", path: "/etc/passwd" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
