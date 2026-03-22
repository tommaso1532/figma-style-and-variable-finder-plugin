import type {
  ScanRequest,
  ScanResult,
  ComponentSetResult,
  StyleMatch,
  VariableMatch,
  LocalStyleInfo,
  LocalVariableInfo,
} from '../shared/types';
import { buildStyleIdSet } from './styles';

// ─── Internal types ────────────────────────────────────────────────────────

interface MatchAccumulator {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly pageName: string;
  readonly pageId: string;
  readonly styleCounts: Map<string, number>;
  readonly varCounts: Map<string, number>;
}

// ─── Scan cancellation ─────────────────────────────────────────────────────

let currentScanId = 0;

export function cancelCurrentScan(): void {
  currentScanId++;
}

// ─── Cooperative chunking ───────────────────────────────────────────────────

const CHUNK_MS = 100;
const TIME_CHECK_INTERVAL = 200;

function runChunked(
  work: () => boolean,
  scanId: number,
): Promise<boolean> {
  return new Promise(resolve => {
    function tick() {
      if (currentScanId !== scanId) { resolve(false); return; }

      const chunkEnd = Date.now() + CHUNK_MS;
      let hasMore = true;
      let counter = 0;

      while (hasMore) {
        hasMore = work();
        counter++;
        if (counter >= TIME_CHECK_INTERVAL) {
          counter = 0;
          if (Date.now() >= chunkEnd) break;
        }
      }

      if (!hasMore) {
        resolve(true);
      } else if (currentScanId !== scanId) {
        resolve(false);
      } else {
        setTimeout(tick, 0);
      }
    }

    setTimeout(tick, 0);
  });
}

// ─── Reusable predicate for findAll ─────────────────────────────────────────

const RETURN_TRUE = (): boolean => true;

// ─── Node type sets for skipping irrelevant checks ──────────────────────────

/** Node types that have NO fills, strokes, styles, effects, or useful boundVariables */
const SKIP_TYPES: ReadonlySet<string> = new Set(['SLICE', 'GROUP']);

// ─── Main scan function ────────────────────────────────────────────────────

