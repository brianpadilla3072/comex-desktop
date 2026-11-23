import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });

type Send = { channel: string; payload: unknown };
const sends: Send[] = [];
const listeners = new Map<string, Array<(event: unknown, value: any) => void>>();
const ipcRenderer = {
  on(channel: string, handler: (event: unknown, value: any) => void) {
    listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
  },
  removeListener() {},
  send(channel: string, payload: unknown) { sends.push({ channel, payload }); },
  invoke(channel: string) {
    return Promise.resolve(channel === "openwork:browser:element-selector-state" ? { active: false } : null);
  },
};

// The content preload requires Electron. Give it a recording stub, then load
// the real script against a DOM so we exercise its isolated-world picker.
mock.module("electron", () => ({ ipcRenderer, contextBridge: null, webFrame: null }));

const roots: any[] = [];
const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit) {
  const root = originalAttachShadow.call(this, init);
  roots.push(root);
  return root;
};

await import("../../desktop/electron/browser-content-preload.cjs");

afterAll(() => {
  Element.prototype.attachShadow = originalAttachShadow;
  mock.restore();
  if (ownsDom) void GlobalRegistrator.unregister();
});

function fireState(active: boolean) {
  for (const handler of listeners.get("openwork:browser:element-selector-state") ?? []) handler({}, { active });
}
function trusted<T extends Event>(event: T, extra: Record<string, unknown> = {}): T {
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}
function pickerRoot() {
  const root = roots.filter(candidate => candidate.host?.hasAttribute?.("data-comex-element-picker")).at(-1);
  if (!root) throw new Error("picker root not mounted");
  return root;
}
function pick(target: HTMLElement, comment: string, withCapture: boolean) {
  target.dispatchEvent(trusted(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }), { clientX: 20, clientY: 30 }));
  const root = pickerRoot();
  const input = root.querySelector("input[type=text]") as HTMLInputElement;
  expect(input).toBeDefined();
  input.value = comment;
  const box = root.querySelector("#capture-row input") as HTMLInputElement;
  expect(box).toBeDefined();
  box.checked = withCapture;
  root.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return sends.filter(item => item.channel === "openwork:browser:element-picked").at(-1)?.payload as any;
}

test("the picker outlines a hovered element, sends the comment and exits on Escape", () => {
  fireState(true);
  const target = document.createElement("button");
  target.id = "save";
  target.className = "primary action";
  target.textContent = "Guardar cambios";
  document.body.append(target);
  target.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
  (document as any).elementFromPoint = () => target;

  window.dispatchEvent(trusted(new MouseEvent("pointermove", { bubbles: true }), { clientX: 20, clientY: 30 }));
  const root = pickerRoot();
  expect(root.querySelector("#label").textContent).toContain("button");

  const picked = pick(target, "Revisar este botón", false);
  expect(picked.tag).toBe("button");
  expect(picked.id).toBe("save");
  expect(picked.text).toBe("Guardar cambios");
  expect(picked.selector).toContain("#save");
  expect(picked.comment).toBe("Revisar este botón");
  // The screenshot is opt-in: an unticked box sends no capture region.
  expect(picked.capture).toBeNull();

  window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(sends.some(item => item.channel === "openwork:browser:element-selector-exit")).toBe(true);
});

test("tick the capture box to request a bounded region of the picked node", () => {
  fireState(true);
  const target = document.createElement("div");
  target.textContent = "Capturar este bloque";
  document.body.append(target);
  target.getBoundingClientRect = () => ({ left: 12, top: 34, right: 212, bottom: 94, width: 200, height: 60, x: 12, y: 34, toJSON: () => ({}) }) as DOMRect;
  (document as any).elementFromPoint = () => target;

  const picked = pick(target, "Adjunto la foto", true);
  expect(picked.comment).toBe("Adjunto la foto");
  expect(picked.capture).toMatchObject({ include: true, x: 12, y: 34, width: 200, height: 60 });
  expect(typeof picked.capture.scrollX).toBe("number");
  expect(typeof picked.capture.scrollY).toBe("number");
});
