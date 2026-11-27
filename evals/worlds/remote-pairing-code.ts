import { browserScript } from "@openwork/cdp";
import { evalIn } from "@openwork/behaviors";
import type { Seed } from "@openwork/env";

type PairingStatusResult = {
  status: number;
  body: { enabled: boolean; remoteCodeEnabled: boolean; remoteCodeConfigured: boolean; remoteCodeSource: string };
};
type RedemptionResult = { status: number; scope: string | null; tokenIssued: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): PairingStatusResult {
  if (!isRecord(value) || typeof value.status !== "number" || !isRecord(value.body)) throw new Error("Invalid pairing status response");
  const body = value.body;
  if (typeof body.enabled !== "boolean" || typeof body.remoteCodeEnabled !== "boolean" || typeof body.remoteCodeConfigured !== "boolean" || typeof body.remoteCodeSource !== "string") {
    throw new Error("Invalid pairing status payload");
  }
  return {
    status: value.status,
    body: {
      enabled: body.enabled,
      remoteCodeEnabled: body.remoteCodeEnabled,
      remoteCodeConfigured: body.remoteCodeConfigured,
      remoteCodeSource: body.remoteCodeSource,
    },
  };
}

function parseRedemption(value: unknown): RedemptionResult {
  if (!isRecord(value) || typeof value.status !== "number" || !(typeof value.scope === "string" || value.scope === null) || typeof value.tokenIssued !== "boolean") {
    throw new Error("Invalid pairing redemption response");
  }
  return { status: value.status, scope: value.scope, tokenIssued: value.tokenIssued };
}

/** A clean desktop profile with the reusable-code feature on and the dev fallback disabled. */
export async function remotePairingCodeWorld(seed: Seed) {
  const app = await seed.desktop({
    name: "remote-pairing-code",
    signIn: false,
    env: {
      DEN_FEATURE_REMOTE_PAIRING_CODE: "true",
      OPENWORK_DEV_PAIRING_CODE: "",
      OPENWORK_ELECTRON_SKIP_WORKSPACE_BUILD: "1",
      OPENWORK_ELECTRON_SKIP_NATIVE_REBUILD: "1",
    },
  });
  // Headless displays can leave CSS entrance animations parked at opacity 0.
  await app.client.send("Page.bringToFront");
  await app.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  return {
    app,
    async status(): Promise<PairingStatusResult> {
      return parseStatus(await evalIn(app, async () => {
        const info = await window.__OPENWORK_ELECTRON__.invokeDesktop("openworkServerInfo");
        const response = await fetch(info.baseUrl + "/pairing/status", { signal: AbortSignal.timeout(5000) });
        return { status: response.status, body: await response.json() };
      }, { awaitPromise: true }));
    },
    async redeem(code: string, deviceName: string): Promise<RedemptionResult> {
      return parseRedemption(await evalIn(app, browserScript(async (inputCode: string, inputName: string) => {
        const info = await window.__OPENWORK_ELECTRON__.invokeDesktop("openworkServerInfo");
        const response = await fetch(info.baseUrl + "/pairing/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: inputCode, deviceName: inputName }),
          signal: AbortSignal.timeout(5000),
        });
        const body = await response.json();
        return {
          status: response.status,
          scope: typeof body.scope === "string" ? body.scope : null,
          tokenIssued: typeof body.token === "string" && body.token.length > 0,
        };
      }, [code, deviceName]), { awaitPromise: true }));
    },
    async readRemoteCode(): Promise<string> {
      const value = await evalIn(app, () => document.querySelector<HTMLInputElement>("[data-remote-pairing-code]")?.value ?? "");
      if (typeof value !== "string" || !value) throw new Error("The one-time code view is not visible");
      return value;
    },
  };
}
