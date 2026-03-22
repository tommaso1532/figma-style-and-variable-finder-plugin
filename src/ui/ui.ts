import type {
  PluginToUIMessage,
  UIToPluginMessage,
  LocalStyleInfo,
  LocalVariableInfo,
  StyleType,
  VariableResolvedType,
} from '../shared/types';

// ─── State ─────────────────────────────────────────────────────────────────

interface AppState {
  styles: ReadonlyArray<LocalStyleInfo>;
  variables: ReadonlyArray<LocalVariableInfo>;
  selectedStyleIds: Set<string>;
  selectedVariableIds: Set<string>;
  searchQuery: string;
  currentPageOnly: boolean;
  scanResult: import('../shared/types').ScanResult | null;
  isScanning: boolean;
  scanProgress: { scanned: number; total: number } | null;
  resultSearchQuery: string;
  collapsedGroups: Set<string>; // group key: style type or variable collection id
}

const state: AppState = {
  styles: [],
  variables: [],
  selectedStyleIds: new Set(),
  selectedVariableIds: new Set(),
  searchQuery: '',
  currentPageOnly: false,
  scanResult: null,
  isScanning: false,
  scanProgress: null,
  resultSearchQuery: '',
  collapsedGroups: new Set<string>(),
};

// Generation counter: incremented on every scan start and cancel.
// Queued clicks that arrive after a cancel carry a stale generation
// and are silently dropped, preventing accidental re-scans.
let scanGeneration = 0;
let pendingDeepLinkBtn: HTMLElement | null = null;
let bannerDismissed = false;

// ─── DOM references ────────────────────────────────────────────────────────

const elements = {
  searchInput: document.getElementById('search-input') as HTMLInputElement,
  styleList: document.getElementById('style-list') as HTMLDivElement,
  scanBtn: document.getElementById('scan-btn') as HTMLButtonElement,
  scanPageBtn: document.getElementById('scan-page-btn') as HTMLButtonElement,
  selectedCount: document.getElementById('selected-count') as HTMLSpanElement,
  resultsEmptyState: document.getElementById('results-empty-state') as HTMLDivElement,
  resultsSection: document.getElementById('results-section') as HTMLDivElement,
  resultsList: document.getElementById('results-list') as HTMLDivElement,
  resultsStatus: document.getElementById('results-status') as HTMLDivElement,
  progressBar: document.getElementById('progress-bar') as HTMLDivElement,
  progressFill: document.getElementById('progress-fill') as HTMLDivElement,
  progressText: document.getElementById('progress-text') as HTMLSpanElement,
  emptyStylesMsg: document.getElementById('empty-styles-msg') as HTMLDivElement,
  resultSearchInput: document.getElementById('result-search-input') as HTMLInputElement,
  resultSearchField: document.getElementById('result-search-field') as HTMLDivElement,
  resultSearchBtn: document.getElementById('result-search-btn') as HTMLButtonElement,
  deselectAllBtn: document.getElementById('deselect-all-btn') as HTMLButtonElement,
  toast: document.getElementById('toast') as HTMLDivElement,
  coffeeBanner: document.getElementById('coffee-banner') as HTMLDivElement,
  coffeeLink: document.getElementById('coffee-link') as HTMLButtonElement,
  coffeeDismiss: document.getElementById('coffee-dismiss') as HTMLButtonElement,
};

// ─── Initialize ────────────────────────────────────────────────────────────

function init(): void {
  setupMessageHandler();
  bindEvents();
  initResizeHandle();
  sendToPlugin({ type: 'load-styles' });
}

function initResizeHandle(): void {
  const handle = document.getElementById('resize-handle') as HTMLElement;
  const leftPanel = document.querySelector('.left-panel') as HTMLElement;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    const startX = e.clientX;
    const startWidth = leftPanel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(520, startWidth + e.clientX - startX));
      leftPanel.style.width = `${newWidth}px`;
      renderStyleList();
      renderResults();
    };

    const onMouseUp = () => {
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });
}