export async function runScan(
  request: ScanRequest,
  allStyles: ReadonlyArray<LocalStyleInfo>,
  allVariables: ReadonlyArray<LocalVariableInfo>,
  onProgress: (scanned: number, total: number) => void,
): Promise<ScanResult | null> {
  const scanId = ++currentScanId;
  const startTime = Date.now();

  const targetStyleIds = buildStyleIdSet(request.selectedStyleIds);
  const targetVarIds = buildStyleIdSet(request.selectedVariableIds);

  const styleInfoById = new Map<string, LocalStyleInfo>();
  for (const s of allStyles) {
    if (targetStyleIds.has(s.id)) styleInfoById.set(s.id, s);
  }

  const varInfoById = new Map<string, LocalVariableInfo>();
  for (const v of allVariables) {
    if (targetVarIds.has(v.id)) varInfoById.set(v.id, v);
  }

  const pages: ReadonlyArray<PageNode> = request.currentPageOnly
    ? [figma.currentPage]
    : figma.root.children;

  if (request.currentPageOnly) {
    await figma.currentPage.loadAsync();
  } else {
    await figma.loadAllPagesAsync();
  }

  // Yield after page loading so queued UI messages (button/progress)
  // can be painted before we start the synchronous findAllWithCriteria.
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  if (currentScanId !== scanId) return null;

  // Phase 1: collect scan targets using Figma's native findAllWithCriteria.
  // Yield between pages so the UI can paint and process cancel messages.
  interface ScanTarget {
    node: ComponentSetNode | ComponentNode;
    page: PageNode;
    componentCount: number;
  }

  const scanTargets: ScanTarget[] = [];
  let totalComponentCount = 0;

  // Send initial progress so the UI can show "0/0" immediately
  onProgress(0, 0);

  for (const page of pages) {
    if (currentScanId !== scanId) return null;

    // Yield to the event loop between pages so the UI can repaint
    // and cancel messages can be processed.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (currentScanId !== scanId) return null;

    const nodes = page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
    for (const node of nodes) {
      if (node.type === 'COMPONENT_SET') {
        scanTargets.push({ node, page, componentCount: node.children.length });
        totalComponentCount += node.children.length;
      } else if (node.parent === null || node.parent.type !== 'COMPONENT_SET') {
        scanTargets.push({ node: node as ComponentNode, page, componentCount: 1 });
        totalComponentCount += 1;
      }
    }

    // Report discovered total so far
    onProgress(0, totalComponentCount);
  }

  if (currentScanId !== scanId) return null;

  // Phase 2: scan subtrees using native findAll per target.
  // findAll runs the tree walk in C++ — much faster than a JS DFS stack.
  // We get a flat array back and iterate it with a simple index.
  const accumulators = new Map<string, MatchAccumulator>();
  let scannedComponents = 0;

  const checkVars = targetVarIds.size > 0;
  const checkStyles = targetStyleIds.size > 0;

  let targetIdx = 0;
  let flatNodes: SceneNode[] = [];
  let nodeIdx = 0;
  let curStyleCounts = new Map<string, number>();
  let curVarCounts = new Map<string, number>();
  let curTarget: ScanTarget | null = null;
  let lastProgressReport = 0;

  function advanceTarget(): boolean {
    // Finalise previous target
    if (curTarget !== null) {
      if (curStyleCounts.size > 0 || curVarCounts.size > 0) {
        accumulators.set(curTarget.node.id, {
          nodeId: curTarget.node.id,
          nodeName: curTarget.node.name,
          pageName: curTarget.page.name,
          pageId: curTarget.page.id,
          styleCounts: curStyleCounts,
          varCounts: curVarCounts,
        });
      }
      scannedComponents += curTarget.componentCount;
    }

    // Move to next target
    if (targetIdx >= scanTargets.length) {
      curTarget = null;
      return false;
    }

    curTarget = scanTargets[targetIdx++];
    // C++ native tree traversal → flat array (no JS DFS, no stack, no children access)
    flatNodes = curTarget.node.findAll(RETURN_TRUE);
    // nodeIdx -1 = process root node first (findAll excludes the root)
    nodeIdx = -1;
    curStyleCounts = new Map();
    curVarCounts = new Map();
    return true;
  }

  // Inline node-checking function to avoid per-call overhead in the hot loop
  function checkNode(n: SceneNode | ComponentSetNode): void {
    const ntype = n.type;

    // Skip types that can't carry styles or variables
    if (SKIP_TYPES.has(ntype)) return;

    // ── Style bindings ──────────────────────────────────────────────
    if (checkStyles) {
      if (ntype === 'TEXT') {
        const tsId = (n as TextNode).textStyleId;
        if (tsId === figma.mixed) {
          const segments = (n as TextNode).getStyledTextSegments(['textStyleId']);
          for (let s = 0; s < segments.length; s++) {
            const sid = segments[s].textStyleId;
            if (sid !== '' && targetStyleIds.has(sid)) {
              curStyleCounts.set(sid, (curStyleCounts.get(sid) ?? 0) + 1);
            }
          }
        } else if (typeof tsId === 'string' && tsId !== '' && targetStyleIds.has(tsId)) {
          curStyleCounts.set(tsId, (curStyleCounts.get(tsId) ?? 0) + 1);
        }
      }
      if ('fillStyleId' in n) {
        const id = (n as { fillStyleId: string | symbol }).fillStyleId;
        if (typeof id === 'string' && id !== '' && targetStyleIds.has(id)) {
          curStyleCounts.set(id, (curStyleCounts.get(id) ?? 0) + 1);
        }
      }
      if ('strokeStyleId' in n) {
        const id = (n as { strokeStyleId: string | symbol }).strokeStyleId;
        if (typeof id === 'string' && id !== '' && targetStyleIds.has(id)) {
          curStyleCounts.set(id, (curStyleCounts.get(id) ?? 0) + 1);
        }
      }
    }

    // ── Variable bindings ───────────────────────────────────────────
    if (checkVars) {
      const bv = (n as { boundVariables?: Record<string, unknown> }).boundVariables;
      if (bv !== undefined && bv !== null) {
        for (const key in bv) {
          if (ARRAY_BOUND_VAR_KEYS.has(key)) continue;
          const val = bv[key];
          if (val !== null && typeof val === 'object' &&
              (val as Record<string, unknown>)['type'] === 'VARIABLE_ALIAS') {
            const vid = (val as { id: string }).id;
            if (targetVarIds.has(vid)) {
              curVarCounts.set(vid, (curVarCounts.get(vid) ?? 0) + 1);
            }
          }
        }
      }
      if ('effects' in n) {
        const effects = (n as { effects: ReadonlyArray<{ boundVariables?: Record<string, unknown> }> }).effects;
        for (let e = 0; e < effects.length; e++) {
          const ebv = effects[e].boundVariables;
          if (ebv !== undefined) {
            for (const field in ebv) {
              const val = ebv[field];
              if (val !== null && typeof val === 'object' &&
                  (val as Record<string, unknown>)['type'] === 'VARIABLE_ALIAS') {
                const vid = (val as { id: string }).id;
                if (targetVarIds.has(vid)) {
                  curVarCounts.set(vid, (curVarCounts.get(vid) ?? 0) + 1);
                }
              }
            }
          }
        }
      }
      // Fills
      const fills = (n as unknown as Record<string, unknown>)['fills'];
      if (Array.isArray(fills)) {
        for (let f = 0; f < fills.length; f++) {
          const ca = (fills[f] as { boundVariables?: { color?: unknown } }).boundVariables?.color;
          if (ca !== null && ca !== undefined && typeof ca === 'object' &&
              (ca as Record<string, unknown>)['type'] === 'VARIABLE_ALIAS') {
            const vid = (ca as { id: string }).id;
            if (targetVarIds.has(vid)) {
              curVarCounts.set(vid, (curVarCounts.get(vid) ?? 0) + 1);
            }
          }
        }
      }
      // Strokes
      const strokes = (n as unknown as Record<string, unknown>)['strokes'];
      if (Array.isArray(strokes)) {
        for (let f = 0; f < strokes.length; f++) {
          const ca = (strokes[f] as { boundVariables?: { color?: unknown } }).boundVariables?.color;
          if (ca !== null && ca !== undefined && typeof ca === 'object' &&
              (ca as Record<string, unknown>)['type'] === 'VARIABLE_ALIAS') {
            const vid = (ca as { id: string }).id;
            if (targetVarIds.has(vid)) {
              curVarCounts.set(vid, (curVarCounts.get(vid) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  // Seed first target
  if (!advanceTarget()) {
    onProgress(0, 0);
    return {
      results: [],
      scannedComponentCount: 0,
      scanDurationMs: Date.now() - startTime,
    };
  }

  const ok = await runChunked(() => {
    // nodeIdx -1 = process root node (not included in findAll result)
    if (nodeIdx === -1) {
      checkNode(curTarget!.node);
      nodeIdx = 0;
      return flatNodes.length > 0 || targetIdx < scanTargets.length;
    }

    // Flat array exhausted → advance to next target
    if (nodeIdx >= flatNodes.length) {
      if (scannedComponents - lastProgressReport >= 50 || targetIdx >= scanTargets.length) {
        onProgress(scannedComponents, totalComponentCount);
        lastProgressReport = scannedComponents;
      }
      return advanceTarget();
    }

    // Process node from flat array — no stack, no children access needed
    checkNode(flatNodes[nodeIdx++]);

    return nodeIdx < flatNodes.length || targetIdx < scanTargets.length;
  }, scanId);

  if (!ok) return null;

  // Finalise last target (TS can't track mutation across closures after await)
  const finalTarget = curTarget as ScanTarget | null;
  if (finalTarget !== null && (curStyleCounts.size > 0 || curVarCounts.size > 0)) {
    accumulators.set(finalTarget.node.id, {
      nodeId: finalTarget.node.id,
      nodeName: finalTarget.node.name,
      pageName: finalTarget.page.name,
      pageId: finalTarget.page.id,
      styleCounts: curStyleCounts,
      varCounts: curVarCounts,
    });
  }

  onProgress(totalComponentCount, totalComponentCount);

  // Phase 3: build results
  const results: ComponentSetResult[] = [];

  for (const acc of accumulators.values()) {
    const matches: StyleMatch[] = [];
    let totalMatchCount = 0;

    for (const [styleId, count] of acc.styleCounts) {
      const info = styleInfoById.get(styleId);
      if (info !== undefined) {
        matches.push({ styleId: info.id, styleName: info.name, styleType: info.type, count });
        totalMatchCount += count;
      }
    }
    matches.sort((a, b) => a.styleName.localeCompare(b.styleName));

    const variableMatches: VariableMatch[] = [];
    for (const [varId, count] of acc.varCounts) {
      const info = varInfoById.get(varId);
      if (info !== undefined) {
        variableMatches.push({ variableId: info.id, variableName: info.name, resolvedType: info.resolvedType, count });
        totalMatchCount += count;
      }
    }
    variableMatches.sort((a, b) => a.variableName.localeCompare(b.variableName));

    results.push({
      nodeId: acc.nodeId,
      nodeName: acc.nodeName,
      pageName: acc.pageName,
      pageId: acc.pageId,
      matches: Object.freeze(matches),
      variableMatches: Object.freeze(variableMatches),
      totalMatchCount,
    });
  }

  results.sort((a, b) => {
    const pageCompare = a.pageName.localeCompare(b.pageName);
    if (pageCompare !== 0) return pageCompare;
    return a.nodeName.localeCompare(b.nodeName);
  });

  return {
    results: Object.freeze(results),
    scannedComponentCount: totalComponentCount,
    scanDurationMs: Date.now() - startTime,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ARRAY_BOUND_VAR_KEYS: ReadonlySet<string> = new Set([
  'fills', 'strokes', 'effects', 'layoutGrids', 'componentProperties', 'textRangeFills',
]);
