import type { UIToPluginMessage, PluginToUIMessage, LocalStyleInfo, LocalVariableInfo } from '../shared/types';
import { loadLocalStyles, loadLocalVariables } from './styles';
import { runScan, cancelCurrentScan } from './scanner';
import { navigateToNode, generateDeepLinkInfo } from './navigation';

// ─── Plugin initialization ─────────────────────────────────────────────────

figma.showUI(__html__, {
  width: 900,
  height: 600,
  themeColors: true,
  title: 'Style and Variable Finder',
});

// Cache loaded styles and variables so we don't reload on every scan
let cachedStyles: ReadonlyArray<LocalStyleInfo> = [];
let cachedVariables: ReadonlyArray<LocalVariableInfo> = [];

// ─── Send styles + variables immediately on launch ──────────────────────────

async function loadAndSendStyles(): Promise<void> {
  [cachedStyles, cachedVariables] = await Promise.all([
    loadLocalStyles(),
    loadLocalVariables(),
  ]);
  sendToUI({ type: 'styles-loaded', styles: cachedStyles, variables: cachedVariables });
}

loadAndSendStyles();

// ─── Message handling ──────────────────────────────────────────────────────

figma.ui.onmessage = async (msg: UIToPluginMessage) => {
  switch (msg.type) {
    case 'load-styles': {
      await loadAndSendStyles();
      break;
    }

    case 'run-scan': {
      cancelCurrentScan();

      const onProgress = (scanned: number, total: number): void => {
        sendToUI({ type: 'scan-progress', scanned, total });
      };

      // Yield before starting heavy work so the UI iframe can paint
      // the Cancel button and progress bar before we block the thread.
      setTimeout(async () => {
        try {
          const result = await runScan(msg.request, cachedStyles, cachedVariables, onProgress);
          if (result !== null) {
            sendToUI({ type: 'scan-complete', result });
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          sendToUI({ type: 'scan-error', error });
        }
      }, 0);
      break;
    }

    case 'cancel-scan': {
      cancelCurrentScan();
      sendToUI({ type: 'scan-cancelled' });
      break;
    }

    case 'navigate-to-node': {
      const { success, error } = await navigateToNode(msg.nodeId, msg.pageId);
      sendToUI({ type: 'navigation-complete', success, error });
      break;
    }

    case 'request-deep-link': {
      const { url, fallbackName } = await generateDeepLinkInfo(msg.nodeId);
      sendToUI({ type: 'deep-link-result', nodeId: msg.nodeId, url, fallbackName });
      break;
    }
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function sendToUI(message: PluginToUIMessage): void {
  figma.ui.postMessage(message);
}