function bindEvents(): void {
  elements.searchInput.addEventListener('input', () => {
    state.searchQuery = elements.searchInput.value;
    renderStyleList();
  });

  elements.resultSearchInput.addEventListener('input', () => {
    state.resultSearchQuery = elements.resultSearchInput.value;
    renderResults();
  });

  elements.resultSearchBtn.addEventListener('click', () => {
    const isOpen = elements.resultSearchField.classList.toggle('open');
    elements.resultSearchBtn.classList.toggle('active', isOpen);
    if (isOpen) {
      elements.resultSearchInput.focus();
    } else {
      elements.resultSearchInput.value = '';
      state.resultSearchQuery = '';
      renderResults();
    }
  });

  elements.scanBtn.addEventListener('click', () => {
    const clickGen = scanGeneration;
    if (state.isScanning) {
      handleInterrupt();
    } else {
      if (clickGen !== scanGeneration) return;
      state.currentPageOnly = false;
      handleScan();
    }
  });

  elements.scanPageBtn.addEventListener('click', () => {
    const clickGen = scanGeneration;
    if (!state.isScanning) {
      if (clickGen !== scanGeneration) return;
      state.currentPageOnly = true;
      handleScan();
    }
  });
  elements.deselectAllBtn.addEventListener('click', handleDeselectAll);

  elements.coffeeDismiss.addEventListener('click', () => {
    bannerDismissed = true;
    elements.coffeeBanner.classList.remove('visible');
  });

  elements.coffeeLink.addEventListener('click', () => {
    // Replace the URL below with your Buy Me a Coffee page
    window.open('https://buymeacoffee.com/tommasodematte', '_blank');
  });
}

// ─── Message handling ──────────────────────────────────────────────────────

function handlePluginMessage(msg: PluginToUIMessage): void {
  switch (msg.type) {
    case 'styles-loaded':
      state.styles = msg.styles;
      state.variables = msg.variables;
      state.selectedStyleIds.clear();
      state.selectedVariableIds.clear();
      renderStyleList();
      updateScanButton();
      break;

    case 'scan-progress':
      if (!state.isScanning) break;
      state.scanProgress = { scanned: msg.scanned, total: msg.total };
      renderProgress();
      break;

    case 'scan-complete':
      if (!state.isScanning) break;
      state.isScanning = false;
      state.scanResult = msg.result;
      state.scanProgress = null;
      collapseAllGroups();
      renderStyleList();
      renderResults();
      updateScanButton();
      hideProgress();
      if (!bannerDismissed) {
        elements.coffeeBanner.classList.add('visible');
      }
      break;

    case 'scan-cancelled':
      state.isScanning = false;
      state.scanProgress = null;
      state.scanResult = null;
      hideProgress();
      renderResults();
      updateScanButton();
      break;

    case 'scan-error':
      if (!state.isScanning) break;
      state.isScanning = false;
      state.scanProgress = null;
      hideProgress();
      updateScanButton();
      showError(msg.error);
      break;

    case 'navigation-complete':
      if (!msg.success && msg.error) {
        showToast(`Navigation failed: ${msg.error}`, 'error');
      }
      break;

    case 'deep-link-result': {
      const text = msg.url !== null ? msg.url : msg.fallbackName;
      copyToClipboard(text);
      flashLinkCopied(pendingDeepLinkBtn);
      pendingDeepLinkBtn = null;
      break;
    }
  }
}

function setupMessageHandler(): void {
  window.onmessage = (event: MessageEvent) => {
    const msg = event.data.pluginMessage as PluginToUIMessage | undefined;
    if (msg === undefined || msg === null) return;
    if (typeof msg !== 'object' || !('type' in msg)) return;
    handlePluginMessage(msg);
  };
}

// ─── Actions ───────────────────────────────────────────────────────────────

