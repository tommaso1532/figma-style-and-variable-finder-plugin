import type { LocalStyleInfo, LocalVariableInfo, StyleType, VariableResolvedType } from '../shared/types';

/**
 * Load all local text and paint styles from the current file.
 */
export async function loadLocalStyles(): Promise<ReadonlyArray<LocalStyleInfo>> {
  const [textStyles, paintStyles] = await Promise.all([
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
  ]);

  const toInfo = (style: TextStyle | PaintStyle, type: StyleType): LocalStyleInfo => ({
    id: style.id,
    name: style.name,
    type,
    key: style.key,
  });

  const styles: LocalStyleInfo[] = [
    ...textStyles.map(s => toInfo(s, 'TEXT')),
    ...paintStyles.map(s => toInfo(s, 'PAINT')),
  ];

  return Object.freeze(styles);
}

/**
 * Load all local variables (COLOR and FLOAT only — the types used for visual styles
 * like shadow colors, elevation, spacing, corner radii, etc.).
 * Groups each variable with its collection name for UI display.
 */
export async function loadLocalVariables(): Promise<ReadonlyArray<LocalVariableInfo>> {
  const [variables, collections] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
  ]);

  const collectionNameById = new Map<string, string>();
  for (const col of collections) {
    collectionNameById.set(col.id, col.name);
  }

  const INCLUDED_TYPES: ReadonlySet<string> = new Set(['COLOR', 'FLOAT']);

  const result: LocalVariableInfo[] = [];
  for (const v of variables) {
    if (!INCLUDED_TYPES.has(v.resolvedType)) continue;
    result.push({
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType as VariableResolvedType,
      collectionName: collectionNameById.get(v.variableCollectionId) ?? 'Unknown',
      collectionId: v.variableCollectionId,
    });
  }

  return Object.freeze(result);
}

/**
 * Build a lookup Set of IDs for O(1) membership testing during scan.
 */
export function buildStyleIdSet(styleIds: ReadonlyArray<string>): ReadonlySet<string> {
  return new Set(styleIds);
}
