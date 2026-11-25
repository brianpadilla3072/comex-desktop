import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resuelve un estilo por ruta o por nombre de la biblioteca.
 *
 *   resolveStyle("video-projects/x/style.json")  → ruta tal cual
 *   resolveStyle("asyncstudio-promo")            → library/styles/asyncstudio-promo.json
 *
 * La biblioteca se puede cambiar con HF_STYLE_LIBRARY.
 */
export function resolveStyle(value, projectDir = process.cwd()) {
  if (!value) return null;
  const raw = String(value);
  const libraries = [
    process.env.HF_STYLE_LIBRARY,
    process.env.VIDEO_LIBRARY ? path.join(process.env.VIDEO_LIBRARY, "styles") : null,
    path.join(os.homedir(), ".openwork", "video", "library", "styles"),
    path.resolve(process.cwd(), "video-library", "styles"),
  ].filter(Boolean);

  const candidates = [
    path.resolve(raw),
    path.resolve(`${raw}.json`),
    path.resolve(projectDir, raw),
    path.resolve(projectDir, `${raw}.json`),
    ...libraries.flatMap((library) => [
      path.join(library, `${raw}.json`),
      path.join(library, raw, "style.json"),
    ]),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}