function handleScan(): void {
  const hasSelection = state.selectedStyleIds.size > 0 || state.selectedVariableIds.size > 0;
  if (!hasSelection) return;

  scanGeneration++;
  state.isScanning = true;
  state.scanResult = null;
  state.resultSearchQuery = '';
  elements.resultSearchInput.value = '';
  renderResults();
  updateScanButton();
  showProgress();

  // Defer sending to the plugin so the browser can paint the updated UI
  // (gray Cancel button, progress bar) before the plugin's heavy
  // synchronous work blocks the shared main thread.
  // setTimeout(150) guarantees multiple paint frames at 60 fps.
  setTimeout(() => {
    sendToPlugin({
      type: 'run-scan',
      request: {
        selectedStyleIds: Array.from(state.selectedStyleIds),
        selectedVariableIds: Array.from(state.selectedVariableIds),
        currentPageOnly: state.currentPageOnly,
      },
    });
  }, 150);
}

function handleInterrupt(): void {
  scanGeneration++;
  sendToPlugin({ type: 'cancel-scan' });
  state.isScanning = false;
  state.scanProgress = null;
  state.scanResult = null;
  hideProgress();
  renderResults();
  updateScanButton();
}

function handleDeselectAll(): void {
  state.selectedStyleIds.clear();
  state.selectedVariableIds.clear();
  renderStyleList();
  updateScanButton();
}

function toggleStyleSelection(styleId: string): void {
  if (state.selectedStyleIds.has(styleId)) {
    state.selectedStyleIds.delete(styleId);
  } else {
    state.selectedStyleIds.add(styleId);
  }
  renderStyleList();
  updateScanButton();
}

function toggleVariableSelection(varId: string): void {
  if (state.selectedVariableIds.has(varId)) {
    state.selectedVariableIds.delete(varId);
  } else {
    state.selectedVariableIds.add(varId);
  }
  renderStyleList();
  updateScanButton();
}

function navigateToComponent(nodeId: string, pageId: string): void {
  sendToPlugin({ type: 'navigate-to-node', nodeId, pageId });
}

function requestDeepLink(nodeId: string): void {
  sendToPlugin({ type: 'request-deep-link', nodeId });
}

const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="2,6 5,9 10,3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function flashLinkCopied(btn: HTMLElement | null): void {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.innerHTML = `${CHECK_ICON}Link copied`;
  btn.classList.add('link-copied');
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('link-copied');
  }, 2000);
}

function copyComponentName(name: string): void {
  copyToClipboard(name);
  showToast('Component name copied');
}

// ─── Accordion helpers ─────────────────────────────────────────────────────

function collapseAllGroups(): void {
  const groups = buildGroups(state.styles, state.variables);
  for (const group of groups) {
    state.collapsedGroups.add(group.key);
  }
}

// ─── Rendering: Style + Variable List ─────────────────────────────────────

interface FilteredItems {
  filteredStyles: ReadonlyArray<LocalStyleInfo>;
  filteredVariables: ReadonlyArray<LocalVariableInfo>;
}

function getFilteredItems(): FilteredItems {
  const query = state.searchQuery.toLowerCase().trim();
  const filteredStyles = query === ''
    ? state.styles
    : state.styles.filter(s => s.name.toLowerCase().includes(query));
  const filteredVariables = query === ''
    ? state.variables
    : state.variables.filter(v => v.name.toLowerCase().includes(query) || v.collectionName.toLowerCase().includes(query));
  return { filteredStyles, filteredVariables };
}

interface StyleGroup {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly items: Array<{ id: string; name: string; isVariable: boolean }>;
}

