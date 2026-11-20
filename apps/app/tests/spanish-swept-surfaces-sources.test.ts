import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// These surfaces showed hard-coded English ("Select folder", "Want more analytics?",
// "Search all models", "Open preview", …) inside the Spanish app. Their text now goes
// through t(); this guard fails if a literal English label comes back as JSX text or as
// an aria-label / placeholder / title / alt.
const SWEPT = [
  "components/chat/composer-pill.tsx", "components/chat/created-skill-card.tsx", "components/chat/image-attachment-badge.tsx",
  "components/chat/mcp-app-frame.tsx", "components/chat/mcp-app-loading.tsx", "components/chat/mcp-app-tool-change.tsx",
  "components/chat/subagent-run-line.tsx", "components/chat/task-recovery.tsx", "components/chat/task-suggestions.tsx",
  "components/markdown/link-action-menu.tsx", "components/markdown/mermaid-zoom-viewport.tsx", "components/panel-tabs.tsx",
  "components/tools/websearch.tsx", "components/ui/dialog.tsx", "components/ui/sidebar.tsx", "components/ui/source.tsx",
  "components/ui/tool.tsx",
  "react-app/domains/apps/app-chat-artifact.tsx", "react-app/domains/apps/built-app-chat-preview.tsx",
  "react-app/domains/apps/built-mcp-app-panel.tsx", "react-app/domains/apps/generated-app-preview.tsx",
  "react-app/domains/connections/web-approvals.tsx", "react-app/domains/dashboard/dashboard-page.tsx",
  "react-app/domains/models/model-picker-list.tsx", "react-app/domains/models/model-picker-panel.tsx",
  "react-app/domains/onboarding/attribution-step.tsx", "react-app/domains/onboarding/provider-selection-step.tsx",
  "react-app/domains/session/artifacts/artifact-panel.tsx", "react-app/domains/session/artifacts/artifact-spreadsheet-editor.tsx",
  "react-app/domains/session/artifacts/preview.tsx", "react-app/domains/session/artifacts/workspace-file-tree.tsx",
  "react-app/domains/session/chat/mobile-chat-navigation.tsx", "react-app/domains/session/chat/new-task-composer.tsx",
  "react-app/domains/session/chat/new-task-destination-menu.tsx", "react-app/domains/session/chat/pending-conversation.tsx",
  "react-app/domains/session/chat/responsive-session-layout.tsx", "react-app/domains/session/chat/session-empty-hero.tsx",
  "react-app/domains/session/panel/browser-presentation.tsx", "react-app/domains/session/panel/browser-window.tsx",
  "react-app/domains/session/panel/panel-empty.tsx", "react-app/domains/session/panel/side-panel.tsx",
  "react-app/domains/session/sidebar/account-status-menu.tsx", "react-app/domains/session/sidebar/app-sidebar.tsx",
  "react-app/domains/session/sidebar/sidebar-chrome.tsx", "react-app/domains/session/surface/composer/model-recovery-note.tsx",
  "react-app/domains/session/surface/composer/native-dictation-control.tsx", "react-app/domains/session/surface/find-bar.tsx",
  "react-app/domains/session/surface/scroll-overlay.tsx", "react-app/domains/session/surface/session-history.tsx",
  "react-app/domains/session/surface/session-surface.tsx", "react-app/domains/session/terminal/terminal-dock.tsx",
  "react-app/domains/settings/appearance/window-section.tsx", "react-app/domains/settings/browser-extension-config.tsx",
  "react-app/domains/settings/desktop-integration-section.tsx", "react-app/domains/settings/ollama-config.tsx",
  "react-app/domains/settings/pages/general-view.tsx", "react-app/domains/settings/pages/keyboard-shortcuts-view.tsx",
  "react-app/domains/settings/pages/plugins-view.tsx", "react-app/domains/settings/pages/updates-view.tsx",
  "react-app/domains/settings/panels/authorized-folders-panel.tsx", "react-app/domains/workspace/create-workspace-local-panel.tsx",
  "react-app/shell/app-error-boundary.tsx", "react-app/shell/command-palette.tsx", "react-app/shell/loading-overlay.tsx",
  "react-app/shell/workspace-startup-status.tsx",
  // Less-used screens: cloud/Den after signing in, computer use, MCP connection help, advanced settings.
  "components/chat/computer-crew.tsx", "components/chat/computer-session-history.tsx", "components/model-select.tsx",
  "react-app/design-system/extension-detail-modal.tsx", "react-app/domains/apps/built-app-share-button.tsx",
  "react-app/domains/automations/automation-editor.tsx", "react-app/domains/automations/automation-model-button.tsx",
  "react-app/domains/automations/automation-schedule-fields.tsx", "react-app/domains/automations/automations-page.tsx",
  "react-app/domains/cloud/activation/activation-card.tsx", "react-app/domains/cloud/auto-access-ui.tsx",
  "react-app/domains/cloud/brand-theme.tsx", "react-app/domains/cloud/connect-link-provider.tsx",
  "react-app/domains/cloud/den-reauth-notice.tsx", "react-app/domains/cloud/den-signin-surface.tsx",
  "react-app/domains/cloud/enterprise-activation-gate.tsx", "react-app/domains/cloud/gateway-usage-panel.tsx",
  "react-app/domains/cloud/openwork-web-access-gate.tsx", "react-app/domains/cloud/org-onboarding-page.tsx",
  "react-app/domains/cloud/sign-in-handoff-notice.tsx", "react-app/domains/connections/member-api-key-dialog.tsx",
  "react-app/domains/dashboard/artifacts-page.tsx", "react-app/domains/dashboard/built-dashboard-apps.tsx",
  "react-app/domains/dashboard/dashboard-apps.tsx", "react-app/domains/dashboard/dashboard-tile-shell.tsx",
  "react-app/domains/dashboard/mcp-app-tile.tsx", "react-app/domains/dashboard/share-dashboard-button.tsx",
  "react-app/domains/session/computer/cloud-computer-control.tsx", "react-app/domains/session/computer/computer-panel.tsx",
  "react-app/domains/session/computer/computer-request-panel.tsx", "react-app/domains/settings/cloud/agent-access-card.tsx",
  "react-app/domains/settings/cloud/cloud-account-section.tsx", "react-app/domains/settings/pages/advanced-view-sections.tsx",
  "react-app/domains/settings/pages/advanced-view.tsx", "react-app/domains/settings/pages/cloud-account-view.tsx",
  "react-app/domains/settings/pages/computer-use-view.tsx", "react-app/domains/settings/cloud/sections.tsx",
  "react-app/domains/cloud/usage-limit-card.tsx",
];
const ATTRIBUTES = new Set(["aria-label", "placeholder", "title", "alt"]);
const ENGLISH_WORD = /\b(the|a|an|to|of|and|or|your|this|no|not|add|select|open|save|create|delete|remove|close|new|edit|loading|failed|error|connect|choose|search|copy|show|hide|back|next|cancel|retry|yes|is|are|in|for|with|more|name|folder|file|workspace|session|settings|model|run|stop|send|view|sign|enable|disable|set|use)\b/i;
const SPANISH_HINT = /[áéíóúñ¿¡]|\b(de|la|el|los|las|que|para|con|una|un|se|del|sin|por)\b/i;
const looksEnglish = (text: string) => /[A-Za-z]{2,}/.test(text) && ENGLISH_WORD.test(text) && !SPANISH_HINT.test(text) && !/^[a-z0-9-:[\]/ .]+$/.test(text);

function englishLiterals(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && looksEnglish(node.text.trim())) found.push(node.text.trim());
    if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression) ? init.expression : null;
      if (literal && looksEnglish(literal.text)) found.push(`${node.name.getText()}="${literal.text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("the guard sees a hard-coded English label", () => {
  expect(englishLiterals("x.tsx", '<b aria-label="Select folder">Want more analytics?</b>')).toEqual(['aria-label="Select folder"', "Want more analytics?"]);
  expect(englishLiterals("x.tsx", '<b aria-label={t("a")}>Seleccionar carpeta</b>')).toEqual([]);
});

test("swept surfaces keep their text in the locale files", () => {
  const offenders = SWEPT.flatMap((file) => englishLiterals(file, readFileSync(join(import.meta.dir, "../src", file), "utf8")).map((text) => `${file}: ${text}`));
  expect(offenders).toEqual([]);
});
