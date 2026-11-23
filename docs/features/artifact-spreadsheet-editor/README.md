# Artifact spreadsheet editor (`artifactSpreadsheetEditor`)

Open sheet artifacts in an Excel-like spreadsheet powered by **Jspreadsheet CE** (MIT),
instead of the read-only HTML grid.

## What changes

When the flag is on, artifacts of type `sheet` render with Jspreadsheet CE: editable cells,
keyboard navigation, copy/paste from Excel, formulas (`=SUM(...)`), column resize, multiple
worksheets and a toolbar. When it is off, the lightweight read-only grid is shown.

## How to try it

1. Turn the flag on in `/admin` › Features (self-hosted).
2. Open a conversation with a `sheet` artifact (for example "Exportaciones de ejemplo").
3. Edit a cell, add a row, or paste a range from Excel; changes are kept in the spreadsheet
   instance. The artifact content on disk is not rewritten yet — saving is the next step.

## What turning it off does

Falls back to the read-only HTML grid. Nothing is lost: the artifact content is unchanged.

## Feature key, deployments, author

- Key: `artifactSpreadsheetEditor`
- Deployments: self-hosted
- Author: brianpadilla3072

## Screenshot

To be captured once the feature is exercised on a machine with a working display (the
development sandbox used while building it has no usable GPU for Electron). The feature is
visual: a sheet artifact changes from a read-only HTML grid into an interactive spreadsheet.