function buildGroups(
  styles: ReadonlyArray<LocalStyleInfo>,
  variables: ReadonlyArray<LocalVariableInfo>,
): ReadonlyArray<StyleGroup> {
  const groups: StyleGroup[] = [];

  // Paint styles
  const paintStyles = styles.filter(s => s.type === 'PAINT');
  if (paintStyles.length > 0) {
    groups.push({
      key: 'style-PAINT',
      label: 'Color Styles',
      icon: '&#9632;',
      items: paintStyles.map(s => ({ id: s.id, name: s.name, isVariable: false })),
    });
  }

  // Text styles
  const textStyles = styles.filter(s => s.type === 'TEXT');
  if (textStyles.length > 0) {
    groups.push({
      key: 'style-TEXT',
      label: 'Text Styles',
      icon: 'T',
      items: textStyles.map(s => ({ id: s.id, name: s.name, isVariable: false })),
    });
  }

  // Variable groups — one accordion per collection
  const collectionOrder: string[] = [];
  const byCollection = new Map<string, { name: string; items: LocalVariableInfo[] }>();
  for (const v of variables) {
    if (!byCollection.has(v.collectionId)) {
      byCollection.set(v.collectionId, { name: v.collectionName, items: [] });
      collectionOrder.push(v.collectionId);
    }
    byCollection.get(v.collectionId)!.items.push(v);
  }

  for (const colId of collectionOrder) {
    const col = byCollection.get(colId)!;
    const colorVars = col.items.filter(v => v.resolvedType === 'COLOR');
    const floatVars = col.items.filter(v => v.resolvedType === 'FLOAT');

    if (colorVars.length > 0) {
      groups.push({
        key: `var-color-${colId}`,
        label: `${col.name} — Colors`,
        icon: '&#9675;',
        items: colorVars.map(v => ({ id: v.id, name: v.name, isVariable: true })),
      });
    }
    if (floatVars.length > 0) {
      groups.push({
        key: `var-float-${colId}`,
        label: `${col.name} — Numbers`,
        icon: '#',
        items: floatVars.map(v => ({ id: v.id, name: v.name, isVariable: true })),
      });
    }
  }

  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function renderStyleList(): void {
  const { filteredStyles, filteredVariables } = getFilteredItems();
  const totalSelected = state.selectedStyleIds.size + state.selectedVariableIds.size;
  elements.selectedCount.textContent = `${totalSelected} selected`;

  const hasAny = state.styles.length > 0 || state.variables.length > 0;
  if (!hasAny) {
    elements.styleList.innerHTML = '';
    elements.emptyStylesMsg.classList.remove('hidden');
    elements.emptyStylesMsg.textContent = 'No local styles or variables found in this file.';
    return;
  }

  const hasFiltered = filteredStyles.length > 0 || filteredVariables.length > 0;
  if (!hasFiltered) {
    elements.emptyStylesMsg.classList.remove('hidden');
    elements.emptyStylesMsg.textContent = 'No styles or variables match your search.';
    elements.styleList.innerHTML = '';
    return;
  }

  elements.emptyStylesMsg.classList.add('hidden');

  const groups = buildGroups(filteredStyles, filteredVariables);

  // On first load, collapse all groups by default
  if (state.collapsedGroups.size === 0) {
    for (const group of groups) {
      state.collapsedGroups.add(group.key);
    }
  }

  const containerW = elements.styleList.offsetWidth || 280;
  const ITEM_FONT = '400 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const LABEL_FONT = '600 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  // item: padding(28) + checkbox(20) + gap(8) = 56px overhead
  const nameMaxPx = Math.max(40, containerW - 56);
  // header: padding(24) + icon(16) + gaps(16) + count(40) + chevron(16) = 112px overhead
  const labelMaxPx = Math.max(40, containerW - 112);

  let html = '';

  for (const group of groups) {
    const isCollapsed = state.collapsedGroups.has(group.key);
    const selectedInGroup = group.items.filter(item =>
      item.isVariable ? state.selectedVariableIds.has(item.id) : state.selectedStyleIds.has(item.id)
    ).length;

    html += `<div class="style-group ${isCollapsed ? 'collapsed' : ''}" data-group-key="${escapeAttr(group.key)}">`;
    html += `<div class="style-group-header" data-group-key="${escapeAttr(group.key)}">`;
    html += `<span class="style-group-icon">${group.icon}</span>`;
    html += `<span class="style-group-label" title="${escapeAttr(group.label)}">${escapeHtml(midTruncateToWidth(group.label, labelMaxPx, LABEL_FONT))}</span>`;
    html += `<span class="style-group-count">${selectedInGroup}/${group.items.length}</span>`;
    html += `<span class="accordion-chevron">&#9660;</span>`;
    html += `</div>`;

    for (const item of group.items) {
      const isSelected = item.isVariable
        ? state.selectedVariableIds.has(item.id)
        : state.selectedStyleIds.has(item.id);
      const dataAttr = item.isVariable ? `data-var-id="${escapeAttr(item.id)}"` : `data-style-id="${escapeAttr(item.id)}"`;
      html += `<div class="style-item ${isSelected ? 'selected' : ''}" ${dataAttr}>`;
      html += `<div class="style-checkbox">${isSelected ? '&#10003;' : ''}</div>`;
      html += `<div class="style-name" title="${escapeAttr(item.name)}">${escapeHtml(midTruncateToWidth(item.name, nameMaxPx, ITEM_FONT))}</div>`;
      html += `</div>`;
    }

    html += `</div>`;
  }

  elements.styleList.innerHTML = html;

  // Accordion header click
  elements.styleList.querySelectorAll('.style-group-header').forEach(header => {
    header.addEventListener('click', () => {
      const key = (header as HTMLElement).getAttribute('data-group-key') ?? '';
      if (state.collapsedGroups.has(key)) {
        state.collapsedGroups.delete(key);
      } else {
        state.collapsedGroups.add(key);
      }
      renderStyleList();
    });
  });

  // Style item click
  elements.styleList.querySelectorAll('.style-item').forEach(item => {
    item.addEventListener('click', () => {
      const styleId = (item as HTMLElement).getAttribute('data-style-id');
      const varId = (item as HTMLElement).getAttribute('data-var-id');
      if (styleId) toggleStyleSelection(styleId);
      else if (varId) toggleVariableSelection(varId);
    });
  });
}

// ─── Rendering: Results ────────────────────────────────────────────────────

function getFilteredResults(): ReadonlyArray<import('../shared/types').ComponentSetResult> {
  if (state.scanResult === null) return [];
  const query = state.resultSearchQuery.toLowerCase().trim();
  if (query === '') return state.scanResult.results;
  return state.scanResult.results.filter(
    r =>
      r.nodeName.toLowerCase().includes(query) ||
      r.pageName.toLowerCase().includes(query) ||
      r.matches.some(m => m.styleName.toLowerCase().includes(query)) ||
      r.variableMatches.some(m => m.variableName.toLowerCase().includes(query)),
  );
}

function renderResults(): void {
  if (state.scanResult === null) {
    elements.resultsSection.style.display = 'none';
    elements.resultsEmptyState.style.display = 'flex';
    return;
  }

  elements.resultsEmptyState.style.display = 'none';
  elements.resultsSection.style.display = 'flex';
  const filtered = getFilteredResults();
  const result = state.scanResult;

  elements.resultsStatus.innerHTML =
    `<span>${result.results.length} component set${result.results.length !== 1 ? 's' : ''}</span>` +
    `<span class="results-meta">${result.scannedComponentCount} components scanned in ${result.scanDurationMs}ms</span>`;

  if (result.results.length === 0) {
    elements.resultsList.innerHTML = `<div class="empty-results">No main components use the selected styles or variables.</div>`;
    return;
  }

  if (filtered.length === 0) {
    elements.resultsList.innerHTML = `<div class="empty-results">No results match your filter.</div>`;
    return;
  }

  const copyIcon = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  const linkIcon = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 6.5a3 3 0 0 0 4.243 0l1.414-1.414a3 3 0 0 0-4.243-4.243L5.707 2.05" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M7 5.5a3 3 0 0 0-4.243 0L1.343 6.914a3 3 0 0 0 4.243 4.243L6.293 9.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

  // Pixel-accurate truncation widths based on live column sizes
  const listW = elements.resultsList.offsetWidth || 580;
  const contentW = listW - 24; // subtract row padding (12px each side)
  // result-main: 160px fixed; result-actions: 160px fixed; 2 gaps: 16px
  const matchesColW = Math.max(80, contentW - 160 - 160 - 16);
  // result-style-name: matchesColW minus count(80) minus inner gap(8) minus padding-right(4)
  const styleNameMaxPx = Math.max(40, matchesColW - 80 - 8 - 4);
  // result-name: 160px minus copy-btn(20px) minus gap(4px)
  const compNameMaxPx = 160 - 20 - 4;
  const NAME_FONT = '500 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const STYLE_FONT = '400 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  let html = `<div class="results-column-header"><span class="col-name">Component name</span><span class="col-style">Style / Variable</span><span class="col-count">Instances</span><span class="col-actions"></span></div>`;
  for (const row of filtered) {
    html += `<div class="result-row" data-node-id="${escapeAttr(row.nodeId)}" data-page-id="${escapeAttr(row.pageId)}">`;
    html += `<div class="result-main">`;
    html += `<div class="result-name-row">`;
    html += `<div class="result-name" title="${escapeAttr(row.nodeName)}">${escapeHtml(midTruncateToWidth(row.nodeName, compNameMaxPx, NAME_FONT))}</div>`;
    html += `<button class="copy-name-btn" title="Copy component name" data-action="copy-name" data-name="${escapeAttr(row.nodeName)}">${copyIcon}</button>`;
    html += `</div>`;
    html += `<div class="result-page">${escapeHtml(row.pageName)}</div>`;
    html += `</div>`;
    html += `<div class="result-matches-col">`;
    for (const match of row.matches) {
      const cls = match.styleType === 'TEXT' ? 'style-text' : 'style-paint';
      html += `<div class="result-match-row">`;
      html += `<div class="result-style-name ${cls}" title="${escapeAttr(match.styleName)}">${escapeHtml(midTruncateToWidth(match.styleName, styleNameMaxPx, STYLE_FONT))}</div>`;
      html += `<div class="result-count">${match.count}</div>`;
      html += `</div>`;
    }
    for (const match of row.variableMatches) {
      const cls = match.resolvedType === 'COLOR' ? 'style-var-color' : 'style-var-float';
      html += `<div class="result-match-row">`;
      html += `<div class="result-style-name ${cls}" title="${escapeAttr(match.variableName)}">${escapeHtml(midTruncateToWidth(match.variableName, styleNameMaxPx, STYLE_FONT))}</div>`;
      html += `<div class="result-count">${match.count}</div>`;
      html += `</div>`;
    }
    html += `</div>`;
    html += `<div class="result-actions">`;
    html += `<button class="action-labeled-btn" data-action="deep-link" data-node-id="${escapeAttr(row.nodeId)}">${linkIcon}Copy link to component</button>`;
    html += `</div>`;
    html += `</div>`;
  }

  elements.resultsList.innerHTML = html;

  elements.resultsList.querySelectorAll('.result-row').forEach(row => {
    const main = row.querySelector('.result-main');
    if (main) {
      main.addEventListener('click', () => {
        const nodeId = row.getAttribute('data-node-id');
        const pageId = row.getAttribute('data-page-id');
        if (nodeId && pageId) navigateToComponent(nodeId, pageId);
      });
    }
  });

  elements.resultsList.querySelectorAll('.action-labeled-btn, .copy-name-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).getAttribute('data-action');
      if (action === 'navigate') {
        const nodeId = (btn as HTMLElement).getAttribute('data-node-id');
        const pageId = (btn as HTMLElement).getAttribute('data-page-id');
        if (nodeId && pageId) navigateToComponent(nodeId, pageId);
      } else if (action === 'deep-link') {
        const nodeId = (btn as HTMLElement).getAttribute('data-node-id');
        if (nodeId) { pendingDeepLinkBtn = btn as HTMLElement; requestDeepLink(nodeId); }
      } else if (action === 'copy-name') {
        const name = (btn as HTMLElement).getAttribute('data-name');
        if (name) copyComponentName(name);
      }
    });
  });
}

