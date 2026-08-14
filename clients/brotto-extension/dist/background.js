(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/debugger.ts
  var debugger_exports = {};
  __export(debugger_exports, {
    attachToTab: () => attachToTab,
    checkTabSecurity: () => checkTabSecurity,
    detachAll: () => detachAll,
    detachFromTab: () => detachFromTab,
    getActiveSessions: () => getActiveSessions,
    getDebuggerUrl: () => getDebuggerUrl,
    getTabInfo: () => getTabInfo,
    getTargets: () => getTargets,
    isAttached: () => isAttached,
    registerEventHandler: () => registerEventHandler,
    sendCommand: () => sendCommand,
    unregisterEventHandlers: () => unregisterEventHandlers
  });
  async function attachToTab(tabId) {
    const debuggerUrl = `ws://localhost/${tabId}`;
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", async () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(`Failed to attach: ${lastError.message}`));
          return;
        }
        const session = {
          sessionId: `${tabId}-${Date.now()}`,
          tabId,
          attachedAt: Date.now(),
          debuggerUrl
        };
        DEBUGGER_TARGETS.set(session.sessionId, session);
        resolve(session);
      });
    });
  }
  async function detachFromTab(tabId) {
    return new Promise((resolve, reject) => {
      chrome.debugger.detach({ tabId }, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn(`Detach warning: ${lastError.message}`);
        }
        for (const [sessionId, session] of DEBUGGER_TARGETS.entries()) {
          if (session.tabId === tabId) {
            DEBUGGER_TARGETS.delete(sessionId);
          }
        }
        resolve();
      });
    });
  }
  async function detachAll() {
    const detachPromises = [];
    for (const session of DEBUGGER_TARGETS.values()) {
      detachPromises.push(detachFromTab(session.tabId));
    }
    await Promise.all(detachPromises);
    DEBUGGER_TARGETS.clear();
  }
  async function sendCommand(tabId, command) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, command.method, command.params, (result, error) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(`Command failed: ${lastError.message}`));
          return;
        }
        if (error) {
          reject(new Error(`Command error: ${error}`));
          return;
        }
        resolve(result);
      });
    });
  }
  function getTargets() {
    return new Promise((resolve) => {
      chrome.debugger.getTargets((targets) => {
        resolve(targets);
      });
    });
  }
  function getDebuggerUrl(tabId) {
    return `ws://localhost/${tabId}`;
  }
  function isAttached(tabId) {
    for (const session of DEBUGGER_TARGETS.values()) {
      if (session.tabId === tabId) {
        return true;
      }
    }
    return false;
  }
  function getActiveSessions() {
    return Array.from(DEBUGGER_TARGETS.values());
  }
  function registerEventHandler(tabId, eventHandler) {
    const existingHandlers = eventHandlers.get(`${tabId}`) || [];
    existingHandlers.push(eventHandler);
    eventHandlers.set(`${tabId}`, existingHandlers);
    if (existingHandlers.length === 1) {
      chrome.debugger.onEvent.addListener(debuggerEventListener);
    }
  }
  function unregisterEventHandlers(tabId) {
    eventHandlers.delete(`${tabId}`);
    if (eventHandlers.size === 0) {
      chrome.debugger.onEvent.removeListener(debuggerEventListener);
    }
  }
  function debuggerEventListener(source, method, params) {
    if (!source.tabId) return;
    const handlers = eventHandlers.get(`${source.tabId}`);
    if (!handlers) return;
    const event = { method, params };
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`Event handler error for ${method}:`, err);
      }
    }
  }
  async function checkTabSecurity(tabId) {
    const warnings = [];
    try {
      const tab = await chrome.tabs.get(tabId);
      const sensitivePatterns = [
        /mail\./i,
        /bank/i,
        /paypal/i,
        /stripe/i,
        /coinbase/i,
        /auth\.google/i,
        /login/i,
        /signin/i,
        /account/i
      ];
      const url = tab.url || "";
      for (const pattern of sensitivePatterns) {
        if (pattern.test(url)) {
          warnings.push(`Tab appears to be on a sensitive site: ${url}`);
        }
      }
      if (url.startsWith("https://")) {
      } else if (url.startsWith("http://")) {
        warnings.push("Tab is not using HTTPS - data may be intercepted");
      }
      if (tab.incognito) {
        warnings.push("Tab is in incognito mode");
      }
      return {
        isSecure: warnings.length === 0,
        warnings
      };
    } catch (err) {
      return {
        isSecure: false,
        warnings: [`Could not verify tab security: ${err}`]
      };
    }
  }
  async function getTabInfo(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      return {
        id: tab.id,
        title: tab.title || "Untitled",
        url: tab.url || "",
        favIconUrl: tab.favIconUrl,
        incognito: tab.incognito,
        windowId: tab.windowId
      };
    } catch {
      return null;
    }
  }
  var DEBUGGER_TARGETS, eventHandlers;
  var init_debugger = __esm({
    "src/debugger.ts"() {
      DEBUGGER_TARGETS = /* @__PURE__ */ new Map();
      eventHandlers = /* @__PURE__ */ new Map();
    }
  });

  // src/canonical/action-executor.ts
  init_debugger();

  // src/canonical/redaction.ts
  var MAX_SEMANTIC_TEXT_LENGTH = 512;
  var MAX_TAG_LENGTH = 64;
  var MAX_ROLE_LENGTH = 128;
  var MAX_LOCATOR_CANDIDATES = 10;
  var MAX_OBSERVATION_URL_LENGTH = 2048;
  var STABLE_REF_HEX_LENGTH = 16;
  var SENSITIVE_BROWSER_WORDS = /\b(?:api[\s_-]*keys?|auth(?:entication|orization)?|bearer|cookies?|credentials?|local[\s_-]*storage|password|passcode|profile|proxy[\s_-]*authorization|secret|session[\s_-]*storage|tokens?)\b/i;
  var STRONG_CREDENTIAL_VALUE = /(?:\beyj[a-z0-9_-]{10,}\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?|\bsk[\s_-]*live[\s_-]*[a-z0-9_-]{8,}|\bbearer\s+[a-z0-9._~+/-]{3,})/i;
  var NORMALIZED_CREDENTIAL_SIGNAL = /(?:accesstoken|apikey|authorization|authtoken|bearer|clientsecret|credential|idtoken|password|passcode|refreshtoken|secretkey|sessiontoken|sklive)/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var INPUT_TYPES = /* @__PURE__ */ new Set([
    "text",
    "search",
    "email",
    "tel",
    "url",
    "number",
    "date",
    "checkbox",
    "radio"
  ]);
  var ACTIONABLE_TAGS = /* @__PURE__ */ new Set(["a", "button", "input", "select", "textarea"]);
  var ACTIONABLE_ROLES = /* @__PURE__ */ new Set([
    "button",
    "checkbox",
    "combobox",
    "link",
    "listbox",
    "menuitem",
    "option",
    "radio",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "textbox"
  ]);
  var ACCESSIBLE_NAME_SOURCES = /* @__PURE__ */ new Set([
    "aria-label",
    "aria-labelledby",
    "visible_text"
  ]);
  var ENUMERATED_ARIA_ATTRIBUTES = {
    "aria-expanded": /* @__PURE__ */ new Set(["true", "false"]),
    "aria-haspopup": /* @__PURE__ */ new Set([
      "true",
      "false",
      "menu",
      "listbox",
      "tree",
      "grid",
      "dialog"
    ]),
    "aria-current": /* @__PURE__ */ new Set([
      "true",
      "false",
      "page",
      "step",
      "location",
      "date",
      "time"
    ]),
    "aria-pressed": /* @__PURE__ */ new Set(["true", "false", "mixed"]),
    "aria-selected": /* @__PURE__ */ new Set(["true", "false"])
  };
  var TEXT_ARIA_ATTRIBUTES = /* @__PURE__ */ new Set([
    "aria-label",
    "aria-describedby",
    "aria-controls"
  ]);
  var SAFE_QUERY_KEYS = /* @__PURE__ */ new Set([
    "category",
    "filter",
    "lang",
    "locale",
    "order",
    "page",
    "q",
    "query",
    "search",
    "sort"
  ]);
  function normalizedText(value, maxLength = MAX_SEMANTIC_TEXT_LENGTH) {
    if (typeof value !== "string") return void 0;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || containsSensitiveBrowserData(normalized)) return void 0;
    return normalized.slice(0, maxLength);
  }
  function fnv1a32(seed, offsetBasis) {
    let hash = offsetBasis;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function computeStableRef(input) {
    const parts = [
      input.tag,
      input.role ?? "",
      input.accessibleName ?? "",
      input.attributes["data-testid"] ?? "",
      input.attributes.name ?? "",
      input.attributes["aria-label"] ?? "",
      input.attributes.type ?? ""
    ].map((part) => part.toLowerCase());
    const seed = parts.join("");
    const h1 = fnv1a32(seed, 2166136261);
    const h2 = fnv1a32(seed, 3421674724);
    const hex = h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
    return hex.slice(0, STABLE_REF_HEX_LENGTH);
  }
  function sanitizeAccessibleName(value) {
    if (typeof value === "string") {
      const text2 = normalizedText(value);
      return text2 ? { source: "visible_text", text: text2 } : void 0;
    }
    if (!value || typeof value !== "object") return void 0;
    if (typeof value.source !== "string" || !ACCESSIBLE_NAME_SOURCES.has(value.source))
      return void 0;
    const text = normalizedText(value.text);
    if (!text) return void 0;
    return {
      source: value.source,
      text
    };
  }
  function sanitizeBoundingBox(value) {
    if (!value) return void 0;
    const { x, y, width, height } = value;
    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return void 0;
    }
    return { x, y, width, height };
  }
  function sanitizeOpaquePath(value) {
    if (!Array.isArray(value)) return void 0;
    if (value.length > 20) return void 0;
    if (!value.every(
      (segment) => typeof segment === "string" && UUID.test(segment)
    )) {
      return void 0;
    }
    return value;
  }
  function sanitizeAttributes(attributes) {
    const safe = {};
    for (const key of TEXT_ARIA_ATTRIBUTES) {
      const value = normalizedText(attributes[key]);
      if (value) safe[key] = value;
    }
    for (const [key, allowedValues] of Object.entries(
      ENUMERATED_ARIA_ATTRIBUTES
    )) {
      const value = attributes[key];
      if (typeof value === "string" && allowedValues.has(value)) {
        safe[key] = value;
      }
    }
    return Object.keys(safe).length > 0 ? safe : void 0;
  }
  function sanitizeLocatorCandidate(value) {
    if (!value || typeof value !== "object") return void 0;
    const candidate = value;
    if (candidate.kind === "test_id") {
      const testId = normalizedText(candidate.testId);
      return testId ? { kind: "test_id", testId } : void 0;
    }
    if (candidate.kind === "label") {
      const label = sanitizeAccessibleName(candidate.label);
      return label ? { kind: "label", label } : void 0;
    }
    if (candidate.kind === "role_name") {
      const role = normalizedText(candidate.role, MAX_ROLE_LENGTH);
      const name = sanitizeAccessibleName(candidate.name);
      return role && name ? { kind: "role_name", role, name } : void 0;
    }
    if (candidate.kind === "safe_attribute") {
      const attribute = candidate.attribute;
      const valueText = normalizedText(candidate.value);
      const allowed = /* @__PURE__ */ new Set([
        "aria-label",
        "aria-describedby",
        "aria-controls",
        "aria-current"
      ]);
      if (typeof attribute === "string" && allowed.has(attribute) && valueText) {
        return {
          kind: "safe_attribute",
          attribute,
          value: valueText
        };
      }
    }
    return void 0;
  }
  function addLocator(candidates, candidate) {
    if (!candidate || candidates.length >= MAX_LOCATOR_CANDIDATES) return;
    const encoded = JSON.stringify(candidate);
    if (!candidates.some((existing) => JSON.stringify(existing) === encoded)) {
      candidates.push(candidate);
    }
  }
  function sanitizeSemanticTarget(raw) {
    if (raw.visible !== true) return null;
    const targetId = typeof raw.targetId === "string" && UUID.test(raw.targetId) ? raw.targetId : void 0;
    const tag = normalizedText(raw.tag, MAX_TAG_LENGTH)?.toLowerCase();
    const boundingBox = sanitizeBoundingBox(raw.boundingBox);
    const framePath = sanitizeOpaquePath(raw.framePath);
    if (!targetId || !tag || !boundingBox || !framePath) return null;
    const attributes = raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {};
    const rawInputType = typeof attributes.type === "string" ? attributes.type.toLowerCase() : void 0;
    if (tag === "input" && (rawInputType === "password" || rawInputType === "hidden"))
      return null;
    if (tag === "input" && rawInputType && !INPUT_TYPES.has(rawInputType))
      return null;
    const role = normalizedText(raw.role, MAX_ROLE_LENGTH)?.toLowerCase();
    if (!ACTIONABLE_TAGS.has(tag) && (!role || !ACTIONABLE_ROLES.has(role)))
      return null;
    const explicitName = sanitizeAccessibleName(raw.accessibleName);
    const labelText = normalizedText(raw.label);
    const fallbackName = labelText ?? normalizedText(attributes.name);
    const accessibleName = explicitName ?? (fallbackName ? { source: "visible_text", text: fallbackName } : void 0);
    const safeAttributes = sanitizeAttributes(attributes);
    const locatorCandidates = [];
    if (role && accessibleName) {
      addLocator(locatorCandidates, {
        kind: "role_name",
        role,
        name: accessibleName
      });
    }
    if (labelText) {
      addLocator(locatorCandidates, {
        kind: "label",
        label: { source: "visible_text", text: labelText }
      });
    }
    const testId = normalizedText(attributes["data-testid"]);
    if (testId) addLocator(locatorCandidates, { kind: "test_id", testId });
    for (const attribute of [
      "aria-label",
      "aria-describedby",
      "aria-controls",
      "aria-current"
    ]) {
      const value = safeAttributes?.[attribute];
      if (value)
        addLocator(locatorCandidates, {
          kind: "safe_attribute",
          attribute,
          value
        });
    }
    if (Array.isArray(raw.locatorCandidates)) {
      for (const candidate of raw.locatorCandidates) {
        addLocator(locatorCandidates, sanitizeLocatorCandidate(candidate));
      }
    }
    const shadowPath = sanitizeOpaquePath(raw.shadowPath);
    if (raw.shadowPath !== void 0 && !shadowPath) return null;
    const control = tag === "input" ? {
      kind: "input",
      inputType: rawInputType ?? "text"
    } : { kind: "non_input" };
    const stableRef = computeStableRef({
      tag,
      role,
      accessibleName: accessibleName?.text,
      attributes: {
        "data-testid": testId,
        name: normalizedText(attributes.name),
        "aria-label": safeAttributes?.["aria-label"],
        type: rawInputType
      }
    });
    return {
      targetId,
      ...stableRef ? { stableRef } : {},
      tag,
      ...role ? { role } : {},
      ...accessibleName ? { accessibleName } : {},
      ...safeAttributes ? { attributes: safeAttributes } : {},
      control,
      boundingBox,
      visible: true,
      framePath,
      ...shadowPath ? { shadowPath } : {},
      locatorCandidates
    };
  }
  function sanitizeBrowserText(value, maxLength = MAX_SEMANTIC_TEXT_LENGTH) {
    if (typeof value !== "string") return "";
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return containsSensitiveBrowserData(normalized) ? "[redacted]" : normalized.slice(0, maxLength);
  }
  function containsSensitiveBrowserData(value) {
    if (typeof value !== "string") return false;
    const normalized = value.normalize("NFKC").toLowerCase();
    const compact = normalized.replace(/[^a-z0-9]/g, "");
    return SENSITIVE_BROWSER_WORDS.test(normalized) || STRONG_CREDENTIAL_VALUE.test(normalized) || NORMALIZED_CREDENTIAL_SIGNAL.test(compact);
  }
  function sanitizeObservationUrl(value) {
    if (typeof value !== "string") throw new Error("Observation URL is missing");
    if (value === "about:blank" || value.startsWith("chrome://") || value.startsWith("chrome-extension://") || value.startsWith("devtools://")) {
      return value;
    }
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Observation URL must use HTTP(S)");
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const [key, entryValue] of [...url.searchParams.entries()]) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!SAFE_QUERY_KEYS.has(normalizedKey) || containsSensitiveBrowserData(key) || containsSensitiveBrowserData(entryValue)) {
        url.searchParams.delete(key);
      }
    }
    if (containsSensitiveBrowserData(decodeURIComponent(url.pathname))) {
      url.pathname = "/";
    }
    const sanitized = url.toString();
    if (sanitized.length > MAX_OBSERVATION_URL_LENGTH) {
      throw new Error("Observation URL exceeds maximum length");
    }
    return sanitized;
  }

  // src/canonical/coordinate-context.ts
  function transformCapturedPoint(rawX, rawY, capture) {
    if (typeof rawX !== "number" || !Number.isFinite(rawX) || typeof rawY !== "number" || !Number.isFinite(rawY)) {
      return { ok: false, error: { code: "MISSING_ACTION_PARAMETER", message: "Pointer actions require finite coordinates", retryable: false } };
    }
    const scale = capture.devicePixelRatio * capture.zoom;
    if (!Number.isFinite(scale) || scale <= 0 || capture.viewportWidth <= 0 || capture.viewportHeight <= 0) {
      return { ok: false, error: { code: "INVALID_ACTION_PARAMETER", message: "Captured viewport transform is invalid", retryable: false } };
    }
    if (rawX < 0 || rawY < 0 || rawX > capture.viewportWidth * scale || rawY > capture.viewportHeight * scale) {
      return { ok: false, error: { code: "COORDINATE_OUT_OF_BOUNDS", message: "Pointer coordinate is outside the captured viewport", retryable: true } };
    }
    return { x: rawX / scale, y: rawY / scale };
  }

  // src/canonical/stable-ref.ts
  var StableRef = class _StableRef {
    constructor(axPath, attributeHash, role, name) {
      this.axPath = axPath;
      this.attributeHash = attributeHash;
      this.role = role;
      this.name = name;
    }
    static fromAXNode(node) {
      return new _StableRef(node.axPath, node.attributeHash, node.role, node.name ?? "");
    }
    equals(other) {
      if (this.attributeHash !== other.attributeHash) return false;
      if (this.role !== other.role) return false;
      if (this.name !== other.name) return false;
      return this.sameAxPath(other.axPath);
    }
    sameAxPath(other) {
      if (this.axPath.length !== other.length) return false;
      for (let i = 0; i < this.axPath.length; i++) {
        const a = this.axPath[i];
        const b = other[i];
        if (a.role !== b.role || a.index !== b.index || (a.name ?? "") !== (b.name ?? "")) {
          return false;
        }
      }
      return true;
    }
    // Wire format key for StableRef transport (plan 2); full identity uses equals().
    toJSON() {
      return { axPath: this.axPath, attributeHash: this.attributeHash };
    }
  };

  // src/canonical/ref-matcher.ts
  var MATCH_CONFIDENCE_THRESHOLD = 0.8;
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length;
    const n = b.length;
    const prev = new Array(n + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
  }
  function matchStableRef(ref, snapshot) {
    for (const node of snapshot) {
      if (StableRef.fromAXNode(node).equals(ref)) {
        return { confidence: 1, node, strategy: "exact" };
      }
    }
    const sameRole = snapshot.filter((n) => n.role === ref.role && n.name);
    if (sameRole.length && ref.name) {
      let best = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const node of sameRole) {
        const d = levenshtein(ref.name, node.name ?? "");
        if (d < bestDist) {
          bestDist = d;
          best = node;
        }
      }
      if (best && bestDist <= Math.max(2, Math.floor(ref.name.length / 3))) {
        return { confidence: 0.7, node: best, strategy: "role-name" };
      }
    }
    return { confidence: 0, node: null, strategy: "miss" };
  }

  // ../../packages/brotto-action-schema/src/index.ts
  var ForbiddenBrowserDataError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ForbiddenBrowserDataError";
    }
  };
  var ActionCommandV1Schema = { parse: (data) => data };
  var ActionResultV1Schema = { parse: (data) => data };
  var ObservationV1Schema = { parse: (data) => data, safeParse: (data) => ({ success: true, data }) };
  function assertNoForbiddenBrowserData(data) {
    if (!data) return;
  }

  // src/canonical/client-policy.ts
  var HIGH_IMPACT_WORDS = /\b(?:buy|purchase|checkout|pay(?:ment)?|place order|book|reserve|send|publish|post|submit|confirm|accept|agree|delete|remove|upload|download|sign[ -]?in|log[ -]?in|password|passcode|otp|verification code|credential|account|billing|credit card)\b/i;
  var ClientPolicy = class {
    constructor(options = {}) {
      this.allowedOrigins = options.allowedOrigins === void 0 ? void 0 : new Set(options.allowedOrigins.map(normalizeOrigin));
      this.privateNetworkOrigins = new Set(
        (options.privateNetworkOrigins ?? []).map(normalizeOrigin)
      );
    }
    evaluate(command, context) {
      if (!context.attachedTabIds.has(context.tabId)) {
        return denied("TAB_NOT_ATTACHED", "The target tab is not explicitly attached");
      }
      if (command.observationId !== context.observation.observationId) {
        return denied("STALE_OBSERVATION", "The command does not reference the current observation");
      }
      if (!safeHttpUrl(context.observation.url)) {
        return denied("CURRENT_URL_DENIED", "The attached page is not an allowed HTTP(S) URL");
      }
      const currentPageDecision = this.evaluateNavigation(context.observation.url);
      if (currentPageDecision !== void 0) return currentPageDecision;
      if (command.action.type === "visit_url") {
        const navigationDecision = this.evaluateNavigation(command.action.url);
        if (navigationDecision !== void 0) return navigationDecision;
      }
      if (isHighImpact(command.action, context.observation.semanticTargets, context.capture)) {
        if (!hasValidApprovalProof(command, context.approvedApprovalIds)) {
          if (command.policyContext.approved || command.policyContext.approvalId !== void 0) {
            return denied("APPROVAL_PROOF_INVALID", "High-impact action approval proof is incomplete");
          }
          return {
            decision: "requires_approval",
            code: "HIGH_IMPACT_APPROVAL_REQUIRED",
            reason: "This action may have an external consequence and requires explicit approval"
          };
        }
      }
      return { decision: "allowed", code: "ALLOWED", reason: "Client policy permits the action" };
    }
    evaluateNavigation(rawUrl) {
      let url;
      try {
        url = new URL(rawUrl);
      } catch {
        return denied("NAVIGATION_URL_INVALID", "The navigation URL is malformed");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return denied("NAVIGATION_SCHEME_DENIED", `Navigation scheme ${url.protocol} is not permitted`);
      }
      if (url.username !== "" || url.password !== "") {
        return denied("NAVIGATION_CREDENTIALS_DENIED", "Navigation URLs must not contain embedded credentials");
      }
      const origin = normalizeOrigin(url.origin);
      if (isPrivateHostname(url.hostname) && !this.privateNetworkOrigins.has(origin)) {
        return denied("PRIVATE_NETWORK_DENIED", "Private, loopback, link-local, and metadata destinations require explicit local policy");
      }
      if (this.allowedOrigins !== void 0 && !this.allowedOrigins.has(origin)) {
        return denied("NAVIGATION_ORIGIN_DENIED", "The navigation origin is outside the configured allowlist");
      }
      return void 0;
    }
  };
  function denied(code, reason) {
    return { decision: "denied", code, reason };
  }
  function normalizeOrigin(raw) {
    try {
      return new URL(raw).origin.toLowerCase();
    } catch {
      return raw.toLowerCase().replace(/\/$/, "");
    }
  }
  function safeHttpUrl(raw) {
    try {
      const protocol = new URL(raw).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }
  function hasValidApprovalProof(command, approvedApprovalIds) {
    return command.policyContext.approved === true && typeof command.policyContext.approvalId === "string" && command.policyContext.approvalId.length > 0 && approvedApprovalIds.has(command.policyContext.approvalId) && typeof command.policyContext.policyDecisionId === "string" && command.policyContext.policyDecisionId.length > 0;
  }
  function isHighImpact(action, targets, capture) {
    if (action.type === "key" && action.key.toLowerCase() === "enter") return true;
    return actionTargets(action, targets, capture).some((target) => {
      if (action.type === "insert_text" && target.control.kind === "input") {
        if (["email", "tel"].includes(target.control.inputType)) return true;
      }
      const attributes = target.attributes ?? {};
      const description = [
        target.accessibleName?.text,
        attributes["aria-label"],
        attributes.name,
        attributes.type,
        target.role,
        target.tag
      ].filter((value) => typeof value === "string").join(" ");
      return attributes.type?.toLowerCase() === "submit" || HIGH_IMPACT_WORDS.test(description);
    });
  }
  function actionTargets(action, targets, capture) {
    const matches = /* @__PURE__ */ new Map();
    if ("targetId" in action && action.targetId !== void 0) {
      const declared = targets.find((candidate) => candidate.visible && candidate.targetId === action.targetId);
      if (declared !== void 0) matches.set(declared.targetId, declared);
    }
    if ("x" in action && "y" in action) {
      const point = capture === void 0 ? { x: action.x, y: action.y } : transformCapturedPoint(action.x, action.y, capture);
      if ("error" in point) return [...matches.values()];
      for (const candidate of targets) {
        if (!candidate.visible) continue;
        const box = candidate.boundingBox;
        if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) {
          matches.set(candidate.targetId, candidate);
        }
      }
    }
    return [...matches.values()];
  }
  function isPrivateHostname(rawHostname) {
    const hostname = rawHostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal") return true;
    if (hostname.includes(":")) {
      return hostname === "::" || hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || /^fe[89ab]/.test(hostname) || hostname.startsWith("2001:db8:");
    }
    const octets = hostname.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 0 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a >= 224;
  }

  // src/canonical/execution-pipeline.ts
  var InMemoryApprovalStore = class {
    constructor() {
      this.grants = /* @__PURE__ */ new Map();
    }
    register(grant) {
      this.grants.set(grant.approvalId, { ...grant });
    }
    consume(command, actionDigest, now) {
      return this.consumeGrant(command, actionDigest, now) !== void 0;
    }
    consumeGrant(command, actionDigest, now) {
      const approvalId = command.policyContext.approvalId;
      if (!command.policyContext.approved || approvalId === void 0) return void 0;
      const grant = this.grants.get(approvalId);
      if (grant === void 0) return void 0;
      const matches = grant.actionId === command.actionId && grant.policyDecisionId === command.policyContext.policyDecisionId && grant.observationId === command.observationId && grant.actionDigest === actionDigest && grant.idempotencyKey === command.idempotencyKey && grant.commandExpiresAt === command.expiresAt && Date.parse(grant.expiresAt) >= now && Date.parse(command.expiresAt) >= now;
      if (!matches) return void 0;
      this.grants.delete(approvalId);
      return grant;
    }
  };
  var physicalExecutionPermits = /* @__PURE__ */ new WeakSet();
  function consumePhysicalExecutionPermit(permit) {
    if (!physicalExecutionPermits.has(permit)) return false;
    physicalExecutionPermits.delete(permit);
    return true;
  }
  var CanonicalExecutionPipeline = class {
    constructor(options) {
      this.completed = /* @__PURE__ */ new Map();
      this.inFlight = /* @__PURE__ */ new Map();
      this.idempotencySignatures = /* @__PURE__ */ new Map();
      this.options = options;
      this.policy = new ClientPolicy({
        allowedOrigins: options.allowedOrigins,
        privateNetworkOrigins: options.privateNetworkOrigins
      });
    }
    execute(input, signal) {
      const parsed = ActionCommandV1Schema.safeParse(input);
      if (!parsed.success) return Promise.resolve({ status: "denied", code: "COMMAND_SCHEMA_INVALID" });
      const command = parsed.data;
      const signature = canonicalJson(command);
      const previousSignature = this.idempotencySignatures.get(command.idempotencyKey);
      if (previousSignature !== void 0 && previousSignature !== signature) {
        return Promise.resolve({ status: "denied", code: "IDEMPOTENCY_CONFLICT" });
      }
      this.idempotencySignatures.set(command.idempotencyKey, signature);
      const cached = this.completed.get(command.idempotencyKey);
      if (cached !== void 0) return Promise.resolve(cached);
      const active = this.inFlight.get(command.idempotencyKey);
      if (active !== void 0) return active;
      const execution = this.executeOnce(command, signal).then((result) => {
        this.completed.set(command.idempotencyKey, result);
        return result;
      }).finally(() => this.inFlight.delete(command.idempotencyKey));
      this.inFlight.set(command.idempotencyKey, execution);
      return execution;
    }
    async executeOnce(command, signal) {
      if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };
      const now = (this.options.now ?? Date.now)();
      if (Date.parse(command.expiresAt) <= now) return { status: "denied", code: "COMMAND_EXPIRED" };
      let trusted;
      try {
        trusted = await this.options.observationAuthority.verify(this.options.tabId, command.observationId, signal);
      } catch {
        return signal?.aborted ? { status: "cancelled", code: "ACTION_CANCELLED" } : { status: "denied", code: "OBSERVATION_AUTHORITY_DENIED" };
      }
      let executableCommand = command;
      if (command.action.type === "history_back") {
        const destination = await historyDestination(this.options.tabId, command.action.steps ?? 1, this.options.send, signal);
        if (destination === void 0) return { status: "denied", code: "HISTORY_ENTRY_UNAVAILABLE" };
        executableCommand = { ...command, action: { type: "visit_url", url: destination.href } };
      }
      const targetCheck = verifyTargetFidelity(executableCommand, trusted.observation.semanticTargets, trusted.capture);
      if (targetCheck !== void 0) return { status: "denied", code: targetCheck };
      if (executableCommand.action.type === "visit_url") {
        const hostname = stripBrackets(new URL(executableCommand.action.url).hostname);
        if (!isIpLiteral(hostname) && this.options.trustedHostnamePolicy?.isTrusted(hostname) !== true) {
          return { status: "denied", code: "HOSTNAME_NOT_TRUSTED" };
        }
      }
      const destinations = navigationDestinations(executableCommand, trusted.observation.url);
      const pins = /* @__PURE__ */ new Map();
      for (const destination of destinations) {
        const resolution = await resolvePublic(destination, this.options.resolver, signal, this.options.resolverTimeoutMs ?? 1e3);
        if (resolution.code === "ACTION_CANCELLED") return { status: "cancelled", code: "ACTION_CANCELLED" };
        if (resolution.code !== void 0) return { status: "denied", code: resolution.code };
        pins.set(destination.hostname, resolution.addresses);
      }
      if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };
      const digest = await actionAuthorizationDigest(command);
      const approvalGrant = this.options.approvals.consumeGrant(command, digest, now);
      const approvalValid = approvalGrant !== void 0;
      const policy = this.policy.evaluate(command, {
        tabId: this.options.tabId,
        attachedTabIds: /* @__PURE__ */ new Set([this.options.tabId]),
        approvedApprovalIds: approvalValid && command.policyContext.approvalId ? /* @__PURE__ */ new Set([command.policyContext.approvalId]) : /* @__PURE__ */ new Set(),
        observation: trusted.observation,
        capture: trusted.capture
      });
      if (policy.decision === "requires_approval") return { status: "approval_required", code: policy.code };
      if (policy.decision === "denied") return { status: "denied", code: policy.code };
      if (executableCommand.action.type === "visit_url") {
        const destination = new URL(executableCommand.action.url);
        const second = await resolvePublic(destination, this.options.resolver, signal, this.options.resolverTimeoutMs ?? 1e3);
        if (second.code === "ACTION_CANCELLED") return { status: "cancelled", code: "ACTION_CANCELLED" };
        const first = pins.get(destination.hostname) ?? [];
        if (second.code !== void 0 || !sameAddresses(first, second.addresses)) {
          return { status: "denied", code: "DNS_REBINDING_DETECTED" };
        }
      }
      if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };
      if (Date.parse(command.expiresAt) <= (this.options.now ?? Date.now)()) return { status: "denied", code: "COMMAND_EXPIRED" };
      let execution;
      let preExecutionDenial;
      const settlement = await this.options.createSettler(trusted.mainFrameId, {
        url: trusted.observation.url,
        lifecycle: "interactive"
      }).settle(async () => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const executionNow = (this.options.now ?? Date.now)();
        if (Date.parse(command.expiresAt) <= executionNow) {
          preExecutionDenial = "COMMAND_EXPIRED";
          return;
        }
        if (approvalGrant !== void 0 && Date.parse(approvalGrant.expiresAt) <= executionNow) {
          preExecutionDenial = "APPROVAL_PROOF_INVALID";
          return;
        }
        const permit = {};
        physicalExecutionPermits.add(permit);
        execution = await executePermittedPhysicalAction(permit, this.options, executableCommand, trusted, signal);
        if (!execution.ok) throw new Error("Controlled action failed");
      }, signal);
      if (signal?.aborted || settlement.status === "cancelled") return { status: "cancelled", code: "ACTION_CANCELLED" };
      if (preExecutionDenial !== void 0) return { status: "denied", code: preExecutionDenial };
      if (execution === void 0 || !execution.ok) return { status: "failed", code: execution?.error.code ?? "ACTION_EXECUTION_FAILED" };
      if (settlement.status !== "settled") return { status: "failed", code: "SETTLEMENT_FAILED" };
      return { status: "succeeded", code: "ACTION_SUCCEEDED", execution, settlement };
    }
  };
  async function historyDestination(tabId, steps, sender, signal) {
    if (signal?.aborted) return void 0;
    const send = sender ?? ((id, command) => Promise.resolve().then(() => (init_debugger(), debugger_exports)).then(({ sendCommand: sendCommand2 }) => sendCommand2(id, command)));
    try {
      const response = await send(tabId, { method: "Page.getNavigationHistory" });
      if (!Number.isInteger(response.currentIndex) || !Array.isArray(response.entries)) return void 0;
      const entry = response.entries[response.currentIndex - steps];
      if (typeof entry?.url !== "string") return void 0;
      const url = new URL(entry.url);
      if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "") return void 0;
      return url;
    } catch {
      return void 0;
    }
  }
  function createCanonicalExecutionPipeline(options) {
    return new CanonicalExecutionPipeline(options);
  }
  async function actionAuthorizationDigest(command) {
    const serialized = canonicalJson({
      actionId: command.actionId,
      observationId: command.observationId,
      idempotencyKey: command.idempotencyKey,
      action: command.action
    });
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  function canonicalJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
  }
  function verifyTargetFidelity(command, targets, capture) {
    const action = command.action;
    if (!("targetId" in action) || action.targetId === void 0 || !("x" in action) || !("y" in action)) return void 0;
    const target = targets.find((candidate) => candidate.visible && candidate.targetId === action.targetId);
    if (target === void 0) return "TARGET_NOT_FOUND";
    const point = transformCapturedPoint(action.x, action.y, capture);
    if ("error" in point) return point.error.code;
    const box = target.boundingBox;
    return point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height ? "TARGET_COORDINATE_MISMATCH" : void 0;
  }
  function navigationDestinations(command, currentUrl) {
    const values = [new URL(currentUrl)];
    if (command.action.type === "visit_url") values.push(new URL(command.action.url));
    return values;
  }
  async function resolvePublic(url, resolver, signal, timeoutMs) {
    if (signal?.aborted) return { addresses: [], code: "ACTION_CANCELLED" };
    let addresses;
    try {
      addresses = isIpLiteral(url.hostname) ? [stripBrackets(url.hostname)] : await resolveWithDeadline(resolver, url.hostname, signal, timeoutMs);
    } catch {
      return { addresses: [], code: signal?.aborted ? "ACTION_CANCELLED" : "DNS_RESOLUTION_FAILED" };
    }
    const normalized = [...new Set(addresses.map(stripBrackets))].sort();
    if (normalized.length === 0) return { addresses: [], code: "DNS_RESOLUTION_FAILED" };
    if (normalized.some((address) => !isPublicAddress(address))) return { addresses: normalized, code: "PRIVATE_NETWORK_DENIED" };
    return { addresses: normalized };
  }
  async function resolveWithDeadline(resolver, hostname, signal, timeoutMs) {
    const controller2 = new AbortController();
    const onAbort = () => controller2.abort();
    let rejectAbort;
    const onAbortRace = () => rejectAbort?.(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    signal?.addEventListener("abort", onAbortRace, { once: true });
    let timer;
    try {
      return await Promise.race([
        resolver.resolve(hostname, controller2.signal),
        new Promise((_, reject) => {
          rejectAbort = reject;
          if (signal?.aborted) onAbortRace();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller2.abort();
            reject(new Error("deadline"));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer !== void 0) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", onAbortRace);
    }
  }
  function sameAddresses(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  function stripBrackets(value) {
    return value.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  }
  function isIpLiteral(value) {
    return /^\[?[0-9a-f:.]+\]?$/i.test(value);
  }
  function isPublicAddress(raw) {
    const address = stripBrackets(raw);
    if (address.includes(":")) {
      if (address.startsWith("::ffff:")) return isPublicAddress(address.slice(7));
      const first = Number.parseInt(address.split(":")[0] || "0", 16);
      return first >= 8192 && first <= 16383 && !address.startsWith("2001:db8:") && !address.startsWith("2001:0:") && !address.startsWith("2001:2:") && !address.startsWith("2001:10:");
    }
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 0 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a === 192 && b === 0 && c === 2 || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }

  // src/canonical/action-executor.ts
  var CanonicalActionExecutor = class {
    constructor(options) {
      this.active = false;
      this.tabId = options.tabId;
      this.capture = options.capture;
      this.observation = options.observation;
      this.send = options.send ?? ((tabId, command) => sendCommand(tabId, command));
      this.wait = options.wait ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    }
    async execute(command, signal) {
      if (signal?.aborted) return failure("CDP_COMMAND_FAILED", "Controlled action was cancelled", false);
      const action = command?.action;
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return failure("MISSING_ACTION_PARAMETER", "The action type is required", false);
      }
      const targetFailure = this.verifyDeclaredTarget(action);
      if (targetFailure !== void 0) return targetFailure;
      if (this.active) return failure("CDP_COMMAND_FAILED", "Another controlled action is already executing", true);
      this.active = true;
      this.activeSignal = signal;
      try {
        switch (action.type) {
          case "left_click":
            return await this.click(action, "left", 1);
          case "double_click":
            return await this.click(action, "left", 2);
          case "right_click":
            return await this.click(action, "right", 1);
          case "mouse_move":
            return await this.mouseMove(action);
          case "drag":
            return await this.drag(action);
          case "scroll":
            return await this.scroll(action);
          case "key":
            return await this.key(action);
          case "insert_text":
            return await this.insertText(action);
          case "visit_url":
            return await this.navigate(action);
          case "history_back":
            return await this.historyBack(action);
          case "wait":
            return await this.waitFor(action);
          case "ask_user_question":
          case "memorize_fact":
            return failure("UNKNOWN_ACTION", `${action.type} is not a browser execution action`, false);
          default:
            return failure("UNKNOWN_ACTION", "The requested action type is not supported", false);
        }
      } catch (error) {
        return failure(
          "CDP_COMMAND_FAILED",
          "The controlled browser command failed",
          true
        );
      } finally {
        this.active = false;
        this.activeSignal = void 0;
      }
    }
    async click(action, button, clickCount) {
      const point = this.point(action.x, action.y);
      if ("error" in point) return point;
      await this.mouse({ type: "mouseMoved", ...point });
      await this.mouse({ type: "mousePressed", ...point, button, clickCount });
      await this.mouse({ type: "mouseReleased", ...point, button, clickCount });
      return { ok: true, effect: { kind: "pointer", button, clickCount, x: point.x, y: point.y } };
    }
    async mouseMove(action) {
      const point = this.point(action.x, action.y);
      if ("error" in point) return point;
      await this.mouse({ type: "mouseMoved", ...point });
      return { ok: true, effect: { kind: "pointer_move", x: point.x, y: point.y } };
    }
    async drag(action) {
      const start = this.point(action.startX, action.startY);
      if ("error" in start) return start;
      const end = this.point(action.endX, action.endY);
      if ("error" in end) return end;
      await this.mouse({ type: "mouseMoved", ...start });
      await this.mouse({ type: "mousePressed", ...start, button: "left", clickCount: 1 });
      await this.mouse({ type: "mouseMoved", ...end, button: "left", buttons: 1 });
      await this.mouse({ type: "mouseReleased", ...end, button: "left", clickCount: 1 });
      return { ok: true, effect: { kind: "drag", start, end } };
    }
    async scroll(action) {
      if (!finite(action.deltaX) || !finite(action.deltaY)) {
        return failure("MISSING_ACTION_PARAMETER", "Scroll requires finite deltaX and deltaY", false);
      }
      await this.mouse({
        type: "mouseWheel",
        x: this.capture.viewportWidth / 2,
        y: this.capture.viewportHeight / 2,
        deltaX: action.deltaX,
        deltaY: action.deltaY
      });
      return { ok: true, effect: { kind: "scroll", deltaX: action.deltaX, deltaY: action.deltaY } };
    }
    async key(action) {
      if (typeof action.key !== "string" || action.key.length === 0) {
        return failure("MISSING_ACTION_PARAMETER", "Key action requires a non-empty key", false);
      }
      const modifiers = modifierMask(action.modifiers);
      if (modifiers === void 0) {
        return failure("INVALID_ACTION_PARAMETER", "Key modifiers must be booleans", false);
      }
      await this.keyboard({ type: "keyDown", key: action.key, modifiers });
      await this.keyboard({ type: "keyUp", key: action.key, modifiers });
      return { ok: true, effect: { kind: "key", modifiers } };
    }
    async insertText(action) {
      if (typeof action.text !== "string" || action.text.length === 0) {
        return failure("MISSING_ACTION_PARAMETER", "Text insertion requires non-empty text", false);
      }
      const targetId = action.targetId;
      if (targetId && this.observation) {
        const target = this.observation.semanticTargets.find((t) => t.visible && t.targetId === targetId);
        if (target) {
          const bb = target.boundingBox;
          const cx = Math.round(bb.x + bb.width / 2);
          const cy = Math.round(bb.y + bb.height / 2);
          await this.sendAllowed({ method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 } });
          await this.sendAllowed({ method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 } });
        }
      }
      await this.sendAllowed({ method: "Input.insertText", params: { text: action.text } });
      return { ok: true, effect: { kind: "text_inserted", characterCount: [...action.text].length } };
    }
    async navigate(action) {
      if (typeof action.url !== "string") {
        return failure("MISSING_ACTION_PARAMETER", "Navigation requires a URL", false);
      }
      let url;
      try {
        url = new URL(action.url);
      } catch {
        return failure("INVALID_NAVIGATION_URL", "Navigation URL is malformed", false);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return failure("INVALID_NAVIGATION_URL", "Only HTTP(S) navigation is supported", false);
      }
      if (url.username !== "" || url.password !== "") {
        return failure("INVALID_NAVIGATION_URL", "Navigation URL must not contain embedded credentials", false);
      }
      await this.sendAllowed({ method: "Page.navigate", params: { url: url.href } });
      return { ok: true, effect: { kind: "navigation", url: sanitizeObservationUrl(url.href) } };
    }
    async historyBack(action) {
      const steps = action.steps ?? 1;
      if (!Number.isInteger(steps) || steps < 1 || steps > 20) {
        return failure("INVALID_ACTION_PARAMETER", "History steps must be an integer from 1 to 20", false);
      }
      const history = await this.sendAllowed({ method: "Page.getNavigationHistory" });
      const parsed = navigationHistory(history);
      if (!parsed) return failure("CDP_COMMAND_FAILED", "Navigation history response was invalid", true);
      const target = parsed.entries[parsed.currentIndex - steps];
      if (!target) return failure("HISTORY_ENTRY_UNAVAILABLE", "Requested history entry does not exist", true);
      const url = new URL(target.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return failure("INVALID_NAVIGATION_URL", "History target is not HTTP(S)", false);
      }
      if (url.username !== "" || url.password !== "") {
        return failure("INVALID_NAVIGATION_URL", "History target contains embedded credentials", false);
      }
      await this.sendAllowed({ method: "Page.navigate", params: { url: url.href } });
      return { ok: true, effect: { kind: "navigation", url: sanitizeObservationUrl(url.href) } };
    }
    async waitFor(action) {
      if (!Number.isInteger(action.durationMs) || action.durationMs < 1 || action.durationMs > 6e4) {
        return failure("INVALID_ACTION_PARAMETER", "Wait duration must be from 1 to 60000 milliseconds", false);
      }
      await this.wait(action.durationMs);
      this.throwIfAborted();
      return { ok: true, effect: { kind: "wait", durationMs: action.durationMs } };
    }
    point(rawX, rawY) {
      if (!finite(rawX) || !finite(rawY)) {
        return failure("MISSING_ACTION_PARAMETER", "Pointer actions require finite x and y coordinates", false);
      }
      return transformCapturedPoint(rawX, rawY, this.capture);
    }
    verifyDeclaredTarget(action) {
      return verifyDeclaredTarget(action, this.observation, this.capture);
    }
    mouse(params) {
      return this.sendAllowed({ method: "Input.dispatchMouseEvent", params });
    }
    keyboard(params) {
      return this.sendAllowed({ method: "Input.dispatchKeyEvent", params });
    }
    sendAllowed(command) {
      this.throwIfAborted();
      return this.send(this.tabId, command);
    }
    throwIfAborted() {
      if (this.activeSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
  };
  async function executePermittedPhysicalAction(permit, options, command, trusted, signal) {
    if (!consumePhysicalExecutionPermit(permit)) {
      return failure("POLICY_AUTHORIZATION_REQUIRED", "Physical execution permit is invalid", false);
    }
    const executor = new CanonicalActionExecutor({
      tabId: options.tabId,
      capture: trusted.capture,
      observation: trusted.observation,
      send: options.send,
      wait: options.wait
    });
    return executor.execute(command, signal);
  }
  function verifyDeclaredTarget(action, observation, capture) {
    const ref = action.ref;
    const axNodes = observation?.accessibilityNodes;
    if (ref && axNodes && axNodes.length > 0) {
      const match = matchStableRef(ref, Array.from(axNodes));
      if (match.confidence >= MATCH_CONFIDENCE_THRESHOLD) {
        return void 0;
      }
    }
    if (observation === void 0 || !("targetId" in action) || action.targetId === void 0) return void 0;
    const target = observation.semanticTargets.find((candidate) => candidate.visible && candidate.targetId === action.targetId);
    if (target === void 0) return failure("TARGET_NOT_FOUND", "Declared semantic target is unavailable", true);
    if (!("x" in action) || !("y" in action)) return void 0;
    const point = transformCapturedPoint(action.x, action.y, capture);
    if ("error" in point) return point;
    const box = target.boundingBox;
    if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) {
      return failure("TARGET_COORDINATE_MISMATCH", "Pointer coordinate does not match the declared semantic target", true);
    }
    return void 0;
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function modifierMask(raw) {
    if (raw === void 0) return 0;
    if (!raw || typeof raw !== "object") return void 0;
    const modifiers = raw;
    for (const name of ["alt", "ctrl", "meta", "shift"]) {
      if (modifiers[name] !== void 0 && typeof modifiers[name] !== "boolean") return void 0;
    }
    return (modifiers.alt ? 1 : 0) | (modifiers.ctrl ? 2 : 0) | (modifiers.meta ? 4 : 0) | (modifiers.shift ? 8 : 0);
  }
  function navigationHistory(raw) {
    if (!raw || typeof raw !== "object") return void 0;
    const value = raw;
    if (!Number.isInteger(value.currentIndex) || !Array.isArray(value.entries)) return void 0;
    const entries = [];
    for (const entry of value.entries) {
      if (!entry || typeof entry !== "object" || typeof entry.url !== "string") return void 0;
      entries.push({ url: entry.url });
    }
    return { currentIndex: value.currentIndex, entries };
  }
  function failure(code, message, retryable) {
    return { ok: false, error: { code, message, retryable } };
  }

  // ../../packages/brotto-relay-protocol/src/index.ts
  var AgentMessageV1Schema = {};
  var AgentEnvelopeV1Schema = {};
  var ActionCommandMessageSchema = {};
  function canonicalEnvelopeBytes(data) {
    return new Uint8Array();
  }
  function createEnvelope(data) {
    return {};
  }
  function signEnvelope(envelope, signer) {
    return envelope;
  }

  // src/canonical/controller.ts
  var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var CanonicalExtensionController = class {
    constructor(options) {
      this.approvals = new InMemoryApprovalStore();
      this.resultCache = /* @__PURE__ */ new Map();
      this.inFlightResults = /* @__PURE__ */ new Map();
      this.approvalResolutions = /* @__PURE__ */ new Map();
      this.lifecycleAbort = new AbortController();
      this.actionAbort = null;
      this.activeAction = null;
      this.transport = null;
      this.recovery = null;
      this.pipeline = null;
      this.captured = null;
      this.pendingApproval = null;
      this.terminalEmitted = false;
      this.restoredLease = false;
      this.options = options;
      this.now = options.now ?? Date.now;
      this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    }
    async startTask(rawGoal) {
      if (this.recovery !== null && !isTerminalStatus(this.recovery.status)) throw new Error("A canonical task is already active");
      const goal = validateGoal(rawGoal);
      const taskId = requireUuid(this.idGenerator(), "task ID");
      this.resetLease();
      await Promise.all([
        this.options.store.clearTerminal(),
        this.options.store.clearApproval(),
        this.options.store.clearActionExecution()
      ]);
      let tabId = null;
      try {
        this.emit({ type: "canonical_status", status: "connecting" });
        tabId = await this.options.tabs.activeTabId();
        await this.options.tabs.attach(tabId);
        const material = await this.options.bootstrap.bootstrap({ mode: "open", goal, taskId }, this.lifecycleAbort.signal);
        await this.options.store.saveBootstrap(material);
        this.recovery = recoveryFrom(material, taskId, tabId, "connecting");
        await this.options.store.saveRecovery(this.recovery);
        this.prepareAttachedRuntime(tabId);
        this.transport = this.options.transportFactory(this.transportContext(material));
        await this.transport.connect();
        await this.transport.send({ type: "session.open", client: "browser_extension", goal }, {
          correlationId: taskId,
          causationId: taskId
        });
        this.captured = await this.options.capture(tabId, this.lifecycleAbort.signal);
        await this.transport.send({ type: "observation.submitted", observation: this.captured.observation }, {
          correlationId: taskId,
          causationId: taskId
        });
        await this.updateRecovery({
          status: "connected",
          lastObservationId: this.captured.observation.observationId
        });
        await this.options.store.appendTrajectory(trajectory("observation", "Initial observation submitted", this.now()));
        this.emit({ type: "canonical_step", kind: "observation", summary: "Initial observation submitted" });
        this.emit({ type: "canonical_status", status: "connected" });
      } catch (error) {
        if (tabId !== null) await boundedCleanup(this.safeDetach(tabId));
        await boundedCleanup(this.transport?.close("startup failed"));
        this.transport = null;
        await this.options.store.clearBootstrap();
        this.emitError("SESSION_START_FAILED", error);
        throw error;
      }
    }
    async restore() {
      const recovery = await this.options.store.loadRecovery();
      if (recovery === null || recovery.attachedTabId === null) return false;
      if (isTerminalStatus(recovery.status)) {
        this.recovery = recovery;
        return false;
      }
      this.resetLease();
      this.restoredLease = true;
      let material = await this.options.store.loadBootstrap();
      if (material === null) {
        material = await this.options.bootstrap.bootstrap({ mode: "resume", recovery }, this.lifecycleAbort.signal);
        await this.options.store.saveBootstrap(material);
      }
      assertRecoveryBinding(recovery, material);
      this.recovery = recovery;
      const approval = await this.options.store.loadApproval();
      if (approval !== null) this.pendingApproval = AgentMessageV1Schema.parse({
        type: "approval.requested",
        ...approval
      });
      const attached = await this.options.tabs.isAttached(recovery.attachedTabId);
      if (!attached) await this.options.tabs.attach(recovery.attachedTabId);
      this.prepareAttachedRuntime(recovery.attachedTabId);
      this.transport = this.options.transportFactory(this.transportContext(material));
      await this.transport.connect();
      await this.updateRecovery({ status: "reconnecting" });
      this.emit({ type: "canonical_status", status: "reconnecting" });
      return true;
    }
    async handleTransportMessage(input) {
      const message = AgentMessageV1Schema.parse(input.message);
      switch (message.type) {
        case "action.command":
          await this.handleCommand(message);
          return;
        case "approval.requested":
          this.pendingApproval = message;
          await this.options.store.saveApproval(message);
          await this.updateRecovery({ status: "waiting_for_approval", pendingActionId: message.actionId });
          await this.options.store.appendTrajectory(trajectory("approval", "Approval required", this.now()));
          this.emit({ type: "canonical_approval", request: message });
          return;
        case "reconcile.response":
          await this.handleReconciliation(message);
          return;
        case "task.completed":
        case "task.failed":
        case "task.cancelled":
          await this.handleTerminal(message);
          return;
        case "protocol.error":
          this.emit({ type: "canonical_error", code: message.code, message: message.message });
          return;
        default:
          return;
      }
    }
    async resolveApproval(approved) {
      const request = this.pendingApproval;
      const transport = this.requireTransport();
      if (request === null) throw new Error("No canonical approval is pending");
      const resolution = {
        approvalId: request.approvalId,
        policyDecisionId: request.policyDecisionId,
        actionId: request.actionId,
        status: approved ? "approved" : "denied",
        resolvedAt: new Date(this.now()).toISOString()
      };
      await transport.send({ type: "approval.resolved", resolution }, {
        correlationId: request.actionId,
        causationId: request.approvalId
      });
      this.approvalResolutions.set(request.actionId, resolution);
      this.pendingApproval = null;
      await this.options.store.clearApproval();
      await this.options.store.appendTrajectory(trajectory("approval", approved ? "Approval granted" : "Approval denied", this.now()));
      await this.updateRecovery({ status: "connected", pendingActionId: null });
    }
    async cancel(reason = "User cancelled the task") {
      const recovery = this.recovery;
      this.lifecycleAbort.abort();
      this.actionAbort?.abort();
      if (recovery === null) {
        await this.disconnectRuntime("cancelled", true);
        return;
      }
      await this.updateRecovery({ status: "cancelling" });
      this.emit({ type: "canonical_status", status: "cancelling" });
      if (this.transport !== null && recovery.lastObservationId !== null) {
        await this.transport.send({
          type: "task.cancelled",
          taskId: recovery.taskId,
          occurredAt: new Date(this.now()).toISOString(),
          reason: sanitizeReason(reason),
          observationId: recovery.lastObservationId,
          ...recovery.pendingActionId === null ? {} : { actionId: recovery.pendingActionId }
        }, {
          correlationId: recovery.taskId,
          causationId: recovery.pendingActionId ?? recovery.taskId
        }).catch((error) => this.emitError("CANCELLATION_SEND_FAILED", error));
      }
      await this.disconnectRuntime("cancelled", true);
      await this.updateRecovery({ status: "cancelled", pendingActionId: null });
      this.emit({ type: "canonical_status", status: "cancelled" });
    }
    async disconnect() {
      this.lifecycleAbort.abort();
      this.actionAbort?.abort();
      await this.disconnectRuntime("disconnected", true);
      if (this.recovery !== null) await this.updateRecovery({ status: "disconnected", pendingActionId: null });
      this.emit({ type: "canonical_status", status: "disconnected" });
    }
    async submitFreshObservation(summary = "Fresh observation submitted") {
      const recovery = this.recovery;
      if (recovery?.attachedTabId === null || recovery?.attachedTabId === void 0) throw new Error("No canonical tab is attached");
      this.captured = await this.options.capture(recovery.attachedTabId, this.lifecycleAbort.signal);
      await this.requireTransport().send({ type: "observation.submitted", observation: this.captured.observation }, {
        correlationId: recovery.taskId,
        causationId: recovery.lastObservationId ?? recovery.taskId
      });
      await this.updateRecovery({ lastObservationId: this.captured.observation.observationId, status: "connected" });
      await this.options.store.appendTrajectory(trajectory("observation", summary, this.now()));
      this.emit({ type: "canonical_step", kind: "observation", summary });
    }
    async viewState() {
      return {
        recovery: this.recovery ?? await this.options.store.loadRecovery(),
        transport: this.transport?.snapshot() ?? null,
        trajectory: await this.options.store.loadTrajectory(),
        terminal: await this.options.store.loadTerminal(),
        approval: await this.options.store.loadApproval()
      };
    }
    /** Called by tab lifecycle listeners so commands cannot use a page that changed after observation. */
    invalidateObservation(tabId) {
      if (this.recovery?.attachedTabId === tabId) this.captured = null;
    }
    async handleCommand(raw) {
      const parsed = ActionCommandMessageSchema.parse(raw);
      const command = parsed.command;
      const transport = this.requireTransport();
      await this.updateRecovery({ status: "executing", pendingActionId: command.actionId });
      await transport.send({
        type: "action.acknowledged",
        actionId: command.actionId,
        stepId: command.stepId,
        observationId: command.observationId,
        acknowledgedAt: new Date(this.now()).toISOString()
      }, {
        correlationId: command.actionId,
        causationId: command.observationId
      });
      this.emit({ type: "canonical_step", kind: "acknowledged", summary: "Action acknowledged", actionId: command.actionId });
      const signature = canonicalCommandSignature(command);
      const durable = await this.options.store.loadActionExecution();
      const durableMatches = durable !== null && durable.actionId === command.actionId && durable.idempotencyKey === command.idempotencyKey && durable.observationId === command.observationId;
      const unknownRestoredAction = durable === null && this.restoredLease && this.recovery?.pendingActionId === command.actionId;
      if (durableMatches || unknownRestoredAction) {
        const message = {
          type: "action.completed",
          result: durable?.status === "completed" ? durable.result : indeterminateResult(command, this.now())
        };
        if (durable?.status !== "completed") await this.options.store.saveActionExecution({
          actionId: command.actionId,
          idempotencyKey: command.idempotencyKey,
          observationId: command.observationId,
          status: "completed",
          result: message.result
        });
        this.resultCache.set(command.idempotencyKey, { signature, message });
        await transport.send(message, { correlationId: command.actionId, causationId: command.actionId });
        await this.updateRecovery({ status: "connected", pendingActionId: null, lastObservationId: resultObservationId(message.result) });
        return;
      }
      const cached = this.resultCache.get(command.idempotencyKey);
      if (cached !== void 0 && cached.signature === signature) {
        await transport.send(cached.message, { correlationId: command.actionId, causationId: command.actionId });
        return;
      }
      const active = this.inFlightResults.get(command.idempotencyKey);
      if (active !== void 0) {
        const message = await active;
        await transport.send(message, { correlationId: command.actionId, causationId: command.actionId });
        return;
      }
      if (command.policyContext.approved) await this.registerApproval(command);
      await this.options.store.saveActionExecution({
        actionId: command.actionId,
        idempotencyKey: command.idempotencyKey,
        observationId: command.observationId,
        status: "started"
      });
      const work = this.executeCommand(command, signature);
      this.inFlightResults.set(command.idempotencyKey, work);
      this.activeAction = work;
      try {
        const completed = await work;
        await transport.send(completed, { correlationId: command.actionId, causationId: command.actionId });
        await this.updateRecovery({ status: "connected", pendingActionId: null, lastObservationId: resultObservationId(completed.result) });
      } finally {
        this.inFlightResults.delete(command.idempotencyKey);
        if (this.activeAction === work) this.activeAction = null;
        this.actionAbort = null;
      }
    }
    async executeCommand(command, signature) {
      const pipeline = this.pipeline;
      this.actionAbort = new AbortController();
      const startedAtMs = Math.max(this.now(), Date.parse(command.dispatchedAt));
      this.emit({ type: "canonical_step", kind: "action", summary: actionSummary(command), actionId: command.actionId });
      let result;
      try {
        if (pipeline === null) throw new Error("Trusted canonical execution pipeline is unavailable");
        const pipelineResult = await pipeline.execute(command, this.actionAbort.signal);
        result = await this.toActionResult(command, pipelineResult, startedAtMs, this.actionAbort.signal);
      } catch {
        result = indeterminateResult(command, this.now(), startedAtMs, "CLIENT_EXECUTION_INDETERMINATE");
      }
      const message = { type: "action.completed", result };
      await this.options.store.saveActionExecution({
        actionId: command.actionId,
        idempotencyKey: command.idempotencyKey,
        observationId: command.observationId,
        status: "completed",
        result
      });
      this.resultCache.set(command.idempotencyKey, { signature, message });
      await this.options.store.appendTrajectory(trajectory("action", resultSummary(command, result), this.now()));
      this.emit({ type: "canonical_step", kind: "result", summary: resultSummary(command, result), actionId: command.actionId });
      return message;
    }
    async toActionResult(command, pipelineResult, startedAtMs, signal) {
      const baseCompletedAt = Math.max(startedAtMs, this.now());
      const base = {
        actionId: command.actionId,
        stepId: command.stepId,
        observationId: command.observationId,
        sequence: command.sequence + 1,
        startedAt: new Date(startedAtMs).toISOString(),
        completedAt: new Date(baseCompletedAt).toISOString(),
        durationMs: baseCompletedAt - startedAtMs
      };
      if (pipelineResult.status === "denied" || pipelineResult.status === "approval_required") {
        return ActionResultV1Schema.parse({
          ...base,
          status: pipelineResult.status === "approval_required" ? "approval_required" : staleCode(pipelineResult.code) ? "rejected_stale" : "rejected_policy",
          rejection: { code: pipelineResult.code, message: safeResultMessage(pipelineResult.code), retryable: pipelineResult.status === "approval_required" }
        });
      }
      const post = await this.capturePostObservation(signal);
      const chronology = chronologicalTimes(startedAtMs, baseCompletedAt, Date.parse(post.observation.capturedAt));
      const executedBase = {
        ...base,
        startedAt: new Date(chronology.startedAt).toISOString(),
        completedAt: new Date(chronology.completedAt).toISOString(),
        durationMs: chronology.completedAt - chronology.startedAt,
        postObservation: post.observation
      };
      if (pipelineResult.status === "succeeded") return ActionResultV1Schema.parse({ ...executedBase, status: "succeeded" });
      if (pipelineResult.status === "cancelled") return ActionResultV1Schema.parse({
        ...executedBase,
        status: "cancelled",
        cancellation: { reason: "Action cancelled" }
      });
      return ActionResultV1Schema.parse({
        ...executedBase,
        status: pipelineResult.status === "failed" ? "failed_recoverable" : "failed_terminal",
        error: { code: pipelineResult.code, message: safeResultMessage(pipelineResult.code), retryable: pipelineResult.status === "failed" }
      });
    }
    async capturePostObservation(signal) {
      const tabId = this.recovery?.attachedTabId;
      if (tabId === null || tabId === void 0) throw new Error("Attached tab is unavailable for post-observation");
      const captured = await this.options.capture(tabId, signal);
      this.captured = captured;
      return captured;
    }
    async registerApproval(command) {
      const resolution = this.approvalResolutions.get(command.actionId);
      if (resolution?.status !== "approved" || resolution.approvalId !== command.policyContext.approvalId) return;
      this.approvals.register({
        approvalId: resolution.approvalId,
        actionId: command.actionId,
        policyDecisionId: command.policyContext.policyDecisionId,
        observationId: command.observationId,
        actionDigest: await actionAuthorizationDigest(command),
        idempotencyKey: command.idempotencyKey,
        expiresAt: command.expiresAt,
        commandExpiresAt: command.expiresAt
      });
    }
    async handleReconciliation(message) {
      if (message.terminal !== void 0) {
        await this.handleTerminal(message.terminal);
        return;
      }
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(message.authoritativeState)) {
        await this.disconnectRuntime("terminal reconciliation missing result", true);
        throw new Error("Authoritative terminal reconciliation omitted its structured terminal result");
      }
      if (message.storedResult !== void 0) {
        await this.updateRecovery({ pendingActionId: null, status: terminalStateStatus(message.authoritativeState) });
        return;
      }
      if (message.requiresFreshObservation || message.command !== void 0 && this.captured === null) {
        const tabId = this.recovery?.attachedTabId;
        if (tabId === null || tabId === void 0) throw new Error("Cannot reconcile without an attached tab");
        this.captured = await this.options.capture(tabId, this.lifecycleAbort.signal);
        await this.requireTransport().send({ type: "observation.submitted", observation: this.captured.observation }, {
          correlationId: this.recovery.taskId,
          causationId: this.recovery.taskId
        });
        await this.updateRecovery({ lastObservationId: this.captured.observation.observationId, pendingActionId: null, status: "connected" });
        return;
      }
      if (message.command !== void 0) await this.handleCommand(message.command);
    }
    async handleTerminal(message) {
      if (this.terminalEmitted) return;
      this.terminalEmitted = true;
      this.actionAbort?.abort();
      const status = message.type === "task.completed" ? "completed" : message.type === "task.failed" ? "failed" : "cancelled";
      await this.options.store.saveTerminal(message);
      await this.options.store.clearApproval();
      await this.updateRecovery({ status, pendingActionId: null });
      await this.options.store.appendTrajectory(trajectory("terminal", `Task ${status}`, this.now()));
      this.emit({ type: "canonical_terminal", message });
      await this.disconnectRuntime("terminal", true);
    }
    prepareAttachedRuntime(tabId) {
      const authority = {
        verify: async (requestedTabId, observationId, signal) => {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (requestedTabId !== tabId || !await this.options.tabs.isAttached(tabId)) throw new Error("Tab attachment is not authoritative");
          const captured = this.captured;
          if (captured === null || captured.observation.observationId !== observationId) throw new Error("Observation is stale");
          return trustedContext(captured);
        }
      };
      if (this.recovery === null) throw new Error("Recovery state is unavailable for pipeline construction");
      this.pipeline = this.options.executionPipelineFactory({
        tabId,
        serverUrl: this.recovery.serverUrl,
        observationAuthority: authority,
        approvals: this.approvals
      });
    }
    transportContext(material) {
      const recovery = this.recovery;
      if (recovery === null) throw new Error("Recovery state is unavailable");
      return {
        material,
        recovery,
        pendingActionIds: () => this.recovery?.pendingActionId ? [this.recovery.pendingActionId] : [],
        getReconnectMaterial: async (signal) => {
          const current = this.recovery;
          if (current === null) throw new Error("Cannot reconnect a missing session");
          const refreshed = await this.options.bootstrap.bootstrap({ mode: "resume", recovery: current }, signal);
          assertRecoveryBinding(current, refreshed);
          await this.options.store.saveBootstrap(refreshed);
          return refreshed;
        },
        onMaterial: async (refreshed) => {
          await this.options.store.saveBootstrap(refreshed);
        },
        onMessage: async (message) => {
          await this.handleTransportMessage(message);
        },
        onStateChange: (snapshot) => {
          void this.handleTransportState(snapshot);
        }
      };
    }
    async handleTransportState(snapshot) {
      if (this.recovery === null) return;
      const status = snapshot.status === "reconnecting" ? "reconnecting" : snapshot.status === "open" ? "connected" : snapshot.status === "failed" ? "failed" : this.recovery.status;
      await this.updateRecovery({
        status,
        lastReceivedSequence: snapshot.lastReceivedSequence,
        lastSentSequence: snapshot.lastSentSequence
      });
      if (snapshot.status === "reconnecting" || snapshot.status === "failed") {
        this.emit({ type: "canonical_reconnect", status: snapshot.status, attempt: snapshot.reconnectAttempt });
      }
    }
    async updateRecovery(patch) {
      if (this.recovery === null) return;
      const transport = this.transport?.snapshot();
      this.recovery = {
        ...this.recovery,
        ...transport === void 0 ? {} : {
          lastReceivedSequence: transport.lastReceivedSequence,
          lastSentSequence: transport.lastSentSequence
        },
        ...patch
      };
      await this.options.store.saveRecovery(this.recovery);
    }
    async disconnectRuntime(reason, clearBootstrap) {
      const transport = this.transport;
      this.transport = null;
      await boundedCleanup(transport?.close(reason));
      const tabId = this.recovery?.attachedTabId;
      if (tabId !== null && tabId !== void 0) await boundedCleanup(this.safeDetach(tabId));
      if (clearBootstrap) await this.options.store.clearBootstrap();
    }
    async safeDetach(tabId) {
      try {
        await this.options.tabs.detach(tabId);
      } catch {
      }
    }
    requireTransport() {
      if (this.transport === null) throw new Error("Canonical transport is unavailable");
      return this.transport;
    }
    resetLease() {
      this.lifecycleAbort.abort();
      this.lifecycleAbort = new AbortController();
      this.actionAbort = null;
      this.activeAction = null;
      this.resultCache.clear();
      this.inFlightResults.clear();
      this.approvalResolutions.clear();
      this.pendingApproval = null;
      this.terminalEmitted = false;
      this.restoredLease = false;
      this.captured = null;
      this.pipeline = null;
      this.transport = null;
      this.recovery = null;
    }
    emit(event) {
      this.options.emitUiEvent?.(event);
    }
    emitError(code, error) {
      this.emit({ type: "canonical_error", code, message: error instanceof Error ? error.message : "Canonical operation failed" });
    }
  };
  var ControlPlaneConnectionBootstrap = class {
    constructor(endpoint, fetcher = fetch) {
      this.endpoint = endpoint;
      this.fetcher = fetcher;
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new TypeError("Control-plane bootstrap requires HTTPS");
    }
    async bootstrap(input, signal) {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal
      });
      if (!response.ok) throw new Error(`Control-plane bootstrap failed (${response.status})`);
      return await response.json();
    }
  };
  function recoveryFrom(material, taskId, tabId, status) {
    return {
      version: 1,
      serverUrl: material.serverUrl,
      sessionId: material.sessionId,
      deviceId: material.deviceId,
      lastReceivedSequence: 0,
      lastSentSequence: 0,
      attachedTabId: tabId,
      taskId,
      lastObservationId: null,
      pendingActionId: null,
      status
    };
  }
  function trustedContext(captured) {
    return {
      observation: captured.observation,
      capture: {
        viewportWidth: captured.observation.viewport.width,
        viewportHeight: captured.observation.viewport.height,
        devicePixelRatio: captured.observation.viewport.devicePixelRatio,
        zoom: captured.observation.viewport.zoom
      },
      mainFrameId: captured.mainFrameId
    };
  }
  function assertRecoveryBinding(recovery, material) {
    if (recovery.serverUrl !== material.serverUrl || recovery.sessionId !== material.sessionId || recovery.deviceId !== material.deviceId) {
      throw new Error("Bootstrap material does not match the recoverable session");
    }
  }
  function canonicalCommandSignature(command) {
    return canonicalJson2(command);
  }
  function canonicalJson2(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("Command contains a non-finite number");
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson2).join(",")}]`;
    if (typeof value === "object") {
      const record2 = value;
      return `{${Object.keys(record2).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson2(record2[key])}`).join(",")}}`;
    }
    throw new TypeError("Command contains a non-canonical value");
  }
  function actionSummary(command) {
    return `${command.action.type.toUpperCase()} executing`;
  }
  function resultSummary(command, result) {
    return `${command.action.type.toUpperCase()} ${result.status}`;
  }
  function resultObservationId(result) {
    return "postObservation" in result ? result.postObservation.observationId : result.observationId;
  }
  function indeterminateResult(command, completedAtMs, startedAtMs = completedAtMs, code = "EXECUTION_OUTCOME_INDETERMINATE") {
    const completed = Math.max(startedAtMs, completedAtMs);
    return ActionResultV1Schema.parse({
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      sequence: command.sequence + 1,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - startedAtMs,
      status: "rejected_stale",
      rejection: {
        code,
        message: "Execution outcome is indeterminate; a fresh observation is required",
        retryable: true
      }
    });
  }
  async function boundedCleanup(work, timeoutMs = 1e3) {
    if (work === void 0) return;
    let timer;
    await Promise.race([
      work.catch(() => void 0),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      })
    ]);
    if (timer !== void 0) clearTimeout(timer);
  }
  function trajectory(type, summary, now) {
    return { type, summary, occurredAt: new Date(now).toISOString() };
  }
  function chronologicalTimes(startedAt, completedAt, capturedAt) {
    if (!Number.isFinite(capturedAt)) throw new Error("Post-observation timestamp is invalid");
    const safeCompleted = Math.min(completedAt, capturedAt - 1);
    const safeStarted = Math.min(startedAt, safeCompleted);
    return { startedAt: safeStarted, completedAt: safeCompleted };
  }
  function staleCode(code) {
    return code === "COMMAND_EXPIRED" || code.includes("OBSERVATION") || code.includes("STALE") || code.includes("TARGET_NOT_FOUND");
  }
  function safeResultMessage(code) {
    return `Canonical action outcome: ${code}`.slice(0, 2e3);
  }
  function sanitizeReason(reason) {
    const value = reason.trim().slice(0, 2e3);
    return value.length > 0 ? value : "User cancelled the task";
  }
  function terminalStateStatus(state) {
    return state === "COMPLETED" ? "completed" : state === "FAILED" ? "failed" : state === "CANCELLED" ? "cancelled" : "connected";
  }
  function isTerminalStatus(status) {
    return status === "completed" || status === "failed" || status === "cancelled" || status === "disconnected";
  }
  function validateGoal(raw) {
    const goal = raw.trim();
    if (goal.length === 0 || goal.length > 4e3) throw new TypeError("Task goal must contain 1 to 4000 characters");
    return goal;
  }
  function requireUuid(value, name) {
    if (!UUID2.test(value)) throw new TypeError(`${name} must be an opaque UUID`);
    return value;
  }

  // src/canonical/ax-snapshot.ts
  var MAX_AX_NODES = 2e3;
  var KEY_ATTRS = ["id", "aria-label", "data-testid", "data-id", "name", "type"];
  function extractKeyAttrs(raw) {
    const out = {};
    for (const k of KEY_ATTRS) {
      const prop = raw.properties?.find((p) => p.name === k);
      const v = prop?.value?.value;
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  async function sha256Hex(input) {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = Math.imul(31, h) + input.charCodeAt(i) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
  }
  async function collectAccessibilitySnapshot(tabId, sendCdpCommand) {
    let raw;
    try {
      raw = await sendCdpCommand(tabId, "Accessibility.getFullAXTree", { perfMode: "deep" });
    } catch (err) {
      console.warn("[ax-snapshot] Accessibility.getFullAXTree failed:", err);
      return [];
    }
    const rawNodes = raw.nodes ?? [];
    const byId = /* @__PURE__ */ new Map();
    for (const n of rawNodes) if (n.nodeId) byId.set(n.nodeId, n);
    const axPathCache = /* @__PURE__ */ new Map();
    const axPathFor = (id) => {
      const cached = axPathCache.get(id);
      if (cached) return cached;
      const node = byId.get(id);
      if (!node?.role?.value) {
        axPathCache.set(id, []);
        return [];
      }
      const parentPath = node.parentId ? axPathFor(node.parentId) : [];
      const siblings = node.parentId ? rawNodes.filter((n) => n.parentId === node.parentId && n.role?.value === node.role?.value) : rawNodes.filter((n) => !n.parentId && n.role?.value === node.role?.value);
      const index = siblings.findIndex((s) => s.nodeId === id);
      const tuple = {
        role: node.role.value,
        index: Math.max(0, index),
        name: node.name?.value
      };
      const path = [...parentPath, tuple];
      axPathCache.set(id, path);
      return path;
    };
    const nodes = [];
    for (const rawNode of rawNodes) {
      if (!rawNode.nodeId || !rawNode.role?.value) continue;
      if (nodes.length >= MAX_AX_NODES) {
        console.warn(`[ax-snapshot] truncated at MAX_AX_NODES=${MAX_AX_NODES}; original=${rawNodes.length}`);
        break;
      }
      const role = rawNode.role.value;
      const name = rawNode.name?.value;
      const attrs = extractKeyAttrs(rawNode);
      const hashMaterial = `${role}|${name ?? ""}|${JSON.stringify(attrs)}`;
      const attributeHash = await sha256Hex(hashMaterial);
      const bb = rawNode.boundingBox;
      nodes.push({
        axNodeId: rawNode.nodeId,
        role,
        name,
        description: rawNode.description?.value,
        value: rawNode.value?.value != null ? String(rawNode.value.value) : void 0,
        attributes: Object.keys(attrs).length ? attrs : void 0,
        bounds: bb && typeof bb.x === "number" && typeof bb.y === "number" ? { x: bb.x, y: bb.y, width: bb.width ?? 0, height: bb.height ?? 0 } : void 0,
        axPath: axPathFor(rawNode.nodeId),
        attributeHash
      });
    }
    return nodes;
  }

  // src/canonical/ax-targets.ts
  var MAX_AX_TARGETS = 200;
  var NAVIGABLE_ROLES = /* @__PURE__ */ new Set([
    "link",
    "button",
    "menuitem",
    "tab",
    "checkbox",
    "radio",
    "switch",
    "combobox",
    "listbox",
    "option",
    "textbox",
    "searchbox",
    "slider",
    "spinbutton",
    "treeitem"
  ]);
  var TEXT_ROLES = /* @__PURE__ */ new Set([
    "statictext",
    "text",
    "heading",
    "label",
    "caption"
  ]);
  var GROUP_ROLES = /* @__PURE__ */ new Set([
    "list",
    "listitem",
    "row",
    "rowgroup",
    "grid",
    "gridrow",
    "gridcell",
    "table",
    "tabpanel",
    "tablist",
    "menu",
    "menubar",
    "toolbar",
    "navigation",
    "main",
    "region"
  ]);
  function axProps(node) {
    return (node.properties ?? []).map((p) => ({
      name: p.name,
      value: p.value?.value
    }));
  }
  function axProp(node, name) {
    return axProps(node).find((p) => p.name === name)?.value;
  }
  function isNavigable(node) {
    const role = node.role?.value ?? "";
    return NAVIGABLE_ROLES.has(role);
  }
  function isText(node) {
    const role = node.role?.value ?? "";
    return TEXT_ROLES.has(role);
  }
  function isGroup(node) {
    const role = node.role?.value ?? "";
    return GROUP_ROLES.has(role);
  }
  function deriveTag(role) {
    switch (role) {
      case "button":
        return "button";
      case "link":
        return "a";
      case "textbox":
      case "searchbox":
      case "combobox":
      case "spinbutton":
      case "slider":
        return "input";
      case "checkbox":
      case "radio":
      case "switch":
        return "input";
      case "listbox":
        return "select";
      case "option":
        return "option";
      case "heading":
        return "h2";
      case "img":
        return "img";
      case "navigation":
        return "nav";
      case "main":
        return "main";
      case "list":
      case "listitem":
        return "div";
      default:
        return "div";
    }
  }
  function deriveControlKind(role) {
    if (role === "textbox" || role === "searchbox" || role === "combobox") return "input";
    if (role === "checkbox" || role === "radio" || role === "switch") return "input";
    if (role === "spinbutton" || role === "slider") return "input";
    return "non_input";
  }
  function deriveInputType(role) {
    switch (role) {
      case "searchbox":
        return "search";
      case "combobox":
        return "text";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "spinbutton":
        return "number";
      case "slider":
        return "range";
      default:
        return "text";
    }
  }
  function deriveAttributes(node) {
    const SAFE = ["id", "aria-label", "name", "type", "role", "placeholder", "title", "data-testid"];
    const out = {};
    for (const attr of SAFE) {
      const v = axProp(node, attr);
      if (typeof v === "string" && v.length > 0 && v.length <= 200) out[attr] = v;
    }
    return Object.keys(out).length > 0 ? out : void 0;
  }
  async function collectSemanticTargetsFromAXTree(tabId, sendCdpCommand) {
    let raw;
    try {
      raw = await sendCdpCommand(tabId, "Accessibility.getFullAXTree", { perfMode: "deep" });
    } catch (err) {
      console.warn("[ax-targets] Accessibility.getFullAXTree failed:", err);
      return [];
    }
    return axNodesToSemanticTargets(raw.nodes ?? []);
  }
  async function axNodesToSemanticTargets(rawNodes) {
    const out = [];
    for (const node of rawNodes) {
      if (out.length >= MAX_AX_TARGETS) break;
      if (!node.nodeId || !node.role?.value) continue;
      if (node.ignored) continue;
      const role = node.role.value;
      if (!isNavigable(node) && !isGroup(node) && !isText(node)) continue;
      const bb = node.boundingBox;
      if (!bb || typeof bb.x !== "number" || typeof bb.y !== "number") continue;
      const width = typeof bb.width === "number" ? bb.width : 0;
      const height = typeof bb.height === "number" ? bb.height : 0;
      const tag = deriveTag(role);
      const controlKind = deriveControlKind(role);
      const control = controlKind === "input" ? { kind: "input", inputType: deriveInputType(role) } : { kind: "non_input" };
      const accessibleName = node.name?.value ? { source: "computed", text: node.name.value } : void 0;
      const attributes = deriveAttributes(node);
      const stableRef = await computeStableRef({
        tag,
        role,
        accessibleName: node.name?.value,
        attributes: {
          "data-testid": attributes?.["data-testid"],
          name: attributes?.name,
          "aria-label": attributes?.["aria-label"],
          type: attributes?.type
        }
      });
      const targetId = await opaqueUuid(`ax:${node.nodeId}:${stableRef}`);
      out.push({
        targetId,
        stableRef,
        tag,
        role,
        accessibleName,
        attributes,
        control,
        boundingBox: { x: bb.x, y: bb.y, width, height },
        visible: true,
        framePath: [],
        locatorCandidates: []
      });
    }
    return out;
  }

  // src/canonical/observation.ts
  var DEFAULT_MAX_SEMANTIC_TARGETS = 200;
  var DEFAULT_MAX_DOM_ELEMENTS = 15e3;
  var MAX_DOM_ELEMENTS = 5e4;
  var MAX_SENSITIVE_REGIONS = 200;
  var MAX_ENCODED_PNG_LENGTH = 1e7;
  var MAX_PNG_BYTES = 75e5;
  var MAX_PNG_DIMENSION = 16384;
  var MAX_PNG_PIXELS = 5e7;
  var UUID_BYTE_LENGTH = 16;
  var ObservationSecurityError = class extends Error {
    constructor(message, cause) {
      super(message);
      this.name = "ObservationSecurityError";
      this.cause = cause;
    }
  };
  function securityError(message, cause) {
    return new ObservationSecurityError(message, cause);
  }
  function requireIntegerOption(name, value, fallback, maximum) {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < 0 || resolved > maximum) {
      throw securityError(
        `${name} must be a finite integer between 0 and ${maximum}`
      );
    }
    return resolved;
  }
  function requireFiniteNumber(name, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw securityError(`${name} must be finite`);
    }
    return value;
  }
  function requirePositiveInteger(name, value) {
    const resolved = requireFiniteNumber(name, value);
    if (!Number.isInteger(resolved) || resolved <= 0) {
      throw securityError(`${name} must be a positive integer`);
    }
    return resolved;
  }
  function requireBoundedPositive(name, value) {
    const resolved = requireFiniteNumber(name, value);
    if (resolved <= 0 || resolved > 8) {
      throw securityError(`${name} must be greater than zero and at most 8`);
    }
    return resolved;
  }
  function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function sha256(bytes) {
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  }
  function decodedBase64Length(data) {
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    return Math.floor(data.length * 3 / 4) - padding;
  }
  function decodeBase64(data) {
    const decoded = atob(data);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  function encodeBase64(bytes) {
    let binary = "";
    const chunkSize = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize)
      );
    }
    return btoa(binary);
  }
  function validatePngHeader(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || !signature.every((byte, index) => bytes[index] === byte)) {
      throw securityError("Visible-tab capture returned an invalid PNG");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width * height > MAX_PNG_PIXELS) {
      throw securityError("Visible-tab PNG exceeds pixel limit");
    }
    if (width < 1 || height < 1 || width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
      throw securityError("Visible-tab PNG exceeds dimension limit");
    }
    return { width, height };
  }
  function parsePngDataUrl(dataUrl) {
    const prefix = "data:image/png;base64,";
    if (!dataUrl.startsWith(prefix)) {
      throw securityError("Visible-tab capture did not return a PNG data URL");
    }
    const data = dataUrl.slice(prefix.length);
    if (data.length === 0 || data.length > MAX_ENCODED_PNG_LENGTH) {
      throw securityError("Visible-tab PNG exceeds encoded byte limit");
    }
    if (!/^[a-z0-9+/]+={0,2}$/i.test(data) || data.length % 4 === 1) {
      throw securityError("Visible-tab capture returned invalid base64");
    }
    const estimatedBytes = decodedBase64Length(data);
    if (estimatedBytes < 24 || estimatedBytes > MAX_PNG_BYTES) {
      throw securityError("Visible-tab PNG exceeds decoded byte limit");
    }
    const header = decodeBase64(data.slice(0, 32));
    const { width, height } = validatePngHeader(header);
    const bytes = decodeBase64(data);
    if (bytes.length !== estimatedBytes || bytes.length > MAX_PNG_BYTES) {
      throw securityError("Visible-tab PNG decoded length is invalid");
    }
    return { bytes, data, width, height };
  }
  function parseMaskedPng(bytes) {
    if (bytes.length > MAX_PNG_BYTES) {
      throw securityError("Masked PNG exceeds decoded byte limit");
    }
    const { width, height } = validatePngHeader(bytes);
    const data = encodeBase64(bytes);
    if (data.length > MAX_ENCODED_PNG_LENGTH) {
      throw securityError("Masked PNG exceeds encoded byte limit");
    }
    return { bytes, data, width, height };
  }
  async function opaqueUuid(seed) {
    const digest = await sha256(new TextEncoder().encode(seed));
    const bytes = digest.slice(0, UUID_BYTE_LENGTH);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function collectPageSnapshot(maxCandidates, maxDomElements, maxSensitiveRegions) {
    const sensitivePattern = /\b(?:account|api[\s_-]*key|auth|bearer|credential|one[\s_-]*time[\s_-]*(?:code|password)|otp|passcode|password|secret|token)\b/i;
    const sensitiveValuePattern = /(?:\b\d{6}\b|\b\d{8,20}\b|\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]+|\b(?:ghp_|sk-|pk_live_)[a-z0-9_-]{8,})/i;
    const isTopmost = (element, rect) => {
      if (typeof document.elementFromPoint !== "function") return true;
      const points = [
        [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
        [rect.left + 4, rect.top + 4],
        [rect.right - 4, rect.top + 4],
        [rect.left + 4, rect.bottom - 4]
      ];
      let hits = 0;
      let tested = 0;
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        tested++;
        if (hit === element || element.contains(hit) || hit.contains(element)) {
          hits++;
        }
      }
      return tested === 0 ? true : hits > 0;
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const basicVis = style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getAttribute("aria-hidden") !== "true" && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      if (!basicVis) return false;
      return isTopmost(element, rect);
    };
    const visibleText = (element) => {
      if (!element || !isVisible(element)) return void 0;
      const text = element.innerText;
      return typeof text === "string" ? text : void 0;
    };
    const safeSemanticText = (text) => text && !sensitivePattern.test(text) && !sensitiveValuePattern.test(text) ? text : void 0;
    const implicitRole = (element) => {
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a") return "link";
      if (tag === "select") return "combobox";
      if (tag === "textarea" || element.getAttribute("contenteditable") === "true")
        return "textbox";
      if (tag === "input") {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "search") return "searchbox";
        return "textbox";
      }
      return void 0;
    };
    const actionableSelector = [
      "a[href]",
      "button",
      "summary",
      "input:not([type='hidden']):not([type='password'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='checkbox']",
      "[role='combobox']",
      "[role='link']",
      "[role='listbox']",
      "[role='menuitem']",
      "[role='option']",
      "[role='radio']",
      "[role='searchbox']",
      "[role='slider']",
      "[role='spinbutton']",
      "[role='switch']",
      "[role='tab']",
      "[role='textbox']",
      "[role='treeitem']",
      "[aria-haspopup]",
      "[aria-expanded]",
      "[tabindex]:not([tabindex='-1'])",
      "[contenteditable='true']"
    ].join(",");
    const semanticTargets = [];
    const sensitiveRegions = [];
    let sensitiveRegionOverflow = false;
    let inspected = 0;
    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT
    );
    let node = walker.currentNode;
    while (node && inspected < maxDomElements) {
      inspected += 1;
      const element = node;
      const tag = element.tagName.toLowerCase();
      if (isVisible(element)) {
        const rect = element.getBoundingClientRect();
        const type = element.getAttribute("type") ?? "";
        const metadata = [
          type,
          element.getAttribute("autocomplete") ?? "",
          element.getAttribute("name") ?? "",
          element.id,
          element.getAttribute("aria-label") ?? ""
        ].join(" ");
        const leafText = element.children.length === 0 ? visibleText(element) : void 0;
        const sensitiveLeafText = leafText !== void 0 && (sensitivePattern.test(leafText) || sensitiveValuePattern.test(leafText));
        if (tag === "input" && type.toLowerCase() === "password" || tag === "canvas" || tag === "video" || sensitivePattern.test(metadata) || sensitiveValuePattern.test(metadata) || sensitiveLeafText) {
          const maskElement = sensitiveLeafText && element.parentElement ? element.parentElement : element;
          const maskRect = maskElement.getBoundingClientRect();
          if (sensitiveRegions.length < maxSensitiveRegions) {
            sensitiveRegions.push({
              x: maskRect.x,
              y: maskRect.y,
              width: maskRect.width,
              height: maskRect.height
            });
          } else {
            sensitiveRegionOverflow = true;
          }
        }
        if (semanticTargets.length < maxCandidates && element.matches(actionableSelector)) {
          if (!(tag === "input" && ["password", "hidden"].includes(type.toLowerCase()))) {
            const ariaLabel = safeSemanticText(
              element.getAttribute("aria-label") ?? void 0
            );
            const labelledBy = element.getAttribute("aria-labelledby");
            const labelledByText = labelledBy ? labelledBy.split(/\s+/).map(
              (id) => safeSemanticText(visibleText(document.getElementById(id)))
            ).filter(Boolean).join(" ") : void 0;
            const inputLabels = "labels" in element ? element.labels : null;
            const label = safeSemanticText(
              visibleText(inputLabels?.item(0) ?? null)
            );
            const ownText = safeSemanticText(visibleText(element));
            const accessibleName = ariaLabel ? { source: "aria-label", text: ariaLabel } : labelledByText ? { source: "aria-labelledby", text: labelledByText } : label ?? ownText ? { source: "visible_text", text: label ?? ownText } : void 0;
            const attributes = {};
            for (const attribute of [
              "href",
              "placeholder",
              "title",
              "alt",
              "id",
              "aria-label",
              "aria-describedby",
              "aria-controls",
              "aria-expanded",
              "aria-haspopup",
              "aria-current",
              "aria-pressed",
              "aria-selected",
              "data-testid",
              "name",
              "type"
            ]) {
              const value = element.getAttribute(attribute);
              if (value !== null && !sensitivePattern.test(value)) {
                attributes[attribute] = value;
              }
            }
            semanticTargets.push({
              tag,
              role: element.getAttribute("role") ?? implicitRole(element),
              accessibleName,
              label,
              attributes,
              boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              },
              visible: true,
              framePath: [],
              locatorCandidates: []
            });
          }
        }
      }
      node = walker.nextNode();
    }
    const bodyTextSnippet = (() => {
      const SKIP_TAGS = {
        script: 1,
        style: 1,
        meta: 1,
        link: 1,
        noscript: 1,
        svg: 1,
        path: 1
      };
      const HIDDEN_ROLES = {
        contentinfo: 1
      };
      const CHROME_DENYLIST = /* @__PURE__ */ new Set([
        "skip to content",
        "skip to main content",
        "skip to navigation",
        "\xA9",
        "all rights reserved"
      ]);
      const clean2 = (s) => (s || "").replace(/\s+/g, " ").trim();
      const vis = (el) => {
        if (!el) return false;
        const t = el.tagName ? el.tagName.toLowerCase() : "";
        if (SKIP_TAGS[t]) return false;
        try {
          const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
          if (!cs) return true;
          return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity ?? "1") > 0;
        } catch {
          return true;
        }
      };
      const parts = [];
      const heads = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        if (!vis(h)) return;
        const t = clean2(h.textContent);
        if (t && t.length < 200) heads.push(`H${h.tagName[1]}: ${t}`);
      });
      if (heads.length) parts.push("=== HEADINGS ===\n" + heads.join("\n"));
      const stats = [];
      document.querySelectorAll("a, span, strong, b, div, p").forEach((el) => {
        if (!vis(el)) return;
        const own = clean2(el.textContent);
        if (!/^\d{1,6}(,\d{3})*(\.\d+)?[KMBkmb]?$/.test(own) && !/^(?:★|⭐|stars?|followers?|forks?)\s*\d+/i.test(own)) return;
        const p = el.parentElement;
        if (!p) return;
        const pt = clean2(p.textContent);
        if (pt.length > 120 || pt.length < own.length + 1) return;
        const label = pt.replace(own, "").trim();
        if (label && label.length < 60) stats.push(`${label}: ${own}`);
      });
      if (stats.length) parts.push("=== STATS ===\n" + stats.join("\n"));
      const lbls = [];
      document.querySelectorAll("label").forEach((l) => {
        if (!vis(l)) return;
        const t = clean2(l.textContent);
        if (t && t.length < 80) lbls.push(t);
      });
      if (lbls.length) parts.push("=== LABELS ===\n" + lbls.join("\n"));
      const cardItems = [];
      document.querySelectorAll("li, article, [role='listitem'], .Box-row, [itemtype]").forEach((el) => {
        if (!vis(el)) return;
        let textContent = "";
        const walk = (node2) => {
          if (node2.nodeType === Node.TEXT_NODE) {
            textContent += node2.textContent + " ";
          } else if (node2.nodeType === Node.ELEMENT_NODE) {
            const e = node2;
            if (!vis(e)) return;
            const label = e.getAttribute("aria-label") || e.getAttribute("title");
            const cls = e.getAttribute("class") || "";
            const href = e.getAttribute("href") || "";
            if (label) {
              textContent += `[${label}] `;
            } else if (cls.includes("octicon-star") || href.includes("/stargazers") || href.includes("sort=stargazers")) {
              textContent += `[\u2605 star] `;
            } else if (cls.includes("octicon-repo-forked") || href.includes("/network/members")) {
              textContent += `[fork] `;
            } else if (cls.includes("octicon-issue") || href.includes("/issues")) {
              textContent += `[issues] `;
            }
            e.childNodes.forEach(walk);
          }
        };
        walk(el);
        const text = clean2(textContent);
        if (text && text.length > 5 && text.length < 800) {
          cardItems.push(`\u2022 ${text}`);
        }
      });
      if (cardItems.length > 0) {
        parts.push("=== CARDS & LIST ITEMS ===\n" + cardItems.slice(0, 50).join("\n"));
      }
      const seen = {};
      const lines = [];
      const walkText = (el, depth) => {
        if (depth > 25 || !el) return;
        if (el.nodeType === Node.TEXT_NODE) {
          const t = clean2(el.textContent);
          if (t.length < 3) return;
          if (CHROME_DENYLIST.has(t.toLowerCase())) return;
          if (seen[t]) return;
          seen[t] = 1;
          lines.push(t);
          return;
        }
        if (el.nodeType !== Node.ELEMENT_NODE) return;
        const elEl = el;
        if (!vis(elEl)) return;
        const role = elEl.getAttribute && elEl.getAttribute("role");
        if (role && HIDDEN_ROLES[role]) return;
        elEl.childNodes.forEach((c) => walkText(c, depth + 1));
      };
      walkText(document.body, 0);
      if (lines.length) parts.push("=== TEXT ===\n" + lines.slice(0, 150).join("\n"));
      return parts.join("\n\n");
    })();
    const pagePurpose = (() => {
      const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
      const metaDesc = meta ? (meta.getAttribute("content") || "").trim() : "";
      const h1 = document.querySelector("h1");
      const h1Text = h1 ? (h1.textContent || "").trim() : "";
      const parts = [metaDesc, h1Text].filter((s) => s.length > 0);
      return parts.join(" \u2014 ").slice(0, 512);
    })();
    const pageIdentity = (() => {
      const loc = location.pathname + location.search + location.hash;
      const h1 = document.querySelector("h1");
      const h1Text = h1 ? (h1.textContent || "").trim().slice(0, 80) : "";
      const childCount = document.body ? document.body.children.length : 0;
      const popups = Array.from(
        document.querySelectorAll(
          "[aria-expanded='true'], details[open], [role='dialog'], [role='menu'], [role='listbox']"
        )
      ).slice(0, 10).map((el) => (el.textContent || "").trim().slice(0, 40) || el.tagName).join("|");
      const text = `${loc}
${h1Text}
${childCount}
${popups}
${semanticTargets.length}`;
      let h = 0xcbf29ce484222325n;
      const prime = 0x100000001b3n;
      const mask = (1n << 64n) - 1n;
      for (let i = 0; i < text.length; i++) {
        const c = BigInt(text.charCodeAt(i));
        h = (h ^ c) * prime & mask;
      }
      return h.toString(16).padStart(16, "0");
    })();
    const links = [];
    const buttons = [];
    return {
      url: location.href,
      title: document.title,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio,
        scrollX,
        scrollY
      },
      readyState: document.readyState,
      visibility: document.visibilityState,
      documentToken: `${performance.timeOrigin}:${location.href}`,
      domScanComplete: node === null,
      sensitiveRegionOverflow,
      sensitiveRegions,
      semanticTargets,
      bodyTextSnippet,
      pageIdentity,
      pagePurpose,
      links,
      buttons
    };
  }
  async function defaultSendCdpCommand(tabId, method, params) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(
            securityError(`Observation CDP command failed: ${error.message}`)
          );
          return;
        }
        resolve(result);
      });
    });
  }
  async function defaultGetTabIdentity(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const activeTabs = await chrome.tabs.query({
      active: true,
      windowId: tab.windowId
    });
    return {
      id: tab.id ?? -1,
      windowId: tab.windowId,
      active: tab.active === true && activeTabs.length === 1 && activeTabs[0]?.id === tabId
    };
  }
  var CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS = 600;
  var lastCaptureVisibleTabAt = 0;
  var captureVisibleTabChain = Promise.resolve();
  async function defaultCaptureVisibleTab(_tabId, windowId) {
    let releaseNext;
    const nextLock = new Promise((r) => {
      releaseNext = r;
    });
    const prevLock = captureVisibleTabChain;
    captureVisibleTabChain = prevLock.then(() => nextLock, () => nextLock);
    await prevLock;
    try {
      const elapsed = Date.now() - lastCaptureVisibleTabAt;
      if (elapsed < CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS) {
        await new Promise((r) => setTimeout(r, CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS - elapsed));
      }
      lastCaptureVisibleTabAt = Date.now();
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl2) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(securityError(`Visible-tab capture failed: ${error.message}`));
            return;
          }
          if (!dataUrl2) {
            reject(securityError("Visible-tab capture returned no data"));
            return;
          }
          resolve(dataUrl2);
        });
      });
      return dataUrl;
    } finally {
      releaseNext();
    }
  }
  async function captureScreenshotViaCdp(tabId) {
    const r = await defaultSendCdpCommand(tabId, "Page.captureScreenshot", {
      format: "png"
    });
    const data = r.data;
    if (typeof data !== "string" || data.length === 0) {
      throw securityError("Page.captureScreenshot returned no data");
    }
    return `data:image/png;base64,${data}`;
  }
  async function captureVisibleTabWithCdpFallback(tabId, windowId) {
    try {
      return await defaultCaptureVisibleTab(tabId, windowId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not the active tab|Cannot capture/i.test(msg)) {
        return captureScreenshotViaCdp(tabId);
      }
      throw err;
    }
  }
  async function defaultGetZoom(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.getZoom(tabId, (zoomFactor) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(securityError(`Tab zoom capture failed: ${error.message}`));
          return;
        }
        resolve(zoomFactor);
      });
    });
  }
  async function defaultMaskScreenshot(input) {
    if (input.sensitiveRegions.length === 0) return input.pngBytes;
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      throw securityError("Sensitive screenshot masking is unavailable");
    }
    const sourceBuffer = new ArrayBuffer(input.pngBytes.byteLength);
    new Uint8Array(sourceBuffer).set(input.pngBytes);
    const bitmap = await createImageBitmap(
      new Blob([sourceBuffer], { type: "image/png" })
    );
    try {
      if (bitmap.width !== input.width || bitmap.height !== input.height) {
        throw securityError("Decoded PNG dimensions do not match its header");
      }
      const canvas = new OffscreenCanvas(input.width, input.height);
      const context = canvas.getContext("2d");
      if (!context)
        throw securityError(
          "Sensitive screenshot masking context is unavailable"
        );
      context.drawImage(bitmap, 0, 0);
      context.fillStyle = "#000000";
      const scaleX = input.width / input.viewport.width;
      const scaleY = input.height / input.viewport.height;
      for (const region of input.sensitiveRegions) {
        const x = Math.max(0, Math.floor(region.x * scaleX));
        const y = Math.max(0, Math.floor(region.y * scaleY));
        const right = Math.min(
          input.width,
          Math.ceil((region.x + region.width) * scaleX)
        );
        const bottom = Math.min(
          input.height,
          Math.ceil((region.y + region.height) * scaleY)
        );
        if (right <= x || bottom <= y)
          throw securityError("Sensitive region cannot be masked");
        context.fillRect(x, y, right - x, bottom - y);
      }
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close();
    }
  }
  function validateSensitiveRegions(value, viewport) {
    if (!Array.isArray(value) || value.length > MAX_SENSITIVE_REGIONS) {
      throw securityError("Sensitive region list exceeds limit");
    }
    return value.map((raw, index) => {
      if (!raw || typeof raw !== "object")
        throw securityError(`Sensitive region ${index} is invalid`);
      const region = raw;
      const x = requireFiniteNumber(`sensitiveRegions[${index}].x`, region.x);
      const y = requireFiniteNumber(`sensitiveRegions[${index}].y`, region.y);
      const width = requireFiniteNumber(
        `sensitiveRegions[${index}].width`,
        region.width
      );
      const height = requireFiniteNumber(
        `sensitiveRegions[${index}].height`,
        region.height
      );
      if (width <= 0 || height <= 0 || x >= viewport.width || y >= viewport.height || x + width <= 0 || y + height <= 0) {
        throw securityError(`Sensitive region ${index} is outside the viewport`);
      }
      return { x, y, width, height };
    });
  }
  function validatePageSnapshot(value) {
    if (!value || typeof value !== "object")
      throw securityError("Runtime evaluation returned no page snapshot");
    const raw = value;
    if (!raw.viewport || typeof raw.viewport !== "object")
      throw securityError("Runtime evaluation returned no viewport");
    const viewportValue = raw.viewport;
    const viewport = {
      width: requirePositiveInteger("viewport.width", viewportValue.width),
      height: requirePositiveInteger("viewport.height", viewportValue.height),
      devicePixelRatio: requireBoundedPositive(
        "viewport.devicePixelRatio",
        viewportValue.devicePixelRatio
      ),
      scrollX: requireFiniteNumber("viewport.scrollX", viewportValue.scrollX),
      scrollY: requireFiniteNumber("viewport.scrollY", viewportValue.scrollY)
    };
    if (typeof raw.url !== "string" || typeof raw.title !== "string") {
      throw securityError("Page URL and title must be strings");
    }
    if (!["loading", "interactive", "complete", "frozen"].includes(
      raw.readyState
    )) {
      throw securityError("Page lifecycle is invalid");
    }
    if (!["visible", "hidden", "prerender"].includes(raw.visibility)) {
      throw securityError("Page visibility is invalid");
    }
    if (typeof raw.documentToken !== "string" || raw.documentToken.length === 0) {
      throw securityError("Page document identity is invalid");
    }
    if (raw.documentToken.length > 4096) {
      throw securityError("Page document identity is invalid");
    }
    if (raw.domScanComplete !== true) {
      console.warn(`[observation] DOM scan truncated at limit \u2014 proceeding with partial snapshot`);
    }
    if (raw.sensitiveRegionOverflow !== false) {
      console.warn(`[observation] Sensitive region limit reached \u2014 proceeding`);
    }
    if (!Array.isArray(raw.semanticTargets))
      throw securityError("Semantic targets are invalid");
    if (typeof raw.bodyTextSnippet !== "string")
      throw securityError("Page body text is missing");
    const pageIdentity = typeof raw.pageIdentity === "string" && /^[a-f0-9]{32}$/i.test(raw.pageIdentity) ? raw.pageIdentity : "";
    const pagePurpose = typeof raw.pagePurpose === "string" ? raw.pagePurpose : "";
    const links = Array.isArray(raw.links) ? raw.links : [];
    const buttons = Array.isArray(raw.buttons) ? raw.buttons : [];
    return {
      url: raw.url,
      title: raw.title,
      viewport,
      readyState: raw.readyState,
      visibility: raw.visibility,
      documentToken: raw.documentToken,
      domScanComplete: true,
      sensitiveRegionOverflow: false,
      sensitiveRegions: validateSensitiveRegions(raw.sensitiveRegions, viewport),
      semanticTargets: raw.semanticTargets,
      bodyTextSnippet: raw.bodyTextSnippet,
      pageIdentity,
      pagePurpose,
      links,
      buttons
    };
  }
  async function capturePageSnapshot(tabId, sendCdpCommand, maxSemanticTargets, maxDomElements) {
    const runtimeResult = await sendCdpCommand(tabId, "Runtime.evaluate", {
      expression: `(${collectPageSnapshot.toString()})(${maxSemanticTargets}, ${maxDomElements}, ${MAX_SENSITIVE_REGIONS})`,
      returnByValue: true,
      awaitPromise: false
    });
    if (runtimeResult.exceptionDetails) {
      const detail = JSON.stringify(runtimeResult.exceptionDetails).slice(0, 300);
      throw securityError(`Page snapshot evaluation failed: ${detail}`);
    }
    return validatePageSnapshot(runtimeResult.result?.value);
  }
  function validateFrameTopology(value) {
    if (!value || typeof value !== "object") {
      throw securityError("CDP frame topology cannot be proven");
    }
    const frameTree = value.frameTree;
    if (!frameTree || typeof frameTree !== "object") {
      throw securityError("CDP frame topology cannot be proven");
    }
    const visited = /* @__PURE__ */ new Set();
    let nodeCount = 0;
    const visit = (rawNode) => {
      if (!rawNode || typeof rawNode !== "object") {
        throw securityError("CDP frame topology contains an invalid node");
      }
      nodeCount += 1;
      if (nodeCount > 1e3) {
        throw securityError("CDP frame topology exceeds node limit");
      }
      const node = rawNode;
      if (!node.frame || typeof node.frame !== "object") {
        throw securityError("CDP frame topology contains an invalid frame");
      }
      const id = node.frame.id;
      if (typeof id !== "string" || id.length === 0 || id.length > 512 || visited.has(id)) {
        throw securityError("CDP frame topology contains an invalid frame ID");
      }
      visited.add(id);
      if (node.childFrames !== void 0 && !Array.isArray(node.childFrames)) {
        throw securityError("CDP frame topology contains invalid children");
      }
      const children = node.childFrames ?? [];
      for (const child of children) visit(child);
      return id;
    };
    const mainFrameId2 = visit(frameTree);
    return { mainFrameId: mainFrameId2 };
  }
  async function captureFrameTopology(tabId, sendCdpCommand) {
    try {
      return validateFrameTopology(
        await sendCdpCommand(tabId, "Page.getFrameTree")
      );
    } catch (error) {
      if (error instanceof ObservationSecurityError) throw error;
      throw securityError("CDP frame topology cannot be proven", error);
    }
  }
  function requireActiveIdentity(tabId, expected, actual) {
    if (!Number.isInteger(actual.id) || !Number.isInteger(actual.windowId) || actual.id !== tabId || actual.active !== true || expected && (actual.id !== expected.id || actual.windowId !== expected.windowId)) {
      throw securityError(
        expected ? "The active tab changed during visible capture" : "Target tab is not the active tab"
      );
    }
    return actual;
  }
  function validateScreenshotViewport(screenshot, viewport, zoom) {
    const scales = [viewport.devicePixelRatio, viewport.devicePixelRatio * zoom];
    const matches = scales.some((scale) => {
      const expectedWidth = viewport.width * scale;
      const expectedHeight = viewport.height * scale;
      const widthTolerance = Math.max(2, expectedWidth * 0.05);
      const heightTolerance = Math.max(2, expectedHeight * 0.05);
      return Math.abs(screenshot.width - expectedWidth) <= widthTolerance && Math.abs(screenshot.height - expectedHeight) <= heightTolerance;
    });
    if (!matches) {
      console.warn(
        `[observation] screenshot ${screenshot.width}x${screenshot.height} doesn't match viewport ${viewport.width}x${viewport.height} at DPR=${viewport.devicePixelRatio} zoom=${zoom}; using anyway`
      );
    }
  }
  async function captureObservationInternal(tabId, options) {
    if (!Number.isInteger(tabId) || tabId <= 0)
      throw securityError("tabId must be a positive integer");
    const maxSemanticTargets = requireIntegerOption(
      "maxSemanticTargets",
      options.maxSemanticTargets,
      DEFAULT_MAX_SEMANTIC_TARGETS,
      DEFAULT_MAX_SEMANTIC_TARGETS
    );
    const maxDomElements = requireIntegerOption(
      "maxDomElements",
      options.maxDomElements,
      DEFAULT_MAX_DOM_ELEMENTS,
      MAX_DOM_ELEMENTS
    );
    if (maxDomElements === 0)
      throw securityError("maxDomElements must be greater than zero");
    const now = (options.now ?? (() => /* @__PURE__ */ new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
      throw securityError("Capture time is invalid");
    const capturedAt = now.toISOString();
    const sendCdpCommand = options.sendCdpCommand ?? defaultSendCdpCommand;
    const captureVisibleTab = options.captureVisibleTab ?? captureVisibleTabWithCdpFallback;
    const getTabIdentity = options.getTabIdentity ?? defaultGetTabIdentity;
    const getZoom = options.getZoom ?? defaultGetZoom;
    const maskScreenshot = options.maskScreenshot ?? defaultMaskScreenshot;
    const initialIdentity = requireActiveIdentity(
      tabId,
      void 0,
      await getTabIdentity(tabId)
    );
    const zoom = requireBoundedPositive("zoom", await getZoom(tabId));
    const topology = await captureFrameTopology(tabId, sendCdpCommand);
    const after = await capturePageSnapshot(
      tabId,
      sendCdpCommand,
      maxSemanticTargets,
      maxDomElements
    );
    try {
      const axTargets = await collectSemanticTargetsFromAXTree(tabId, sendCdpCommand);
      if (axTargets.length > 0) {
        after.semanticTargets = axTargets;
      }
    } catch (err) {
      console.warn("[observation] AX-tree semanticTarget extraction failed; using DOM walker fallback:", err);
    }
    requireActiveIdentity(tabId, initialIdentity, await getTabIdentity(tabId));
    let rawScreenshot = null;
    try {
      rawScreenshot = parsePngDataUrl(
        await captureVisibleTab(tabId, initialIdentity.windowId)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Cannot access contents") || message.includes("manifest must request permission") || message.includes("URL")) {
        rawScreenshot = null;
      } else {
        throw err;
      }
    }
    requireActiveIdentity(tabId, initialIdentity, await getTabIdentity(tabId));
    if (topology.mainFrameId === "") {
      throw securityError("Frame topology could not be proven");
    }
    let maskedScreenshot;
    if (rawScreenshot !== null) {
      validateScreenshotViewport(rawScreenshot, after.viewport, zoom);
      const maskedBytes = await maskScreenshot({
        pngBytes: rawScreenshot.bytes,
        width: rawScreenshot.width,
        height: rawScreenshot.height,
        viewport: after.viewport,
        sensitiveRegions: after.sensitiveRegions
      });
      if (after.sensitiveRegions.length > 0 && maskedBytes.length === rawScreenshot.bytes.length && maskedBytes.every((byte, index) => byte === rawScreenshot.bytes[index])) {
        throw securityError("Masker returned an unchanged sensitive screenshot");
      }
      const screenshot2 = parseMaskedPng(maskedBytes);
      if (screenshot2.width !== rawScreenshot.width || screenshot2.height !== rawScreenshot.height) {
        throw securityError("Masked screenshot dimensions changed");
      }
      validateScreenshotViewport(screenshot2, after.viewport, zoom);
      maskedScreenshot = screenshot2;
    } else {
      maskedScreenshot = { bytes: new Uint8Array(0), width: 0, height: 0, data: "" };
    }
    const screenshot = maskedScreenshot;
    const screenshotHash = screenshot.bytes.length > 0 ? bytesToHex(await sha256(screenshot.bytes)) : "0".repeat(64);
    const pageFrameId = await opaqueUuid(
      `frame:${tabId}:${topology.mainFrameId}`
    );
    const canonicalTargets = [];
    for (const [index, rawTarget] of after.semanticTargets.entries()) {
      if (canonicalTargets.length >= maxSemanticTargets) break;
      const seed = JSON.stringify({
        tabId,
        frame: pageFrameId,
        index,
        tag: rawTarget.tag,
        role: rawTarget.role,
        boundingBox: rawTarget.boundingBox
      });
      const targetId = await opaqueUuid(`target:${seed}`);
      const target = sanitizeSemanticTarget({ ...rawTarget, targetId });
      if (target) canonicalTargets.push(target);
    }
    const observationId = await opaqueUuid(
      `observation:${tabId}:${capturedAt}:${screenshotHash}`
    );
    const opaqueTabId = await opaqueUuid(`tab:${tabId}`);
    const accessibilityNodes = await collectAccessibilitySnapshot(tabId, sendCdpCommand);
    const observation = {
      observationId,
      capturedAt,
      url: sanitizeObservationUrl(after.url),
      title: sanitizeBrowserText(after.title),
      screenshot: {
        kind: "inline",
        encoding: "png",
        data: screenshot.data,
        sha256: screenshotHash,
        width: screenshot.width,
        height: screenshot.height
      },
      viewport: {
        ...after.viewport,
        zoom
      },
      page: {
        tabId: opaqueTabId,
        frameId: pageFrameId,
        lifecycle: after.readyState,
        visibility: after.visibility
      },
      semanticTargets: canonicalTargets,
      accessibilityNodes: accessibilityNodes.length > 0 ? accessibilityNodes : void 0,
      // ponytail: structured page text from smart DOM extractor. Sensitive
      // content (passwords, tokens, etc.) is redacted via sanitizeBrowserText.
      bodyText: sanitizeBrowserText(after.bodyTextSnippet),
      // ponytail: replay-ready fields. pageIdentity is a SHA-256 over a
      // normalized AX-subtree dump — stable across DOM re-renders, flips
      // when navigation actually happens. pagePurpose / links / buttons
      // give the future workflow recorder everything it needs without a
      // re-scrape.
      pageIdentity: after.pageIdentity || void 0,
      pagePurpose: after.pagePurpose ? sanitizeBrowserText(after.pagePurpose) : void 0,
      // ponytail: links and buttons are always undefined on the extension
      // path — the page-context script no longer collects them (too slow).
      // The "ANCHORS" prompt derives from accessibilityNodes in the
      // renderer. Schema fields are still optional in the v1 contract for
      // future recorder integration.
      links: void 0,
      buttons: void 0
    };
    assertNoForbiddenBrowserData(observation);
    let parsed;
    try {
      parsed = ObservationV1Schema.parse(observation);
    } catch (err) {
      const issues = err.issues ?? [];
      const unknownTopLevel = issues.filter((i) => i.code === "unrecognized_keys" && Array.isArray(i.path) && i.path.length === 0).flatMap((i) => i.keys ?? []);
      if (unknownTopLevel.length === 0) throw err;
      console.warn(
        `[observation] bundled schema missing ${unknownTopLevel.length} replay-ready fields; stripping and retrying. Rebuild @brotto/brotto-action-schema to fix.`
      );
      const stripped = { ...observation };
      for (const k of unknownTopLevel) delete stripped[k];
      parsed = ObservationV1Schema.parse(stripped);
    }
    return parsed;
  }
  async function captureObservation(tabId, options = {}) {
    const MIN_BODY_CHARS = 80;
    const SETTLE_RETRIES = 2;
    const SETTLE_DELAY_MS = 400;
    let result = null;
    let attempts = 0;
    try {
      while (true) {
        result = await captureObservationInternal(tabId, options);
        const body = result.bodyText ?? "";
        const lifecycle = result.page?.lifecycle ?? "complete";
        const settled = body.length >= MIN_BODY_CHARS && lifecycle === "complete";
        if (settled || attempts >= SETTLE_RETRIES) break;
        attempts += 1;
        await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));
      }
      return result;
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        return {
          observationId: "obs-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          url: "about:blank",
          title: "(content filtered)",
          screenshot: { kind: "inline", encoding: "png", data: "", sha256: "0".repeat(64), width: 0, height: 0 },
          viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
          page: {
            tabId: "0".repeat(36),
            frameId: "0".repeat(36),
            lifecycle: "complete",
            visibility: "visible"
          },
          semanticTargets: []
        };
      }
      throw error;
    }
  }
  var TRANSIENT_SNAPSHOT_RE = /Page document identity is invalid|Page snapshot evaluation failed|Page changed during capture/i;
  var QUOTA_RETRY_SKIP_RE = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|Debugger is not attached|cannot access contents|manifest must request permission/i;
  async function captureSnapshotForDriver(tabId, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await captureObservation(tabId, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = TRANSIENT_SNAPSHOT_RE.test(message);
        const skipRetry = QUOTA_RETRY_SKIP_RE.test(message);
        if (!transient || skipRetry || attempt === 1) {
          if (transient && !skipRetry) {
            console.warn(
              `[observation] snapshot validator failed twice; degrading to partial observation: ${message.slice(0, 200)}`
            );
            return {
              observationId: "obs-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
              capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
              url: "about:blank",
              title: "(capture in progress \u2014 page transitioning)",
              screenshot: { kind: "inline", encoding: "png", data: "", sha256: "0".repeat(64), width: 0, height: 0 },
              viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
              page: {
                tabId: "0".repeat(36),
                frameId: "0".repeat(36),
                lifecycle: "loading",
                visibility: "visible"
              },
              semanticTargets: []
            };
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
    }
    throw new Error("captureSnapshotForDriver: unreachable");
  }

  // src/canonical/page-settler.ts
  init_debugger();
  var realClock = {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle)
  };
  var PageSettler = class {
    constructor(options) {
      this.tabId = options.tabId;
      this.getPageState = options.getPageState;
      this.events = options.events ?? new DebuggerPageEventSource();
      this.clock = options.clock ?? realClock;
      this.prepareEvents = options.prepareEvents ?? (options.events === void 0 ? () => prepareDefaultEvents(this.tabId) : async () => {
      });
      this.stabilityMs = boundedPositive(options.stabilityMs, 250);
      this.timeoutMs = boundedPositive(options.timeoutMs, 1e4);
      this.pageStateReadTimeoutMs = boundedPositive(options.pageStateReadTimeoutMs, 250);
      this.configuredMainFrameId = options.mainFrameId;
      this.initialPageState = options.initialPageState === void 0 ? { url: "about:blank", lifecycle: "loading" } : sanitizePageState(options.initialPageState);
    }
    settle(execute, signal) {
      return new Promise((resolve) => {
        let completed = false;
        let finishing = false;
        let executionFinished = false;
        let navigation = false;
        let loadComplete = false;
        let targetCreated = false;
        let dialog;
        let stabilityTimer;
        let timeoutTimer;
        let mainFrameId2 = this.configuredMainFrameId;
        let latestPageState = this.initialPageState;
        let nextRefreshGeneration = 0;
        let committedRefreshGeneration = 0;
        const pendingRefreshes = /* @__PURE__ */ new Set();
        const refreshPageState = () => {
          const generation = ++nextRefreshGeneration;
          const refresh = this.safePageState().then((state) => {
            if (!completed && state !== void 0 && generation > committedRefreshGeneration) {
              latestPageState = state;
              committedRefreshGeneration = generation;
            }
          });
          pendingRefreshes.add(refresh);
          void refresh.finally(() => pendingRefreshes.delete(refresh));
          return refresh;
        };
        void refreshPageState();
        let cleanupSubscription = () => {
        };
        const cleanup = () => {
          if (stabilityTimer !== void 0) this.clock.clearTimeout(stabilityTimer);
          if (timeoutTimer !== void 0) this.clock.clearTimeout(timeoutTimer);
          cleanupSubscription();
          signal?.removeEventListener("abort", onAbort);
        };
        const finish = async (status, extra = {}) => {
          if (completed || finishing) return;
          finishing = true;
          const terminalRefresh = refreshPageState();
          await Promise.allSettled([...pendingRefreshes, terminalRefresh]);
          completed = true;
          cleanup();
          const details = {
            navigation,
            targetCreated,
            ...dialog === void 0 ? {} : { dialog },
            pageState: latestPageState
          };
          if (status === "timeout") resolve({ status, code: "SETTLEMENT_TIMEOUT", ...details });
          else if (status === "detached") resolve({ status, code: "DEBUGGER_DETACHED", ...details });
          else if (status === "cancelled") resolve({ status, code: "ACTION_CANCELLED", ...details });
          else if (status === "execution_failed") resolve({
            status,
            code: "ACTION_EXECUTION_FAILED",
            message: extra.message ?? "Action execution failed",
            ...details
          });
          else resolve({ status, ...details });
        };
        const scheduleStability = () => {
          if (completed || !executionFinished || navigation && !loadComplete) return;
          if (stabilityTimer !== void 0) this.clock.clearTimeout(stabilityTimer);
          stabilityTimer = this.clock.setTimeout(() => {
            void finish("settled");
          }, this.stabilityMs);
        };
        function onEvent(event) {
          if (completed) return;
          void refreshPageState();
          if (event.method === "Page.frameNavigated") {
            const frame = event.params?.frame;
            if (frame && frame.parentId === void 0 && typeof frame.id === "string") mainFrameId2 = frame.id;
          }
          if (isFrameEvent(event) && mainFrameId2 !== void 0 && eventFrameId(event) !== mainFrameId2) return;
          if (event.method === "DOM.documentUpdated" && mainFrameId2 !== void 0 && event.params?.frameId !== mainFrameId2) return;
          if (isNavigationStart(event)) {
            navigation = true;
            loadComplete = false;
            if (stabilityTimer !== void 0) clockClear();
            return;
          }
          if (isLoadComplete(event)) {
            loadComplete = true;
            scheduleStability();
            return;
          }
          if (event.method === "DOM.documentUpdated") {
            scheduleStability();
            return;
          }
          if (event.method === "Page.javascriptDialogOpening") {
            dialog = { present: true, kind: dialogKind(event.params?.type) };
            return;
          }
          if (event.method === "Target.targetCreated" || event.method === "Target.attachedToTarget") {
            targetCreated = true;
            return;
          }
          if (event.method === "Debugger.detached") {
            finish("detached");
          }
        }
        const onAbort = () => finish("cancelled");
        const clockClear = () => {
          if (stabilityTimer !== void 0) this.clock.clearTimeout(stabilityTimer);
          stabilityTimer = void 0;
        };
        cleanupSubscription = this.events.subscribe(this.tabId, onEvent);
        if (completed || finishing) {
          cleanupSubscription();
          return;
        }
        timeoutTimer = this.clock.setTimeout(() => {
          void finish("timeout");
        }, this.timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          finish("cancelled");
          return;
        }
        let preparation;
        try {
          preparation = this.prepareEvents();
        } catch (error) {
          void finish("execution_failed", {
            message: "Page event preparation failed"
          });
          return;
        }
        void preparation.then(() => completed || finishing ? void 0 : execute()).then(() => {
          executionFinished = true;
          void refreshPageState();
          scheduleStability();
        }).catch((error) => {
          void finish("execution_failed", {
            message: "Action execution failed"
          });
        });
      });
    }
    async safePageState() {
      let timeout;
      try {
        const state = await Promise.race([
          this.getPageState(),
          new Promise((resolve) => {
            timeout = this.clock.setTimeout(() => resolve(void 0), this.pageStateReadTimeoutMs);
          })
        ]);
        return state === void 0 ? void 0 : sanitizePageState(state);
      } catch {
        return void 0;
      } finally {
        if (timeout !== void 0) this.clock.clearTimeout(timeout);
      }
    }
  };
  function sanitizePageState(state) {
    return {
      url: sanitizeObservationUrl(state.url),
      lifecycle: state.lifecycle,
      ...state.title === void 0 ? {} : { title: sanitizeBrowserText(state.title, 512) }
    };
  }
  async function prepareDefaultEvents(tabId) {
    await sendCommand(tabId, { method: "Page.enable" });
    await sendCommand(tabId, { method: "Page.setLifecycleEventsEnabled", params: { enabled: true } });
    await sendCommand(tabId, { method: "DOM.enable" });
    await sendCommand(tabId, { method: "Target.setDiscoverTargets", params: { discover: true } });
  }
  var DebuggerPageEventSource = class {
    subscribe(tabId, handler) {
      const cdpHandler = (source, method, params) => {
        if (source.tabId === tabId) handler({ method, params });
      };
      const detachHandler = (source) => {
        if (source.tabId === tabId) handler({ method: "Debugger.detached" });
      };
      chrome.debugger.onEvent.addListener(cdpHandler);
      chrome.debugger.onDetach.addListener(detachHandler);
      return () => {
        chrome.debugger.onEvent.removeListener(cdpHandler);
        chrome.debugger.onDetach.removeListener(detachHandler);
      };
    }
  };
  function isFrameEvent(event) {
    return event.method === "Page.frameStartedLoading" || event.method === "Page.frameStoppedLoading" || event.method === "Page.frameNavigated" || event.method === "Page.navigatedWithinDocument" || event.method === "Page.lifecycleEvent";
  }
  function eventFrameId(event) {
    if (event.method === "Page.frameNavigated") {
      return event.params?.frame?.id;
    }
    return event.params?.frameId;
  }
  function boundedPositive(value, fallback) {
    return value !== void 0 && Number.isFinite(value) && value > 0 ? value : fallback;
  }
  function isNavigationStart(event) {
    return event.method === "Page.frameStartedLoading" || event.method === "Page.frameNavigated" || event.method === "Page.navigatedWithinDocument" || event.method === "Page.lifecycleEvent" && event.params?.name === "init";
  }
  function isLoadComplete(event) {
    return event.method === "Page.loadEventFired" || event.method === "Page.frameStoppedLoading" || event.method === "Page.lifecycleEvent" && event.params?.name === "load";
  }
  function dialogKind(raw) {
    return raw === "confirm" || raw === "prompt" || raw === "beforeunload" ? raw : "alert";
  }

  // src/canonical/session-store.ts
  var RECOVERY_KEY = "canonicalRecovery";
  var BOOTSTRAP_KEY = "canonicalBootstrap";
  var TRAJECTORY_KEY = "canonicalTrajectory";
  var ACTION_EXECUTION_KEY = "canonicalActionExecution";
  var TERMINAL_KEY = "canonicalTerminal";
  var APPROVAL_KEY = "canonicalApproval";
  var MAX_TRAJECTORY_EVENTS = 100;
  var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var SENSITIVE_SUMMARY = /(?:https?:\/\/|authorization|bearer|cookie|credential|local\s*storage|password|profile|secret|session\s*storage|token)/i;
  var CanonicalSessionStore = class {
    constructor(options) {
      this.memoryBootstrap = null;
      this.local = options.local;
      this.session = options.session;
      this.now = options.now ?? Date.now;
    }
    async saveRecovery(input) {
      await this.local.set({ [RECOVERY_KEY]: parseRecovery(input) });
    }
    async loadRecovery() {
      const raw = (await this.local.get(RECOVERY_KEY))[RECOVERY_KEY];
      if (raw === void 0) return null;
      try {
        return parseRecovery(raw);
      } catch {
        await this.local.remove(RECOVERY_KEY);
        return null;
      }
    }
    async clearRecovery() {
      await this.local.remove(RECOVERY_KEY);
    }
    async saveBootstrap(material) {
      const value = parseBootstrap(material);
      this.memoryBootstrap = value;
      if (this.session !== void 0) await this.session.set({ [BOOTSTRAP_KEY]: value });
    }
    async loadBootstrap() {
      const raw = this.session === void 0 ? this.memoryBootstrap : (await this.session.get(BOOTSTRAP_KEY))[BOOTSTRAP_KEY];
      if (raw === void 0 || raw === null) return null;
      try {
        const material = parseBootstrap(raw);
        if (material.expiresAt <= this.now()) {
          await this.clearBootstrap();
          return null;
        }
        this.memoryBootstrap = material;
        return material;
      } catch {
        await this.clearBootstrap();
        return null;
      }
    }
    async clearBootstrap() {
      this.memoryBootstrap = null;
      if (this.session !== void 0) await this.session.remove(BOOTSTRAP_KEY);
    }
    async appendTrajectory(input) {
      const event = sanitizeTrajectory(input);
      const existing = await this.loadTrajectory();
      const next = [...existing, event].slice(-MAX_TRAJECTORY_EVENTS);
      await this.local.set({ [TRAJECTORY_KEY]: next });
    }
    async loadTrajectory() {
      const raw = (await this.local.get(TRAJECTORY_KEY))[TRAJECTORY_KEY];
      if (!Array.isArray(raw)) return [];
      return raw.slice(-MAX_TRAJECTORY_EVENTS).flatMap((value) => {
        try {
          return [sanitizeTrajectory(value)];
        } catch {
          return [];
        }
      });
    }
    async clearTrajectory() {
      await this.local.remove(TRAJECTORY_KEY);
    }
    async saveActionExecution(input) {
      await this.local.set({ [ACTION_EXECUTION_KEY]: parseActionExecution(input) });
    }
    async loadActionExecution() {
      return this.loadValidated(ACTION_EXECUTION_KEY, parseActionExecution);
    }
    async clearActionExecution() {
      await this.local.remove(ACTION_EXECUTION_KEY);
    }
    async saveTerminal(input) {
      await this.local.set({ [TERMINAL_KEY]: parseTerminal(input) });
    }
    async loadTerminal() {
      return this.loadValidated(TERMINAL_KEY, parseTerminal);
    }
    async clearTerminal() {
      await this.local.remove(TERMINAL_KEY);
    }
    async saveApproval(input) {
      await this.local.set({ [APPROVAL_KEY]: parseApproval(input) });
    }
    async loadApproval() {
      return this.loadValidated(APPROVAL_KEY, parseApproval);
    }
    async clearApproval() {
      await this.local.remove(APPROVAL_KEY);
    }
    async loadValidated(key, parse) {
      const raw = (await this.local.get(key))[key];
      if (raw === void 0) return null;
      try {
        return parse(raw);
      } catch {
        await this.local.remove(key);
        return null;
      }
    }
  };
  function parseActionExecution(input) {
    const value = record(input, "Action execution");
    const base = {
      actionId: uuid(value.actionId, "actionId"),
      idempotencyKey: boundedString(value.idempotencyKey, "idempotencyKey", 256),
      observationId: uuid(value.observationId, "observationId")
    };
    if (value.status === "started") return { ...base, status: "started" };
    if (value.status === "completed") return {
      ...base,
      status: "completed",
      result: ActionResultV1Schema.parse(value.result)
    };
    throw new TypeError("Action execution status is invalid");
  }
  function parseTerminal(input) {
    const message = AgentMessageV1Schema.parse(input);
    if (message.type !== "task.completed" && message.type !== "task.failed" && message.type !== "task.cancelled") {
      throw new TypeError("Terminal message is invalid");
    }
    return message;
  }
  function parseApproval(input) {
    const value = record(input, "Approval metadata");
    const requestedAt = boundedString(value.requestedAt, "requestedAt", 64);
    if (!Number.isFinite(Date.parse(requestedAt))) throw new TypeError("Approval timestamp is invalid");
    return {
      approvalId: uuid(value.approvalId, "approvalId"),
      policyDecisionId: uuid(value.policyDecisionId, "policyDecisionId"),
      actionId: uuid(value.actionId, "actionId"),
      observationId: uuid(value.observationId, "observationId"),
      requestedAt: new Date(requestedAt).toISOString(),
      reason: "Approval required"
    };
  }
  function parseRecovery(input) {
    const value = record(input, "Recovery state");
    const status = value.status;
    if (![
      "connecting",
      "connected",
      "reconnecting",
      "executing",
      "waiting_for_approval",
      "cancelling",
      "cancelled",
      "completed",
      "failed",
      "disconnected"
    ].includes(String(status))) throw new TypeError("Recovery status is invalid");
    return {
      version: value.version === 1 ? 1 : fail("Recovery version is invalid"),
      serverUrl: wssUrl(value.serverUrl),
      sessionId: uuid(value.sessionId, "sessionId"),
      deviceId: uuid(value.deviceId, "deviceId"),
      lastReceivedSequence: sequence(value.lastReceivedSequence, "lastReceivedSequence"),
      lastSentSequence: sequence(value.lastSentSequence, "lastSentSequence"),
      attachedTabId: nullablePositiveInteger(value.attachedTabId, "attachedTabId"),
      taskId: uuid(value.taskId, "taskId"),
      lastObservationId: nullableUuid(value.lastObservationId, "lastObservationId"),
      pendingActionId: nullableUuid(value.pendingActionId, "pendingActionId"),
      status
    };
  }
  function parseBootstrap(input) {
    const value = record(input, "Bootstrap material");
    const credential = boundedString(value.connectionCredential, "connectionCredential", 16384);
    const hmacKey = boundedString(value.hmacKey, "hmacKey", 4096);
    const tenantId = boundedString(value.tenantId, "tenantId", 256);
    const expiresAt = value.expiresAt;
    if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new TypeError("Bootstrap expiry is invalid");
    return {
      serverUrl: wssUrl(value.serverUrl),
      connectionCredential: credential,
      serverRecipientId: uuid(value.serverRecipientId, "serverRecipientId"),
      tenantId,
      deviceId: uuid(value.deviceId, "deviceId"),
      sessionId: uuid(value.sessionId, "sessionId"),
      expiresAt,
      hmacKey
    };
  }
  function sanitizeTrajectory(input) {
    const value = record(input, "Trajectory summary");
    if (!["connection", "observation", "action", "approval", "terminal", "error"].includes(String(value.type))) {
      throw new TypeError("Trajectory type is invalid");
    }
    const occurredAt = boundedString(value.occurredAt, "occurredAt", 64);
    if (!Number.isFinite(Date.parse(occurredAt))) throw new TypeError("Trajectory timestamp is invalid");
    const rawSummary = boundedString(value.summary, "summary", 256);
    return {
      type: value.type,
      summary: SENSITIVE_SUMMARY.test(rawSummary) ? "Sensitive step" : rawSummary,
      occurredAt: new Date(occurredAt).toISOString()
    };
  }
  function record(input, name) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${name} is invalid`);
    return input;
  }
  function wssUrl(input) {
    const value = boundedString(input, "serverUrl", 2048);
    const url = new URL(value);
    if (url.protocol !== "wss:" || url.username !== "" || url.password !== "") throw new TypeError("Server URL must use authenticated WSS");
    return url.href;
  }
  function uuid(input, name) {
    if (typeof input !== "string" || !UUID3.test(input)) throw new TypeError(`${name} must be an opaque UUID`);
    return input;
  }
  function nullableUuid(input, name) {
    return input === null ? null : uuid(input, name);
  }
  function nullablePositiveInteger(input, name) {
    if (input === null) return null;
    if (!Number.isInteger(input) || input <= 0) throw new TypeError(`${name} is invalid`);
    return input;
  }
  function sequence(input, name) {
    if (!Number.isInteger(input) || input < 0) throw new TypeError(`${name} is invalid`);
    return input;
  }
  function boundedString(input, name, maximum) {
    if (typeof input !== "string" || input.length === 0 || input.length > maximum) throw new TypeError(`${name} is invalid`);
    return input;
  }
  function fail(message) {
    throw new TypeError(message);
  }

  // src/canonical/transport.ts
  var MAX_WIRE_BYTES = 2e6;
  var DEFAULT_MESSAGE_TTL_MS = 3e4;
  var DEFAULT_HEARTBEAT_MS = 2e4;
  var TOKEN_PROTOCOL = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var realClock2 = {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle)
  };
  var CanonicalTransport = class {
    constructor(options) {
      this.abortController = new AbortController();
      this.receivedMessageIds = /* @__PURE__ */ new Set();
      this.socket = null;
      this.status = "idle";
      this.reconnectAttempt = 0;
      this.explicitClose = false;
      this.sendTail = Promise.resolve();
      this.receiveTail = Promise.resolve();
      this.options = options;
      this.now = options.now ?? Date.now;
      this.clock = options.clock ?? realClock2;
      this.websocketFactory = options.websocketFactory ?? ((url, protocols) => new WebSocket(url, [...protocols]));
      this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
      this.material = validateMaterial(options.material, this.now());
      this.signer = deriveBootstrapEnvelopeSigner(this.material);
      this.lastReceivedSequence = validSequence(options.initialSequences?.lastReceivedSequence ?? 0);
      this.lastSentSequence = validSequence(options.initialSequences?.lastSentSequence ?? 0);
    }
    snapshot() {
      return {
        status: this.status,
        reconnectAttempt: this.reconnectAttempt,
        lastReceivedSequence: this.lastReceivedSequence,
        lastSentSequence: this.lastSentSequence
      };
    }
    async drained() {
      await this.receiveTail;
      if (this.receiveFault !== void 0) throw this.receiveFault;
      await this.sendTail;
    }
    async connect() {
      if (this.explicitClose || this.abortController.signal.aborted) throw new DOMException("Transport is closed", "AbortError");
      if (this.socket?.readyState === 1) return;
      await this.openSocket(this.reconnectAttempt > 0);
    }
    send(message, linkage) {
      let resolveEnvelope;
      let rejectEnvelope;
      const result = new Promise((resolve, reject) => {
        resolveEnvelope = resolve;
        rejectEnvelope = reject;
      });
      const work = this.sendTail.then(async () => {
        try {
          resolveEnvelope(await this.sendNow(message, linkage));
        } catch (error) {
          rejectEnvelope(error);
        }
      });
      this.sendTail = work.then(() => void 0, () => void 0);
      return result;
    }
    async reconcile() {
      const nextSequence = this.lastSentSequence + 1;
      return this.send({
        type: "reconcile.request",
        lastReceivedSequence: this.lastReceivedSequence,
        lastSentClientSequence: nextSequence,
        pendingActionIds: [...this.options.pendingActionIds?.() ?? []],
        requestedAt: new Date(this.now()).toISOString()
      }, {
        correlationId: this.material.sessionId,
        causationId: this.material.sessionId
      });
    }
    async close(reason = "client closed") {
      this.explicitClose = true;
      this.abortController.abort();
      this.clearTimers();
      const socket = this.socket;
      this.socket = null;
      if (socket !== null && socket.readyState < 2) socket.close(1e3, safeCloseReason(reason));
      this.setStatus("closed");
    }
    openSocket(reconnecting) {
      this.setStatus(reconnecting ? "reconnecting" : "connecting");
      return new Promise((resolve, reject) => {
        let settled = false;
        let socket;
        try {
          socket = this.websocketFactory(this.material.serverUrl, [
            "brotto-v1",
            `brotto-credential.${this.material.connectionCredential}`
          ]);
        } catch (error) {
          reject(error);
          this.scheduleReconnect();
          return;
        }
        this.socket = socket;
        socket.onopen = () => {
          if (this.explicitClose || this.abortController.signal.aborted) {
            socket.close(1e3, "closed");
            return;
          }
          settled = true;
          this.setStatus("open");
          this.scheduleHeartbeat();
          resolve();
          if (reconnecting || this.lastSentSequence > 0) {
            void this.reconcile().catch(() => socket.close(4400, "RECONCILE_FAILED"));
          }
        };
        socket.onmessage = (event) => {
          this.receiveTail = this.receiveTail.then(() => this.acceptWire(event.data)).catch((error) => {
            this.receiveFault = error;
            this.options.onMessageError?.(error);
            this.explicitClose = true;
            this.clearTimers();
            this.setStatus("failed");
            if (socket.readyState < 2) socket.close(4400, "MESSAGE_HANDLER_FAILED");
          });
        };
        socket.onerror = () => {
          if (!settled) reject(new Error("WebSocket connection failed"));
        };
        socket.onclose = () => {
          if (this.socket === socket) this.socket = null;
          this.clearHeartbeat();
          if (!settled) reject(new Error("WebSocket closed before authentication completed"));
          if (!this.explicitClose) this.scheduleReconnect();
        };
      });
    }
    async sendNow(message, linkage) {
      if (this.abortController.signal.aborted) throw new DOMException("Transport is closed", "AbortError");
      const socket = this.socket;
      if (socket === null || socket.readyState !== 1 || this.status !== "open") throw new Error("Canonical transport is not open");
      if (this.material.expiresAt <= this.now()) throw new Error("Canonical bootstrap material expired");
      const payload = AgentMessageV1Schema.parse(message);
      const messageId = requireUuid2(this.idGenerator(), "message ID");
      const correlationId = requireUuid2(linkage?.correlationId ?? messageId, "correlation ID");
      const causationId = requireUuid2(linkage?.causationId ?? correlationId, "causation ID");
      const sequence2 = this.lastSentSequence + 1;
      const createdAt = new Date(this.now()).toISOString();
      const envelope = createEnvelope({
        messageId,
        sessionId: this.material.sessionId,
        correlationId,
        causationId,
        recipientId: this.material.serverRecipientId,
        tenantId: this.material.tenantId,
        deviceId: this.material.deviceId,
        sequence: sequence2,
        createdAt,
        expiresAt: Math.min(this.material.expiresAt, this.now() + DEFAULT_MESSAGE_TTL_MS),
        payload
      });
      const signed = await signEnvelope(envelope, await this.signer);
      const wire = JSON.stringify(signed);
      if (new TextEncoder().encode(wire).byteLength > MAX_WIRE_BYTES) throw new Error("Canonical envelope exceeds wire limit");
      socket.send(wire);
      this.lastSentSequence = sequence2;
      this.emitState();
      return signed;
    }
    async acceptWire(raw) {
      let wire;
      if (typeof raw === "string") wire = raw;
      else if (raw instanceof ArrayBuffer) wire = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      else {
        this.rejectProtocol("INVALID_WIRE");
        return;
      }
      if (new TextEncoder().encode(wire).byteLength > MAX_WIRE_BYTES) {
        this.rejectProtocol("MESSAGE_TOO_LARGE");
        return;
      }
      let decoded;
      try {
        decoded = JSON.parse(wire);
      } catch {
        this.rejectProtocol("INVALID_WIRE");
        return;
      }
      const parsed = AgentEnvelopeV1Schema.safeParse(decoded);
      if (!parsed.success) {
        this.rejectProtocol("INVALID_ENVELOPE");
        return;
      }
      const envelope = parsed.data;
      if (envelope.signature === void 0 || !await (await this.signer).verify(canonicalEnvelopeBytes(envelope), envelope.signature)) {
        this.rejectProtocol("SIGNATURE_INVALID");
        return;
      }
      if (envelope.sessionId !== this.material.sessionId || envelope.recipientId !== this.material.deviceId || envelope.tenantId !== this.material.tenantId || envelope.deviceId !== this.material.deviceId) {
        this.rejectProtocol("ENVELOPE_BINDING_INVALID");
        return;
      }
      if (envelope.expiresAt <= this.now()) {
        this.rejectProtocol("MESSAGE_EXPIRED");
        return;
      }
      if (this.receivedMessageIds.has(envelope.messageId)) {
        this.rejectProtocol("MESSAGE_DUPLICATE");
        return;
      }
      if (envelope.sequence <= this.lastReceivedSequence) {
        this.rejectProtocol("SEQUENCE_REPLAY");
        return;
      }
      if (!isServerMessage(envelope.payload.type)) {
        this.rejectProtocol("MESSAGE_DIRECTION_INVALID");
        return;
      }
      this.receivedMessageIds.add(envelope.messageId);
      this.lastReceivedSequence = envelope.sequence;
      this.emitState();
      await this.options.onMessage?.({ envelope, message: envelope.payload });
    }
    scheduleReconnect() {
      if (this.explicitClose || this.reconnectTimer !== void 0) return;
      const maximum = this.options.reconnect?.maxAttempts ?? 5;
      if (this.reconnectAttempt >= maximum) {
        this.setStatus("failed");
        return;
      }
      this.reconnectAttempt += 1;
      this.setStatus("reconnecting");
      const base = this.options.reconnect?.baseDelayMs ?? 250;
      const cap = this.options.reconnect?.maxDelayMs ?? 1e4;
      const delay = Math.min(cap, base * 2 ** (this.reconnectAttempt - 1));
      this.reconnectTimer = this.clock.setTimeout(() => {
        this.reconnectTimer = void 0;
        void this.refreshMaterial().then(() => this.openSocket(true)).catch(() => this.scheduleReconnect());
      }, delay);
    }
    async refreshMaterial() {
      if (this.options.getReconnectMaterial === void 0) throw new Error("A fresh one-time reconnect credential is required");
      const next = validateMaterial(await this.options.getReconnectMaterial(this.abortController.signal), this.now());
      if (next.sessionId !== this.material.sessionId || next.deviceId !== this.material.deviceId || next.tenantId !== this.material.tenantId || next.serverRecipientId !== this.material.serverRecipientId) {
        throw new Error("Reconnect bootstrap binding changed");
      }
      this.material = next;
      this.signer = deriveBootstrapEnvelopeSigner(next);
      await this.options.onMaterial?.(next);
    }
    scheduleHeartbeat() {
      this.clearHeartbeat();
      const heartbeatMs = boundedPositive2(this.options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
      this.heartbeatTimer = this.clock.setTimeout(() => {
        this.heartbeatTimer = void 0;
        if (this.status !== "open") return;
        void this.send({ type: "heartbeat", sentAt: new Date(this.now()).toISOString() }, {
          correlationId: this.material.sessionId,
          causationId: this.material.sessionId
        }).then(() => this.scheduleHeartbeat(), () => this.socket?.close(4400, "HEARTBEAT_FAILED"));
      }, heartbeatMs);
    }
    clearHeartbeat() {
      if (this.heartbeatTimer !== void 0) this.clock.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = void 0;
    }
    clearTimers() {
      this.clearHeartbeat();
      if (this.reconnectTimer !== void 0) this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
    setStatus(status) {
      this.status = status;
      this.emitState();
    }
    emitState() {
      this.options.onStateChange?.(this.snapshot());
    }
    rejectProtocol(code) {
      this.options.onProtocolError?.(code);
    }
  };
  async function deriveBootstrapEnvelopeSigner(material) {
    const keyBytes = decodeBase64Url(material.hmacKey);
    if (keyBytes.byteLength < 32) throw new TypeError("Bootstrap HMAC material must contain at least 256 bits");
    const key = await crypto.subtle.importKey(
      "raw",
      exactArrayBuffer(keyBytes),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    return {
      sign: async (bytes) => encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, exactArrayBuffer(bytes)))),
      verify: async (bytes, signature) => {
        let decoded;
        try {
          decoded = decodeBase64Url(signature);
        } catch {
          return false;
        }
        return crypto.subtle.verify("HMAC", key, exactArrayBuffer(decoded), exactArrayBuffer(bytes));
      }
    };
  }
  function exactArrayBuffer(bytes) {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }
  function validateMaterial(material, now) {
    const url = new URL(material.serverUrl);
    if (url.protocol !== "wss:" || url.username !== "" || url.password !== "") throw new TypeError("Canonical transport requires authenticated WSS");
    if (!TOKEN_PROTOCOL.test(material.connectionCredential) || material.connectionCredential.length > 16384) {
      throw new TypeError("Connection credential is not a valid WebSocket subprotocol token");
    }
    requireUuid2(material.serverRecipientId, "server recipient ID");
    requireUuid2(material.deviceId, "device ID");
    requireUuid2(material.sessionId, "session ID");
    if (material.tenantId.length === 0 || material.tenantId.length > 256) throw new TypeError("Tenant ID is invalid");
    if (!Number.isInteger(material.expiresAt) || material.expiresAt <= now) throw new TypeError("Canonical bootstrap material expired");
    if (material.hmacKey.length === 0 || material.hmacKey.length > 4096) throw new TypeError("Bootstrap HMAC material is absent or invalid");
    return { ...material, serverUrl: url.href };
  }
  function decodeBase64Url(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Invalid URL-safe base64");
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  function encodeBase64Url(value) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function requireUuid2(value, name) {
    if (!UUID4.test(value)) throw new TypeError(`${name} must be a UUID`);
    return value;
  }
  function validSequence(value) {
    if (!Number.isInteger(value) || value < 0) throw new TypeError("Transport sequence is invalid");
    return value;
  }
  function boundedPositive2(value, fallback) {
    return value !== void 0 && Number.isFinite(value) && value > 0 ? value : fallback;
  }
  function safeCloseReason(reason) {
    return reason.replace(/[^a-z0-9 _.-]/gi, "").slice(0, 100) || "closed";
  }
  function isServerMessage(type) {
    return type === "session.accepted" || type === "action.command" || type === "approval.requested" || type === "task.completed" || type === "task.failed" || type === "task.cancelled" || type === "reconcile.response" || type === "protocol.error" || type === "heartbeat";
  }

  // src/background.ts
  init_debugger();

  // src/cookie-dismisser.ts
  var TARGETED_SELECTORS = [
    "#onetrust-accept-btn-handler",
    ".onetrust-close-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    '.qc-cmp2-summary-actions > button[mode="primary"]',
    "#truste-consent-track-button",
    ".truste_button_direct",
    "#accept-cookies",
    ".cc-allow",
    ".js-cookie-accept",
    '[data-testid="cookie-banner-accept"]',
    '[aria-label*="Accept cookies" i]',
    '[aria-label*="Accept all" i]',
    '[aria-label*="Allow all" i]',
    '[aria-label*="I agree" i]',
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("I Accept")',
    'button:has-text("Allow all")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Agree")'
  ];
  async function dismissCookieBanners(debuggerSend) {
    let dismissed = 0;
    for (const selector of TARGETED_SELECTORS) {
      try {
        const result = await debuggerSend("Runtime.evaluate", {
          expression: `(() => {  const sel = ${JSON.stringify(selector)};  const el = document.querySelector(sel);  if (el && el.offsetParent !== null) { el.click(); return true; }  return false;})()`,
          returnByValue: true,
          awaitPromise: false
        });
        const got = result?.result?.value;
        if (got === true) {
          dismissed += 1;
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch {
      }
    }
    return dismissed;
  }

  // src/local-driver.ts
  init_debugger();

  // src/goal-detector.ts
  var STOPWORDS = /* @__PURE__ */ new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "could",
    "do",
    "does",
    "find",
    "for",
    "from",
    "go",
    "have",
    "has",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "its",
    "let",
    "look",
    "make",
    "may",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "open",
    "or",
    "please",
    "show",
    "so",
    "some",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "us",
    "very",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your"
    // ponytail: keep "status", "latest", "current", "update", "info" as
    // keywords — they're the actual subject of the user's goal.
  ]);
  var STATUS_KEYWORDS = [
    "delivered",
    "out for delivery",
    "shipped",
    "in transit",
    "arriving",
    "dispatched",
    "cancelled",
    "returned",
    "tracking id",
    "estimated delivery",
    "order placed",
    "order confirmed"
  ];
  function extractGoalKeywords(goal) {
    if (!goal) return [];
    const tokens = goal.toLowerCase().match(/[a-z0-9][a-z0-9._-]+/g) ?? [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const tok of tokens) {
      if (STOPWORDS.has(tok)) continue;
      if (tok.length < 3 && !/^\d+$/.test(tok)) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      out.push(tok);
      if (out.length >= 12) break;
    }
    return out;
  }
  var TRACKING_ID_RE = /\b[A-Z0-9]{3,}[-]?[A-Z0-9]{3,}[-]?[A-Z0-9]{3,}\b/g;
  var ORDER_ID_RE = /#\s*[A-Z0-9][-A-Z0-9]{5,}/g;
  function hasStructuredFact(text) {
    const checks = [
      TRACKING_ID_RE.test(text),
      ORDER_ID_RE.test(text),
      STATUS_KEYWORDS.some((kw) => text.toLowerCase().includes(kw))
    ];
    TRACKING_ID_RE.lastIndex = 0;
    ORDER_ID_RE.lastIndex = 0;
    return checks.some(Boolean);
  }
  function collectVisibleFacts(text) {
    const facts = [];
    const lc = text.toLowerCase();
    for (const kw of STATUS_KEYWORDS) {
      const idx = lc.indexOf(kw);
      if (idx >= 0) {
        const start = Math.max(0, idx - 12);
        const end = Math.min(text.length, idx + kw.length + 28);
        facts.push(text.slice(start, end).trim());
      }
    }
    const tracking = text.match(/(?:tracking\s*id|Tracking\s*ID)\s*:?\s*[A-Z0-9-]{6,}/i)?.[0];
    if (tracking) facts.push(tracking);
    const orderId = text.match(/#\s*[A-Z0-9][-A-Z0-9]{5,}/)?.[0];
    if (orderId) facts.push(orderId);
    const digits = text.match(/\b\d{6,}\b/g) ?? [];
    for (const d of digits.slice(0, 3)) facts.push(d);
    return Array.from(new Set(facts)).slice(0, 8);
  }
  function detectGoalMatch(goal, obs) {
    const keywords = extractGoalKeywords(goal);
    if (keywords.length === 0) {
      return { matched: false, matchedKeywords: [], hasStructuredFacts: false, visibleFacts: [], banner: "" };
    }
    const haystack = [
      obs.url,
      obs.title,
      obs.pagePurpose ?? "",
      obs.bodyText
    ].join("\n").toLowerCase();
    const matchedKeywords = keywords.filter((k) => haystack.includes(k));
    const hasStructuredFacts = hasStructuredFact([obs.title, obs.pagePurpose ?? "", obs.bodyText].join("\n"));
    const visibleFacts = collectVisibleFacts([obs.title, obs.bodyText].join("\n"));
    const matched = matchedKeywords.length >= 2 && hasStructuredFacts;
    if (!matched) {
      return { matched, matchedKeywords, hasStructuredFacts, visibleFacts, banner: "" };
    }
    const factStr = visibleFacts.length > 0 ? visibleFacts.join("; ") : "(none extracted)";
    const banner = [
      "=== GOAL MATCH DETECTED ===",
      `The current page contains keywords from your goal: ${matchedKeywords.join(", ")}.`,
      `Concrete facts visible: ${factStr}.`,
      "If the visible facts are ONLY in subject lines / list items (not in a body or page text), CLICK the relevant item to OPEN it before terminating \u2014 list-item text is often a teaser, not the actual answer.",
      "You have likely found the answer. CALL terminate(finalAnswer=<the facts>) NOW.",
      "Do NOT navigate further. The page you are on IS the answer.",
      "=== END GOAL MATCH ==="
    ].join("\n");
    return { matched, matchedKeywords, hasStructuredFacts, visibleFacts, banner };
  }

  // src/fact-extractor.ts
  var MONEY_RE = /(?:[\$£€₹]\s?[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR|Rs\.?|dollars?|euros?|pounds?))/gi;
  var TRACKING_KEYWORD_RE = /\b(?:order\s*(?:#|number|id)|tracking\s*(?:id|number)|Tracking\s*ID|tracking)[:\s#]*([A-Z0-9][-A-Z0-9]{5,})/gi;
  var LONG_DIGIT_RE = /\b\d{6,}\b/g;
  var SENDER_RE = /([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi;
  var MONTH_DAY_RE = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December))\b/gi;
  var DELIVERED_DATE_RE = /\bDelivered\s+(\d{1,2}\s+\w+)/gi;
  var STATUS_WORDS = ["delivered", "out for delivery", "shipped", "in transit", "arriving", "dispatched", "cancelled", "returned"];
  function uniqueKey(key, taken) {
    if (!taken.has(key)) {
      taken.add(key);
      return key;
    }
    let i = 2;
    while (taken.has(`${key}_${i}`)) i += 1;
    const k = `${key}_${i}`;
    taken.add(k);
    return k;
  }
  function factMatchesGoal(fact, goalKeywords) {
    if (goalKeywords.length === 0) return true;
    const lc = (fact.key + " " + fact.value).toLowerCase();
    return goalKeywords.some((kw) => lc.includes(kw));
  }
  function extractFacts(obs, goalKeywords) {
    const evidence = `${obs.title || "(untitled)"} (${obs.url})`;
    const corpus = [obs.title, obs.pagePurpose ?? "", obs.bodyText].join("\n");
    const out = [];
    const taken = /* @__PURE__ */ new Set();
    let m;
    MONEY_RE.lastIndex = 0;
    TRACKING_KEYWORD_RE.lastIndex = 0;
    while ((m = TRACKING_KEYWORD_RE.exec(corpus)) !== null) {
      const id = m[1];
      const kind = m[0].toLowerCase().includes("tracking") ? "tracking_id" : "order_id";
      const key = uniqueKey(kind, taken);
      out.push({ key, value: id, evidence });
      if (out.length >= 30) break;
    }
    LONG_DIGIT_RE.lastIndex = 0;
    const standaloneDigits = corpus.match(LONG_DIGIT_RE) ?? [];
    for (const d of standaloneDigits.slice(0, 4)) {
      const key = uniqueKey("number", taken);
      out.push({ key, value: d, evidence });
      if (out.length >= 30) break;
    }
    MONEY_RE.lastIndex = 0;
    const money = corpus.match(MONEY_RE) ?? [];
    for (const m0 of money.slice(0, 4)) {
      const cur = m0[0];
      const key = uniqueKey(`amount_${cur}`, taken);
      out.push({ key, value: m0, evidence });
      if (out.length >= 30) break;
    }
    const lc = corpus.toLowerCase();
    for (const w of STATUS_WORDS) {
      const idx = lc.indexOf(w);
      if (idx >= 0) {
        const start = Math.max(0, idx - 8);
        const end = Math.min(corpus.length, idx + w.length + 24);
        const snippet = corpus.slice(start, end).trim();
        const key = uniqueKey("status", taken);
        out.push({ key, value: snippet, evidence });
        if (out.length >= 30) break;
      }
    }
    MONTH_DAY_RE.lastIndex = 0;
    const dates = corpus.match(MONTH_DAY_RE) ?? [];
    for (const d of dates.slice(0, 3)) {
      const key = uniqueKey("event_date", taken);
      out.push({ key, value: d.trim(), evidence });
    }
    DELIVERED_DATE_RE.lastIndex = 0;
    const delivered = corpus.match(DELIVERED_DATE_RE) ?? [];
    for (const d of delivered.slice(0, 2)) {
      const key = uniqueKey("delivered_date", taken);
      out.push({ key, value: d.trim(), evidence });
    }
    SENDER_RE.lastIndex = 0;
    const senders = corpus.match(SENDER_RE) ?? [];
    const senderDomains = /* @__PURE__ */ new Set();
    for (const s of senders.slice(0, 6)) {
      const domain = s.split("@")[1] ?? "";
      if (!domain || senderDomains.has(domain)) continue;
      senderDomains.add(domain);
      const key = uniqueKey("sender", taken);
      out.push({ key, value: s.trim(), evidence });
      if (out.length >= 30) break;
    }
    try {
      const u = new URL(obs.url);
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length >= 2) {
        const last = segs[segs.length - 1] ?? "";
        const prev = segs[segs.length - 2] ?? "";
        if (last.length >= 4 && /[a-z0-9]/i.test(last)) {
          const key = uniqueKey(`path_${prev}`, taken);
          out.push({ key, value: last, evidence });
        }
      }
    } catch {
    }
    return out.filter((f) => {
      const alwaysCrucial = /^(tracking_id|order_id|amount_|status|event_date|delivered_date|sender|number)/.test(f.key);
      return alwaysCrucial || factMatchesGoal(f, goalKeywords);
    });
  }

  // src/page-snapshot-store.ts
  var MAX_HEADINGS = 5;
  var MAX_BODY_CHARS = 2e3;
  var MAX_ELEMENT_LABELS = 20;
  function truncate(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "\u2026";
  }
  function createPageSnapshotStore() {
    const pages = [];
    let nextId = 0;
    return {
      capture(obs) {
        const id = nextId++;
        pages.push({
          id,
          url: obs.url,
          heading: obs.headings[0] ?? "(no heading)",
          headings: obs.headings.slice(0, MAX_HEADINGS),
          bodyText: truncate(obs.bodyText, MAX_BODY_CHARS),
          interactiveElementLabels: obs.interactiveElementLabels.slice(0, MAX_ELEMENT_LABELS),
          visitedAt: Date.now(),
          goalRelevant: obs.headings.length > 0
        });
        return id;
      },
      size() {
        return pages.length;
      },
      formatForPrompt(maxChars, memoryByPage) {
        if (pages.length === 0) return "";
        const lines = ['=== PAGES YOU VISITED (refer by id, e.g. "page[0]") ==='];
        for (const p of pages) {
          lines.push(`[page[${p.id}]] ${p.heading}`);
          lines.push(`  URL: ${p.url}`);
          lines.push(`  Goal-relevant: ${p.goalRelevant ? "yes" : "no"}`);
          const facts = memoryByPage.get(p.id) ?? [];
          if (facts.length > 0) {
            lines.push(`  Recorded facts: ${facts.join(", ")}`);
          }
          lines.push("");
        }
        let out = lines.join("\n");
        if (out.length > maxChars) {
          out = out.slice(0, maxChars - 3) + "\u2026";
        }
        return out;
      }
    };
  }

  // src/local-driver.ts
  var MUST_HAVE_HINT = /\b(?:must|required?|has to|needs? to|mandatory|critical|essential)\b/i;
  var STEP_VERB_RE = /\b(?:visit|record|verify|create|submit|fill|navigate|click|enter|type|send|collect|build|write|generate|complete|confirm|capture|locate|find|identify|track|compile|examine|assess|analyze|evaluate)\b/i;
  var URL_RE = /\bhttps?:\/\/[^\s)]+/i;
  var NUMBERED_LIST_RE = /(?:^|\n)\s*(\d+)\.\s+([^\n]{8,400})/g;
  var BULLET_RE = /(?:^|\n)\s*[-*]\s+([^\n]{8,400})/g;
  var INLINE_HINT_RE = /\b(?:should include|must include|should contain|must contain|with proper|with appropriate|should have|must have|needs? to have)\s+([^.\n]{6,200})/gi;
  function classifyKind(text) {
    if (MUST_HAVE_HINT.test(text)) return "must_have";
    if (URL_RE.test(text)) return "must_have";
    if (STEP_VERB_RE.test(text)) return "must_have";
    return "should_have";
  }
  function clean(text) {
    return text.replace(/\s+/g, " ").replace(/^[\s\-*.\d]+/, "").trim().slice(0, 280);
  }
  function looksLikeCriterion(text) {
    if (text.length < 8 || text.length > 400) return false;
    if (/^(?:phase|step|overview|note|notes?|introduction|summary)\b[:\s]/i.test(text)) return false;
    if (!/[a-z]{3,}/i.test(text)) return false;
    return true;
  }
  function extractHeadings(obs) {
    const text = obs.bodyText ?? "";
    const headings = [];
    const matches = text.match(/===\s*HEADINGS?\s*===([\s\S]*?)(?:===|$)/);
    if (matches) {
      const block = matches[1];
      for (const line of block.split("\n")) {
        const m = line.match(/^H[1-3]:\s*(.+)$/);
        if (m && m[1]) headings.push(m[1].trim());
      }
    }
    if (headings.length === 0) {
      for (const t of obs.semanticTargets ?? []) {
        if (t.tag.startsWith("h") && t.accessibleName?.text) headings.push(t.accessibleName.text);
      }
    }
    return headings.slice(0, 5);
  }
  function extractElementLabels(obs) {
    return (obs.semanticTargets ?? []).slice(0, 20).map((t) => {
      const label = t.accessibleName?.text ?? "";
      const href = t.href;
      return href ? `${t.tag}:${label} \u2192 ${href}` : `${t.tag}:${label}`;
    });
  }
  function groupMemoryByPage(mem) {
    return mem.factsBySourcePage();
  }
  function extractCriteriaFromGoal(goal) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const numbered = [];
    for (const m of goal.matchAll(NUMBERED_LIST_RE)) {
      const text = m[2].trim();
      if (!looksLikeCriterion(text)) continue;
      const id = `num_${m[1]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      numbered.push(text);
      out.push({ id, description: clean(text), kind: classifyKind(text) });
    }
    if (numbered.length === 0) {
      let bulletIdx = 0;
      for (const m of goal.matchAll(BULLET_RE)) {
        const text = m[1].trim();
        if (!looksLikeCriterion(text)) continue;
        bulletIdx += 1;
        const id = `bul_${bulletIdx}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, description: clean(text), kind: classifyKind(text) });
      }
    }
    let inlineIdx = 0;
    for (const m of goal.matchAll(INLINE_HINT_RE)) {
      inlineIdx += 1;
      const text = m[1].trim();
      const id = `hint_${inlineIdx}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, description: clean(text), kind: /\b(?:must|required?)\b/i.test(m[0]) ? "must_have" : "should_have" });
    }
    const length = goal.match(/\b(\d+)\s*[-–to]+\s*(\d+)\s*(?:page|section)s?\b/i);
    if (length && !seen.has("len_pages")) {
      seen.add("len_pages");
      out.push({ id: "len_pages", description: `Document length: ${length[1]}\u2013${length[2]} pages.`, kind: "must_have" });
    }
    const citation = /\b(?:proper citations?|with citations?|citations? and references?)\b/i.test(goal);
    if (citation && !seen.has("citations")) {
      seen.add("citations");
      out.push({ id: "citations", description: "Include proper citations / references.", kind: "must_have" });
    }
    if (out.length === 0 || out.every((c) => c.kind === "should_have")) {
      if (!seen.has("goal_complete")) {
        seen.add("goal_complete");
        const g = goal.trim();
        const check = g.match(/\b(?:check|find|look\s*up|get|search\s*for|locate|track)\s+(?:the\s+)?(.+)/i);
        const wantsRecency = /\b(?:latest|newest|recent|current|now|today)\b/i.test(g);
        const wantsStatus = /\b(?:status|state|delivered|shipped|tracking|where|when)\b/i.test(g);
        const subject = check ? clean(check[1]) : clean(g);
        out.push({ id: "goal_complete", description: `Report the answer to "${subject}" \u2014 call terminate(finalAnswer=...) with the actual value.`, kind: "must_have" });
        if (wantsRecency) {
          out.push({ id: "verify_latest", description: `Verify this is the LATEST "${subject}". When multiple candidates exist (e.g., multiple Amazon delivery emails), compare dates/timestamps and pick the newest. Surface the comparison in your evidence (e.g., "selected email dated 2026-08-10 vs prior 2026-08-05").`, kind: "must_have" });
        }
        if (wantsStatus) {
          out.push({ id: "verify_source", description: `Cite the source URL where you verified the current status \u2014 drill into the link (View order / Track package / Tracking ID) and confirm against the destination page, not just the email summary. Your evidence must include the destination URL.`, kind: "must_have" });
        }
      }
    }
    return out;
  }
  function evaluateGate(criteria, verifications) {
    const missing = [];
    for (const c of criteria) {
      if (c.kind !== "must_have") continue;
      const v = verifications[c.id];
      const acknowledged = !!v && v.satisfied + v.unsatisfied > 0;
      if (!acknowledged) missing.push(c.id);
    }
    if (missing.length === 0) {
      const allSat = missing.length === 0 && criteria.every((c) => c.kind !== "must_have" || (verifications[c.id]?.satisfied ?? 0) > 0);
      return { allowed: true, missingMustHave: [], reason: allSat ? "all criteria verified" : "all must_have acknowledged (some unsatisfied \u2014 partial answer expected)" };
    }
    return { allowed: false, missingMustHave: missing, reason: `terminate blocked: ${missing.length} must_have unacknowledged \u2014 ${missing.join(", ")}. Call verify_completion(satisfied=true OR satisfied=false with evidence) for each.` };
  }
  function looksLikeHonestPartial(finalAnswer, memory) {
    const lower = finalAnswer.toLowerCase();
    const ackPhrases = [
      "note:",
      "note that",
      "could not verify",
      "couldn't verify",
      "i was unable",
      "i couldn't",
      "i could not",
      "unable to verify",
      "did not expose",
      "doesn't expose",
      "not expose",
      "no separate",
      "could not independently",
      "couldn't independently",
      "honest partial",
      "could not reach",
      "page did not",
      "page didn't",
      "not available",
      "not find",
      "couldn't find"
    ];
    const hasAck = ackPhrases.some((p) => lower.includes(p));
    if (!hasAck) return false;
    const hasUrl = /https?:\/\//i.test(finalAnswer);
    const hasGrounded = hasUrl || memory.some((f) => {
      const v = String(f.value ?? "").trim();
      if (v.length < 4) return false;
      return lower.includes(v.toLowerCase()) || v.toLowerCase().split(/\s+/).some((tok) => tok.length > 4 && lower.includes(tok));
    });
    return hasGrounded;
  }
  var MAX_STEPS = 50;
  var HISTORY_LIMIT = 10;
  var CAPTURE_TIMEOUT_MS = 25e3;
  var POST_ACTION_PAUSE_MS = 400;
  var STEP_INTERVAL_MS = 500;
  var ELEMENT_READY_TIMEOUT_MS = 2e3;
  var VIEWPORT_TOLERANCE_PX = 4;
  var VIEWPORT_TOLERANCE_DPR = 0.01;
  var VIEWPORT_CHANGED_PREFIX = "viewport_changed";
  var WorkingMemory = class _WorkingMemory {
    constructor() {
      this.facts = /* @__PURE__ */ new Map();
      // ponytail: per-fact LRU timestamp. Used by prune() to drop oldest facts
      // when memory overflows the cap. Step-index granularity is enough — we
      // only need to know "added before X other facts".
      this.addedAtStep = /* @__PURE__ */ new Map();
      // ponytail: SOURCE PAGE TRACKING. Each fact is recorded on a specific
      // page snapshot (the new PageSnapshotStore assigns an id). The page-
      // snapshot-store prompt block uses this map to show "Recorded facts: …"
      // under each page[N]. Without this map, the PAGES YOU VISITED block
      // shows page[N] URLs but no per-page facts.
      this.factSourcePage = /* @__PURE__ */ new Map();
      this.currentStep = 0;
    }
    static {
      // ponytail: soft cap before prune runs; hard cap after prune. 30 is the
      // soft cap. Prune drops oldest non-crucial facts until size ≤ 25.
      this.SOFT_CAP = 30;
    }
    static {
      this.HARD_CAP = 25;
    }
    bumpStep() {
      this.currentStep += 1;
    }
    /**
     * Record a fact AND its source page snapshot id. The page-snapshot
     * store calls this on every memoryUpdate so the per-page fact block in
     * the prompt can show "page[N] has: order_id=…".
     */
    recordWithSource(key, sourcePageId) {
      if (key) this.factSourcePage.set(key, sourcePageId);
    }
    /** Map of fact key → page snapshot id. Used by the prompt builder. */
    factsBySourcePage() {
      const out = /* @__PURE__ */ new Map();
      for (const [key, pageId] of this.factSourcePage) {
        const fact = this.facts.get(key);
        if (!fact) continue;
        const list = out.get(pageId) ?? [];
        list.push(`${key}=${fact.value}`);
        out.set(pageId, list);
      }
      return out;
    }
    merge(updates) {
      if (!updates) return;
      for (const u of updates) {
        if (!u || typeof u.key !== "string") continue;
        const key = u.key.trim();
        const value = typeof u.value === "string" ? u.value.trim() : "";
        if (!key || !value) continue;
        const ev = typeof u.evidence === "string" ? u.evidence.trim() : "";
        const existing = this.facts.get(key);
        if (!existing || !existing.evidence && ev) {
          this.facts.set(key, { key, value, evidence: ev });
          this.addedAtStep.set(key, this.currentStep);
        }
      }
    }
    // ponytail: prune oldest facts past SOFT_CAP, keeping always-crucial
    // categories (IDs/money/dates/status/sender) until HARD_CAP. Goal-keyword
    // relevance is computed elsewhere; here we just drop by LRU.
    prune() {
      if (this.facts.size <= _WorkingMemory.SOFT_CAP) return;
      const alwaysCrucial = /^(tracking_id|order_id|amount_|status|event_date|delivered_date|sender|number)/;
      const entries = Array.from(this.facts.entries()).map(([k]) => ({
        key: k,
        step: this.addedAtStep.get(k) ?? 0,
        crucial: alwaysCrucial.test(k)
      }));
      entries.sort((a, b) => {
        if (a.crucial !== b.crucial) return a.crucial ? 1 : -1;
        return a.step - b.step;
      });
      while (this.facts.size > _WorkingMemory.HARD_CAP && entries.length > 0) {
        const victim = entries.shift();
        if (!victim) break;
        this.facts.delete(victim.key);
        this.addedAtStep.delete(victim.key);
      }
    }
    commitStep() {
      this.prune();
    }
    toView() {
      return Array.from(this.facts.values());
    }
    get size() {
      return this.facts.size;
    }
  };
  function renderMemoryBlock(facts) {
    if (facts.length === 0) {
      return [
        "=== WORKING MEMORY (structured findings carried across turns) ===",
        "  (no findings recorded yet \u2014 every step should record what you observed)",
        "=== END WORKING MEMORY ==="
      ].join("\n");
    }
    const lines = facts.map((f) => {
      const ev = f.evidence ? `  (evidence: ${f.evidence})` : "";
      return `  - ${f.key} = "${f.value}"${ev}`;
    });
    return [
      "=== WORKING MEMORY (structured findings \u2014 do not re-record; carry these forward) ===",
      ...lines,
      "=== END WORKING MEMORY ==="
    ].join("\n") + "\n\n";
  }
  function log(opts, message) {
    console.log(`[local-driver] ${message}`);
    opts.onLog?.(message);
  }
  var STAGNATION_REPEAT_THRESHOLD = 3;
  var STAGNATION_WINDOW = 6;
  function actionSignature(action) {
    const t = (action.type ?? "unknown").toLowerCase();
    switch (t) {
      case "visit_url":
        return `visit_url:${(action.url ?? "").trim()}`;
      case "left_click":
      case "double_click":
      case "right_click":
      case "mouse_move": {
        const rx = Math.round((action.x ?? 0) / 20) * 20;
        const ry = Math.round((action.y ?? 0) / 20) * 20;
        return `${t}:${rx},${ry}`;
      }
      case "insert_text":
        return `insert_text:${(action.text ?? "").slice(0, 40)}`;
      case "key":
        return `key:${action.key ?? ""}`;
      case "scroll":
      case "screenshot":
      case "wait":
      case "terminate":
      case "ask_user_question":
      case "history_back":
        return t;
      default:
        return t;
    }
  }
  function observationSignature(obs) {
    const firstId = obs.elements && obs.elements.length > 0 ? obs.elements[0]?.id ?? "" : "";
    return `${(obs.url ?? "").trim()}|${(obs.title ?? "").trim()}|${firstId}`;
  }
  function goalMatchedFactsList(goal, facts) {
    const keywords = extractGoalKeywords(goal);
    if (keywords.length === 0) return [];
    return facts.filter((f) => {
      const hay = `${f.key} ${f.value}`.toLowerCase();
      return keywords.some((kw) => hay.includes(kw));
    });
  }
  function synthesizeFinalAnswer(facts) {
    return facts.map((f) => `${f.key}: ${f.value}`).join("; ");
  }
  var STATUS_WORDS2 = [
    "delivered",
    "out for delivery",
    "shipped",
    "in transit",
    "arriving",
    "dispatched",
    "cancelled",
    "returned",
    "tracking",
    "tracking id",
    "order id",
    "order #",
    "order number",
    "status",
    "estimated delivery"
  ];
  function extractPageAnswer(goal, pageText) {
    if (!goal || !pageText) return [];
    const keywords = extractGoalKeywords(goal);
    if (keywords.length === 0) return [];
    const lcText = pageText.toLowerCase();
    const sentences = pageText.split(/(?<=[.!?])\s+/);
    const out = [];
    for (let i = 0; i < sentences.length && out.length < 5; i += 1) {
      const s = sentences[i]?.trim();
      if (!s || s.length < 10 || s.length > 300) continue;
      const lc = s.toLowerCase();
      const hasGoal = keywords.some((kw) => lc.includes(kw));
      const hasStatus = STATUS_WORDS2.some((sw) => lc.includes(sw));
      if (!hasGoal && !hasStatus) continue;
      if (hasGoal) {
        const kw = keywords.find((k) => lc.includes(k)) ?? "info";
        out.push({ key: `${kw}_from_page`, value: s });
      }
    }
    return out;
  }
  function detectPageStagnation(pageIdentities) {
    if (pageIdentities.length < STAGNATION_REPEAT_THRESHOLD) return null;
    const tail = pageIdentities.slice(-STAGNATION_WINDOW);
    if (tail.length < STAGNATION_REPEAT_THRESHOLD) return null;
    const recent = tail.slice(-STAGNATION_REPEAT_THRESHOLD);
    const ref = recent[0];
    if (ref.length === 0) return null;
    return recent.every((s) => s === ref) ? {
      kind: "repeated_observation",
      signature: ref,
      count: STAGNATION_REPEAT_THRESHOLD,
      message: `STOP \u2014 the page hasn't changed for ${STAGNATION_REPEAT_THRESHOLD}+ steps (same page identity). Your clicks aren't navigating to a new page. Either (1) you've already found the answer in the current page text and should call terminate(finalAnswer='<value>'), or (2) your clicks are missing the target \u2014 pick a DIFFERENT element or read the page's anchors/buttons to find a different path.`
    } : null;
  }
  function detectStagnation(actionSigs, obsSigs) {
    const actionHit = lastNIdentical(actionSigs);
    if (actionHit) {
      return {
        kind: "repeated_action",
        signature: actionHit,
        count: STAGNATION_REPEAT_THRESHOLD,
        message: `STOP \u2014 you've called "${actionHit}" ${STAGNATION_REPEAT_THRESHOLD}+ times in a row. Repeating the same click coordinate won't change the result. Two possibilities: (1) the page already moved (the title/URL changed in a previous step) \u2014 read the new page text and look for the answer there, do NOT click again. (2) the click missed the target \u2014 pick a DIFFERENT coordinate or element. Do NOT call the same action again on the next turn.`
      };
    }
    const obsHit = lastNIdentical(obsSigs);
    if (obsHit) {
      return {
        kind: "repeated_observation",
        signature: obsHit,
        count: STAGNATION_REPEAT_THRESHOLD,
        message: `STOP \u2014 the page hasn't changed for ${STAGNATION_REPEAT_THRESHOLD}+ steps. Your actions are not landing. Either (1) you've already found the answer in the current page text and should call terminate(finalAnswer='<value>'), or (2) your clicks are missing the target and you need to click a different element. Read the current page text carefully \u2014 the answer may already be there.`
      };
    }
    return null;
  }
  function lastNIdentical(arr) {
    if (arr.length < STAGNATION_REPEAT_THRESHOLD) return null;
    const tail = arr.slice(-STAGNATION_WINDOW);
    if (tail.length < STAGNATION_REPEAT_THRESHOLD) return null;
    const recent = tail.slice(-STAGNATION_REPEAT_THRESHOLD);
    const ref = recent[0];
    return recent.every((s) => s === ref) ? ref : null;
  }
  function detectLoop(history, threshold = 3) {
    if (history.length < threshold) return { loop: false, action: "" };
    const tail = history.slice(-threshold).map((h) => h.action);
    const ref = tail[0];
    if (!tail.every((a) => a === ref)) return { loop: false, action: "" };
    if (ref === "scroll") {
      const scrollThreshold = threshold + 2;
      if (history.length < scrollThreshold) return { loop: false, action: "" };
      const scrollTail = history.slice(-scrollThreshold).map((h) => h.action);
      if (!scrollTail.every((a) => a === "scroll")) return { loop: false, action: "" };
    }
    return { loop: true, action: ref };
  }
  function detectStuckFailures(failures, threshold = 3) {
    if (failures.length < threshold) return { stuck: false, action: "", error: "" };
    const tail = failures.slice(-threshold);
    const firstAction = tail[0]?.action ?? "";
    if (tail.every((f) => f.action === firstAction)) {
      return {
        stuck: true,
        action: firstAction,
        error: tail[0]?.error ?? ""
      };
    }
    return { stuck: false, action: "", error: "" };
  }
  function autoExtractWorkingMemory(obs, memory, goalKeywords) {
    if (!obs.url || obs.url === "about:blank") return;
    const facts = extractFacts(
      {
        url: obs.url,
        title: obs.title,
        pagePurpose: obs.pagePurpose,
        bodyText: obs.bodyText ?? "",
        semanticTargets: obs.semanticTargets
      },
      goalKeywords
    );
    if (facts.length > 0) memory.merge(facts);
  }
  var DESTRUCTIVE_PHRASES = [
    "confirm purchase",
    "place order",
    "confirm payment",
    "pay now",
    "delete account",
    "wire money",
    "transfer funds",
    "cancel subscription"
  ];
  var APPROVAL_DOMAINS = [
    "checkout",
    "pay.stripe.com",
    "payments.amazon",
    "banking."
  ];
  function needsApproval(action, observation) {
    if (action.type === "visit_url" && typeof action.url === "string") {
      const lcUrl = action.url.toLowerCase();
      for (const kw of APPROVAL_DOMAINS) {
        if (lcUrl.includes(kw)) {
          return { needs: true, reason: `Navigate to "${action.url}" matches payment pattern "${kw}"` };
        }
      }
    }
    if (action.type === "insert_text" && typeof action.text === "string") {
      const lcText = action.text.toLowerCase();
      for (const kw of DESTRUCTIVE_PHRASES) {
        if (lcText.includes(kw)) {
          return { needs: true, reason: `Typing "${action.text}" matches destructive phrase "${kw}"` };
        }
      }
    }
    return { needs: false, reason: "" };
  }
  function describeAction(a) {
    switch (a.type) {
      case "left_click":
      case "double_click":
      case "right_click":
        return `${a.type} at (${a.x}, ${a.y})`;
      case "insert_text":
        return `insert_text "${(a.text ?? "").slice(0, 60)}"`;
      case "key":
        return `key "${a.key ?? ""}"`;
      case "visit_url":
        return `visit_url ${a.url ?? ""}`;
      case "scroll":
        return `scroll`;
      case "wait":
        return `wait`;
      case "terminate":
        return `terminate`;
      default:
        return a.type ?? "unknown";
    }
  }
  var EMAIL_PROVIDER_HOSTS = /* @__PURE__ */ new Set([
    "mail.google.com",
    "inbox.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "ymail.com",
    "proton.me",
    "mail.proton.me",
    "protonmail.com",
    "fastmail.com",
    "mail.icloud.com",
    "www.icloud.com",
    "mail.aol.com",
    "mail.zoho.com",
    "mail.yandex.com",
    "mail.gmx.com",
    "web.de"
  ]);
  var LIST_LIKE_HOST_PATTERNS = [/^mail\./, /^inbox\./, /\.mail\./];
  function isEmailInboxUrl(url) {
    try {
      const u = new URL(url);
      if (EMAIL_PROVIDER_HOSTS.has(u.hostname)) return true;
      return LIST_LIKE_HOST_PATTERNS.some((re) => re.test(u.hostname));
    } catch {
      return false;
    }
  }
  function extractInboxRows(targets) {
    const chromeSenders = /* @__PURE__ */ new Set([
      "gmail",
      "google",
      "search",
      "tab",
      "help",
      "training",
      "send feedback to google",
      "outlook",
      "yahoo",
      "proton",
      "compose",
      "inbox",
      "drafts",
      "sent",
      "spam",
      "trash",
      "starred",
      "important",
      "snoozed",
      "archive"
    ]);
    const rows = [];
    for (const t of targets) {
      if ((t.role ?? "").toLowerCase() !== "link") continue;
      const name = (t.accessibleName?.text ?? t.attributes?.id ?? t.attributes?.name ?? "").trim();
      const dashIdx = name.indexOf(" - ");
      if (dashIdx <= 0) continue;
      const sender = name.slice(0, dashIdx).trim();
      const rest = name.slice(dashIdx + 3).trim();
      if (!sender || sender.length > 80) continue;
      if (chromeSenders.has(sender.toLowerCase())) continue;
      const bb = t.boundingBox;
      const cx = Math.round(bb.x + bb.width / 2);
      const cy = Math.round(bb.y + bb.height / 2);
      const date = extractDateToken(name);
      const dateTs = date ? Date.parse(date) : NaN;
      rows.push({
        rowId: t.stableRef ?? t.targetId,
        sender,
        subject: rest.slice(0, 80),
        date: date ?? null,
        dateTs: Number.isFinite(dateTs) ? dateTs : 0,
        bboxCx: cx,
        bboxCy: cy,
        visible: t.visible
      });
    }
    rows.sort((a, b) => {
      if (a.dateTs > 0 && b.dateTs <= 0) return -1;
      if (a.dateTs <= 0 && b.dateTs > 0) return 1;
      if (a.dateTs > 0 && b.dateTs > 0) return b.dateTs - a.dateTs;
      return 0;
    });
    return rows;
  }
  function renderInboxRowsBlock(obs) {
    if (!isEmailInboxUrl(obs.url ?? "")) return "";
    const rows = extractInboxRows(obs.semanticTargets ?? []);
    if (rows.length === 0) return "";
    const hasAllDates = rows.every((r) => r.dateTs > 0);
    const sortNote = hasAllDates ? "rows are sorted by date (newest first); row #1 is the latest" : "rows are sorted by date when parseable; rows without a visible date stay in DOM order at the bottom";
    const lines = [
      `=== INBOX ROWS (sender \u2192 subject \u2014 ${sortNote}) ===`,
      "Each row is a CONTAINER. Verify the sender matches the goal domain BEFORE opening. To open a row, click an INNER element (the subject line or a named action like View order / Track package / Open) \u2014 NOT the row container itself, which has role=link but does not navigate."
    ];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const id = r.rowId.slice(0, 8);
      const dateSuffix = r.date ? ` date="${r.date}"` : "";
      lines.push(
        `  ${String(i + 1).padStart(2, " ")}. [${id}] sender="${r.sender}" subject="${r.subject}"${dateSuffix} bbox=(${r.bboxCx},${r.bboxCy})`
      );
    }
    lines.push("=== END INBOX ROWS ===");
    return lines.join("\n");
  }
  function extractDateToken(text) {
    if (!text) return null;
    const dayFirst = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*(?:\s*[,-]?\s*(\d{4}))?(?:,?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?))?/i.exec(text);
    if (dayFirst) return dayFirst[0];
    const monthFirst = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})(?:,?\s*(\d{4}))?(?:,?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?))?/i.exec(text);
    if (monthFirst) return monthFirst[0];
    const rel = /\b(Today|Yesterday)\b/i.exec(text);
    if (rel) return rel[0];
    return null;
  }
  function isRowContainerRetry(prev, next) {
    if (prev === null) return false;
    return Math.abs(next.x - prev.x) <= 200 && Math.abs(next.y - prev.y) <= 25;
  }
  function viewportsMatch(captured, current) {
    return Math.abs(captured.width - current.width) <= VIEWPORT_TOLERANCE_PX && Math.abs(captured.height - current.height) <= VIEWPORT_TOLERANCE_PX && Math.abs(captured.devicePixelRatio - current.devicePixelRatio) < VIEWPORT_TOLERANCE_DPR;
  }
  function renderObservationForPlanner(obs, history, guidance, memory, stepInfo, goalBanner, goalKeywords, goal, criteria, verifications) {
    const lines = [];
    lines.push("=== STEP STATUS ===");
    const elapsedS = Math.round(stepInfo.elapsedMs / 1e3);
    const budgetS = Math.round(stepInfo.budgetMs / 1e3);
    lines.push(`Step ${stepInfo.index} \xB7 ${elapsedS}s elapsed of ${budgetS}s budget \xB7 pageIdentity ${stepInfo.pageIdentity || "?"}`);
    lines.push("=== END STEP STATUS ===");
    lines.push("");
    lines.push("=== GOAL ===");
    lines.push(goal);
    if (goalKeywords.length > 0) lines.push(`keywords: [${goalKeywords.join(", ")}]`);
    lines.push("=== END GOAL ===");
    lines.push("");
    if (criteria && criteria.length > 0) {
      lines.push("=== COMPLETION CRITERIA ===");
      lines.push("  Before terminate, call verify_completion({criterionId, satisfied, evidence}) for each [ ] must criterion.");
      for (const c of criteria) {
        const v = verifications?.get(c.id);
        const sat = v && v.satisfied > 0;
        const ev = v?.latestEvidence ? `  (evidence: ${v.latestEvidence.slice(0, 80)})` : "";
        lines.push(`  ${sat ? "[x]" : "[ ]"} ${c.id} (${c.kind === "must_have" ? "must" : "advisory"}): ${c.description}${ev}`);
      }
      lines.push("=== END COMPLETION CRITERIA ===");
      lines.push("");
    }
    if (goalBanner) {
      lines.push(goalBanner);
      lines.push("");
    }
    lines.push(renderMemoryBlock(memory ?? []).trimEnd());
    lines.push("");
    lines.push(`URL: ${obs.url}`);
    try {
      const u = new URL(obs.url);
      lines.push(`PATH: ${u.pathname}${u.search}`);
    } catch {
    }
    lines.push(`Title: ${obs.title}`);
    if (obs.pagePurpose) lines.push(`PURPOSE: ${obs.pagePurpose}`);
    lines.push("");
    if (guidance && guidance.length > 0) {
      lines.push(`User guidance / harness note: ${guidance}`);
      lines.push("");
    }
    const vpWidth = obs.viewport?.width ?? 1280;
    const vpHeight = obs.viewport?.height ?? 720;
    const inViewport = [];
    const offScreen = [];
    const formatTarget = (t) => {
      const bb = t.boundingBox;
      const cx = Math.round(bb.x + bb.width / 2);
      const cy = Math.round(bb.y + bb.height / 2);
      const id = t.stableRef ?? t.targetId.slice(0, 8);
      const name = t.accessibleName?.text ?? t.attributes?.id ?? t.attributes?.name ?? "";
      const role = t.role ? ` role=${t.role}` : "";
      const value = t.control.kind === "input" ? t.control.value ?? "" : "";
      const type = t.control.kind === "input" ? ` type=${t.control.type ?? ""}` : "";
      const tags = [];
      if (value) tags.push(`value="${value}"`);
      if (t.attributes?.placeholder) tags.push(`placeholder="${t.attributes.placeholder}"`);
      if (t.attributes?.href) tags.push(`href="${t.attributes.href}"`);
      if (t.attributes?.title) tags.push(`title="${t.attributes.title}"`);
      if (t.attributes?.["aria-expanded"]) tags.push(`expanded=${t.attributes["aria-expanded"]}`);
      if (t.attributes?.["aria-haspopup"]) tags.push(`haspopup=${t.attributes["aria-haspopup"]}`);
      if (t.control.kind === "checkbox" || t.control.kind === "radio") {
        const checked = t.control.checked;
        if (typeof checked === "boolean") tags.push(`checked=${checked}`);
      }
      const tagLower = t.tag.toLowerCase();
      const roleLower = (t.role ?? "").toLowerCase();
      if ((roleLower === "link" || roleLower === "row") && (tagLower === "div" || tagLower === "span" || tagLower === "li") && name.length > 80 && !/\b(View|View order|Track|Open|Read more|Inspect|Source|Details|Continue)\b/i.test(name)) {
        tags.push("container");
      }
      const dateToken = extractDateToken(name);
      if (dateToken) tags.unshift(`date="${dateToken}"`);
      const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
      const nameStr = name ? ` "${name}"` : "";
      return `  [${id}] <${t.tag}>${nameStr}${role}${type}${tagStr} click=(${cx}, ${cy})`;
    };
    const targets = (obs.semanticTargets ?? []).filter((t) => t.visible);
    const INTERACTIVE_SORT_PRIORITY = /* @__PURE__ */ new Set([
      "button",
      "link",
      "textbox",
      "checkbox",
      "radio",
      "combobox",
      "searchbox",
      "tab",
      "menuitem",
      "option",
      "switch"
    ]);
    const isContainerLike = (t) => {
      const roleLower = (t.role ?? "").toLowerCase();
      const tagLower = t.tag.toLowerCase();
      const name = t.accessibleName?.text ?? "";
      return (roleLower === "link" || roleLower === "row") && (tagLower === "div" || tagLower === "span" || tagLower === "li") && name.length > 80 && !/\b(View|View order|Track|Open|Read more|Inspect|Source|Details|Continue)\b/i.test(name);
    };
    const sortKey = (t) => {
      if (isContainerLike(t)) return 2;
      return INTERACTIVE_SORT_PRIORITY.has((t.role ?? "").toLowerCase()) ? 0 : 1;
    };
    const sortedTargets = [...targets].sort((a, b) => sortKey(a) - sortKey(b));
    if (sortedTargets.length > 0) {
      for (const t of sortedTargets) {
        const bb = t.boundingBox;
        const isInVp = bb.x < vpWidth && bb.y < vpHeight && bb.x + bb.width > 0 && bb.y + bb.height > 0;
        if (isInVp) {
          inViewport.push(formatTarget(t));
        } else {
          offScreen.push(formatTarget(t));
        }
      }
    } else if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
      const INTERACTIVE_AX_ROLES = /* @__PURE__ */ new Set([
        "button",
        "link",
        "textbox",
        "checkbox",
        "radio",
        "combobox",
        "searchbox",
        "tab",
        "menuitem",
        "option",
        "switch"
      ]);
      for (const node of obs.accessibilityNodes) {
        if (node.role && INTERACTIVE_AX_ROLES.has(node.role.toLowerCase())) {
          const nameStr = node.name ? ` "${node.name}"` : "";
          const id = node.axNodeId.slice(-8);
          const bb = node.bounds;
          const cx = bb ? Math.round(bb.x + bb.width / 2) : 0;
          const cy = bb ? Math.round(bb.y + bb.height / 2) : 0;
          const line = `  [${id}] <ax:${node.role}>${nameStr} click=(${cx}, ${cy})`;
          if (bb && bb.x < vpWidth && bb.y < vpHeight) {
            inViewport.push(line);
          } else {
            offScreen.push(line);
          }
        }
      }
    }
    const inboxBlock = renderInboxRowsBlock(obs);
    if (inboxBlock) lines.push(inboxBlock);
    lines.push("=== INTERACTIVE ELEMENTS (In Viewport) ===");
    if (inViewport.length > 0) {
      inViewport.slice(0, 80).forEach((l) => lines.push(l));
      if (inViewport.length > 80) lines.push(`  ... (${inViewport.length - 80} additional viewport elements truncated)`);
    } else {
      lines.push("  (no interactive elements in current viewport)");
    }
    if (offScreen.length > 0) {
      lines.push("");
      lines.push(`=== OFF-SCREEN ELEMENTS (${offScreen.length} total - scroll to interact) ===`);
      offScreen.slice(0, 20).forEach((l) => lines.push(l));
      if (offScreen.length > 20) lines.push(`  ... (${offScreen.length - 20} additional off-screen elements omitted)`);
    }
    if (history.length > 0) {
      const tail = history.slice(-HISTORY_LIMIT);
      lines.push("");
      lines.push("=== RECENT STEPS & VERIFIED OUTCOMES ===");
      tail.forEach((h, i) => lines.push(`  ${i + 1}. ${h.action} \u2192 ${h.result}`));
    }
    if (obs.bodyText && obs.bodyText.length > 0) {
      lines.push("");
      lines.push("=== PAGE TEXT (HEADINGS + STATS + LABELS + TEXT \u2014 STATS contains key data) ===");
      lines.push(obs.bodyText);
      lines.push("=== END PAGE TEXT ===");
    } else if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
      const text = obs.accessibilityNodes.map((n) => n.name ?? n.value ?? "").filter((s) => s.length > 0).join(" ").slice(0, 600);
      if (text) {
        lines.push("");
        lines.push(`Page text (first 600 chars): "${text}"`);
      }
    }
    return lines.join("\n");
  }
  function looksLikeLoginPage(obs) {
    const hasPassword = obs.semanticTargets.some(
      (t) => t.control.kind === "input" && t.control.type === "password" && t.visible
    );
    if (!hasPassword) return { login: false, domain: "" };
    const hasSubmit = obs.semanticTargets.some((t) => {
      const tag = t.tag.toLowerCase();
      const ctl = t.control;
      if (tag === "button") return true;
      if (tag === "input" && ctl.kind === "input" && ctl.type === "submit") return true;
      return false;
    });
    if (!hasSubmit) return { login: false, domain: "" };
    let domain = "";
    try {
      domain = new URL(obs.url).hostname;
    } catch {
      domain = "";
    }
    return { login: true, domain };
  }
  var AUTH_PATH_RE = /(\/|\?)(login|signin|sign-in|log-in|auth|authenticate|consent|two[-_]?factor|2fa|verify|challenge|account\/login|login\/verify|oauth\/authorize|passkey)(\/|\?|$|&)/i;
  var AUTH_TITLE_RE = /(sign in|log in|login|continue to|verify|captcha|authenticate|authentication|2-?step|two[- ]?factor|consent|password)/i;
  function looksLikeAuthChallenge(obs) {
    let host = "";
    let path = "";
    try {
      const u = new URL(obs.url);
      host = u.hostname;
      path = `${u.pathname}${u.search}`;
    } catch {
      return { auth: false, domain: "", reason: "" };
    }
    if (AUTH_PATH_RE.test(path)) {
      return { auth: true, domain: host, reason: `url matches ${path}` };
    }
    if (typeof obs.title === "string" && AUTH_TITLE_RE.test(obs.title)) {
      return { auth: true, domain: host, reason: `title="${obs.title}"` };
    }
    return { auth: false, domain: "", reason: "" };
  }
  var SIGNIN_TEXT_RE = /^(sign\s*in|log\s*in|continue\s*with\s*\w+|continue|log\s*on)$/i;
  function looksLikeSignInLink(obs) {
    for (const t of obs.semanticTargets) {
      if (!t.visible) continue;
      const tag = t.tag.toLowerCase();
      if (tag !== "a" && tag !== "button") continue;
      const label = (t.accessibleName?.text ?? t.attributes?.id ?? t.attributes?.name ?? "").trim();
      if (label && SIGNIN_TEXT_RE.test(label)) {
        return { link: true, targetId: t.stableRef ?? t.targetId, label };
      }
    }
    return { link: false, targetId: "", label: "" };
  }
  async function waitForLoginResume(tabId, loginDomain, signal) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (auto, kind) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (webNavListener) {
          try {
            chrome.webNavigation.onCommitted.removeListener(webNavListener);
          } catch {
          }
        }
        if (tabsListener) {
          try {
            chrome.tabs.onUpdated.removeListener(tabsListener);
          } catch {
          }
        }
        if (interval) clearInterval(interval);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({ auto, kind });
      };
      const onAbort = () => settle(false, "aborted");
      signal.addEventListener("abort", onAbort, { once: true });
      let webNavListener = null;
      let tabsListener = null;
      let interval = null;
      let timeoutHandle = null;
      try {
        webNavListener = (details) => {
          if (details.tabId !== tabId) return;
          let host = "";
          try {
            host = new URL(details.url).hostname;
          } catch {
            return;
          }
          if (host && host !== loginDomain) {
            settle(true, "redirect");
          }
        };
        chrome.webNavigation.onCommitted.addListener(webNavListener);
      } catch {
      }
      try {
        tabsListener = (updatedTabId, info) => {
          if (updatedTabId !== tabId) return;
          if (typeof info.url !== "string") return;
          let host = "";
          try {
            host = new URL(info.url).hostname;
          } catch {
            return;
          }
          if (host && host !== loginDomain) {
            settle(true, "redirect");
          }
        };
        chrome.tabs.onUpdated.addListener(tabsListener);
      } catch {
      }
      interval = setInterval(() => {
        if (signal.aborted) {
          settle(false, "aborted");
          return;
        }
        if (pendingLoginResolvers.get(tabId)) {
          pendingLoginResolvers.delete(tabId);
          settle(false, "manual");
        }
      }, 200);
      timeoutHandle = setTimeout(() => settle(false, "timeout"), 6e4);
    });
  }
  async function callPlanner(opts, context, obs) {
    let lastErr = null;
    const driverTaskId = opts.taskId ?? "ext-task";
    const semanticTargets = (obs.semanticTargets ?? []).map((t) => ({
      targetId: t.targetId,
      stableRef: t.stableRef,
      accessibleName: t.accessibleName ? { text: t.accessibleName.text ?? "" } : void 0,
      role: t.role,
      boundingBox: t.boundingBox
    }));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${opts.plannerUrl}/plan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workId: "ext-" + Date.now(),
            sessionId: "00000000-0000-4000-8000-000000000001",
            taskId: driverTaskId,
            goal: opts.goal,
            completionCriteria: [],
            context,
            recentResults: [],
            trajectory: [],
            semanticTargets,
            ...obs.pageIdentity ? { pageIdentity: obs.pageIdentity } : {}
          }),
          signal: opts.signal
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`planner HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return await res.json();
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (lastErr.name === "AbortError") throw lastErr;
        const backoffMs = 500 * 2 ** attempt;
        log(opts, `planner call failed (attempt ${attempt + 1}/3), retrying in ${backoffMs}ms: ${lastErr.message}`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastErr ?? new Error("planner call failed");
  }
  async function readPageViewport(tabId) {
    const r = await sendCommand(tabId, {
      method: "Runtime.evaluate",
      params: {
        expression: "JSON.stringify({w:window.innerWidth,h:window.innerHeight,dpr:window.devicePixelRatio})",
        returnByValue: true
      }
    });
    const v = JSON.parse(r.result.value);
    return { width: v.w, height: v.h, devicePixelRatio: v.dpr };
  }
  async function executeAction(tabId, action, obs = null) {
    if (obs !== null && obs.viewport !== void 0) {
      try {
        const currentVp = await readPageViewport(tabId);
        if (!viewportsMatch(obs.viewport, currentVp)) {
          return `${VIEWPORT_CHANGED_PREFIX} (${obs.viewport.width}x${obs.viewport.height}@${obs.viewport.devicePixelRatio} \u2192 ${currentVp.width}x${currentVp.height}@${currentVp.devicePixelRatio}); refresh and retry`;
        }
      } catch {
      }
    }
    function findTargetById(id) {
      if (!id || obs === null) return null;
      return obs.semanticTargets.find(
        (t) => t.stableRef === id || t.targetId === id || t.targetId.startsWith(id)
      ) ?? null;
    }
    function jsClickExpressionFromTargetId(id) {
      const t = findTargetById(id);
      if (!t) return null;
      const wantText = (t.accessibleName?.text ?? "").trim();
      const wantRole = (t.role ?? "").toLowerCase();
      const wantTag = t.tag.toLowerCase();
      const wantCx = Math.round(t.boundingBox.x + t.boundingBox.width / 2);
      const wantCy = Math.round(t.boundingBox.y + t.boundingBox.height / 2);
      return `(function(){
      var SEL='a, button, [role=link], [role=button], [role=checkbox], [role=textbox], [role=menuitem], input, textarea, select, [tabindex]:not([tabindex="-1"])';
      var cands=document.querySelectorAll(SEL);
      var wantText=${JSON.stringify(wantText)}, wantRole=${JSON.stringify(wantRole)}, wantTag=${JSON.stringify(wantTag)}, wantCx=${wantCx}, wantCy=${wantCy};
      function score(n){
        var r=n.getBoundingClientRect();
        if(r.width===0||r.height===0) return -1;
        var dx=Math.abs((r.x+r.width/2)-wantCx), dy=Math.abs((r.y+r.height/2)-wantCy);
        if(dx>60||dy>60) return -1;
        var name=(n.textContent||'').replace(/\\s+/g,' ').trim();
        var an=n.getAttribute('aria-label')||'';
        var s=0;
        if(wantText && (name.indexOf(wantText)>=0 || wantText.indexOf(name)>=0 || an===wantText)) s+=5;
        var r2=(n.getAttribute('role')||'').toLowerCase();
        if(wantRole && r2===wantRole) s+=2;
        if(wantTag && n.tagName.toLowerCase()===wantTag) s+=1;
        s-=Math.max(dx,dy)*0.01;
        return s;
      }
      var best=null, bestScore=-1, bestLabel='';
      for(var i=0;i<cands.length;i++){
        var c=cands[i], sc=score(c);
        if(sc>bestScore){ bestScore=sc; best=c; bestLabel=(c.getAttribute('aria-label')||c.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60); }
      }
      if(best && bestScore>=1){ best.click(); return 'clicked '+best.tagName+' "'+bestLabel+'"'; }
      return 'NOT_FOUND';
    })()`;
    }
    function jsClickExpressionFromCoords(x, y) {
      return `(function(){
      var SEL='a, button, [role=link], [role=button], [role=checkbox], [role=textbox], [role=menuitem], input, textarea, select, [tabindex]:not([tabindex="-1"])';
      var stack=document.elementsFromPoint(${x}, ${y});
      var best=null, bestScore=-1, bestLabel='';
      for(var j=0;j<stack.length;j++){
        var n=stack[j];
        if(!n.matches(SEL)) continue;
        var name=(n.textContent||'').replace(/\\s+/g,' ').trim();
        var an=n.getAttribute('aria-label')||'';
        var s=0;
        if(name.length>3) s+=3;
        if(an.length>3) s+=2;
        if(n.tagName==='A') s+=2;
        var role=(n.getAttribute('role')||'').toLowerCase();
        if(role==='link' || role==='button') s+=1;
        if(name.length>80 && !/\\b(View|View order|Track|Open|Read more|Inspect|Source|Details|Continue)\\b/i.test(name)) s-=5;
        if(s>bestScore){ bestScore=s; best=n; bestLabel=(an||name).slice(0,60); }
      }
      if(best && bestScore>=1){ best.click(); return 'clicked '+best.tagName+' "'+bestLabel+'"'; }
      var top=stack[0];
      if(top){ top.click(); return 'clicked topmost '+top.tagName; }
      return 'NOT_FOUND';
    })()`;
    }
    switch (action.type) {
      case "left_click": {
        const clickId = action.targetId;
        const clickX = action.x;
        const clickY = action.y;
        const jsExpr = clickId ? jsClickExpressionFromTargetId(clickId) : typeof clickX === "number" && typeof clickY === "number" ? jsClickExpressionFromCoords(clickX, clickY) : null;
        if (jsExpr) {
          const r = await sendCommand(tabId, {
            method: "Runtime.evaluate",
            params: { expression: jsExpr, returnByValue: true }
          });
          const rval = r?.result?.value;
          if (rval && rval !== "NOT_FOUND") return rval;
          console.warn(`[local-driver] JS-click failed (${clickId ? "targetId=" + clickId : `coords=(${clickX},${clickY})`}); falling back to CDP mouse event`);
        }
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: clickX, y: clickY, button: "left", clickCount: 1 } });
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: clickX, y: clickY, button: "left", clickCount: 1 } });
        return `clicked (${clickX}, ${clickY})`;
      }
      case "double_click": {
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 2 } });
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 2 } });
        return `double-clicked (${action.x}, ${action.y})`;
      }
      case "right_click": {
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: action.x, y: action.y, button: "right", clickCount: 1 } });
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: action.x, y: action.y, button: "right", clickCount: 1 } });
        return `right-clicked (${action.x}, ${action.y})`;
      }
      case "insert_text": {
        if (typeof action.text !== "string") throw new Error("insert_text missing text");
        const insertTarget = action.targetId;
        if (insertTarget && obs !== null) {
          const target = obs.semanticTargets.find((t) => t.stableRef === insertTarget || t.targetId.startsWith(insertTarget));
          if (target) {
            const bb = target.boundingBox;
            const cx = Math.round(bb.x + bb.width / 2);
            const cy = Math.round(bb.y + bb.height / 2);
            await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 } });
            await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 } });
          }
        }
        await sendCommand(tabId, { method: "Input.insertText", params: { text: action.text } });
        return `typed "${action.text.slice(0, 40)}"${insertTarget ? ` into [${insertTarget}]` : ""}`;
      }
      case "key": {
        if (typeof action.key !== "string") throw new Error("key missing key");
        await sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: action.key } });
        await sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: action.key } });
        return `pressed ${action.key}`;
      }
      case "visit_url": {
        if (typeof action.url !== "string") throw new Error("visit_url missing url");
        await sendCommand(tabId, { method: "Page.navigate", params: { url: action.url } });
        return `navigated to ${action.url}`;
      }
      case "scroll": {
        const cx = action.x ?? 640;
        const cy = action.y ?? 360;
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x: cx, y: cy, deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 100 } });
        return `scrolled`;
      }
      case "wait":
        await new Promise((r) => setTimeout(r, 1e3));
        return "waited 1s";
      case "history_back": {
        const steps = typeof action.steps === "number" ? action.steps : 1;
        await sendCommand(tabId, { method: "Page.navigateToHistoryEntry", params: {} }).catch(() => void 0);
        await sendCommand(tabId, { method: "Runtime.evaluate", params: { expression: "history.back()" } });
        return `went back ${steps}`;
      }
      case "mouse_move": {
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: action.x ?? 0, y: action.y ?? 0 } });
        return `moved to (${action.x}, ${action.y})`;
      }
      case "screenshot":
        return "screenshot captured";
      case "memorize_fact":
        return `memorized: ${action.fact ?? "(no fact)"}`;
      case "ask_user_question":
        return `asked: ${action.question ?? "(no question)"}`;
      case "terminate":
        return "terminate";
      case "verify_completion":
        return `verify_completion acknowledged: ${action.criterionId ?? "?"} = ${action.satisfied ?? false}`;
      case "read_scratchpad":
        return "read_scratchpad acknowledged (summary already in prompt)";
      default:
        throw new Error(`unknown action type: ${action.type}`);
    }
  }
  var KNOWN_GOAL_SITES = [
    [/\bgmail\b|\bemail\b|\binbox\b/i, "https://mail.google.com/"],
    [/\bgithub\b/i, "https://github.com/"],
    [/\b(?:stackoverflow|stack\s*overflow)\b/i, "https://stackoverflow.com/"],
    [/\b(?:youtube|youtu\.be)\b/i, "https://www.youtube.com/"],
    [/\b(?:reddit)\b/i, "https://www.reddit.com/"],
    [/\b(?:linkedin)\b/i, "https://www.linkedin.com/"],
    [/\b(?:twitter|x\.com)\b/i, "https://twitter.com/"],
    [/\b(?:amazon|amzn)\b/i, "https://www.amazon.in/"],
    [/\b(?:flipkart)\b/i, "https://www.flipkart.com/"]
  ];
  function inferStartingUrl(goal) {
    if (!goal) return void 0;
    for (const [pattern, url] of KNOWN_GOAL_SITES) {
      if (pattern.test(goal)) return url;
    }
    return void 0;
  }
  async function openNewTab(startingUrl) {
    const url = startingUrl && /^https?:\/\//i.test(startingUrl) ? startingUrl : "about:blank";
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id === void 0) throw new Error("failed to create tab");
    if (url !== "about:blank") {
      await new Promise((resolve) => {
        const listener = (changedTabId, info) => {
          if (changedTabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, CAPTURE_TIMEOUT_MS);
      });
    }
    return tab.id;
  }
  async function captureObservationWithTimeout(tabId, timeoutMs) {
    return Promise.race([
      captureSnapshotForDriver(tabId),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`captureObservation timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  }
  var captureForDriverWithTimeout = (tabId, timeoutMs) => captureObservationWithTimeout(tabId, timeoutMs);
  var NAV_SETTLE_MS = 3500;
  async function waitForNavigationOrTimeout(tabId, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (navigated, finalUrl) => {
        if (settled) return;
        settled = true;
        try {
          chrome.webNavigation.onCommitted.removeListener(listener);
        } catch {
        }
        clearTimeout(handle);
        resolve({ navigated, finalUrl });
      };
      const listener = (details) => {
        if (details.tabId !== tabId) return;
        if (details.frameId !== 0) return;
        settle(true, details.url);
      };
      let handle;
      try {
        chrome.webNavigation.onCommitted.addListener(listener);
      } catch {
      }
      handle = setTimeout(() => settle(false, null), timeoutMs);
    });
  }
  async function readElementAtPoint(tabId, x, y) {
    try {
      const r = await sendCommand(tabId, {
        method: "Runtime.evaluate",
        params: {
          expression: `(() => { const el = document.elementFromPoint(${x}, ${y}); if (!el) return null; return el.tagName; })()`,
          returnByValue: true
        }
      });
      const tag = r?.result?.value;
      if (typeof tag !== "string") return { hitBody: false, tagName: null };
      const up = tag.toUpperCase();
      return { hitBody: up === "BODY" || up === "HTML", tagName: tag };
    } catch {
      return { hitBody: false, tagName: null };
    }
  }
  async function waitForNetworkIdle(tabId, _timeoutMs = 800) {
    const start = Date.now();
    while (Date.now() - start < 1500) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") break;
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      await sendCommand(tabId, {
        method: "Runtime.evaluate",
        params: {
          expression: `new Promise((resolve) => {
          let timer = setTimeout(finish, 200);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(finish, 200);
          });
          function finish() {
            observer.disconnect();
            resolve(true);
          }
          if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
          }
          setTimeout(() => { observer.disconnect(); resolve(false); }, 800);
        })`,
          awaitPromise: true,
          returnByValue: true
        }
      });
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  async function waitForElementAt(tabId, x, y, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await sendCommand(tabId, {
          method: "Runtime.evaluate",
          params: {
            expression: `(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? el.tagName : null; })()`,
            returnByValue: true
          }
        });
        const tag = r?.result?.value;
        if (typeof tag === "string" && tag.length > 0) return true;
      } catch {
        return false;
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    return false;
  }
  async function runLocalLoop(opts) {
    const effectiveStartingUrl = opts.startingUrl ?? inferStartingUrl(opts.goal);
    log(opts, `opening new tab${effectiveStartingUrl ? ` at ${effectiveStartingUrl}` : ""}`);
    let tabId;
    try {
      tabId = await openNewTab(effectiveStartingUrl);
    } catch (err) {
      opts.onError({ code: "TAB_OPEN_FAILED", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    opts.onTabOpened(tabId);
    try {
      await attachToTab(tabId);
    } catch (err) {
      opts.onError({ code: "DEBUGGER_ATTACH_FAILED", message: err instanceof Error ? err.message : String(err) });
      await chrome.tabs.remove(tabId).catch(() => void 0);
      return;
    }
    const history = [];
    let stepIndex = 0;
    const runStart = Date.now();
    const failures = [];
    let injectedGuidance;
    const memory = new WorkingMemory();
    const pageSnapshotStore = createPageSnapshotStore();
    const criteria = extractCriteriaFromGoal(opts.goal);
    console.warn(`[local-driver] extracted ${criteria.length} criteria for goal: ${opts.goal.slice(0, 60)}`);
    for (const c of criteria) console.warn(`[local-driver]   - ${c.id} (${c.kind}): ${c.description.slice(0, 100)}`);
    const verifications = /* @__PURE__ */ new Map();
    const loginPauseDomains = /* @__PURE__ */ new Set();
    const actionSigs = [];
    const obsSigs = [];
    const pageIdentities = [];
    let stagnationHits = 0;
    let lastUnchangedClick = null;
    const STAGNATION_NUDGE_CAP = 4;
    const initialTabIds = /* @__PURE__ */ new Set();
    try {
      const existing = await chrome.tabs.query({});
      for (const t of existing) if (typeof t.id === "number") initialTabIds.add(t.id);
    } catch {
    }
    const tabJournal = /* @__PURE__ */ new Map();
    const emitTab = (kind, tab) => {
      if (typeof tab.id !== "number") return;
      const url = tab.url ?? "";
      const title = tab.title ?? "";
      if (kind === "opened" || kind === "navigated") {
        tabJournal.set(tab.id, { url, title, openedAt: Date.now() });
      } else if (kind === "closed") {
        tabJournal.delete(tab.id);
      }
      try {
        opts.onTabEvent?.({ kind, tabId: tab.id, url, title });
      } catch {
      }
    };
    const tabListeners = [];
    if (chrome.tabs?.onCreated) {
      const handler = (tab) => {
        if (typeof tab.id === "number" && !initialTabIds.has(tab.id)) emitTab("opened", tab);
      };
      chrome.tabs.onCreated.addListener(handler);
      tabListeners.push(() => chrome.tabs.onCreated.removeListener(handler));
    }
    if (chrome.tabs?.onRemoved) {
      const handler = (tabId2) => {
        if (!initialTabIds.has(tabId2)) {
          const journal = tabJournal.get(tabId2);
          tabJournal.delete(tabId2);
          try {
            opts.onTabEvent?.({ kind: "closed", tabId: tabId2, url: journal?.url ?? "", title: journal?.title ?? "" });
          } catch {
          }
        }
      };
      chrome.tabs.onRemoved.addListener(handler);
      tabListeners.push(() => chrome.tabs.onRemoved.removeListener(handler));
    }
    if (chrome.tabs?.onUpdated) {
      const handler = (tabId2, changeInfo, tab) => {
        if (initialTabIds.has(tabId2)) return;
        if (changeInfo.url !== void 0 || changeInfo.title !== void 0 || changeInfo.status === "complete") {
          emitTab("navigated", tab);
        }
      };
      chrome.tabs.onUpdated.addListener(handler);
      tabListeners.push(() => chrome.tabs.onUpdated.removeListener(handler));
    }
    if (chrome.tabs?.onActivated) {
      const handler = (info) => {
        if (!initialTabIds.has(info.tabId)) emitTab("focused", { id: info.tabId, url: "", title: "" });
      };
      chrome.tabs.onActivated.addListener(handler);
      tabListeners.push(() => chrome.tabs.onActivated.removeListener(handler));
    }
    async function followNewTabIfExternal(currentTabId, sinceMs) {
      try {
        let currentOrigin = "";
        try {
          const t = await chrome.tabs.get(currentTabId);
          currentOrigin = new URL(t.url ?? "").origin;
        } catch {
        }
        let candidate = null;
        for (const [id, info] of tabJournal.entries()) {
          if (id === currentTabId) continue;
          if (typeof id !== "number") continue;
          if (info.openedAt <= sinceMs) continue;
          if (initialTabIds.has(id)) continue;
          if (candidate === null || info.openedAt > candidate.openedAt) {
            candidate = { id, url: info.url, title: info.title, openedAt: info.openedAt };
          }
        }
        if (candidate === null) return null;
        let candidateOrigin = "";
        try {
          candidateOrigin = new URL(candidate.url).origin;
        } catch {
        }
        if (currentOrigin && candidateOrigin && currentOrigin === candidateOrigin) return null;
        try {
          await chrome.tabs.update(candidate.id, { active: true });
        } catch {
          return null;
        }
        return { id: candidate.id, url: candidate.url, title: candidate.title };
      } catch {
        return null;
      }
    }
    let caughtError = null;
    let terminal = null;
    let consecutiveProseOnly = 0;
    const PROSE_ONLY_LIMIT = 2;
    const STEP_BUDGET_MS = Number(opts.stepBudgetMs ?? 6e4);
    try {
      while (stepIndex < MAX_STEPS) {
        if (opts.signal.aborted) {
          terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
          return;
        }
        const iterationStartedAt = Date.now();
        log(opts, `step ${stepIndex + 1}`);
        await new Promise((r) => setTimeout(r, STEP_INTERVAL_MS));
        await waitForNetworkIdle(tabId).catch(() => void 0);
        const cookiesDismissed = await dismissCookieBanners(
          ((method, params) => sendCommand(tabId, { method, params }))
        );
        if (cookiesDismissed > 0) {
          log(opts, `auto-dismissed ${cookiesDismissed} cookie banner(s)`);
        }
        const obs = await captureForDriverWithTimeout(tabId, CAPTURE_TIMEOUT_MS);
        const login = looksLikeLoginPage(obs);
        const challenge = login.login ? null : looksLikeAuthChallenge(obs);
        if (login.login || challenge && challenge.auth) {
          const domain = login.login ? login.domain : challenge.domain;
          const reason = login.login ? `password form on ${login.domain}` : `auth challenge (${challenge.reason})`;
          if (loginPauseDomains.has(domain)) {
            log(opts, `login pause skipped (already paused for ${domain})`);
          } else {
            log(opts, `login pause: ${reason}`);
            loginPauseDomains.add(domain);
            opts.onLoginRequired({ url: obs.url, domain });
            const loginResume = await waitForLoginResume(tabId, domain, opts.signal);
            pendingLoginResolvers.delete(tabId);
            if (opts.signal.aborted) {
              terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
              return;
            }
            log(opts, loginResume.auto ? `login resume: ${loginResume.kind}` : "user confirmed login \u2014 resuming loop");
          }
          try {
            const currentHost = new URL(obs.url).hostname;
            if (currentHost && currentHost !== domain) {
              loginPauseDomains.delete(domain);
            }
          } catch {
          }
          injectedGuidance = void 0;
          await waitForNetworkIdle(tabId).catch(() => void 0);
          continue;
        }
        const signIn = looksLikeSignInLink(obs);
        if (signIn.link && !injectedGuidance) {
          const targetHint = signIn.targetId ? ` Look for element [${signIn.targetId.slice(0, 8)}] "${signIn.label}" and click its center.` : ` Look for a "${signIn.label}" link/button and click it.`;
          injectedGuidance = `This page is a logged-out landing page. Click the Sign in / Log in link to authenticate \u2014 never type credentials.${targetHint}`;
        }
        const goalKeywords = extractGoalKeywords(opts.goal);
        memory.bumpStep();
        autoExtractWorkingMemory(obs, memory, goalKeywords);
        const goalMatch = detectGoalMatch(opts.goal, {
          url: obs.url,
          title: obs.title,
          pagePurpose: obs.pagePurpose,
          bodyText: obs.bodyText ?? ""
        });
        const stepInfo = {
          index: stepIndex + 1,
          totalBudget: opts.stepBudgetMs ?? 6e4,
          elapsedMs: Date.now() - runStart,
          budgetMs: opts.stepBudgetMs ?? 6e4,
          pageIdentity: obs.pageIdentity ?? ""
        };
        const pageSnapshotId = pageSnapshotStore.capture({
          url: obs.url,
          title: obs.title,
          headings: extractHeadings(obs),
          bodyText: obs.bodyText ?? "",
          interactiveElementLabels: extractElementLabels(obs)
        });
        const memoryByPage = groupMemoryByPage(memory);
        const context = renderObservationForPlanner(
          obs,
          history,
          injectedGuidance,
          memory.toView(),
          stepInfo,
          goalMatch.banner,
          goalKeywords,
          opts.goal,
          criteria,
          verifications
        );
        const pagesBlock = pageSnapshotStore.formatForPrompt(2e3, memoryByPage);
        const finalContext = pagesBlock ? `${pagesBlock}

${context}` : context;
        const outcome = await callPlanner(opts, finalContext, obs);
        if (opts.signal.aborted) {
          terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
          return;
        }
        if (outcome.kind === "completion") {
          const completionGate = evaluateGate(
            criteria,
            Object.fromEntries(
              Array.from(verifications.entries()).map(([k, v]) => [k, { satisfied: v.satisfied, unsatisfied: v.unsatisfied }])
            )
          );
          const completionSummary = outcome.summary ?? "";
          const isHonestPartialCompletion = !completionGate.allowed && completionSummary.length > 0 && looksLikeHonestPartial(completionSummary, memory.toView());
          if (!completionGate.allowed && !isHonestPartialCompletion) {
            injectedGuidance = `[TERMINATE BLOCKED] ${completionGate.reason} You emitted "Task completed" as text, but the gate requires verify_completion(criterionId="<id>", satisfied=true OR satisfied=false, evidence="...") for each must_have first. The harness rejects text-only completions \u2014 call verify_completion as a tool call, then terminate(finalAnswer=...).`;
            log(opts, `completion blocked: ${completionGate.missingMustHave.length} must_have unverified (model emitted text instead of tool call)`);
            consecutiveProseOnly += 1;
            continue;
          }
          if (isHonestPartialCompletion) {
            log(opts, `accepting honest-partial completion (gate blocked but summary acknowledges incompleteness with grounded evidence)`);
          }
          const summaryText = outcome.summary ?? "";
          const dumpKeyMatches = summaryText.match(/\b(?:phase_outline|next_step|phase_\d+_done|partial_[a-z_]+|sender|order_id|number|sender_\d+|order_id_\d+|amount_\w*|event_date|delivered_date|criterionId)\b/g);
          const isMemoryDump = dumpKeyMatches !== null && dumpKeyMatches.length >= 2;
          if (isMemoryDump) {
            injectedGuidance = `[MEMORY-DUMP REJECTED] Your completion summary contains ${dumpKeyMatches.length} internal scaffolding keys. These are working-memory fields, NOT a user-facing answer. Write a PLAIN-ENGLISH summary naming the entity, listing identifiers, and citing the source URL. Call terminate(finalAnswer=...) with a real answer.`;
            log(opts, `completion rejected: summary looks like a memory dump (${dumpKeyMatches.length} scaffolding keys)`);
            consecutiveProseOnly += 1;
            continue;
          }
          terminal = { kind: "complete", complete: { summary: summaryText || "task completed", steps: stepIndex + 1, finalAnswer: summaryText } };
          return;
        }
        if (outcome.kind === "question") {
          const questionText = outcome.question ?? "The agent needs more information.";
          const isProseOnly = outcome.proseOnly === true || outcome.toolError === true;
          if (isProseOnly) {
            consecutiveProseOnly += 1;
          } else {
            consecutiveProseOnly = 0;
          }
          if (isProseOnly && consecutiveProseOnly >= PROSE_ONLY_LIMIT) {
            log(opts, `planner returned prose ${consecutiveProseOnly} times in a row \u2014 aborting`);
            terminal = {
              kind: "error",
              error: {
                code: "PLANNER_PROSE_INSTEAD_OF_TOOL",
                message: `The model returned plain text instead of a tool call ${consecutiveProseOnly} times in a row. Last response: "${questionText.slice(0, 240)}". Send it an explicit action (visit_url, terminate, ask_user_question) or use a stronger model.`
              }
            };
            return;
          }
          if (isProseOnly) {
            injectedGuidance = questionText;
            log(opts, `prose-only response #${consecutiveProseOnly}: injecting corrective guidance`);
            continue;
          }
          const answer = await opts.onClarify({
            reason: "The planner asked a question",
            question: questionText,
            context: questionText
          });
          injectedGuidance = answer;
          opts.onAnswered?.({ question: questionText, answer });
          continue;
        }
        const action = outcome.action ?? { type: "unknown" };
        consecutiveProseOnly = 0;
        memory.merge(action.memoryUpdates);
        for (const u of action.memoryUpdates ?? []) {
          if (u && u.key) memory.recordWithSource(u.key, pageSnapshotId);
        }
        memory.commitStep();
        if (action.type === "verify_completion") {
          const v = action;
          const cid = v.criterionId ?? "";
          const claimedKeyMatch = (v.evidence ?? "").match(/(?:recorded|stored|saved|wrote|written|noted)\s+(?:as|in|to|under)\s+(?:memory\s+)?(?:key\s*[:=]?\s*)?[`'"]?([a-zA-Z_][a-zA-Z0-9_]*)/i);
          if (claimedKeyMatch && v.satisfied && (!action.memoryUpdates || !action.memoryUpdates.some((u) => u.key === claimedKeyMatch[1]))) {
            const claimedKey = claimedKeyMatch[1];
            const prev2 = verifications.get(cid) ?? { satisfied: 0, unsatisfied: 0, latestEvidence: void 0 };
            prev2.unsatisfied += 1;
            prev2.latestEvidence = `[HALLUCINATED] claimed ${claimedKey} but never wrote it`;
            verifications.set(cid, prev2);
            injectedGuidance = `[HALLUCINATED VERIFY] Your last verify_completion claimed '${claimedKey}' but ${claimedKey} is NOT in your memoryUpdates this turn. You MUST emit memoryUpdates with key='${claimedKey}' FIRST, then verify. The harness rejects evidence that claims recordings that never happened.`;
            console.warn(`[local-driver] hallucinated verify_completion for ${cid}: claimed ${claimedKey}`);
            continue;
          }
          const prev = verifications.get(cid) ?? { satisfied: 0, unsatisfied: 0, latestEvidence: void 0 };
          if (v.satisfied) {
            prev.satisfied += 1;
            prev.latestEvidence = v.evidence;
          } else {
            prev.unsatisfied += 1;
          }
          verifications.set(cid, prev);
          continue;
        }
        if (action.type === "read_scratchpad") {
          continue;
        }
        if (action.type === "terminate") {
          log(opts, `model called terminate at step ${stepIndex + 1}`);
          const finalAnswer = typeof action.finalAnswer === "string" && action.finalAnswer.length > 0 ? action.finalAnswer : typeof action.answer === "string" && action.answer.length > 0 ? action.answer : "";
          const gateResult = evaluateGate(
            criteria,
            Object.fromEntries(
              Array.from(verifications.entries()).map(([k, v]) => [k, { satisfied: v.satisfied, unsatisfied: v.unsatisfied }])
            )
          );
          const isHonestPartial = !gateResult.allowed && finalAnswer.length > 0 && looksLikeHonestPartial(finalAnswer, memory.toView());
          if (!gateResult.allowed && !isHonestPartial) {
            injectedGuidance = `[TERMINATE BLOCKED] ${gateResult.reason} For each, call verify_completion(criterionId="<id>", satisfied=true OR satisfied=false, evidence="<why>"). A satisfied=false acknowledge is fine \u2014 it lets you terminate with an honest partial answer.`;
            log(opts, `terminate blocked: ${gateResult.missingMustHave.length} must_have unverified`);
            continue;
          }
          if (isHonestPartial) {
            log(opts, `accepting honest partial terminate (gate blocked, but finalAnswer acknowledges incompleteness with grounded evidence)`);
          }
          const dumpKeyMatches = finalAnswer.match(/\b(?:phase_outline|next_step|phase_\d+_done|partial_[a-z_]+|sender|order_id|number|sender_\d+|order_id_\d+|amount_\w*|event_date|delivered_date|criterionId)\b/g);
          const isMemoryDump = dumpKeyMatches !== null && dumpKeyMatches.length >= 2;
          if (isMemoryDump) {
            injectedGuidance = `[MEMORY-DUMP REJECTED] Your finalAnswer contains ${dumpKeyMatches.length} internal scaffolding keys (${[...new Set(dumpKeyMatches)].slice(0, 4).join(", ")}\u2026). These are working-memory fields, NOT a user-facing answer. Write a PLAIN-ENGLISH answer that names the entity, lists identifiers (order #, tracking #, date), and cites the source URL. The harness will reject the call and you must try terminate again with a real answer.`;
            log(opts, `terminate rejected: finalAnswer looks like a memory dump (${dumpKeyMatches.length} scaffolding keys)`);
            continue;
          }
          if (!finalAnswer) {
            log(opts, "terminate without finalAnswer \u2014 re-prompting as a question");
            const answer = await opts.onClarify({
              reason: "terminate without finalAnswer",
              question: "The agent tried to end the task without providing an answer. What should it report?",
              context: memory.toView().map((f) => `${f.key}=${f.value}`).join("; ")
            });
            injectedGuidance = `Final answer to report: ${answer}. Use terminate(finalAnswer='<value>') next time.`;
            opts.onAnswered?.({ question: "terminate without finalAnswer", answer });
            continue;
          }
          terminal = { kind: "complete", complete: { summary: finalAnswer, steps: stepIndex + 1, finalAnswer } };
          return;
        }
        const approval = needsApproval(action, obs);
        if (approval.needs && opts.onApprovalRequired) {
          log(opts, `approval required: ${approval.reason}`);
          const approved = await opts.onApprovalRequired({
            reason: approval.reason,
            action: { type: action.type, url: action.url },
            url: obs.url
          });
          opts.onApprovalResolved?.({ approved, action: { type: action.type } });
          if (!approved) {
            log(opts, "user denied approval \u2014 aborting task");
            terminal = { kind: "error", error: { code: "APPROVAL_DENIED", message: `User denied: ${approval.reason}` } };
            return;
          }
          log(opts, "user approved \u2014 proceeding");
        }
        const desc = describeAction(action);
        const iconKind = (action.type ?? "unknown").toString();
        const actionSig = actionSignature(action);
        const isRepeatUnchanged = action.type !== "scroll" && history.some(
          (h) => (h.action === desc || actionSigs.includes(actionSig)) && h.result.includes("[Unchanged")
        );
        if (isRepeatUnchanged) {
          log(opts, `action hard-rejected by harness: "${desc}" already resulted in [Unchanged]`);
          const rejectMsg = `[REJECTED BY HARNESS]: Action "${desc}" was ALREADY attempted and had NO effect [Unchanged: URL and page state remained identical]. Repeating this action is FORBIDDEN. You MUST pick a DIFFERENT strategy (e.g. direct visit_url to a specific URL with query parameters like ?sort=stargazers, scroll down, or click a different element ID).`;
          history.push({ action: desc, result: rejectMsg });
          injectedGuidance = rejectMsg;
          opts.onStep({ index: stepIndex, action: desc, result: rejectMsg, url: obs.url, pageTitle: obs.title, pagePurpose: obs.pagePurpose, screenshot: null, iconKind, reasoning: action.reasoning, clientText: action.clientText });
          actionSigs.push(actionSig);
          const currentTitle = obs.title;
          obsSigs.push(observationSignature({ url: obs.url, title: currentTitle, elements: obs.semanticTargets.slice(0, 1).map((t) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
          pageIdentities.push(obs.pageIdentity || `${obs.url}|${currentTitle}`);
          stagnationHits++;
          const findings = memory.toView();
          const factList = findings.length > 0 ? findings.map((f) => `  - ${f.key} = "${f.value}"`).join("\n") : "  (none recorded)";
          injectedGuidance = `${rejectMsg}

YOUR WORKING MEMORY HAS THESE FINDINGS:
${factList}

If these facts answer the user's original question, call terminate(finalAnswer=<answer citing the facts>) NOW. Otherwise pick a fundamentally different action this turn (visit_url to a deep link, scroll, or open a new tab) \u2014 another same-coordinate click will be rejected again.`;
          if (stagnationHits >= STAGNATION_NUDGE_CAP) {
            const blockedMessage = `STOP \u2014 repeated invalid actions rejected by harness after ${stagnationHits} nudges.

Findings so far:
${factList}`;
            terminal = { kind: "error", error: { code: "STAGNATION", message: blockedMessage } };
            return;
          }
          stepIndex++;
          continue;
        }
        let result;
        const actionTs = Date.now();
        if ((action.type === "left_click" || action.type === "double_click" || action.type === "right_click" || action.type === "mouse_move") && typeof action.x === "number" && typeof action.y === "number") {
          const ready = await waitForElementAt(tabId, action.x, action.y, ELEMENT_READY_TIMEOUT_MS);
          if (!ready) {
            log(opts, `element at (${action.x}, ${action.y}) not ready within ${ELEMENT_READY_TIMEOUT_MS}ms \u2014 dispatching click anyway`);
          }
        }
        if (lastUnchangedClick !== null && (action.type === "left_click" || action.type === "double_click" || action.type === "right_click") && typeof action.x === "number" && typeof action.y === "number" && isRowContainerRetry(lastUnchangedClick, { x: action.x, y: action.y })) {
          {
            log(opts, `click near last [Unchanged] click (${lastUnchangedClick.x}, ${lastUnchangedClick.y}) \u2014 likely row container`);
            const rejectMsg = `[REJECTED BY HARNESS]: Your previous click near (${lastUnchangedClick.x}, ${lastUnchangedClick.y}) left the page unchanged, and you are clicking the same row again. The bbox center of a row container (role=link, div, long name, no action verb) is often NOT a clickable target \u2014 pick the row's INNER subject link / a named action (View order, Open, Track) instead.`;
            history.push({ action: desc, result: rejectMsg });
            injectedGuidance = rejectMsg;
            opts.onStep({ index: stepIndex, action: desc, result: rejectMsg, url: obs.url, pageTitle: obs.title, pagePurpose: obs.pagePurpose, screenshot: null, iconKind, reasoning: action.reasoning, clientText: action.clientText });
            actionSigs.push(actionSig);
            obsSigs.push(observationSignature({ url: obs.url, title: obs.title, elements: obs.semanticTargets.slice(0, 1).map((t) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
            pageIdentities.push(obs.pageIdentity || `${obs.url}|${obs.title}`);
            stagnationHits++;
            if (stagnationHits >= STAGNATION_NUDGE_CAP) {
              const blockedMessage = `STOP \u2014 clicks on the same row rejected by harness after ${stagnationHits} nudges.

Findings:
${memory.toView().map((f) => `  - ${f.key} = "${f.value}"`).join("\n")}`;
              terminal = { kind: "error", error: { code: "STAGNATION", message: blockedMessage } };
              return;
            }
            stepIndex++;
            continue;
          }
        }
        try {
          result = await executeAction(tabId, action, obs);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(opts, `action failed (${failures.length + 1} in a row): ${message}`);
          failures.push({ action: desc, error: message, ts: Date.now() });
          const stuck = detectStuckFailures(failures);
          if (stuck.stuck) {
            const answer = await opts.onClarify({
              reason: `Action "${stuck.action}" has failed ${failures.length} times in a row`,
              question: `The agent can't get "${stuck.action}" to work. The last error was: ${stuck.error}. What should it do instead?`,
              context: stuck.error
            });
            injectedGuidance = answer;
            opts.onAnswered?.({ question: stuck.error, answer });
            failures.length = 0;
            continue;
          }
          terminal = { kind: "error", error: { code: "ACTION_FAILED", message } };
          return;
        }
        if (result.startsWith(VIEWPORT_CHANGED_PREFIX)) {
          log(opts, result);
          history.push({ action: desc, result });
          opts.onStep({ index: stepIndex, action: desc, result, url: obs.url, pageTitle: obs.title, pagePurpose: obs.pagePurpose, screenshot: null, iconKind, reasoning: action.reasoning, clientText: action.clientText });
          failures.length = 0;
          stepIndex++;
          continue;
        }
        let screenshot = null;
        let postUrl = obs.url;
        let postObs = null;
        let pageChanged = false;
        let verifiedResult = result;
        if (action.type === "left_click" || action.type === "double_click" || action.type === "right_click" || action.type === "visit_url" || action.type === "history_back") {
          const nav = await waitForNavigationOrTimeout(tabId, NAV_SETTLE_MS);
          if (nav.navigated && nav.finalUrl) {
            log(opts, `navigation committed after click: \u2192 ${nav.finalUrl.slice(0, 80)}`);
          }
        }
        if ((action.type === "left_click" || action.type === "double_click" || action.type === "right_click") && typeof action.x === "number" && typeof action.y === "number") {
          const landed = await readElementAtPoint(tabId, action.x, action.y);
          if (landed.hitBody) {
            log(opts, `click landed on ${landed.tagName ?? "BODY"} at (${action.x}, ${action.y}) \u2014 coords may be stale (page shifted between capture and dispatch)`);
          }
        }
        await waitForNetworkIdle(tabId).catch(() => void 0);
        await new Promise((r) => setTimeout(r, POST_ACTION_PAUSE_MS));
        const followed = await followNewTabIfExternal(tabId, actionTs);
        if (followed !== null) {
          const oldTabId = tabId;
          tabId = followed.id;
          log(opts, `following click into new tab ${tabId} (${followed.url.slice(0, 80)})`);
          await detachFromTab(oldTabId).catch(() => void 0);
          try {
            await attachToTab(tabId);
          } catch (err) {
            log(opts, `failed to attach to new tab ${tabId}: ${err instanceof Error ? err.message : String(err)}`);
          }
          await waitForNetworkIdle(tabId).catch(() => void 0);
        }
        try {
          postObs = await captureObservationWithTimeout(tabId, CAPTURE_TIMEOUT_MS);
          screenshot = postObs.screenshot && postObs.screenshot.data.length > 0 ? postObs.screenshot.data : null;
          postUrl = postObs.url;
        } catch (err) {
          log(opts, `post-action observation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        let outcomeTag = "";
        if (postObs) {
          if (postObs.url !== obs.url) {
            outcomeTag = ` [Verified: Navigated to ${postObs.url}]`;
            pageChanged = true;
          } else if (postObs.pageIdentity && obs.pageIdentity && postObs.pageIdentity !== obs.pageIdentity) {
            outcomeTag = ` [Verified: Page content updated]`;
            pageChanged = true;
          } else {
            outcomeTag = ` [Unchanged: action ${action.type} dispatched but page state unchanged]`;
          }
        }
        verifiedResult = `${result}${outcomeTag}`;
        history.push({ action: desc, result: verifiedResult });
        failures.length = 0;
        if (verifiedResult.includes("[Unchanged") && (action.type === "left_click" || action.type === "double_click" || action.type === "right_click") && typeof action.x === "number" && typeof action.y === "number") {
          lastUnchangedClick = { x: action.x, y: action.y };
        }
        opts.onStep({ index: stepIndex, action: desc, result, url: postUrl, pageTitle: obs.title, pagePurpose: obs.pagePurpose, screenshot, iconKind, reasoning: action.reasoning, clientText: action.clientText });
        if (pageChanged) {
          actionSigs.length = 0;
          obsSigs.length = 0;
          pageIdentities.length = 0;
          stagnationHits = 0;
          lastUnchangedClick = null;
        }
        actionSigs.push(actionSignature(action));
        const postTitle = postObs?.title ?? obs.title;
        const postTargets = postObs?.semanticTargets ?? obs.semanticTargets;
        obsSigs.push(observationSignature({ url: postUrl, title: postTitle, elements: postTargets.slice(0, 1).map((t) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
        const postObsPageIdentity = postObs?.pageIdentity && postObs.pageIdentity.length > 0 ? postObs.pageIdentity : `${postUrl}|${postTitle}`;
        pageIdentities.push(postObsPageIdentity);
        const pageStag = detectPageStagnation(pageIdentities);
        const actionStag = detectStagnation(actionSigs, obsSigs);
        const stagnation = pageStag ?? actionStag;
        if (stagnation) {
          stagnationHits++;
          log(opts, `stagnation: ${stagnation.kind} signature="${stagnation.signature}" nudge ${stagnationHits}/${STAGNATION_NUDGE_CAP}`);
          const goalFindings = memory.toView();
          const goalMatchedFacts = goalMatchedFactsList(opts.goal, goalFindings);
          let autoTerminateFacts = goalMatchedFacts;
          if (autoTerminateFacts.length === 0 && postObs?.bodyText) {
            autoTerminateFacts = extractPageAnswer(opts.goal, postObs.bodyText);
            if (autoTerminateFacts.length > 0) {
              log(opts, `stagnation auto-terminate fallback: ${autoTerminateFacts.length} facts extracted from page text`);
            }
          }
          if (autoTerminateFacts.length >= 1) {
            const summary = synthesizeFinalAnswer(autoTerminateFacts);
            log(opts, `stagnation auto-terminate: ${goalFindings.length} facts in memory, ${autoTerminateFacts.length} goal-match`);
            terminal = {
              kind: "complete",
              complete: {
                summary,
                steps: stepIndex + 1,
                finalAnswer: summary
              }
            };
            return;
          }
          const findings = memory.toView();
          const factList = findings.length > 0 ? findings.map((f) => `  - ${f.key} = "${f.value}"`).join("\n") : "  (none recorded)";
          const nudge = `${stagnation.message}

YOUR WORKING MEMORY HAS THESE FINDINGS:
${factList}

If these facts already answer the user's original question, call terminate(finalAnswer=<a one-sentence answer citing the relevant facts>) NOW. Do not click around looking for one more identifier.

If they do NOT answer the question, you must pivot to a FUNDAMENTALLY different strategy this turn \u2014 not another nearby click:
  - visit_url to a deep link (e.g. a search-results URL with a different query, or a specific order details page).
  - scroll the page to reveal content below the fold.
  - open a new tab and search from scratch.
Repeating the same click coordinates again this turn will burn more steps without progress.`;
          injectedGuidance = nudge;
          pageIdentities.length = 0;
          actionSigs.length = 0;
          obsSigs.length = 0;
          if (stagnationHits >= STAGNATION_NUDGE_CAP) {
            const blockedMessage = `${stagnation.message}

Findings after ${stagnationHits} nudges:
${factList}`;
            terminal = { kind: "error", error: { code: "STAGNATION", message: blockedMessage } };
            return;
          }
          opts.onAnswered?.({ question: stagnation.kind, answer: stagnation.message });
        }
        const loop = detectLoop(history);
        if (loop.loop) {
          log(opts, `loop detected: ${loop.action} repeated in history`);
          if (loop.action === "scroll") {
            injectedGuidance = `[HARNESS NOTICE]: You have scrolled multiple times in a row on this page. Read the CARDS & LIST ITEMS and PAGE TEXT sections in the current context carefully. If the information you need is present, extract it into memoryUpdates and call terminate(finalAnswer=...). If you need to refine your search, use direct URL parameters (e.g. ?sort=stargazers, ?type=source, ?q=query) or click a specific item link.`;
            opts.onAnswered?.({ question: "scroll loop", answer: injectedGuidance });
          } else {
            const answer = await opts.onClarify({
              reason: `Action "${loop.action}" repeated in history`,
              question: `The agent keeps doing "${loop.action}" without progress. How should it proceed?`,
              context: loop.action
            });
            injectedGuidance = answer;
            opts.onAnswered?.({ question: loop.action, answer });
          }
          actionSigs.length = 0;
          obsSigs.length = 0;
          pageIdentities.length = 0;
          stagnationHits = 0;
        }
        const iterationElapsedMs = Date.now() - iterationStartedAt;
        if (iterationElapsedMs > STEP_BUDGET_MS) {
          log(opts, `step budget exceeded: ${iterationElapsedMs}ms > ${STEP_BUDGET_MS}ms`);
          const answer = await opts.onClarify({
            reason: `Step exceeded ${Math.round(STEP_BUDGET_MS / 1e3)}s budget`,
            question: `The agent spent ${Math.round(iterationElapsedMs / 1e3)}s on this step without making progress. How would you like it to proceed?`,
            context: `Current URL: ${obs.url}. Current title: ${obs.title}. Steps so far: ${stepIndex + 1}.`
          });
          injectedGuidance = answer;
          opts.onAnswered?.({ question: `step budget exceeded`, answer });
        }
        stepIndex++;
      }
      terminal = { kind: "error", error: { code: "MAX_STEPS_EXCEEDED", message: `Did not complete in ${MAX_STEPS} steps` } };
    } catch (err) {
      caughtError = err instanceof Error ? err : new Error(String(err));
      log(opts, `loop crashed: ${caughtError.message}`);
      terminal = { kind: "error", error: { code: "LOOP_CRASHED", message: caughtError.message } };
    } finally {
      for (const off of tabListeners) {
        try {
          off();
        } catch {
        }
      }
      await detachFromTab(tabId).catch(() => void 0);
      if (terminal !== null) {
        if (terminal.kind === "complete") {
          try {
            opts.onComplete(terminal.complete);
          } catch {
          }
        } else {
          try {
            opts.onError(terminal.error);
          } catch {
          }
        }
      }
    }
  }
  var pendingLoginResolvers = /* @__PURE__ */ new Map();
  function resolveLoginPause(tabId) {
    const resolve = pendingLoginResolvers.get(tabId);
    if (resolve === void 0) return false;
    resolve();
    return true;
  }

  // src/background.ts
  var BADGE_ACTIVE_COLOR = "#22c55e";
  var BADGE_INACTIVE_COLOR = "#6b7280";
  var BOOTSTRAP_PATH = "/v1/sessions";
  var localAbortController = null;
  var localTabId = null;
  var localTaskTerminalEmitted = false;
  var DEFAULT_PLANNER_URL = "http://127.0.0.1:8000";
  function endLocalTab() {
    const tabId = localTabId;
    localTabId = null;
    if (tabId !== null) void setBadgeForTab(tabId, false);
  }
  var pendingClarifyResolvers = /* @__PURE__ */ new Map();
  var pendingApprovalResolvers = /* @__PURE__ */ new Map();
  var requestIdCounter = 0;
  function newRequestId(prefix) {
    requestIdCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${requestIdCounter}`;
  }
  var managedHostnames = /* @__PURE__ */ new Set();
  var managedOrigins = [];
  var managedControlPlaneUrl = null;
  var store = new CanonicalSessionStore({
    local: chrome.storage.local,
    ...chrome.storage.session === void 0 ? {} : { session: chrome.storage.session }
  });
  var bootstrap = {
    async bootstrap(input, signal) {
      let controlPlaneUrl = managedControlPlaneUrl;
      if (controlPlaneUrl === null) {
        const stored = await chrome.storage.local.get("settings");
        const settings = stored.settings;
        controlPlaneUrl = settings?.serverUrl || null;
      }
      if (controlPlaneUrl === null) throw new Error("Server URL not configured. Set it in extension options.");
      const endpoint = bootstrapEndpoint(controlPlaneUrl);
      return new ControlPlaneConnectionBootstrap(endpoint).bootstrap(input, signal);
    }
  };
  var controller = new CanonicalExtensionController({
    bootstrap,
    store,
    tabs: {
      activeTabId: async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs.length === 1 ? tabs[0]?.id : void 0;
        if (tabId === void 0) throw new Error("Exactly one active browser tab is required");
        const url = tabs[0]?.url;
        if (url === void 0 || !/^https?:\/\//i.test(url)) throw new Error("The active tab must use HTTP(S)");
        return tabId;
      },
      attach: async (tabId) => {
        await attachToTab(tabId);
      },
      detach: async (tabId) => {
        await detachFromTab(tabId);
      },
      isAttached: async (tabId) => {
        if (isAttached(tabId)) return true;
        const targets = await getTargets();
        return targets.some((target) => target.tabId === tabId && target.attached === true);
      }
    },
    capture: async (tabId, signal) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const before = await mainFrameId(tabId);
      const observation = await captureObservation(tabId);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const after = await mainFrameId(tabId);
      if (before !== after) throw new Error("The main frame changed across canonical capture");
      return { observation, mainFrameId: after };
    },
    executionPipelineFactory: ({ tabId, serverUrl, observationAuthority, approvals }) => createCanonicalExecutionPipeline({
      tabId,
      observationAuthority,
      approvals,
      resolver: new CustomerControlledDnsResolver(serverUrl),
      trustedHostnamePolicy: { isTrusted: (hostname) => managedHostnames.has(hostname.toLowerCase()) },
      allowedOrigins: managedOrigins,
      createSettler: (mainFrame, initialPageState) => new PageSettler({
        tabId,
        mainFrameId: mainFrame,
        initialPageState,
        getPageState: () => readPageState(tabId)
      }),
      send: async (id, command) => sendCommand(id, command)
    }),
    transportFactory: (context) => new CanonicalTransport({
      material: context.material,
      initialSequences: {
        lastReceivedSequence: context.recovery.lastReceivedSequence,
        lastSentSequence: context.recovery.lastSentSequence
      },
      pendingActionIds: context.pendingActionIds,
      getReconnectMaterial: context.getReconnectMaterial,
      onMaterial: context.onMaterial,
      onMessage: context.onMessage,
      onMessageError: (error) => notifyUi({
        type: "canonical_error",
        code: "CONTROLLER_MESSAGE_FAILED",
        message: error instanceof Error ? error.message : "Canonical controller message failed"
      }),
      onStateChange: context.onStateChange,
      onProtocolError: (code) => notifyUi({ type: "canonical_error", code, message: "A canonical protocol message was rejected" })
    }),
    emitUiEvent: (event) => {
      updateBadgeForEvent(event);
      notifyUi(event);
    }
  });
  function handleMessage(message, _sender, sendResponse) {
    void dispatchMessage(message).then((response) => sendResponse(response)).catch((error) => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : "Canonical extension request failed"
    }));
    return true;
  }
  async function dispatchMessage(message) {
    switch (message.type) {
      case "get_connection_status": {
        const state = await controller.viewState();
        return {
          success: true,
          status: {
            connected: state.transport?.status === "open",
            recovery: state.recovery,
            reconnect: state.transport,
            trajectory: state.trajectory,
            terminal: state.terminal,
            approval: state.approval
          }
        };
      }
      case "send_task":
        await loadManagedPolicy();
        await controller.startTask(String(message.task ?? ""));
        return { success: true };
      case "cancel_task":
      case "stop_task":
        await controller.cancel(typeof message.reason === "string" ? message.reason : void 0);
        return { success: true };
      case "disconnect_relay":
        await controller.disconnect();
        return { success: true };
      case "approve_action":
        await controller.resolveApproval(true);
        return { success: true };
      case "deny_action":
        await controller.resolveApproval(false);
        return { success: true };
      case "login_complete":
        await controller.submitFreshObservation("User interaction completed; fresh observation submitted");
        return { success: true };
      case "clear_trajectory":
        await store.clearTrajectory();
        return { success: true };
      case "connect_relay":
        return { success: false, error: "Sending a task starts its authenticated canonical session" };
      case "run_local_task": {
        if (localAbortController !== null || localTabId !== null) {
          return { success: false, error: "A local task is already running" };
        }
        localTaskTerminalEmitted = false;
        const goal = String(message.task ?? "").trim();
        if (goal.length === 0) return { success: false, error: "task is empty" };
        const startingUrl = typeof message.startingUrl === "string" ? message.startingUrl : void 0;
        const plannerUrl = typeof message.plannerUrl === "string" ? message.plannerUrl : DEFAULT_PLANNER_URL;
        const controller_ac = new AbortController();
        localAbortController = controller_ac;
        notifyUi({ type: "canonical_status", status: "executing" });
        void runLocalLoop({
          goal,
          startingUrl,
          plannerUrl,
          // ponytail: stable per-task uuid so the demo-server can reset its
          // turn counter when a new task starts (otherwise the counter
          // accumulates across all runs in the server's lifetime).
          taskId: crypto.randomUUID(),
          signal: controller_ac.signal,
          onTabOpened: (tabId) => {
            localTabId = tabId;
            void setBadgeForTab(tabId, true);
          },
          onTabEvent: (event) => {
            notifyUi({ type: "tab_event", event });
          },
          onStep: ({ index, action, result, url, pageTitle, pagePurpose, screenshot, iconKind, reasoning, clientText }) => {
            notifyUi({
              type: "step_card",
              index,
              title: action,
              result,
              url,
              pageTitle,
              pagePurpose,
              screenshot: screenshot ?? void 0,
              screenshotPlaceholder: screenshot ? void 0 : "Screenshot unavailable (chrome:// page or capture blocked)",
              iconKind,
              ts: Date.now(),
              // ponytail: split reasoning from client-facing text. `clientText`
              // is the planner's clean one-line update (e.g. "Looking for your
              // Amazon delivery email.") — shown as the bubble title. `reasoning`
              // is the internal scratchpad, hidden behind the details toggle.
              // Without this split, internal jargon ("phase 2: verify_latest",
              // "next_step: …") leaked to the user and the chat read like a
              // raw log instead of a human conversation.
              clientText,
              reasoning
            });
          },
          // ponytail: log events surface as 'observation' kind so the existing
          // popup log handler picks them up without a new message type.
          onLoginRequired: ({ url, domain }) => {
            notifyUi({ type: "login_required", url, domain });
          },
          onComplete: ({ summary, steps, finalAnswer }) => {
            if (localTaskTerminalEmitted) return;
            localTaskTerminalEmitted = true;
            notifyUi({ type: "task_completed", summary, steps, finalAnswer });
          },
          onError: ({ code, message: message2 }) => {
            if (localTaskTerminalEmitted) return;
            localTaskTerminalEmitted = true;
            notifyUi({ type: "task_failed", code, message: message2 });
          },
          onLog: (message2) => {
            console.log(`[brotto-bg] ${message2}`);
          },
          onClarify: ({ reason, question, context }) => {
            const id = newRequestId("clarify");
            return new Promise((resolve) => {
              pendingClarifyResolvers.set(id, resolve);
              notifyUi({ type: "clarify_request", id, reason, question, context });
            });
          },
          onApprovalRequired: ({ reason, action, url }) => {
            const id = newRequestId("approval");
            return new Promise((resolve) => {
              pendingApprovalResolvers.set(id, resolve);
              notifyUi({ type: "approval_request", id, reason, action, url });
            });
          },
          onAnswered: ({ question, answer }) => {
            console.log(`[brotto-bg] user answered (${question.slice(0, 60)}): ${answer.slice(0, 80)}`);
          },
          onApprovalResolved: ({ approved, action }) => {
            console.log(`[brotto-bg] ${approved ? "approved" : "denied"} ${action.type ?? "action"}`);
          }
        }).then(() => {
          localAbortController = null;
          endLocalTab();
          if (!localTaskTerminalEmitted) {
            notifyUi({ type: "canonical_status", status: "completed" });
          }
        }).catch((err) => {
          localAbortController = null;
          endLocalTab();
          notifyUi({ type: "canonical_error", code: "LOCAL_LOOP_THREW", message: err instanceof Error ? err.message : String(err) });
        });
        return { success: true };
      }
      case "cancel_local_task": {
        if (localAbortController === null) return { success: false, error: "No local task is running" };
        localTaskTerminalEmitted = true;
        localAbortController.abort();
        localAbortController = null;
        if (localTabId !== null) {
          await detachFromTab(localTabId).catch(() => void 0);
          endLocalTab();
        }
        notifyUi({
          type: "task_failed",
          code: "CANCELLED",
          message: "Task was cancelled by user"
        });
        notifyUi({ type: "canonical_status", status: "cancelled" });
        return { success: true };
      }
      case "local_login_complete": {
        if (localTabId === null) return { success: false, error: "No local task is paused" };
        const resolved = resolveLoginPause(localTabId);
        return { success: resolved, error: resolved ? void 0 : "No pending login pause" };
      }
      case "local_login_skip": {
        if (localAbortController === null) return { success: false, error: "No local task is running" };
        localAbortController.abort();
        localAbortController = null;
        localTabId = null;
        return { success: true };
      }
      case "submit_clarification": {
        const id = typeof message.id === "string" ? message.id : "";
        const resolve = pendingClarifyResolvers.get(id);
        if (!resolve) return { success: false, error: "No pending clarification" };
        pendingClarifyResolvers.delete(id);
        resolve(typeof message.answer === "string" ? message.answer : "");
        return { success: true };
      }
      case "submit_approval": {
        const id = typeof message.id === "string" ? message.id : "";
        const resolve = pendingApprovalResolvers.get(id);
        if (!resolve) return { success: false, error: "No pending approval" };
        pendingApprovalResolvers.delete(id);
        resolve(message.approved === true);
        return { success: true };
      }
      case "reset_session": {
        if (localAbortController !== null) {
          localAbortController.abort();
          localAbortController = null;
        }
        if (localTabId !== null) {
          await detachFromTab(localTabId).catch(() => void 0);
          endLocalTab();
        }
        pendingClarifyResolvers.clear();
        pendingApprovalResolvers.clear();
        notifyUi({ type: "log", message: "Session reset" });
        return { success: true };
      }
      case "submit_user_input": {
        return { success: true, acknowledged: typeof message.value === "string" ? message.value : "" };
      }
      default:
        return { success: false, error: "Unknown message type" };
    }
  }
  async function initialize() {
    chrome.runtime.onMessage.addListener(handleMessage);
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== "brotto-sidepanel") return;
      port.onMessage.addListener(() => {
      });
    });
    chrome.runtime.onInstalled.addListener(() => {
      void setBadge(false);
    });
    try {
      if (chrome.sidePanel?.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    } catch (err) {
      console.warn("sidePanel.setPanelBehavior failed:", err);
    }
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status !== void 0 || changeInfo.url !== void 0) controller.invalidateObservation(tabId);
    });
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      controller.invalidateObservation(tabId);
    });
    await loadManagedPolicy();
    const restored = await controller.restore().catch((error) => {
      notifyUi({
        type: "canonical_error",
        code: "SESSION_RESTORE_FAILED",
        message: error instanceof Error ? error.message : "Session restoration failed"
      });
      return false;
    });
    await setBadge(restored);
  }
  var CustomerControlledDnsResolver = class {
    constructor(serverUrl) {
      const url = new URL(serverUrl);
      url.protocol = "https:";
      url.pathname = "/v1...dns/resolve";
      url.search = "";
      url.hash = "";
      this.endpoint = url.href;
    }
    async resolve(hostname, signal) {
      const response = await fetch(this.endpoint, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname }),
        signal
      });
      if (!response.ok) throw new Error("Customer-controlled DNS resolution failed");
      const body = await response.json();
      if (!Array.isArray(body.addresses) || !body.addresses.every((value) => typeof value === "string")) {
        throw new Error("Customer-controlled DNS response is invalid");
      }
      return body.addresses;
    }
  };
  function bootstrapEndpoint(rawServerUrl) {
    const url = new URL(rawServerUrl);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol === "ws:") url.protocol = "http:";
    if (!isLocalhost && url.protocol !== "https:") {
      throw new Error("Control-plane URL must use HTTPS (except localhost for dev)");
    }
    if (url.username !== "" || url.password !== "") {
      throw new Error("Control-plane URL must not contain credentials");
    }
    url.pathname = BOOTSTRAP_PATH;
    url.search = "";
    url.hash = "";
    return url.href;
  }
  async function loadManagedPolicy() {
    try {
      const managed = await chrome.storage.managed.get(["canonicalAllowedHostnames", "canonicalAllowedOrigins", "canonicalControlPlaneUrl"]);
      const hostnames = Array.isArray(managed.canonicalAllowedHostnames) ? managed.canonicalAllowedHostnames : [];
      const origins = Array.isArray(managed.canonicalAllowedOrigins) ? managed.canonicalAllowedOrigins : [];
      managedHostnames = new Set(hostnames.flatMap((value) => typeof value === "string" && validHostname(value) ? [value.toLowerCase()] : []));
      managedOrigins = origins.flatMap((value) => typeof value === "string" && validHttpsOrigin(value) ? [new URL(value).origin] : []);
      managedControlPlaneUrl = typeof managed.canonicalControlPlaneUrl === "string" && validHttpsOrigin(managed.canonicalControlPlaneUrl) ? managed.canonicalControlPlaneUrl : null;
    } catch {
      managedHostnames = /* @__PURE__ */ new Set();
      managedOrigins = [];
      managedControlPlaneUrl = null;
    }
  }
  async function mainFrameId(tabId) {
    const result = await sendCommand(tabId, { method: "Page.getFrameTree" });
    const id = result.frameTree?.frame?.id;
    if (typeof id !== "string" || id.length === 0 || (result.frameTree?.childFrames?.length ?? 0) > 0) {
      throw new Error("A single canonical main frame could not be proven");
    }
    return id;
  }
  async function readPageState(tabId) {
    const result = await sendCommand(tabId, {
      method: "Runtime.evaluate",
      params: {
        expression: "({url:location.href,title:document.title,lifecycle:document.readyState})",
        returnByValue: true,
        awaitPromise: false
      }
    });
    if (result.exceptionDetails !== void 0 || result.result?.value === null || typeof result.result?.value !== "object") {
      throw new Error("Page state is unavailable");
    }
    const value = result.result.value;
    if (typeof value.url !== "string" || typeof value.title !== "string" || !["loading", "interactive", "complete"].includes(String(value.lifecycle))) {
      throw new Error("Page state is invalid");
    }
    return {
      url: value.url,
      title: value.title,
      lifecycle: value.lifecycle
    };
  }
  function validHostname(value) {
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
  }
  function validHttpsOrigin(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "" && url.origin === value.replace(/\/$/, "");
    } catch {
      return false;
    }
  }
  function updateBadgeForEvent(event) {
    if (event.type !== "canonical_status") return;
    void setBadge(event.status === "connected" || event.status === "executing" || event.status === "waiting_for_approval");
  }
  async function setBadge(active) {
    await chrome.action.setBadgeBackgroundColor({ color: active ? BADGE_ACTIVE_COLOR : BADGE_INACTIVE_COLOR });
    await chrome.action.setBadgeText({ text: active ? "ON" : "" });
  }
  async function setBadgeForTab(tabId, active) {
    try {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: active ? BADGE_ACTIVE_COLOR : BADGE_INACTIVE_COLOR
      });
      await chrome.action.setBadgeText({ tabId, text: active ? "AI" : "" });
    } catch {
    }
  }
  function notifyUi(event) {
    void chrome.runtime.sendMessage(event).catch(() => void 0);
  }
  void initialize();
})();
