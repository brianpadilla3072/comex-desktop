# Connected local web access

Feature: `desktopLocalWeb`, self-hosted only, default off. Owner: brianpadilla3072.

The desktop's **View → Ir a web** command previously opened its Electron/Vite renderer URL when no web server was available. A browser has neither the Electron bridge nor that renderer's connection state, so the page redirected to welcome. A renderer hash link is not a standalone authenticated web link.

With `DEN_FEATURE_DESKTOP_LOCAL_WEB=true` at desktop launch, the command enables the existing server's static UI surface using its packaged app bundle. It opens that server's URL and the current conversation using web path routing. There is no second engine, HTTP listener, history store or copied credential file. The page receives the existing client bootstrap through the existing static UI policy; it does not receive the host or owner token. Features requiring owner access keep their existing pairing/authorization checks.

The embedded server must bind to loopback. Wildcard/LAN binds are rejected. The packaged bundle receives an origin base for its relative assets and a versioned desktop-web bootstrap marker. The frontend uses web deployment behavior and connects to the page's own origin. Both the custom View menu, the native menu and the shell's getWebUrl use the same resolver. Without a ready connected web surface the command reports failure instead of opening a desktop renderer or an API JSON response.

To try it, build the app and server, launch Electron with the feature enabled, open a conversation and select **Ir a web**. Use the URL returned by that command rather than a development renderer URL. No machine-specific port, profile or workspace ID is embedded in this code. The flag must be explicitly enabled in the installation's launcher/operator configuration; the registry default remains off.

Turning the flag off removes this instance's desktop static web surface on subsequent requests without deleting histories or stopping the engine. It does not revoke the server's existing client credential or other independently configured self-host web surfaces. The desktop keeps working. No renderer connection credentials are added to URLs, logs or repository files.

Rust readiness: the root request, ready receipt and desktop bootstrap have Zod schemas in `apps/server/src/desktop-local-web.ts`; host/flag policy vectors live in `contracts/desktop-local-web/v1/policy.json`. Filesystem validation stays at the edge; host policy is pure. The chosen web root belongs to one embedded server's lifetime, not process-global state. The HTTP/bootstrap contract uses ordinary JSON. No new runtime dependencies were introduced; Rust equivalents are serde, url and filesystem access.

Validation: seven unit/integration server tests cover feature off/on, immediate disable, loopback-only policy, invalid/missing roots, relative assets, cross-site token suppression and enabling the existing embedded listener without starting an engine. Existing web origin tests pass. After restarting the real desktop with the feature enabled, its shell web URL resolver returned the current server's conversation URL. Chrome loaded that URL and its messages for 12 seconds, reloaded, and retained the conversation for another 12 seconds without welcome. The real openWebInBrowser action also returned success with the connected URL. Browser test profiles were closed and removed; the user's requested app/web window was retained. Linux was exercised; Windows/macOS execution remains unverified.

Design rules: P1 (report readiness accurately), P11 (retain the existing conversation). No new screen or visual component is introduced. Live conversation contents were not saved as public screenshots.
