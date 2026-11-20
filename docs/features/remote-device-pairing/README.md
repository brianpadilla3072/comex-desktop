# Remote device pairing (`remoteDevicePairing`)

Use OpenWork from a phone or another computer with the same access as the desktop app, for
example over Tailscale.

## Why

The web UI served by `openwork-server web` receives the server's **collaborator** token in
`index.html`. Collaborator access cannot reach `host` routes: creating or changing specialist
applications and their tasks, environment variables, renaming workspaces. Handing the owner or
host token to every page load would give full control to anyone who can open the URL, and behind
`tailscale serve` every request arrives from `127.0.0.1`, so "local means trusted" does not hold.

## How it works

1. On a device that already has owner access (the desktop app, or a paired browser), open
   **Ajustes › Avanzado › Dispositivos › Mostrar código**. The server issues a one-time code
   (`POST /pairing/codes`, host route) that expires in 5 minutes. A new code replaces the old one.
2. On the other device open the web UI at `/pair` (the "Vincular este dispositivo" link shown
   wherever access is read-only), enter the code and a device name. `POST /pairing/redeem`
   (no auth: the code is the credential) consumes the code and returns a new **owner token**
   labelled `device:<name>`.
3. The browser stores that token (`openwork.server.tokenSource = "paired"`). It wins over the
   collaborator token the page injects on every load.
4. **Dispositivos vinculados** lists paired devices (`GET /pairing/devices`) and revokes them
   (`DELETE /pairing/devices/:id`). A revoked browser notices the 401 at startup, drops the token
   and returns to the page's own access.

Guessing is bounded: codes are 8 characters from a 32-letter alphabet, compared in constant time,
and 5 wrong attempts burn the active code. Codes live only in memory.

## Tailscale setup

Keep the server on loopback and let Tailscale provide HTTPS and network access:

```bash
openwork-server web --host 127.0.0.1 --port 8787 --allowed-hosts <machine>.<tailnet>.ts.net
tailscale serve --bg 8787
```

Open `https://<machine>.<tailnet>.ts.net` on the other device, follow `/pair`, and enter the
code from the desktop. Only devices in your tailnet can reach the URL; pairing then decides which
of them get owner access. Consider `--no-bootstrap-token` if even read access should require
pairing or the client token.

## Flag

`remoteDevicePairing` (self-hosted, on by default). Off: every `/pairing/*` route except
`/pairing/status` answers 404 and the settings section and pairing screen stay hidden or fail
with a clear message.

## Tests

- `apps/server/test/device-pairing.test.ts`: single use, owner access on host routes, listing,
  revocation, wrong guesses burn the code, expiry, replacement.
- `apps/app/tests/remote-device-pairing.test.ts`: the paired token wins over the injected token
  and forgetting the pairing restores it.
