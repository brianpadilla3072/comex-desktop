import { expect } from "vitest";
import { spec } from "@openwork/testkit";
import { remotePairingCodeWorld } from "../worlds/remote-pairing-code";

const test = spec.world(remotePairingCodeWorld, {
  timeout: 300_000,
  needs: { placement: "local" },
  resources: { surfaces: ["desktop"], services: [], nativeReason: "Remote pairing administers the embedded desktop server and its host-only credential through the Electron bridge." },
});

test("an owner configures one reusable remote code and pairs two devices without returning to the desktop", async ({ world, user, probe, step, evidence }) => {
  await user.resizeViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  await step("before: a clean install asks for a remote pairing code", async () => {
    await user.see({ role: "heading", label: "Configura el acceso remoto" });
    const status = await world.status();
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: true, remoteCodeEnabled: true, remoteCodeConfigured: false });
  });

  let code = "";
  await step("the owner chooses a reusable code and sees it one time", async () => {
    await user.type({ role: "textbox", label: "Código remoto" }, "ABCD-EFGH-JKLM-NPQR");
    await user.click({ role: "button", label: "Guardar código" });
    await user.see({ role: "heading", label: "Guarda este código" });
    code = await world.readRemoteCode();
    expect(code).toBe("ABCDEFGHJKLMNPQR");
    evidence.recordAssertionEvidence("The owner-chosen reusable code is shown once", `code length ${code.length}; plaintext is not recorded`, code.length >= 16);
  });

  await step("the same code pairs two independent owner devices", async () => {
    const first = await world.redeem(code, "Phone");
    const second = await world.redeem(code, "Laptop");
    expect(first).toEqual({ status: 201, scope: "owner", tokenIssued: true });
    expect(second).toEqual({ status: 201, scope: "owner", tokenIssued: true });
    evidence.recordAssertionEvidence("Two redemptions with one code each issue an owner token", `phone ${first.status}/${first.scope}; laptop ${second.status}/${second.scope}`, first.tokenIssued && second.tokenIssued);
  });

  await step("a wrong code cannot mint owner access", async () => {
    const rejected = await world.redeem("WRONG-CODE-0000", "Intruder");
    expect(rejected).toEqual({ status: 400, scope: null, tokenIssued: false });
    evidence.recordAssertionEvidence("An incorrect code is rejected without a token", `status ${rejected.status}; token ${rejected.tokenIssued}`, rejected.status === 400 && !rejected.tokenIssued);
  });

  await step("after: finishing setup survives reload and the plaintext is not shown again", async () => {
    await user.click({ role: "button", label: "Listo" });
    await user.reload();
    await user.notSee({ role: "heading", label: "Configura el acceso remoto" });
    const status = await probe.eventually(() => world.status(), {
      within: 10_000,
      label: "the server keeps the reusable code configured",
      until: value => value.status === 200 && Boolean(value.body && typeof value.body === "object" && Reflect.get(value.body, "remoteCodeConfigured") === true),
    });
    expect(status.body).toMatchObject({ remoteCodeConfigured: true, remoteCodeSource: "stored" });
    const persisted = status.body.remoteCodeConfigured && status.body.remoteCodeSource === "stored";
    evidence.recordAssertionEvidence("The code remains configured after reload", JSON.stringify(status.body), persisted);
  });
});
