import type { PageSnapshot, HistoryEntry, HistoryEntryV1 } from "./types.js";

// ponytail: stable element IDs + hierarchical tree + state per element + diff.
// Same DOM node → same ID across observations. Tree is small enough for any
// model to scan. Click coordinates inline so the model never has to correlate.

const HISTORY_LIMIT = 6;

export function describeAction(a: {
  type?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  url?: string;
  deltaX?: number;
  deltaY?: number;
  durationMs?: number;
}): string {
  switch (a.type) {
    case "left_click":
    case "double_click":
    case "right_click":
      return `${a.type} at (${a.x}, ${a.y})`;
    case "mouse_move":
      return `mouse_move to (${a.x}, ${a.y})`;
    case "insert_text":
      return `insert_text "${a.text ?? ""}"`;
    case "key":
      return `key "${a.key ?? ""}"`;
    case "visit_url":
      return `visit_url ${a.url ?? ""}`;
    case "scroll":
      return `scroll dx=${a.deltaX ?? 0} dy=${a.deltaY ?? 0}`;
    case "wait":
      return `wait ${a.durationMs ?? 1000}ms`;
    case "terminate":
      return `terminate`;
    default:
      return a.type ?? "unknown";
  }
}

export function describeDiff(prev: PageSnapshot | null, next: PageSnapshot): string {
  if (!prev) return "(first step)";
  const prevById = new Map(prev.elements.map((e) => [e.id, e]));
  const nextById = new Map(next.elements.map((e) => [e.id, e]));
  const parts: string[] = [];
  for (const [id, n] of nextById) {
    const p = prevById.get(id);
    if (!p) {
      parts.push(`${id} appeared`);
      continue;
    }
    if (p.value !== n.value) parts.push(`${id} value→"${n.value.slice(0, 40)}"`);
    if (!p.focused && n.focused) parts.push(`${id} focused`);
    if (p.focused && !n.focused) parts.push(`${id} lost focus`);
    if (!p.disabled && n.disabled) parts.push(`${id} disabled`);
    if (p.disabled && !n.disabled) parts.push(`${id} enabled`);
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) parts.push(`${id} disappeared`);
  }
  if (prev.url !== next.url) parts.push(`url→${next.url}`);
  return parts.length ? parts.join("; ") : "no change";
}

export function renderHistory(history: HistoryEntry[]): string {
  if (history.length === 0) return "";
  const tail = history.slice(-HISTORY_LIMIT);
  // ponytail: HistoryEntryV1 carries memory (observation/verdict/next). When
  // present, render a "memory" section (model-only, internal) ahead of the
  // "what happened" section. Falls back to the legacy single-line format for
  // older callers that only have HistoryEntry.
  const memory = tail
    .map((h, i) => {
      const m = h as Partial<HistoryEntryV1>;
      if (!m.observation && !m.verdict && !m.nextActionPrediction) return null;
      return `  Step ${i + 1}: observation="${m.observation ?? ""}" verdict="${m.verdict ?? ""}" nextActionPrediction="${m.nextActionPrediction ?? ""}"`;
    })
    .filter((l): l is string => l !== null);
  const actionLines = tail.map((h, i) => `  Step ${i + 1}: action="${h.action}" result="${h.result}"`);
  const truncated = history.length > HISTORY_LIMIT ? `  (showing last ${HISTORY_LIMIT} of ${history.length})\n` : "";
  const blocks: string[] = [];
  if (memory.length > 0) {
    blocks.push(`Memory (carry this forward):\n${memory.join("\n")}`);
  }
  blocks.push(`What happened (last ${tail.length} steps):\n${actionLines.join("\n")}`);
  return `${truncated}${blocks.join("\n\n")}\n`;
}

export function diffSnapshots(prev: PageSnapshot | null, next: PageSnapshot): string {
  if (!prev) return "(first observation)";
  const prevById = new Map(prev.elements.map((e) => [e.id, e]));
  const nextById = new Map(next.elements.map((e) => [e.id, e]));
  const changes: string[] = [];
  for (const [id, n] of nextById) {
    const p = prevById.get(id);
    if (!p) {
      changes.push(`+ [${id}] ${n.tag} appeared`);
      continue;
    }
    const parts: string[] = [];
    if (p.value !== n.value) parts.push(`value "${p.value}" → "${n.value}"`);
    if (p.focused !== n.focused) parts.push(n.focused ? "gained focus" : "lost focus");
    if (p.disabled !== n.disabled) parts.push(n.disabled ? "became disabled" : "became enabled");
    if (p.cx !== n.cx || p.cy !== n.cy) parts.push("moved");
    if (parts.length) changes.push(`[${id}] ${n.tag}: ${parts.join(", ")}`);
  }
  for (const [id, p] of prevById) {
    if (!nextById.has(id)) changes.push(`- [${id}] ${p.tag} disappeared`);
  }
  if (prev.url !== next.url) changes.push(`url: ${prev.url} → ${next.url}`);
  if (prev.title !== next.title) changes.push(`title: ${prev.title} → ${next.title}`);
  return changes.length ? changes.join("\n") : "(no changes)";
}

