// ─── Style Types ───────────────────────────────────────────────────────────

export type StyleType = 'TEXT' | 'PAINT';

export interface LocalStyleInfo {
  readonly id: string;
  readonly name: string;
  readonly type: StyleType;
  readonly key: string;
}

// ─── Variable Types ─────────────────────────────────────────────────────────

export type VariableResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface LocalVariableInfo {
  readonly id: string;
  readonly name: string;
  readonly resolvedType: VariableResolvedType;
  readonly collectionName: string;
  readonly collectionId: string;
}

// ─── Scan Types ────────────────────────────────────────────────────────────

export interface ScanRequest {
  readonly selectedStyleIds: ReadonlyArray<string>;
  readonly selectedVariableIds: ReadonlyArray<string>;
  readonly currentPageOnly: boolean;
}

export interface StyleMatch {
  readonly styleId: string;
  readonly styleName: string;
  readonly styleType: StyleType;
  readonly count: number;
}

export interface VariableMatch {
  readonly variableId: string;
  readonly variableName: string;
  readonly resolvedType: VariableResolvedType;
  readonly count: number;
}

export interface ComponentSetResult {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly pageName: string;
  readonly pageId: string;
  readonly matches: ReadonlyArray<StyleMatch>;
  readonly variableMatches: ReadonlyArray<VariableMatch>;
  readonly totalMatchCount: number;
}

export interface ScanResult {
  readonly results: ReadonlyArray<ComponentSetResult>;
  readonly scannedComponentCount: number;
  readonly scanDurationMs: number;
}

// ─── Messages: Plugin → UI ─────────────────────────────────────────────────

export interface StylesLoadedMessage {
  readonly type: 'styles-loaded';
  readonly styles: ReadonlyArray<LocalStyleInfo>;
  readonly variables: ReadonlyArray<LocalVariableInfo>;
}

export interface ScanCompleteMessage {
  readonly type: 'scan-complete';
  readonly result: ScanResult;
}

export interface ScanProgressMessage {
  readonly type: 'scan-progress';
  readonly scanned: number;
  readonly total: number;
}

export interface ScanErrorMessage {
  readonly type: 'scan-error';
  readonly error: string;
}

export interface NavigationCompleteMessage {
  readonly type: 'navigation-complete';
  readonly success: boolean;
  readonly error?: string;
}

export interface DeepLinkMessage {
  readonly type: 'deep-link-result';
  readonly nodeId: string;
  readonly url: string | null;
  readonly fallbackName: string;
}

export interface ScanCancelledMessage {
  readonly type: 'scan-cancelled';
}

export type PluginToUIMessage =
  | StylesLoadedMessage
  | ScanCompleteMessage
  | ScanProgressMessage
  | ScanErrorMessage
  | ScanCancelledMessage
  | NavigationCompleteMessage
  | DeepLinkMessage;

// ─── Messages: UI → Plugin ─────────────────────────────────────────────────

export interface LoadStylesMessage {
  readonly type: 'load-styles';
}

export interface RunScanMessage {
  readonly type: 'run-scan';
  readonly request: ScanRequest;
}

export interface NavigateToNodeMessage {
  readonly type: 'navigate-to-node';
  readonly nodeId: string;
  readonly pageId: string;
}

export interface RequestDeepLinkMessage {
  readonly type: 'request-deep-link';
  readonly nodeId: string;
}

export interface CancelScanMessage {
  readonly type: 'cancel-scan';
}

export type UIToPluginMessage =
  | LoadStylesMessage
  | RunScanMessage
  | NavigateToNodeMessage
  | RequestDeepLinkMessage
  | CancelScanMessage;
