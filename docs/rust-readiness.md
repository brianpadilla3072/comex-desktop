# Rust readiness (strict development policy)

Goal: the OpenWork server and the desktop helpers can be ported to Rust (for example an
Axum server or a Tauri shell, as the desktop app was before Electron) to use less memory
and CPU, **module by module, without a big-bang rewrite**. Every change from now on keeps
that port mechanical. This policy is mandatory; `pnpm check:rust-readiness` enforces the
parts a machine can check, and reviews enforce the rest.

## Scope

- **Port targets:** `apps/server/src/**` (openwork-server) and `apps/desktop/electron/**`
  except the window and UI glue.
- **Stays TypeScript:** the React UI (`apps/app`), Den web and test tooling.
- The boundary between them is HTTP plus the desktop IPC contract
  (`packages/types/src/desktop-ipc.ts`). The UI must never depend on how the server is
  implemented, only on that contract.

## Rules

### R1. Contracts first
Every HTTP payload, persisted file and IPC message has one schema (Zod) next to its code,
and a stable `code` for every error (`ApiError(status, code, message)`). Clients and tests
depend on codes, never on message text. A persisted format carries a `version` and is read
through its schema. A Rust implementation reproduces the schema, not the code.

### R2. Validate everything that crosses a boundary
`JSON.parse`, request bodies, environment variables and files read from disk go straight
into a schema (`schema.parse(JSON.parse(text))`, `safeParse`, or a value typed `unknown`
that is narrowed before use). Never use the raw result as a typed object.

### R3. No escape hatches in port targets
- No `any`, no double casts (`as unknown as`).
- No `eval` / `new Function`.
- No prototype mutation, monkey-patching or `globalThis` tricks.
- These have no Rust equivalent and hide the real types.

### R4. Pure core, explicit edges
Decision logic (validation, matching, scheduling, path rules, formats) lives in functions
that take data and return data. File system, network, clock, randomness and processes are
called at the edges or passed in as parameters. Examples already in the repo:
`specialists/portability/` (sections with `prepare`/`apply`) and
`apps/desktop/electron/opencode-cache.mjs` (candidates, then deletion with an injected fs).

### R5. Language-agnostic contract tests
Behavior that another implementation must match is pinned with JSON vectors under
`contracts/<area>/v<N>/` (input plus expected outcome), run by a TypeScript test today
and by the Rust crate tomorrow. Start with the specialist application bundle
(`contracts/specialist-app-bundle/v1/`).

### R6. Dependencies
A new runtime dependency in a port target needs a mature Rust equivalent (`serde`,
`reqwest`, `rusqlite`, `tokio`, `axum` …), or it must live behind an interface the Rust
side can reimplement. Name the equivalent in the PR. Prefer the standard library.

### R7. Explicit concurrency and state
Serialize writes per resource with an explicit queue (as `tasks.ts` does per application).
Module-level mutable singletons need a comment naming their owner and lifetime. Rust's
ownership model makes hidden shared state the most expensive thing to port.

### R8. Data stays portable
On-disk layouts are documented with their schema (SQLite tables, JSON files, folders).
Use UTF-8, forward-slash relative paths inside formats, and integers for time (epoch ms).
Never JS-specific encodings, `Date` strings without a zone, or floats for money or counters.

## Enforcement

- `pnpm check:rust-readiness` scans port targets for R2 (unvalidated `JSON.parse`) and
  R3 (`any`, double casts, `eval`, prototype mutation).
- Existing occurrences are frozen in `scripts/rust-readiness-baseline.json`, which can
  only shrink. A new occurrence fails the check. When you remove one, run
  `pnpm check:rust-readiness --update` to lower the baseline.
- The check runs inside `pnpm test:comex`. `pnpm test:rust-readiness` tests the checker
  itself.
