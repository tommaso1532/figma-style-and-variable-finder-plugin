# Style Finder — Figma Plugin

Audit local style coverage across main components in your Figma file. Find which component sets use specific text and color styles, navigate to them, and copy deep links.

This plugin is public on Figma Community.

## Setup

```bash
npm install
npm run build
```

### Load in Figma

1. Open Figma Desktop.
2. Go to **Plugins > Development > Import plugin from manifest…**
3. Select the `manifest.json` file in this directory.
4. Run the plugin from the Plugins menu.

### Development

```bash
npm run watch    # Rebuild on file changes
npm run typecheck # Type-check without emitting
```

## How it works

1. **Open the plugin** — it loads all local text and paint styles from the file.
2. **Search and select** — filter styles by name, multi-select the ones you want to audit.
3. **Toggle scope** — optionally limit to the current page.
4. **Click Scan** — the plugin traverses main components and finds which ones use the selected styles.
5. **Browse results** — each result row shows one component set with page name, match count, and matched style tags.
6. **Navigate** — click a result to jump to the component set in Figma. Copy deep links or component names with one click.

## Architecture

```
src/
├── shared/types.ts       # Shared type definitions and message contracts
├── plugin/
│   ├── main.ts           # Plugin entry point, message routing
│   ├── styles.ts         # Local style loading and normalization
│   ├── scanner.ts        # Component subtree scanning and aggregation
│   └── navigation.ts     # Page switching, viewport, deep links
└── ui/
    ├── index.html        # HTML shell with CSS
    └── ui.ts             # UI state management and rendering
```

**Build**: esbuild bundles plugin code as IIFE for the sandbox, and inlines the UI JS into a single HTML file.

## Figma API limitations

| Limitation | Handling |
|---|---|
| `figma.fileKey` may be empty in untitled/local files | Deep link falls back to copying component name |
| `findAllWithCriteria` only returns direct types, not subtree style info | We collect components first, then walk each subtree manually |
| No async generators or streaming in plugin sandbox | We yield to main thread every 50 components to avoid UI freeze |
| `textStyleId` can be `figma.mixed` on multi-style text nodes | We scan character ranges to detect each segment's style |
| `fillStyleId`/`strokeStyleId` can be `symbol` (mixed) | We only count string IDs that match the target set |
| No `document.execCommand('copy')` in plugin sandbox | Clipboard operations happen in the UI iframe |

## Scope

**Supported in v1:**
- Local text styles
- Local paint styles (fills and strokes)
- File-wide and current-page-only scan modes
- Main components only (not instances)
- Roll-up to component set level

**Not supported in v1:**
- Library/remote styles
- Variables
- Effect/grid styles
- Instance-level results
- Heuristic inconsistency warnings
