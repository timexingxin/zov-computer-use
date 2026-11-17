import type {
  AppState,
  CompactAppState,
  CompactUIElement,
  DiffAppState,
  UIElement,
} from "./types.js";

/**
 * Converts a UIElement into a token-lean CompactUIElement.
 */
const PASSWORD_HINT_RE = /\b(password|passcode|passwd|pin\s*code)\b|密码|口令/i;

export function isSensitivePasswordElement(elem: {
  role: string;
  subrole?: string;
  name?: string;
  description?: string;
  identifier?: string;
}): boolean {
  const roleLower = (elem.role || "").toLowerCase();
  const subLower = (elem.subrole || "").toLowerCase();
  if (roleLower === "securetextfield" || subLower === "securetextfield") {
    return true;
  }
  if (["textfield", "textarea", "combobox", "searchfield"].includes(roleLower)) {
    const meta = `${elem.name || ""} ${elem.description || ""} ${elem.identifier || ""}`;
    if (PASSWORD_HINT_RE.test(meta)) {
      return true;
    }
  }
  return false;
}

export function redactElementSecrets(elem: UIElement): UIElement {
  const isSecure = isSensitivePasswordElement(elem);
  const redactedValue =
    isSecure && elem.value !== undefined && elem.value !== ""
      ? "[REDACTED_PASSWORD]"
      : elem.value;
  return {
    ...elem,
    value: redactedValue,
    children: elem.children ? elem.children.map(redactElementSecrets) : undefined,
  };
}

export function toCompactElement(elem: UIElement): CompactUIElement {
  const isSecure = isSensitivePasswordElement(elem);
  const compact: CompactUIElement = {
    i: elem.index,
    h: elem.handle,
    r: elem.role,
    n: elem.name,
    c: elem.capabilities || [],
  };
  if (elem.description !== undefined && elem.description !== "") {
    compact.d = elem.description;
  }
  if (elem.value !== undefined && elem.value !== "") {
    compact.v = isSecure ? "[REDACTED_PASSWORD]" : elem.value;
  }
  return compact;
}

/**
 * Flattens an element tree into a linear list of actionable compact elements.
 * Filters out purely decorative / non-interactive containers to maximize token efficiency.
 */
export function flattenAndFilterTree(
  elements: UIElement[],
  filterNonInteractive = true
): CompactUIElement[] {
  const result: CompactUIElement[] = [];

  function walk(node: UIElement) {
    const isInteractive =
      node.capabilities.length > 0 ||
      node.actions.length > 0 ||
      ["button", "textfield", "link", "checkbox", "radiobutton", "menuitem", "tab", "cell"].includes(
        node.role.toLowerCase()
      );
    const hasReadableText =
      node.name.trim().length > 0 || (node.value !== undefined && node.value.trim().length > 0);

    if (!filterNonInteractive || isInteractive || hasReadableText) {
      result.push(toCompactElement(node));
    }

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const root of elements) {
    walk(root);
  }

  return result;
}

/**
 * Transforms a full AppState into a CompactAppState.
 */
export function reduceToCompactState(state: AppState): CompactAppState {
  const compactElements = flattenAndFilterTree(state.tree, true);

  return {
    state_id: state.state_id,
    app: {
      pid: state.app.pid,
      name: state.app.name,
      bundle_id: state.app.bundle_id,
    },
    active_window: state.active_window
      ? {
          id: state.active_window.id,
          title: state.active_window.title,
          bounds: state.active_window.bounds,
        }
      : undefined,
    elements: compactElements,
    element_count: compactElements.length,
    timestamp: state.timestamp,
    screenshot_base64: state.screenshot_base64,
  };
}

/**
 * Computes a diff between two states (prior vs current).
 * Avoids resending the full tree when only minor controls changed.
 */
export function computeStateDiff(baseState: AppState, currentState: AppState): DiffAppState {
  const baseCounts = new Map<string, number>();
  const baseMap = new Map<string, CompactUIElement>();
  for (const elem of flattenAndFilterTree(baseState.tree, false)) {
    const occ = baseCounts.get(elem.h) || 0;
    baseCounts.set(elem.h, occ + 1);
    baseMap.set(`${elem.h}#${occ}`, elem);
  }

  const curCounts = new Map<string, number>();
  const currentMap = new Map<string, CompactUIElement>();
  const added: CompactUIElement[] = [];
  const modified: CompactUIElement[] = [];

  for (const cur of flattenAndFilterTree(currentState.tree, false)) {
    const occ = curCounts.get(cur.h) || 0;
    curCounts.set(cur.h, occ + 1);
    const occKey = `${cur.h}#${occ}`;
    currentMap.set(occKey, cur);
    const prev = baseMap.get(occKey);
    if (!prev) {
      added.push(cur);
    } else if (prev.n !== cur.n || prev.v !== cur.v || prev.c.join(",") !== cur.c.join(",")) {
      modified.push(cur);
    }
  }

  const removedHandles: string[] = [];
  for (const [occKey, elem] of baseMap) {
    if (!currentMap.has(occKey)) {
      removedHandles.push(elem.h);
    }
  }

  return {
    state_id: currentState.state_id,
    base_state_id: baseState.state_id,
    app: currentState.app,
    added_elements: added,
    removed_handles: removedHandles,
    modified_elements: modified,
    timestamp: currentState.timestamp,
  };
}
