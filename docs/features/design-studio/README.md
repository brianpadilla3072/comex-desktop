# Design studio (`designStudio`)

Create slides, screen mockups, design systems and whiteboards with the agent, as plain local files
inside the project. Nothing leaves the computer: no external design service, no external image
generation (illustrations are SVG written by the agent), no downloads.

## Format (shared contract)

`packages/types/src/designs.ts` (imported as `@openwork/types/designs`) defines the kinds
(`slides`, `mockup`, `system`, `board`), the folder layout, `design.json`, `tokens.json`,
`board.json`, limits and page sizes. A design is `<project>/proyecto/diseno/<designId>/`.

## Parts (each documented in its own section below by the agent that built it)

1. Base: server API, gallery, sandboxed viewer, thumbnails, HTML export.
2. Slides editor: thumbnails, add/reorder, present, export PDF / PPTX / PNG.
3. Comment and edit on the design.
4. Design system viewer and brand context for the agent.
5. Mockups and whiteboard (own SVG canvas).
