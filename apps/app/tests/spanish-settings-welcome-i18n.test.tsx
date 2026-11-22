/** @jsxImportSource react */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import en from "../src/i18n/locales/en";
import es from "../src/i18n/locales/es";
import { currentLocale, setLocale } from "../src/i18n";
import { AiSettingsView, aiProvidersDescription, type AiSettingsViewProps } from "../src/react-app/domains/settings/pages/ai-view";
import { CredentialHealthStatus, LocalProviderStatus } from "../src/react-app/domains/settings/pages/provider-rows";
import { providerAccessLabel } from "../src/react-app/domains/settings/pages/cloud-providers-view";

// The web welcome screen, Settings › AI Providers, the OpenCode engine card and
// the notification settings showed English inside the Spanish app ("Welcome to
// OpenWork", "Connect a provider", "On this device", "Chat engine"). Every
// string there goes through t() and every key used has a Spanish translation.

const enEntries: Record<string, string> = en;
const esEntries: Record<string, string> = es;
const src = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

/** Only the engine card of the Advanced page is in scope; the developer diagnostics stay technical. */
function engineSection() {
  const file = src("react-app/domains/settings/pages/advanced-view-sections.tsx");
  const start = file.indexOf("export function AdvancedEngineV2PreviewSection");
  const end = file.indexOf("\ninterface ", start);
  expect(start).toBeGreaterThan(-1);
  return file.slice(start, end);
}

const SURFACES: Record<string, string> = {
  "welcome-route": src("react-app/shell/welcome-route.tsx"),
  "welcome-page": src("react-app/domains/onboarding/welcome-page.tsx"),
  "ai-view": src("react-app/domains/settings/pages/ai-view.tsx"),
  "provider-rows": src("react-app/domains/settings/pages/provider-rows.tsx"),
  "cloud-providers-view": src("react-app/domains/settings/pages/cloud-providers-view.tsx"),
  "cloud-sections": src("react-app/domains/settings/cloud/sections.tsx"),
  "engine-section": engineSection(),
  "engine-controls": src("react-app/shell/opencode-engine-controls.tsx"),
  "web-notification-permission": src("react-app/domains/settings/web-notification-permission.tsx"),
  "desktop-notifications": src("react-app/shell/desktop-notifications.ts"),
};

/** Visible English left in JSX: text nodes, labels and returned sentences with two or more words. */
function hardCodedEnglish(code: string): string[] {
  const found: string[] = [];
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const candidates = [
      ...[...line.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)].map((match) => match[1] ?? ""),
      ...[...line.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)].map((match) => match[1] ?? ""),
      ...[...line.matchAll(/return "([A-Z][^"]*)"/g)].map((match) => match[1] ?? ""),
      ...(/^[A-Z][a-z]+( [A-Za-z,.'’]+)+[.…]?$/.test(trimmed) ? [trimmed] : []),
    ];
    for (const text of candidates) if (/[A-Za-z]{3,} [A-Za-z]{2,}/.test(text.trim())) found.push(text.trim());
  }
  return found;
}

/** String literals that are locale keys, including both arms of `t(cond ? "a" : "b")`. */
function usedKeys(code: string): string[] {
  const keys = new Set<string>();
  for (const match of code.matchAll(/"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g)) {
    const key = match[1] ?? "";
    if (key in enEntries || `${key}_one` in enEntries) keys.add(key);
  }
  return [...keys];
}

test("these surfaces keep no hard-coded English text", () => {
  const leftovers = Object.entries(SURFACES).flatMap(([name, code]) => hardCodedEnglish(code).map((text) => `${name}: ${text}`));
  expect(leftovers).toEqual([]);
});

test("every key these surfaces use has a Spanish translation", () => {
  const missing = Object.entries(SURFACES).flatMap(([name, code]) => usedKeys(code)
    .filter((key) => !(key in esEntries) && !(`${key}_one` in esEntries && `${key}_other` in esEntries))
    .map((key) => `${name}: ${key}`));
  expect(missing).toEqual([]);
});

test("their Spanish uses tú, never voseo", () => {
  const voseo = /\b(Revisá|Probá|Conectá|Elegí|Agregá|Usá|Volvé|Iniciá|Abrí|Pegá|Escribí|Hacé|Activá|Desactivá|Seleccioná|Intentá|Esperá|Permití|Actualizá|Contactá|Soltá|tenés|podés|querés|necesitás|sabés)\b/;
  const keys = Object.values(SURFACES).flatMap(usedKeys).flatMap((key) => [key, `${key}_one`, `${key}_other`]);
  const offenders = keys.filter((key) => voseo.test(esEntries[key] ?? "")).map((key) => `${key}: ${esEntries[key]}`);
  expect(offenders).toEqual([]);
});

const previousLocale = currentLocale();
afterAll(() => setLocale(previousLocale));

const view: AiSettingsViewProps = {
  busy: false,
  runtimeWorkspaceId: "workspace-test",
  providerAuthBusy: false,
  providerStatusLabel: "",
  providerStatusStyle: "",
  providerSummary: "",
  providerLoadState: { status: "ready", error: null },
  onRetryProviders: () => {},
  connectedProviders: [{ id: "provider-test", name: "Test provider", source: "env" }],
  disconnectingProviderId: null,
  providerConnectError: null,
  providerDisconnectStatus: null,
  providerDisconnectError: null,
  onOpenProviderAuth: () => {},
  onDisconnectProvider: () => {},
  canDisconnectProvider: () => true,
  canAddProviders: true,
  autoPreferences: { enabled: true, available: true, canEnable: true },
  onSetAutoEnabled: () => {},
};

test("Settings › AI Providers renders in Spanish", () => {
  setLocale("es");
  const markup = renderToStaticMarkup(<AiSettingsView {...view} />)
    + renderToStaticMarkup(<CredentialHealthStatus health="unverified" />)
    + renderToStaticMarkup(<LocalProviderStatus state="managed_by_organization" />);
  for (const english of ["Connect a provider", "On this device", "Works without an account", "Environment credential", "Ready to use", "Turn off", "Not checked yet", "manages AI providers", "AI Providers", " providers<"]) {
    expect(markup).not.toContain(english);
  }
  expect(markup).toContain("Proveedores de IA");
  expect(markup).toContain("Conectar un proveedor");
  expect(markup).toContain("En este dispositivo");
  expect(markup).toContain("Funciona sin cuenta");
  expect(markup).toContain("Credencial del entorno");
  expect(markup).toContain("Listo para usar");
  expect(markup).toContain("Desactivar");
  expect(markup).toContain("Aún sin comprobar");
  expect(markup).toContain("2 proveedores");
  expect(aiProvidersDescription({ signedIn: false })).toStartWith("Modelos que tus agentes");
  expect(providerAccessLabel({ allMembers: false, teamNames: [], memberCount: 1 })).toBe("1 miembro");
});

test("English stays the default copy", () => {
  setLocale("en");
  const markup = renderToStaticMarkup(<AiSettingsView {...view} />);
  expect(markup).toContain("Connect a provider");
  expect(markup).toContain("2 providers");
});
