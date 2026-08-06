import type { Page } from "playwright";

// ponytail: stable element IDs + hierarchical tree + state per element + diff.
// Same DOM node → same ID across observations. Tree is small enough for any
// model to scan. Click coordinates inline so the model never has to correlate.

export interface ElementState {
  id: string;
  tag: string;
  role: string;
  name: string;
  value: string;
  type?: string;
  placeholder?: string;
  focused: boolean;
  disabled: boolean;
  visible: boolean;
  cx: number;
  cy: number;
  href?: string;
  checked?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: ElementState[];
  focusedId: string | null;
  bodyTextSnippet: string;
}

// ponytail: pass the body as a string to page.evaluate so esbuild doesn't
// inject __name helper that doesn't exist in the browser context. Wrap with
// explicit return so Playwright sees the value.
const SNAPSHOT_FN_SRC = `(function () {
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

export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const result = await page.evaluate(SNAPSHOT_FN_SRC);
  if (!result) throw new Error("snapshotPage: evaluate returned undefined");
  return result as PageSnapshot;
}

export function diffSnapshots(prev: PageSnapshot | null, next: PageSnapshot): string {
  if (!prev) return "(first observation)";
  const prevById = new Map(prev.elements.map((e) => [e.id, e]));
  const nextById = new Map(next.elements.map((e) => [e.id, e]));
  const changes: string[] = [];
  for (const [id, n] of nextById) {
    const p = prevById.get(id);
    if (!p) { changes.push(`+ [${id}] ${n.tag} appeared`); continue; }
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
