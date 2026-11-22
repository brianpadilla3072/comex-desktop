/** @jsxImportSource react */
import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Dialog } from "../src/components/ui/dialog";
import { currentLocale, setLocale } from "../src/i18n";
import { CreateWorkspaceLocalPanel, type CreateWorkspaceLocalPanelProps } from "../src/react-app/domains/workspace/create-workspace-local-panel";

// "Crear espacio de trabajo" › "Espacio de trabajo local" showed "Select folder",
// "No folder selected yet." and the "Want more analytics?" card in English.
const previousLocale = currentLocale();
afterAll(() => setLocale(previousLocale));

const noop = () => {};
const props: CreateWorkspaceLocalPanelProps = {
  selectedFolder: null,
  hasSelectedFolder: false,
  pickingFolder: false,
  onPickFolder: noop,
  projectLabel: "",
  onProjectLabelInput: noop,
  showProjectLabel: true,
  submitting: false,
  localError: null,
  onClose: noop,
  onSubmit: noop,
  preset: "starter",
  workerSubmitting: false,
  workerDisabled: false,
  workerDisabledReason: null,
  workerDebugLines: [],
  progress: null,
  elapsedSeconds: 0,
  showProgressDetails: false,
  onToggleProgressDetails: noop,
};

const render = (overrides: Partial<CreateWorkspaceLocalPanelProps> = {}) =>
  renderToStaticMarkup(<Dialog open><CreateWorkspaceLocalPanel {...props} {...overrides} /></Dialog>);

test("the local workspace step is fully Spanish", () => {
  setLocale("es");
  const html = render();
  for (const english of ["Select folder", "No folder selected yet", "Want more analytics?", "Add a project name", "Project name", "(optional)"]) {
    expect(html).not.toContain(english);
  }
  expect(html).toContain("Seleccionar carpeta");
  expect(html).toContain("Todavía no elegiste una carpeta.");
  expect(html).toContain("¿Quieres más estadísticas?");
  const progress = render({
    submitting: true,
    showProgressDetails: true,
    progress: { runId: "r", startedAt: 0, stage: "…", error: null, steps: [], logs: ["línea"] },
  });
  for (const english of ["Sandbox setup", "Hide logs", "Live logs"]) expect(progress).not.toContain(english);
});

test("English keeps its wording", () => {
  setLocale("en");
  const html = render();
  expect(html).toContain("Select folder");
  expect(html).toContain("Want more analytics?");
});
