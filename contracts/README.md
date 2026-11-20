# Contracts

Language-agnostic behavior vectors (docs/rust-readiness.md, rule R5). Each folder
`<area>/v<N>/` holds `vectors.json`: an input and the expected outcome. The TypeScript
implementation runs them in its tests today; a Rust implementation must pass the same file
unchanged. Add a vector before changing behavior; a new major version gets a new folder.

| Area | Runner |
| --- | --- |
| `specialist-app-bundle/v1` | `apps/server/test/specialist-bundle-contract.test.ts` |
