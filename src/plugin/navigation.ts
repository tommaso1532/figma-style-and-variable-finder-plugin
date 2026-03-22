/**
 * Navigate to a node in the Figma canvas, switching pages if necessary.
 * Selects the node and scrolls it into view.
 * Uses async API required by documentAccess: "dynamic-page".
 */
export async function navigateToNode(nodeId: string, pageId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node === null) {
      return { success: false, error: 'Node no longer exists in this file.' };
    }

    // Switch to the correct page if needed
    const targetPage = await figma.getNodeByIdAsync(pageId);
    if (targetPage === null || targetPage.type !== 'PAGE') {
      return { success: false, error: 'Target page no longer exists.' };
    }

    if (figma.currentPage.id !== pageId) {
      await figma.setCurrentPageAsync(targetPage as PageNode);
    }

    // Select the node and scroll into view
    if (isSceneNode(node)) {
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      return { success: true };
    }

    return { success: false, error: 'Node is not a scene node.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Generate a deep link URL for a node in the current file.
 * Uses async API for node name fallback lookup.
 */
export async function generateDeepLinkInfo(nodeId: string): Promise<{ url: string | null; fallbackName: string }> {
  const node = await figma.getNodeByIdAsync(nodeId);
  const fallbackName = node !== null ? node.name : 'Unknown';

  try {
    const fileKey = figma.fileKey;
    if (fileKey === undefined || fileKey === null || fileKey === '') {
      return { url: null, fallbackName };
    }

    const urlNodeId = nodeId.replace(/:/g, '-');
    return { url: `https://www.figma.com/design/${fileKey}?node-id=${urlNodeId}`, fallbackName };
  } catch {
    return { url: null, fallbackName };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isSceneNode(node: BaseNode): node is SceneNode {
  return 'visible' in node;
}