// ─── Progress ──────────────────────────────────────────────────────────────

function showProgress(): void {
  elements.progressBar.style.display = 'flex';
  elements.progressFill.style.width = '0%';
  elements.progressText.innerHTML =
    'Scanning<span class="scanning-dot">.</span><span class="scanning-dot">.</span><span class="scanning-dot">.</span>';
}

function hideProgress(): void {
  elements.progressBar.style.display = 'none';
  elements.progressFill.style.width = '0%';
}

function renderProgress(): void {
  if (state.scanProgress === null) return;
  const { scanned, total } = state.scanProgress;
  const pct = total > 0 ? Math.round((scanned / total) * 100) : 0;
  elements.progressFill.style.width = `${pct}%`;
  elements.progressText.innerHTML =
    'Scanning<span class="scanning-dot">.</span><span class="scanning-dot">.</span><span class="scanning-dot">.</span>' +
    ` ${scanned}/${total} components`;
}

// ─── UI state helpers ──────────────────────────────────────────────────────

function updateScanButton(): void {
  const hasSelection = state.selectedStyleIds.size > 0 || state.selectedVariableIds.size > 0;
  if (state.isScanning) {
    elements.scanBtn.disabled = false;
    elements.scanBtn.textContent = 'Cancel';
    elements.scanBtn.className = 'cancel-scan-btn';
    elements.scanBtn.style.background = 'var(--color-bg-secondary)';
    elements.scanBtn.style.color = 'var(--color-text)';
    elements.scanBtn.style.border = '1px solid var(--color-border)';
    elements.scanBtn.style.fontWeight = '500';
    elements.scanPageBtn.style.display = 'none';
  } else {
    elements.scanBtn.disabled = !hasSelection;
    elements.scanBtn.textContent = 'Scan file';
    elements.scanBtn.className = 'primary-btn';
    elements.scanBtn.style.background = '';
    elements.scanBtn.style.color = '';
    elements.scanBtn.style.border = '';
    elements.scanBtn.style.fontWeight = '';
    elements.scanPageBtn.disabled = !hasSelection;
    elements.scanPageBtn.style.display = 'inline-flex';
  }
}

