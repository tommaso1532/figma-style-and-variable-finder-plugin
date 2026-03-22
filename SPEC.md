# Style Finder — Product Spec

## Problem

Design teams need visibility into which main components use specific local styles. Without this, style refactoring is risky, dead styles accumulate, and inconsistencies hide in large files.

## Solution

A Figma plugin that lets users select local styles and scan main components for usage, producing a navigable results list rolled up to the component set level.

## User flow

1. Open plugin.
2. See all local text and paint styles grouped by type.
3. Search/filter styles by name.
4. Multi-select styles to audit.
5. Optionally toggle "Current page only".
6. Click **Scan**.
7. View results: one row per component set showing page, name, match count, and matched styles.
8. Click a row to navigate to the component set in Figma.
9. Copy deep link or component name from action buttons.

## Result row contents

| Field | Description |
|---|---|
| Component name | Name of the component set (or standalone component) |
| Page name | Which page it lives on |
| Match count | Total number of style usages within the component set |
| Style tags | Which of the selected styles matched, with per-style counts |
| Actions | Navigate, copy deep link, copy name |

## Matching rules

- **Text styles**: detected via `textStyleId` on text nodes (including mixed-style segments).
- **Paint styles**: detected via `fillStyleId` and `strokeStyleId` on applicable nodes.
- Only real style bindings count. Raw color matches are not reported.
- Matches roll up to the parent `ComponentSetNode` if the component is a variant.

## Performance contract

- No scan on load.
- Styles loaded immediately.
- Scan only after explicit user action.
- Single traversal per scan (not per style).
- Yields to main thread every 50 components.
- Stale scans auto-cancelled when a new scan starts.
- Progress bar visible during scan.

## Out of scope (v1)

- Library styles
- Variables
- Effect/grid styles
- Instance results
- Heuristic inconsistency detection

---

## Acceptance criteria

- [ ] Lists all local text and paint styles
- [ ] Search and multi-select styles
- [ ] No scan until user clicks Scan
- [ ] File-wide and current-page-only modes
- [ ] Scans only main components
- [ ] One row per component set
- [ ] Each row: page name, component name, match count
- [ ] Navigate to component set in Figma
- [ ] Copy deep link (with fallback)
- [ ] Copy component name
- [ ] Handles empty states and large files
- [ ] No external services

## Manual QA checklist

- [ ] Open plugin in a file with no local styles — shows empty state
- [ ] Open in a file with styles — all text and paint styles appear grouped
- [ ] Search filters styles in real time
- [ ] Select all / deselect all works
- [ ] Toggle current page only and scan — results limited to current page
- [ ] Scan file-wide — results include components from all pages
- [ ] Results show one row per component set, not per child
- [ ] Standalone components (not in a variant set) appear as their own row
- [ ] Click a result — navigates to the component set (switches pages if needed)
- [ ] Copy deep link — URL is in clipboard (or fallback message shown)
- [ ] Copy name — component name in clipboard
- [ ] Large file (500+ components) — progress bar shows, UI doesn't freeze
- [ ] Scan with no matches — shows "No main components use the selected styles"
- [ ] Mixed text styles (multiple styles in one text node) — detected correctly
- [ ] Hidden nodes with styles — included in results
- [ ] Re-scan after changing selection — previous results cleared

## Publishing checklist

- [ ] Update `manifest.json` with real plugin ID from Figma
- [ ] Add 128x128 icon to assets/ and reference in manifest
- [ ] Test in Figma Desktop (latest version)
- [ ] Test with light and dark themes
- [ ] Remove development-only code
- [ ] Verify no network requests
- [ ] Write store listing description (see below)
- [ ] Create cover image (1920x960)
- [ ] Submit for review

### Store listing description

> **Style Finder** audits local style coverage in your Figma file. Select text and color styles, scan your main components, and instantly see which component sets use each style — with one-click navigation and deep link copying.
>
> Perfect for design system maintenance, style cleanup, and coverage audits.
