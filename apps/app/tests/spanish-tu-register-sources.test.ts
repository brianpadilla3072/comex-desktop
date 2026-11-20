import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The hand-written Spanish outside the locale files (Comex panels, specialist
// dialogs, automations, and the server's error messages) used voseo ("Creá",
// "Revisá", "podés") while `es.ts` uses tú. The app speaks one register: tú.
const repo = join(import.meta.dir, "../../..");
const ROOTS = [
  "apps/app/src/react-app",
  "apps/app/src/components",
  "apps/app/src/app",
  "apps/app/src/comex-design.tsx",
  "apps/server/src",
  "apps/desktop/electron",
];
// Locale catalogs are covered by spanish-locale-coverage.test.ts; other languages live there too.
const SKIP_DIRS = new Set(["node_modules", "dist", "locales"]);

// Voseo imperatives and present-tense forms, plus the enclitic ones that lose their accent.
// Tú forms that look alike ("está", "más", "podrás", "estás") are not in the list.
const VOSEO_WORDS = [
  "abrí", "achicá", "activá", "actualizá", "adoptá", "agregá", "ajustá", "andá", "aplicá", "aprobá", "avisá", "borrá",
  "buscá", "cambiá", "cerrá", "citá", "cloná", "compartí", "completá", "conectá", "configurá", "confirmá", "conservá",
  "consolidá", "consultá", "continuá", "contrastá", "convertí", "copiá", "corregí", "creá", "decí", "dejá", "depurá",
  "describí", "desactivá", "distinguí", "editá", "elegí", "enlazá", "entregá", "enviá", "escribí", "esperá", "evitá",
  "explicá", "exportá", "firmá", "generá", "guardá", "hacé", "implementá", "importá", "incluí", "indicá", "ingresá",
  "iniciá", "instalá", "intentá", "introducí", "leé", "llamá", "mandá", "mirá", "mostrá", "ofrecé", "pasá", "pausá",
  "pedí", "pegá", "poné", "preguntá", "prepará", "priorizá", "probá", "programá", "proponé", "quitá", "recordá",
  "reducí", "registrá", "reintentá", "renombrá", "respetá", "respondé", "resumí", "retomá", "revisá", "seleccioná",
  "señalá", "subí", "tocá", "usá", "verificá", "vení", "volvé",
  "acabás", "conservás", "creás", "dejás", "derivás", "enseñás", "guardás", "instalás", "necesitás", "pedís", "podés",
  "producís", "querés", "recibís", "sabés", "seguís", "tenés", "trabajás",
  "abrilo", "achicalo", "avisale", "conectalo", "confirmale", "contale", "contame", "decile", "decilo", "decime",
  "descartala", "fijate", "haceme", "mostrame", "pasale", "pedile", "preguntame", "probala", "probalo", "revisala",
  "revisalo", "usalo",
  "sos", "vos",
];
// Accent-aware word boundaries: "Conectándote" or "más" never match; "\nUsá" inside a string literal does.
const VOSEO = new RegExp(`(?<=^|[^\\p{L}]|\\\\n)(${VOSEO_WORDS.join("|")})(?![\\p{L}])`, "giu");

function sourceFiles(path: string): string[] {
  if (/\.(tsx?|mjs)$/.test(path)) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(join(path, entry.name));
    return /\.(tsx?|mjs)$/.test(entry.name) ? [join(path, entry.name)] : [];
  });
}

test("the guard catches voseo and leaves tú alone", () => {
  const hits = (text: string) => [...text.matchAll(VOSEO)].map((match) => match[0]);
  expect(hits('"Creá tu aplicación y volvé a intentar. Si querés, podés revisarlo."')).toEqual(["Creá", "volvé", "querés", "podés"]);
  expect(hits('"Línea\\nUsá la otra"')).toEqual(["Usá"]);
  expect(hits('"Crea tu aplicación, está lista; hay más. Conectándote… Ya estás. Podrás revisarlo."')).toEqual([]);
});

test("Spanish UI and server messages use tú, never voseo", () => {
  const offenders = ROOTS.flatMap((root) => sourceFiles(join(repo, root))).flatMap((file) =>
    readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
      const found = [...line.matchAll(VOSEO)].map((match) => match[0]);
      return found.length ? [`${relative(repo, file)}:${index + 1}: ${found.join(", ")}`] : [];
    }),
  );
  expect(offenders).toEqual([]);
});
