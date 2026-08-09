import type { PageSnapshot, HistoryEntry, HistoryEntryV1, WorkingMemoryView } from "./types.js";

// ponytail: stable element IDs + hierarchical tree + state per element + diff.
// Same DOM node → same ID across observations. Tree is small enough for any
// model to scan. Click coordinates inline so the model never has to correlate.

const HISTORY_LIMIT = 6;

// ponytail: Generic list-row renderer. Any webmail / inbox / list view
// where rows render as role=link elements with names of the form
// "<sender> - <subject> <preview>" gets the same structured table —
// sender/subject visible upfront so the model can spot domain mismatches
// without parsing a 80-char truncated string. URL detection covers major
// email providers; the row extractor is provider-agnostic.
//
// Note: this is specifically for email/inbox-style rows where the first
// segment of the row name is the sender identifier. Other list views
// (issue trackers, e-commerce, search results) have different row
// semantics and shouldn't use this renderer.

const EMAIL_PROVIDER_HOSTS = new Set([
  // Gmail + Inbox
  "mail.google.com",
  "inbox.google.com",
  // Outlook
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  // Yahoo Mail
  "mail.yahoo.com",
  "ymail.com",
  // Proton Mail
  "proton.me",
  "mail.proton.me",
  "protonmail.com",
  // Fastmail
  "fastmail.com",
  // iCloud Mail
  "mail.icloud.com",
  "www.icloud.com",
  // AOL Mail
  "mail.aol.com",
  // Zoho Mail
  "mail.zoho.com",
  // Yandex Mail
  "mail.yandex.com",
  // GMX / Web.de
  "mail.gmx.com",
  "web.de",
]);

// Hosts that signal "this looks like a list of items with sender-like
// prefixes" even if not a known email provider. Generic fallback.
const LIST_LIKE_HOST_PATTERNS = [
  /^mail\./,
  /^inbox\./,
  /\.mail\./,
];