export function renderSnapshot(snap: PageSnapshot, prev: PageSnapshot | null): string {
  const lines: string[] = [];
  lines.push(`URL: ${snap.url}`);
  lines.push(`Title: ${snap.title}`);
  lines.push("");
  lines.push("Elements (use IDs, click coords inline):");
  for (const el of snap.elements) {
    const tags: string[] = [];
    if (el.focused) tags.push("focused");
    if (el.disabled) tags.push("disabled");
    if (!el.visible) tags.push("hidden");
    if (el.value) tags.push(`value="${el.value}"`);
    if (el.placeholder) tags.push(`placeholder="${el.placeholder}"`);
    if (el.type) tags.push(`type=${el.type}`);
    if (el.checked !== undefined) tags.push(`checked=${el.checked}`);
    if (el.href) tags.push(`href="${el.href}"`);
    const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
    const nameStr = el.name ? ` "${el.name}"` : "";
    lines.push(`  [${el.id}] <${el.tag}>${nameStr}${tagStr} click=(${el.cx}, ${el.cy})`);
  }
  if (snap.elements.length === 0) lines.push("  (no interactive elements)");
  if (snap.focusedId) {
    const f = snap.elements.find((e) => e.id === snap.focusedId);
    if (f) lines.push(`\nFocused: [${f.id}] <${f.tag}>${f.name ? ` "${f.name}"` : ""}`);
  }
  if (prev) {
    lines.push("");
    lines.push("Changes since last step:");
    lines.push(diffSnapshots(prev, snap).split("\n").map((l) => `  ${l}`).join("\n"));
  }
  lines.push("");
  lines.push(`Page text (first 200 chars): "${snap.bodyTextSnippet}"`);
  return lines.join("\n");
}

// ponytail: the browser-side DOM walker. Pure string (no Playwright dep at module
// level) so it can be passed to page.evaluate() without esbuild injecting __name.
export const SNAPSHOT_FN_SRC = `(function () {
  function tagOf(el) { return el.tagName.toLowerCase(); }
  function roleOf(el) { return el.getAttribute('role') || tagOf(el); }
  function nameOf(el) {
    return el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.getAttribute('name') ||
      (el.textContent || '').trim().slice(0, 80) ||
      el.getAttribute('placeholder') ||
      '';
  }
  function valueOf(el) {
    return (el.value !== undefined ? el.value : '') || '';
  }
  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  }
  function isInteractive(el) {
    var t = tagOf(el);
    if (t === 'input' || t === 'button' || t === 'a' || t === 'select' || t === 'textarea') return true;
    var r = el.getAttribute('role');
    if (r && (r === 'button' || r === 'link' || r === 'checkbox' || r === 'radio' || r === 'textbox' || r === 'combobox' || r === 'menuitem')) return true;
    if (el.getAttribute('tabindex') !== null) return true;
    if (el.getAttribute('onclick') !== null) return true;
    return false;
  }
  function stableId(el, path) {
    var tagName = tagOf(el);
    var id = el.id ? '#' + el.id : '';
    var name = el.getAttribute('name') ? '[name=' + el.getAttribute('name') + ']' : '';
    var role = el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '';
    var sig = tagName + id + name + role;
    var s = sig + ':' + path.join('.');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (Math.imul(33, h) + s.charCodeAt(i)) | 0;
    return 'e' + (h >>> 0).toString(36);
  }
  function walk(root, path, out) {
    if (isInteractive(root) && isVisible(root)) {
      var r = root.getBoundingClientRect();
      var cx = Math.round(r.x + r.width / 2);
      var cy = Math.round(r.y + r.height / 2);
      var el = root;
      out.push({
        id: stableId(root, path),
        tag: tagOf(root),
        role: roleOf(root),
        name: nameOf(root),
        value: valueOf(root),
        type: el.type || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        focused: document.activeElement === root,
        disabled: el.disabled === true,
        visible: true,
        cx: cx,
        cy: cy,
        href: el.href || undefined,
        checked: (el.type === 'checkbox' || el.type === 'radio') ? Boolean(el.checked) : undefined,
      });
    }
    for (var i = 0; i < root.children.length; i++) {
      walk(root.children[i], path.concat([i]), out);
    }
  }
  var out = [];
  walk(document.body, [], out);
  var focused = document.activeElement;
  return {
    url: location.href,
    title: document.title,
    elements: out,
    focusedId: (focused && focused !== document.body) ? stableId(focused, []) : null,
    bodyTextSnippet: (document.body.textContent || '').trim().slice(0, 200),
  };
})()`;

// ponytail: login-page detector. Returns true if the page has a visible
// password input inside a form with a submit control. Used by the extension to
// decide when to pause the agent loop for user login.
export function looksLikeLoginPage(snap: PageSnapshot): boolean {
  const hasPassword = snap.elements.some((e) => e.type === "password");
  if (!hasPassword) return false;
  const hasSubmit = snap.elements.some(
    (e) =>
      (e.tag === "button" && (e.type === "submit" || e.type === undefined)) ||
      (e.tag === "input" && e.type === "submit"),
  );
  return hasSubmit;
}

// ponytail: render the full context block (history + snapshot + diff) for a
// single planner call. Single source of truth so demo script and production
// run() loop produce identical strings.
export function renderContext(snap: PageSnapshot, prev: PageSnapshot | null, history: HistoryEntry[]): string {
  return renderHistory(history) + renderSnapshot(snap, prev);
}
