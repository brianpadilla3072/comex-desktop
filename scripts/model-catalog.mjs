#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "../packages/types/node_modules/zod/index.js";
import { modelGuideCatalogSchema } from "../packages/types/src/model-guide.ts";

const source = fileURLToPath(new URL("../apps/server/src/model-guide/catalog.json", import.meta.url));
const [command = "check", target] = process.argv.slice(2);
try {
  if (command === "schema") {
    const schema = JSON.stringify(z.toJSONSchema(modelGuideCatalogSchema), null, 2) + "\n";
    if (target) { await mkdir(dirname(resolve(target)), { recursive: true }); await writeFile(target, schema); } else process.stdout.write(schema);
  } else if (command === "check" || command === "export") {
    const catalog = modelGuideCatalogSchema.parse(JSON.parse(await readFile(command === "check" && target ? target : source, "utf8")));
    if (command === "export") {
      const destination = resolve(target ?? "tmp/model-catalog.json");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, JSON.stringify(catalog, null, 2) + "\n");
      console.log(`Catálogo r${catalog.revision} exportado: ${destination}`);
    } else console.log(`Catálogo r${catalog.revision} válido: ${catalog.models.length} ofertas con ficha, ${catalog.providers.length} proveedores.`);
  } else throw new Error("Uso: node scripts/model-catalog.mjs check [archivo] | export [destino] | schema [destino]");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Catálogo inválido");
  process.exitCode = 1;
}