export function isEmailInbox(url: string): boolean {
  try {
    const u = new URL(url);
    if (EMAIL_PROVIDER_HOSTS.has(u.hostname)) return true;
    return LIST_LIKE_HOST_PATTERNS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface ListRow {
  rowId: string;
  sender: string;
  subject: string;
  snippet: string;
  bboxCx: number;
  bboxCy: number;
}

// Generic chrome / UI labels that aren't real senders.
const CHROME_SENDERS = new Set([
  "gmail", "google", "search", "tab", "help", "training",
  "send feedback to google", "outlook", "yahoo", "proton",
  "compose", "inbox", "drafts", "sent", "spam", "trash",
  "starred", "important", "snoozed", "archive",
]);

export function extractListRows(elements: PageSnapshot["elements"]): ListRow[] {
  // ponytail: List rows typically render as role=link divs whose name is
  // "<sender> - <subject> <first line of body>". We split on the FIRST
  // " - " to peel sender off. Sender must be ≤80 chars (real names, not
  // chrome link labels). Filter out inbox chrome (logo, "Inbox 585", etc.)
  // by name.
  const rows: ListRow[] = [];
  for (const el of elements) {
    if (el.role !== "link") continue;
    const name = el.name || "";
    const dashIdx = name.indexOf(" - ");
    if (dashIdx <= 0) continue;
    const sender = name.slice(0, dashIdx).trim();
    const rest = name.slice(dashIdx + 3).trim();
    if (!sender || sender.length > 80) continue;
    if (CHROME_SENDERS.has(sender.toLowerCase())) continue;
    rows.push({
      rowId: el.id,
      sender,
      subject: rest.slice(0, 80),
      snippet: rest.slice(80, 180),
      bboxCx: el.cx,
      bboxCy: el.cy,
    });
  }
  return rows;
}

export function renderEmailInbox(snap: PageSnapshot): string {
  const rows = extractListRows(snap.elements);
  if (rows.length === 0) return "";
  const lines = [
    "=== INBOX ROWS (sender → subject, top-down — newest at top) ===",
    "Each row is a clickable email/message. Verify the sender matches the goal domain BEFORE opening; skip rows whose sender doesn't match.",
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const snippetSuffix = r.snippet ? ` snippet="${r.snippet.trim()}"` : "";
    lines.push(
      `  ${String(i + 1).padStart(2, " ")}. [${r.rowId}] sender="${r.sender}" subject="${r.subject}"${snippetSuffix} bbox=(${r.bboxCx},${r.bboxCy})`,
    );
  }
  lines.push("=== END INBOX ROWS ===");
  return lines.join("\n");
}

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
  // ponytail: URL/PATH/Title/PURPOSE at the top — orients the model in
  // one glance. PATH is the URL pathname (what the user typically means
  // by "where am I"); PURPOSE is the meta description + first h1.
  lines.push(`URL: ${snap.url}`);
  try {
    const u = new URL(snap.url);
    lines.push(`PATH: ${u.pathname}${u.search}`);
  } catch {
    /* keep URL only */
  }
  lines.push(`Title: ${snap.title}`);
  if (snap.pagePurpose) lines.push(`PURPOSE: ${snap.pagePurpose}`);
  lines.push("");
  // ponytail: replay-ready fields — visible anchor and button inventories
  // come BEFORE structured page text so the model sees them first. Each
  // link/button carries its href + axPath + attributeHash + bbox, which
  // is what the future workflow recorder needs.
  if (snap.links && snap.links.length > 0) {
    lines.push("=== ANCHORS (text → href) ===");
    for (const l of snap.links.slice(0, 100)) {
      try {
        const u = new URL(l.href);
        lines.push(`  ${l.text.padEnd(28)} → ${u.pathname}${u.search}`);
      } catch {
        lines.push(`  ${l.text.padEnd(28)} → ${l.href}`);
      }
    }
    lines.push("");
  }
  if (snap.buttons && snap.buttons.length > 0) {
    lines.push("=== BUTTONS (text) ===");
    for (const b of snap.buttons.slice(0, 100)) {
      lines.push(`  ${b.text}`);
    }
    lines.push("");
  }
  // ponytail: smart-structured page text comes AFTER anchors/buttons so the
  // model sees the human-readable clickables first, then the body. The walker
  // produces HEADINGS / STATS / LABELS / TEXT blocks — STATS catches patterns
  // like "12 followers" automatically, which is exactly what the user asked
  // about. Anything fact-finding depends on lives here.
  // ponytail: email/inbox row table — surfaces sender/subject per row so
  // the model can spot domain mismatches on Gmail, Outlook, Yahoo, Proton,
  // etc. No-op on unrelated pages.
  const inboxTable = isEmailInbox(snap.url) ? renderEmailInbox(snap) : "";
  if (inboxTable) lines.push(inboxTable);
  lines.push("=== PAGE TEXT (HEADINGS + STATS + LABELS + TEXT — STATS contains the data the user asked for) ===");
  lines.push(snap.bodyTextSnippet || "(empty)");
  lines.push("=== END PAGE TEXT ===");
  lines.push("");
  lines.push("Elements (use IDs, click coords inline; anchors include href):");
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

  // ponytail: smart structured page extraction — replaces the lazy
  // textContent.slice(N) cap. Walks DOM with structure awareness:
  //   - HEADINGS (h1-h6) always kept (page outline)
  //   - STATS (number with nearby label, e.g. "12 followers") — this is the
  //     exact pattern that catches GitHub's follower count, repo counts, etc.
  //   - LABELS (form <label>s) kept
  //   - TEXT (visible, deduped, filtered for navigation/footer chrome)
  // Output scales with page complexity. No character cap — the model gets
  // the structured view it needs to answer fact-finding questions.
  function smartExtractText() {
    var SKIP_TAGS = { script:1, style:1, meta:1, link:1, noscript:1, svg:1, path:1 };
    var HIDDEN_ROLES = { navigation:1, banner:1, contentinfo:1 };
    // ponytail: literal chrome denylist replaces the over-broad NAV_LINE_RE.
    // The old regex hid navigation labels the model needs
    // ("Browse repositories", "Filter by languages").
    var CHROME_DENYLIST = {
      'skip to content': 1,
      'skip to main content': 1,
      'skip to navigation': 1,
      '©': 1,
      'all rights reserved': 1,
    };
    function vis(el) {
      if (!el || el.nodeType !== 1) return false;
      var t = el.tagName.toLowerCase();
      if (SKIP_TAGS[t]) return false;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      return true;
    }
    function clean(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }
    var parts = [];

    // Headings
    var heads = [];
    var hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (!vis(h)) continue;
      var ht = clean(h.textContent);
      if (ht && ht.length < 200) heads.push('H' + h.tagName[1] + ': ' + ht);
    }
    if (heads.length) parts.push('=== HEADINGS ===\\n' + heads.join('\\n'));

    // Stats: element with numeric-only text, parent contains a short label.
    var stats = [];
    var nums = document.querySelectorAll('a, span, strong, b, div');
    for (var j = 0; j < nums.length; j++) {
      var el = nums[j];
      if (!vis(el)) continue;
      var own = clean(el.textContent);
      if (!/^\\d{1,4}(,\\d{3})*(\\.\\d+)?[KMBkmb]?$/.test(own)) continue;
      var p = el.parentElement;
      if (!p) continue;
      var pt = clean(p.textContent);
      if (pt.length > 80 || pt.length < own.length + 2) continue;
      var label = pt.replace(own, '').trim();
      if (label && label.length < 40) stats.push(label + ': ' + own);
    }
    if (stats.length) parts.push('=== STATS ===\\n' + stats.join('\\n'));

    // Form labels
    var lbls = [];
    var ls = document.querySelectorAll('label');
    for (var k = 0; k < ls.length; k++) {
      var l = ls[k];
      if (!vis(l)) continue;
      var lt = clean(l.textContent);
      if (lt && lt.length < 80) lbls.push(lt);
    }
    if (lbls.length) parts.push('=== LABELS ===\\n' + lbls.join('\\n'));

    // Visible text: walk + dedupe, filter nav/footer
    var seen = {};
    var lines = [];
    function walkText(el, depth) {
      if (depth > 25) return;
      if (el.nodeType === 3) {
        var t = clean(el.textContent);
        if (t.length < 3) return;
        // ponytail: dropped NAV_LINE_RE; only the literal chrome denylist
        // hides a line now.
        if (CHROME_DENYLIST[t.toLowerCase()]) return;
        if (seen[t]) return;
        seen[t] = 1;
        lines.push(t);
        return;
      }
      if (!vis(el)) return;
      var role = el.getAttribute && el.getAttribute('role');
      if (HIDDEN_ROLES[role]) return;
      var cn = el.childNodes;
      for (var n = 0; n < cn.length; n++) walkText(cn[n], depth + 1);
    }
    walkText(document.body, 0);
    if (lines.length) parts.push('=== TEXT ===\\n' + lines.join('\\n'));

    return parts.join('\\n\\n');
  }

  // ponytail: page-identity fingerprint + replay-ready fields.
  // Mirrors the extension's collectPageSnapshot.
  function pathFor(el) {
    var path = [];
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var role = cur.getAttribute('role') || cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      var idx = 0;
      if (parent) {
        var sameRole = [];
        for (var k = 0; k < parent.children.length; k++) {
          var c = parent.children[k];
          var cr = c.getAttribute('role') || c.tagName.toLowerCase();
          if (cr === role) sameRole.push(c);
        }
        idx = sameRole.indexOf(cur);
        if (idx < 0) idx = 0;
      }
      var name = (cur.getAttribute('aria-label') || cur.getAttribute('title') || '').trim().slice(0, 80);
      path.unshift({ role: role, index: idx, name: name || undefined });
      cur = parent;
    }
    return path;
  }
  function hashAttrs(el) {
    var keys = ['id', 'aria-label', 'data-testid', 'data-id', 'name', 'type', 'href', 'role', 'title'];
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var v = el.getAttribute(keys[i]);
      if (typeof v === 'string' && v.length > 0) parts.push(keys[i] + '=' + v);
    }
    var text = parts.join('|');
    var h1 = 0xcbf29ce484222325 | 0;
    var h2 = 0x84222325cbf29ce4 | 0;
    for (var j = 0; j < text.length; j++) {
      var cc = text.charCodeAt(j);
      h1 = Math.imul(h1 ^ cc, 0x100000001b3) | 0;
      h2 = Math.imul(h2 ^ cc, 0x100000001b3) | 0;
    }
    function hex(n) { var s = (n >>> 0).toString(16); while (s.length < 8) s = '0' + s; return s; }
    return hex(h1) + hex(h2);
  }
  function rect(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function linkText(el) {
    var t = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim().replace(/\\s+/g, ' ');
    return t.slice(0, 256);
  }
  function safeText(t) {
    return /\\b(?:authorization|cookie|credentials?|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token)\\b/i.test(t);
  }
  function pageIdentity() {
    var lines = [];
    var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, null);
    var nd = walker.currentNode;
    while (nd) {
      var el = nd;
      var role = el.getAttribute('role') || el.tagName.toLowerCase();
      var parent = el.parentElement;
      var idx = 0;
      if (parent) {
        var sameRole = [];
        for (var k = 0; k < parent.children.length; k++) {
          var c = parent.children[k];
          var cr = c.getAttribute('role') || c.tagName.toLowerCase();
          if (cr === role) sameRole.push(c);
        }
        idx = sameRole.indexOf(el);
        if (idx < 0) idx = 0;
      }
      var name = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80);
      lines.push(role + '|' + idx + '|' + name);
      nd = walker.nextNode();
    }
    var text = lines.join('\\n');
    var h1 = 0xcbf29ce484222325 | 0;
    var h2 = 0x84222325cbf29ce4 | 0;
    for (var i = 0; i < text.length; i++) {
      var cc = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ cc, 0x100000001b3) | 0;
      h2 = Math.imul(h2 ^ cc, 0x100000001b3) | 0;
    }
    function hex(n) { var s = (n >>> 0).toString(16); while (s.length < 8) s = '0' + s; return s; }
    return hex(h1) + hex(h2);
  }
  var pagePurpose = '';
  var meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  if (meta) pagePurpose = (meta.getAttribute('content') || '').trim();
  var h1El = document.querySelector('h1');
  if (h1El) pagePurpose = (pagePurpose ? pagePurpose + ' — ' : '') + (h1El.textContent || '').trim();
  if (pagePurpose.length > 512) pagePurpose = pagePurpose.slice(0, 512);

  var links = [];
  var linkSel = "a[href], [role='link'][href], [role='link']";
  var linkIter = document.querySelectorAll(linkSel);
  for (var li = 0; li < linkIter.length && links.length < 500; li++) {
    var le = linkIter[li];
    if (!isVisible(le)) continue;
    var lt = linkText(le);
    if (!lt || safeText(lt)) continue;
    var lhref = le.getAttribute('href') || '';
    if (lhref.indexOf('javascript:') === 0) continue;
    var labs;
    try { labs = new URL(lhref, location.href).toString(); } catch (e) { continue; }
    if (labs.length > 2048) labs = labs.slice(0, 2048);
    links.push({ text: lt, href: labs, axPath: pathFor(le), attributeHash: hashAttrs(le), bbox: rect(le) });
  }

  var buttons = [];
  var btnSel = "button, [role='button'], [role='tab'], input[type='submit'], input[type='button']";
  var btnIter = document.querySelectorAll(btnSel);
  for (var bi = 0; bi < btnIter.length && buttons.length < 500; bi++) {
    var be = btnIter[bi];
    if (!isVisible(be)) continue;
    if (be.tagName.toLowerCase() === 'input') {
      var bt = ((be.type || '') + '').toLowerCase();
      if (bt === 'hidden' || bt === 'password') continue;
    }
    var btext = ((be.getAttribute('aria-label') || '') + ' ' + ((be.value || '') + '') + ' ' + (be.textContent || '')).trim().replace(/\\s+/g, ' ');
    if (!btext || safeText(btext)) continue;
    buttons.push({ text: btext.slice(0, 256), axPath: pathFor(be), attributeHash: hashAttrs(be), bbox: rect(be) });
  }

  return {
    url: location.href,
    title: document.title,
    elements: out,
    focusedId: (focused && focused !== document.body) ? stableId(focused, []) : null,
    bodyTextSnippet: smartExtractText(),
    pageIdentity: pageIdentity(),
    pagePurpose: pagePurpose,
    links: links,
    buttons: buttons,
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
// run() loop produce identical strings. Mirrors the extension's
// renderObservationForPlanner — goal keywords + step info + goal banner up top.
export interface RenderStepInfo {
  index: number;
  totalBudget: number;
  elapsedMs: number;
  budgetMs: number;
  pageIdentity: string;
}

export interface RenderContextOptions {
  goal: string;
  goalKeywords: string[];
  goalBanner: string;
  stepInfo: RenderStepInfo;
}

export function renderContext(
  snap: PageSnapshot,
  prev: PageSnapshot | null,
  history: HistoryEntry[],
  memory: WorkingMemoryView | undefined,
  opts: RenderContextOptions,
): string {
  const parts: string[] = [];
  const elapsedS = Math.round(opts.stepInfo.elapsedMs / 1000);
  const budgetS = Math.round(opts.stepInfo.budgetMs / 1000);
  parts.push([
    "=== STEP STATUS ===",
    `Step ${opts.stepInfo.index} · ${elapsedS}s elapsed of ${budgetS}s budget · pageIdentity ${opts.stepInfo.pageIdentity || "?"}`,
    "=== END STEP STATUS ===",
    "",
  ].join("\n"));
  parts.push([
    "=== GOAL ===",
    opts.goal,
    opts.goalKeywords.length > 0 ? `keywords: [${opts.goalKeywords.join(", ")}]` : "",
    "=== END GOAL ===",
    "",
  ].filter(Boolean).join("\n"));
  if (opts.goalBanner) {
    parts.push(opts.goalBanner + "\n");
  }
  parts.push(renderMemoryBlock(memory ?? { facts: [] }));
  parts.push(renderHistory(history));
  parts.push(renderSnapshot(snap, prev));
  return parts.join("\n");
}

// ponytail: structured memory block — model-only. Carries findings across
// turns so the model doesn't re-discover facts it already recorded. Always
// rendered above history so it's the first thing the model reads.
export function renderMemoryBlock(memory: WorkingMemoryView): string {
  if (!memory.facts || memory.facts.length === 0) {
    return [
      "=== WORKING MEMORY (structured findings carried across turns) ===",
      "  (no findings recorded yet — every step should record what you observed)",
      "=== END WORKING MEMORY ===",
      "",
    ].join("\n");
  }
  const lines = memory.facts.map((f) => {
    const ev = f.evidence ? `  (evidence: ${f.evidence})` : "";
    return `  - ${f.key} = "${f.value}"${ev}`;
  });
  return [
    "=== WORKING MEMORY (structured findings — do not re-record; carry these forward) ===",
    ...lines,
    "=== END WORKING MEMORY ===",
    "",
  ].join("\n");
}