function showError(message: string): void {
  elements.resultsSection.style.display = 'flex';
  elements.resultsList.innerHTML = `<div class="error-msg">${escapeHtml(message)}</div>`;
}

function showToast(message: string, type: 'info' | 'error' = 'info'): void {
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type}`;
  setTimeout(() => {
    elements.toast.className = 'toast';
  }, 2500);
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function sendToPlugin(msg: UIToPluginMessage): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

function copyToClipboard(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

function midTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 1) / 2);
  return str.slice(0, half) + '…' + str.slice(str.length - half);
}

// Canvas-based pixel-accurate middle truncation
const _measureCanvas = document.createElement('canvas');
const _measureCtx = _measureCanvas.getContext('2d')!;

function midTruncateToWidth(str: string, maxPx: number, font: string): string {
  _measureCtx.font = font;
  if (_measureCtx.measureText(str).width <= maxPx) return str;
  let lo = 0;
  let hi = Math.floor((str.length - 1) / 2);
  let best = '…';
  while (lo <= hi) {
    const half = (lo + hi) >> 1;
    const candidate = half > 0
      ? str.slice(0, half) + '…' + str.slice(str.length - half)
      : '…';
    if (_measureCtx.measureText(candidate).width <= maxPx) {
      best = candidate;
      lo = half + 1;
    } else {
      hi = half - 1;
    }
  }
  return best;
}

// ─── Boot ──────────────────────────────────────────────────────────────────

init();
