"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

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
      "use strict";
      DEBUGGER_TARGETS = /* @__PURE__ */ new Map();
      eventHandlers = /* @__PURE__ */ new Map();
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.cjs
  var require_util = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.cjs"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.getParsedType = exports.ZodParsedType = exports.objectUtil = exports.util = void 0;
      var util2;
      (function(util3) {
        util3.assertEqual = (_) => {
        };
        function assertIs(_arg) {
        }
        util3.assertIs = assertIs;
        function assertNever(_x) {
          throw new Error();
        }
        util3.assertNever = assertNever;
        util3.arrayToEnum = (items) => {
          const obj = {};
          for (const item of items) {
            obj[item] = item;
          }
          return obj;
        };
        util3.getValidEnumValues = (obj) => {
          const validKeys = util3.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
          const filtered = {};
          for (const k of validKeys) {
            filtered[k] = obj[k];
          }
          return util3.objectValues(filtered);
        };
        util3.objectValues = (obj) => {
          return util3.objectKeys(obj).map(function(e) {
            return obj[e];
          });
        };
        util3.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
          const keys = [];
          for (const key in object) {
            if (Object.prototype.hasOwnProperty.call(object, key)) {
              keys.push(key);
            }
          }
          return keys;
        };
        util3.find = (arr, checker) => {
          for (const item of arr) {
            if (checker(item))
              return item;
          }
          return void 0;
        };
        util3.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
        function joinValues(array, separator = " | ") {
          return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
        }
        util3.joinValues = joinValues;
        util3.jsonStringifyReplacer = (_, value) => {
          if (typeof value === "bigint") {
            return value.toString();
          }
          return value;
        };
      })(util2 || (exports.util = util2 = {}));
      var objectUtil2;
      (function(objectUtil3) {
        objectUtil3.mergeShapes = (first, second) => {
          return {
            ...first,
            ...second
            // second overwrites first
          };
        };
      })(objectUtil2 || (exports.objectUtil = objectUtil2 = {}));
      exports.ZodParsedType = util2.arrayToEnum([
        "string",
        "nan",
        "number",
        "integer",
        "float",
        "boolean",
        "date",
        "bigint",
        "symbol",
        "function",
        "undefined",
        "null",
        "array",
        "object",
        "unknown",
        "promise",
        "void",
        "never",
        "map",
        "set"
      ]);
      var getParsedType2 = (data) => {
        const t = typeof data;
        switch (t) {
          case "undefined":
            return exports.ZodParsedType.undefined;
          case "string":
            return exports.ZodParsedType.string;
          case "number":
            return Number.isNaN(data) ? exports.ZodParsedType.nan : exports.ZodParsedType.number;
          case "boolean":
            return exports.ZodParsedType.boolean;
          case "function":
            return exports.ZodParsedType.function;
          case "bigint":
            return exports.ZodParsedType.bigint;
          case "symbol":
            return exports.ZodParsedType.symbol;
          case "object":
            if (Array.isArray(data)) {
              return exports.ZodParsedType.array;
            }
            if (data === null) {
              return exports.ZodParsedType.null;
            }
            if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
              return exports.ZodParsedType.promise;
            }
            if (typeof Map !== "undefined" && data instanceof Map) {
              return exports.ZodParsedType.map;
            }
            if (typeof Set !== "undefined" && data instanceof Set) {
              return exports.ZodParsedType.set;
            }
            if (typeof Date !== "undefined" && data instanceof Date) {
              return exports.ZodParsedType.date;
            }
            return exports.ZodParsedType.object;
          default:
            return exports.ZodParsedType.unknown;
        }
      };
      exports.getParsedType = getParsedType2;
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.cjs
  var require_ZodError = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.cjs"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ZodError = exports.quotelessJson = exports.ZodIssueCode = void 0;
      var util_js_1 = require_util();
      exports.ZodIssueCode = util_js_1.util.arrayToEnum([
        "invalid_type",
        "invalid_literal",
        "custom",
        "invalid_union",
        "invalid_union_discriminator",
        "invalid_enum_value",
        "unrecognized_keys",
        "invalid_arguments",
        "invalid_return_type",
        "invalid_date",
        "invalid_string",
        "too_small",
        "too_big",
        "invalid_intersection_types",
        "not_multiple_of",
        "not_finite"
      ]);
      var quotelessJson2 = (obj) => {
        const json = JSON.stringify(obj, null, 2);
        return json.replace(/"([^"]+)":/g, "$1:");
      };
      exports.quotelessJson = quotelessJson2;
      var ZodError2 = class _ZodError extends Error {
        get errors() {
          return this.issues;
        }
        constructor(issues) {
          super();
          this.issues = [];
          this.addIssue = (sub) => {
            this.issues = [...this.issues, sub];
          };
          this.addIssues = (subs = []) => {
            this.issues = [...this.issues, ...subs];
          };
          const actualProto = new.target.prototype;
          if (Object.setPrototypeOf) {
            Object.setPrototypeOf(this, actualProto);
          } else {
            this.__proto__ = actualProto;
          }
          this.name = "ZodError";
          this.issues = issues;
        }
        format(_mapper) {
          const mapper = _mapper || function(issue) {
            return issue.message;
          };
          const fieldErrors = { _errors: [] };
          const processError = (error) => {
            for (const issue of error.issues) {
              if (issue.code === "invalid_union") {
                issue.unionErrors.map(processError);
              } else if (issue.code === "invalid_return_type") {
                processError(issue.returnTypeError);
              } else if (issue.code === "invalid_arguments") {
                processError(issue.argumentsError);
              } else if (issue.path.length === 0) {
                fieldErrors._errors.push(mapper(issue));
              } else {
                let curr = fieldErrors;
                let i = 0;
                while (i < issue.path.length) {
                  const el = issue.path[i];
                  const terminal = i === issue.path.length - 1;
                  if (!terminal) {
                    curr[el] = curr[el] || { _errors: [] };
                  } else {
                    curr[el] = curr[el] || { _errors: [] };
                    curr[el]._errors.push(mapper(issue));
                  }
                  curr = curr[el];
                  i++;
                }
              }
            }
          };
          processError(this);
          return fieldErrors;
        }
        static assert(value) {
          if (!(value instanceof _ZodError)) {
            throw new Error(`Not a ZodError: ${value}`);
          }
        }
        toString() {
          return this.message;
        }
        get message() {
          return JSON.stringify(this.issues, util_js_1.util.jsonStringifyReplacer, 2);
        }
        get isEmpty() {
          return this.issues.length === 0;
        }
        flatten(mapper = (issue) => issue.message) {
          const fieldErrors = {};
          const formErrors = [];
          for (const sub of this.issues) {
            if (sub.path.length > 0) {
              const firstEl = sub.path[0];
              fieldErrors[firstEl] = fieldErrors[firstEl] || [];
              fieldErrors[firstEl].push(mapper(sub));
            } else {
              formErrors.push(mapper(sub));
            }
          }
          return { formErrors, fieldErrors };
        }
        get formErrors() {
          return this.flatten();
        }
      };
      exports.ZodError = ZodError2;
      ZodError2.create = (issues) => {
        const error = new ZodError2(issues);
        return error;
      };
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.cjs
  var require_en = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.cjs"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var ZodError_js_1 = require_ZodError();
      var util_js_1 = require_util();
      var errorMap2 = (issue, _ctx) => {
        let message;
        switch (issue.code) {
          case ZodError_js_1.ZodIssueCode.invalid_type:
            if (issue.received === util_js_1.ZodParsedType.undefined) {
              message = "Required";
            } else {
              message = `Expected ${issue.expected}, received ${issue.received}`;
            }
            break;
          case ZodError_js_1.ZodIssueCode.invalid_literal:
            message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util_js_1.util.jsonStringifyReplacer)}`;
            break;
          case ZodError_js_1.ZodIssueCode.unrecognized_keys:
            message = `Unrecognized key(s) in object: ${util_js_1.util.joinValues(issue.keys, ", ")}`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_union:
            message = `Invalid input`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_union_discriminator:
            message = `Invalid discriminator value. Expected ${util_js_1.util.joinValues(issue.options)}`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_enum_value:
            message = `Invalid enum value. Expected ${util_js_1.util.joinValues(issue.options)}, received '${issue.received}'`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_arguments:
            message = `Invalid function arguments`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_return_type:
            message = `Invalid function return type`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_date:
            message = `Invalid date`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_string:
            if (typeof issue.validation === "object") {
              if ("includes" in issue.validation) {
                message = `Invalid input: must include "${issue.validation.includes}"`;
                if (typeof issue.validation.position === "number") {
                  message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
                }
              } else if ("startsWith" in issue.validation) {
                message = `Invalid input: must start with "${issue.validation.startsWith}"`;
              } else if ("endsWith" in issue.validation) {
                message = `Invalid input: must end with "${issue.validation.endsWith}"`;
              } else {
                util_js_1.util.assertNever(issue.validation);
              }
            } else if (issue.validation !== "regex") {
              message = `Invalid ${issue.validation}`;
            } else {
              message = "Invalid";
            }
            break;
          case ZodError_js_1.ZodIssueCode.too_small:
            if (issue.type === "array")
              message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
            else if (issue.type === "string")
              message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
            else if (issue.type === "number")
              message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
            else if (issue.type === "bigint")
              message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
            else if (issue.type === "date")
              message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
            else
              message = "Invalid input";
            break;
          case ZodError_js_1.ZodIssueCode.too_big:
            if (issue.type === "array")
              message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
            else if (issue.type === "string")
              message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
            else if (issue.type === "number")
              message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
            else if (issue.type === "bigint")
              message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
            else if (issue.type === "date")
              message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
            else
              message = "Invalid input";
            break;
          case ZodError_js_1.ZodIssueCode.custom:
            message = `Invalid input`;
            break;
          case ZodError_js_1.ZodIssueCode.invalid_intersection_types:
            message = `Intersection results could not be merged`;
            break;
          case ZodError_js_1.ZodIssueCode.not_multiple_of:
            message = `Number must be a multiple of ${issue.multipleOf}`;
            break;
          case ZodError_js_1.ZodIssueCode.not_finite:
            message = "Number must be finite";
            break;
          default:
            message = _ctx.defaultError;
            util_js_1.util.assertNever(issue);
        }
        return { message };
      };
      exports.default = errorMap2;
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.cjs
  var require_errors = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.cjs"(exports) {
      "use strict";
      var __importDefault = exports && exports.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.defaultErrorMap = void 0;
      exports.setErrorMap = setErrorMap2;
      exports.getErrorMap = getErrorMap2;
      var en_js_1 = __importDefault(require_en());
      exports.defaultErrorMap = en_js_1.default;
      var overrideErrorMap2 = en_js_1.default;
      function setErrorMap2(map) {
        overrideErrorMap2 = map;
      }
      function getErrorMap2() {
        return overrideErrorMap2;
      }
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.cjs
  var require_parseUtil = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.cjs"(exports) {
      "use strict";
      var __importDefault = exports && exports.__importDefault || function(mod) {
        return mod && mod.__esModule ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.isAsync = exports.isValid = exports.isDirty = exports.isAborted = exports.OK = exports.DIRTY = exports.INVALID = exports.ParseStatus = exports.EMPTY_PATH = exports.makeIssue = void 0;
      exports.addIssueToContext = addIssueToContext2;
      var errors_js_1 = require_errors();
      var en_js_1 = __importDefault(require_en());
      var makeIssue2 = (params) => {
        const { data, path, errorMaps, issueData } = params;
        const fullPath = [...path, ...issueData.path || []];
        const fullIssue = {
          ...issueData,
          path: fullPath
        };
        if (issueData.message !== void 0) {
          return {
            ...issueData,
            path: fullPath,
            message: issueData.message
          };
        }
        let errorMessage = "";
        const maps = errorMaps.filter((m) => !!m).slice().reverse();
        for (const map of maps) {
          errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
        }
        return {
          ...issueData,
          path: fullPath,
          message: errorMessage
        };
      };
      exports.makeIssue = makeIssue2;
      exports.EMPTY_PATH = [];
      function addIssueToContext2(ctx, issueData) {
        const overrideMap = (0, errors_js_1.getErrorMap)();
        const issue = (0, exports.makeIssue)({
          issueData,
          data: ctx.data,
          path: ctx.path,
          errorMaps: [
            ctx.common.contextualErrorMap,
            // contextual error map is first priority
            ctx.schemaErrorMap,
            // then schema-bound map if available
            overrideMap,
            // then global override map
            overrideMap === en_js_1.default ? void 0 : en_js_1.default
            // then global default map
          ].filter((x) => !!x)
        });
        ctx.common.issues.push(issue);
      }
      var ParseStatus2 = class _ParseStatus {
        constructor() {
          this.value = "valid";
        }
        dirty() {
          if (this.value === "valid")
            this.value = "dirty";
        }
        abort() {
          if (this.value !== "aborted")
            this.value = "aborted";
        }
        static mergeArray(status, results) {
          const arrayValue = [];
          for (const s of results) {
            if (s.status === "aborted")
              return exports.INVALID;
            if (s.status === "dirty")
              status.dirty();
            arrayValue.push(s.value);
          }
          return { status: status.value, value: arrayValue };
        }
        static async mergeObjectAsync(status, pairs) {
          const syncPairs = [];
          for (const pair of pairs) {
            const key = await pair.key;
            const value = await pair.value;
            syncPairs.push({
              key,
              value
            });
          }
          return _ParseStatus.mergeObjectSync(status, syncPairs);
        }
        static mergeObjectSync(status, pairs) {
          const finalObject = {};
          for (const pair of pairs) {
            const { key, value } = pair;
            if (key.status === "aborted")
              return exports.INVALID;
            if (value.status === "aborted")
              return exports.INVALID;
            if (key.status === "dirty")
              status.dirty();
            if (value.status === "dirty")
              status.dirty();
            if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
              finalObject[key.value] = value.value;
            }
          }
          return { status: status.value, value: finalObject };
        }
      };
      exports.ParseStatus = ParseStatus2;
      exports.INVALID = Object.freeze({
        status: "aborted"
      });
      var DIRTY2 = (value) => ({ status: "dirty", value });
      exports.DIRTY = DIRTY2;
      var OK2 = (value) => ({ status: "valid", value });
      exports.OK = OK2;
      var isAborted2 = (x) => x.status === "aborted";
      exports.isAborted = isAborted2;
      var isDirty2 = (x) => x.status === "dirty";
      exports.isDirty = isDirty2;
      var isValid2 = (x) => x.status === "valid";
      exports.isValid = isValid2;
      var isAsync2 = (x) => typeof Promise !== "undefined" && x instanceof Promise;
      exports.isAsync = isAsync2;
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/typeAliases.cjs
  var require_typeAliases = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/typeAliases.cjs"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.cjs
  var require_errorUtil = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.cjs"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.errorUtil = void 0;
      var errorUtil2;
      (function(errorUtil3) {
        errorUtil3.errToObj = (message) => typeof message === "string" ? { message } : message || {};
        errorUtil3.toString = (message) => typeof message === "string" ? message : message?.message;
      })(errorUtil2 || (exports.errorUtil = errorUtil2 = {}));
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.cjs
  var require_types = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.cjs"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.discriminatedUnion = exports.date = exports.boolean = exports.bigint = exports.array = exports.any = exports.coerce = exports.ZodFirstPartyTypeKind = exports.late = exports.ZodSchema = exports.Schema = exports.ZodReadonly = exports.ZodPipeline = exports.ZodBranded = exports.BRAND = exports.ZodNaN = exports.ZodCatch = exports.ZodDefault = exports.ZodNullable = exports.ZodOptional = exports.ZodTransformer = exports.ZodEffects = exports.ZodPromise = exports.ZodNativeEnum = exports.ZodEnum = exports.ZodLiteral = exports.ZodLazy = exports.ZodFunction = exports.ZodSet = exports.ZodMap = exports.ZodRecord = exports.ZodTuple = exports.ZodIntersection = exports.ZodDiscriminatedUnion = exports.ZodUnion = exports.ZodObject = exports.ZodArray = exports.ZodVoid = exports.ZodNever = exports.ZodUnknown = exports.ZodAny = exports.ZodNull = exports.ZodUndefined = exports.ZodSymbol = exports.ZodDate = exports.ZodBoolean = exports.ZodBigInt = exports.ZodNumber = exports.ZodString = exports.ZodType = void 0;
      exports.NEVER = exports.void = exports.unknown = exports.union = exports.undefined = exports.tuple = exports.transformer = exports.symbol = exports.string = exports.strictObject = exports.set = exports.record = exports.promise = exports.preprocess = exports.pipeline = exports.ostring = exports.optional = exports.onumber = exports.oboolean = exports.object = exports.number = exports.nullable = exports.null = exports.never = exports.nativeEnum = exports.nan = exports.map = exports.literal = exports.lazy = exports.intersection = exports.instanceof = exports.function = exports.enum = exports.effect = void 0;
      exports.datetimeRegex = datetimeRegex2;
      exports.custom = custom2;
      var ZodError_js_1 = require_ZodError();
      var errors_js_1 = require_errors();
      var errorUtil_js_1 = require_errorUtil();
      var parseUtil_js_1 = require_parseUtil();
      var util_js_1 = require_util();
      var ParseInputLazyPath2 = class {
        constructor(parent, value, path, key) {
          this._cachedPath = [];
          this.parent = parent;
          this.data = value;
          this._path = path;
          this._key = key;
        }
        get path() {
          if (!this._cachedPath.length) {
            if (Array.isArray(this._key)) {
              this._cachedPath.push(...this._path, ...this._key);
            } else {
              this._cachedPath.push(...this._path, this._key);
            }
          }
          return this._cachedPath;
        }
      };
      var handleResult2 = (ctx, result) => {
        if ((0, parseUtil_js_1.isValid)(result)) {
          return { success: true, data: result.value };
        } else {
          if (!ctx.common.issues.length) {
            throw new Error("Validation failed but no issues detected.");
          }
          return {
            success: false,
            get error() {
              if (this._error)
                return this._error;
              const error = new ZodError_js_1.ZodError(ctx.common.issues);
              this._error = error;
              return this._error;
            }
          };
        }
      };
      function processCreateParams2(params) {
        if (!params)
          return {};
        const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
        if (errorMap2 && (invalid_type_error || required_error)) {
          throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
        }
        if (errorMap2)
          return { errorMap: errorMap2, description };
        const customMap = (iss, ctx) => {
          const { message } = params;
          if (iss.code === "invalid_enum_value") {
            return { message: message ?? ctx.defaultError };
          }
          if (typeof ctx.data === "undefined") {
            return { message: message ?? required_error ?? ctx.defaultError };
          }
          if (iss.code !== "invalid_type")
            return { message: ctx.defaultError };
          return { message: message ?? invalid_type_error ?? ctx.defaultError };
        };
        return { errorMap: customMap, description };
      }
      var ZodType2 = class {
        get description() {
          return this._def.description;
        }
        _getType(input) {
          return (0, util_js_1.getParsedType)(input.data);
        }
        _getOrReturnCtx(input, ctx) {
          return ctx || {
            common: input.parent.common,
            data: input.data,
            parsedType: (0, util_js_1.getParsedType)(input.data),
            schemaErrorMap: this._def.errorMap,
            path: input.path,
            parent: input.parent
          };
        }
        _processInputParams(input) {
          return {
            status: new parseUtil_js_1.ParseStatus(),
            ctx: {
              common: input.parent.common,
              data: input.data,
              parsedType: (0, util_js_1.getParsedType)(input.data),
              schemaErrorMap: this._def.errorMap,
              path: input.path,
              parent: input.parent
            }
          };
        }
        _parseSync(input) {
          const result = this._parse(input);
          if ((0, parseUtil_js_1.isAsync)(result)) {
            throw new Error("Synchronous parse encountered promise.");
          }
          return result;
        }
        _parseAsync(input) {
          const result = this._parse(input);
          return Promise.resolve(result);
        }
        parse(data, params) {
          const result = this.safeParse(data, params);
          if (result.success)
            return result.data;
          throw result.error;
        }
        safeParse(data, params) {
          const ctx = {
            common: {
              issues: [],
              async: params?.async ?? false,
              contextualErrorMap: params?.errorMap
            },
            path: params?.path || [],
            schemaErrorMap: this._def.errorMap,
            parent: null,
            data,
            parsedType: (0, util_js_1.getParsedType)(data)
          };
          const result = this._parseSync({ data, path: ctx.path, parent: ctx });
          return handleResult2(ctx, result);
        }
        "~validate"(data) {
          const ctx = {
            common: {
              issues: [],
              async: !!this["~standard"].async
            },
            path: [],
            schemaErrorMap: this._def.errorMap,
            parent: null,
            data,
            parsedType: (0, util_js_1.getParsedType)(data)
          };
          if (!this["~standard"].async) {
            try {
              const result = this._parseSync({ data, path: [], parent: ctx });
              return (0, parseUtil_js_1.isValid)(result) ? {
                value: result.value
              } : {
                issues: ctx.common.issues
              };
            } catch (err) {
              if (err?.message?.toLowerCase()?.includes("encountered")) {
                this["~standard"].async = true;
              }
              ctx.common = {
                issues: [],
                async: true
              };
            }
          }
          return this._parseAsync({ data, path: [], parent: ctx }).then((result) => (0, parseUtil_js_1.isValid)(result) ? {
            value: result.value
          } : {
            issues: ctx.common.issues
          });
        }
        async parseAsync(data, params) {
          const result = await this.safeParseAsync(data, params);
          if (result.success)
            return result.data;
          throw result.error;
        }
        async safeParseAsync(data, params) {
          const ctx = {
            common: {
              issues: [],
              contextualErrorMap: params?.errorMap,
              async: true
            },
            path: params?.path || [],
            schemaErrorMap: this._def.errorMap,
            parent: null,
            data,
            parsedType: (0, util_js_1.getParsedType)(data)
          };
          const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
          const result = await ((0, parseUtil_js_1.isAsync)(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
          return handleResult2(ctx, result);
        }
        refine(check, message) {
          const getIssueProperties = (val) => {
            if (typeof message === "string" || typeof message === "undefined") {
              return { message };
            } else if (typeof message === "function") {
              return message(val);
            } else {
              return message;
            }
          };
          return this._refinement((val, ctx) => {
            const result = check(val);
            const setError = () => ctx.addIssue({
              code: ZodError_js_1.ZodIssueCode.custom,
              ...getIssueProperties(val)
            });
            if (typeof Promise !== "undefined" && result instanceof Promise) {
              return result.then((data) => {
                if (!data) {
                  setError();
                  return false;
                } else {
                  return true;
                }
              });
            }
            if (!result) {
              setError();
              return false;
            } else {
              return true;
            }
          });
        }
        refinement(check, refinementData) {
          return this._refinement((val, ctx) => {
            if (!check(val)) {
              ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
              return false;
            } else {
              return true;
            }
          });
        }
        _refinement(refinement) {
          return new ZodEffects2({
            schema: this,
            typeName: ZodFirstPartyTypeKind2.ZodEffects,
            effect: { type: "refinement", refinement }
          });
        }
        superRefine(refinement) {
          return this._refinement(refinement);
        }
        constructor(def) {
          this.spa = this.safeParseAsync;
          this._def = def;
          this.parse = this.parse.bind(this);
          this.safeParse = this.safeParse.bind(this);
          this.parseAsync = this.parseAsync.bind(this);
          this.safeParseAsync = this.safeParseAsync.bind(this);
          this.spa = this.spa.bind(this);
          this.refine = this.refine.bind(this);
          this.refinement = this.refinement.bind(this);
          this.superRefine = this.superRefine.bind(this);
          this.optional = this.optional.bind(this);
          this.nullable = this.nullable.bind(this);
          this.nullish = this.nullish.bind(this);
          this.array = this.array.bind(this);
          this.promise = this.promise.bind(this);
          this.or = this.or.bind(this);
          this.and = this.and.bind(this);
          this.transform = this.transform.bind(this);
          this.brand = this.brand.bind(this);
          this.default = this.default.bind(this);
          this.catch = this.catch.bind(this);
          this.describe = this.describe.bind(this);
          this.pipe = this.pipe.bind(this);
          this.readonly = this.readonly.bind(this);
          this.isNullable = this.isNullable.bind(this);
          this.isOptional = this.isOptional.bind(this);
          this["~standard"] = {
            version: 1,
            vendor: "zod",
            validate: (data) => this["~validate"](data)
          };
        }
        optional() {
          return ZodOptional2.create(this, this._def);
        }
        nullable() {
          return ZodNullable2.create(this, this._def);
        }
        nullish() {
          return this.nullable().optional();
        }
        array() {
          return ZodArray2.create(this);
        }
        promise() {
          return ZodPromise2.create(this, this._def);
        }
        or(option) {
          return ZodUnion2.create([this, option], this._def);
        }
        and(incoming) {
          return ZodIntersection2.create(this, incoming, this._def);
        }
        transform(transform) {
          return new ZodEffects2({
            ...processCreateParams2(this._def),
            schema: this,
            typeName: ZodFirstPartyTypeKind2.ZodEffects,
            effect: { type: "transform", transform }
          });
        }
        default(def) {
          const defaultValueFunc = typeof def === "function" ? def : () => def;
          return new ZodDefault2({
            ...processCreateParams2(this._def),
            innerType: this,
            defaultValue: defaultValueFunc,
            typeName: ZodFirstPartyTypeKind2.ZodDefault
          });
        }
        brand() {
          return new ZodBranded2({
            typeName: ZodFirstPartyTypeKind2.ZodBranded,
            type: this,
            ...processCreateParams2(this._def)
          });
        }
        catch(def) {
          const catchValueFunc = typeof def === "function" ? def : () => def;
          return new ZodCatch2({
            ...processCreateParams2(this._def),
            innerType: this,
            catchValue: catchValueFunc,
            typeName: ZodFirstPartyTypeKind2.ZodCatch
          });
        }
        describe(description) {
          const This = this.constructor;
          return new This({
            ...this._def,
            description
          });
        }
        pipe(target) {
          return ZodPipeline2.create(this, target);
        }
        readonly() {
          return ZodReadonly2.create(this);
        }
        isOptional() {
          return this.safeParse(void 0).success;
        }
        isNullable() {
          return this.safeParse(null).success;
        }
      };
      exports.ZodType = ZodType2;
      exports.Schema = ZodType2;
      exports.ZodSchema = ZodType2;
      var cuidRegex2 = /^c[^\s-]{8,}$/i;
      var cuid2Regex2 = /^[0-9a-z]+$/;
      var ulidRegex2 = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
      var uuidRegex2 = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
      var nanoidRegex2 = /^[a-z0-9_-]{21}$/i;
      var jwtRegex2 = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
      var durationRegex2 = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
      var emailRegex2 = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
      var _emojiRegex2 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
      var emojiRegex2;
      var ipv4Regex2 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
      var ipv4CidrRegex2 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
      var ipv6Regex2 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
      var ipv6CidrRegex2 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
      var base64Regex2 = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
      var base64urlRegex2 = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
      var dateRegexSource2 = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
      var dateRegex2 = new RegExp(`^${dateRegexSource2}$`);
      function timeRegexSource2(args) {
        let secondsRegexSource = `[0-5]\\d`;
        if (args.precision) {
          secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
        } else if (args.precision == null) {
          secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
        }
        const secondsQuantifier = args.precision ? "+" : "?";
        return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
      }
      function timeRegex2(args) {
        return new RegExp(`^${timeRegexSource2(args)}$`);
      }
      function datetimeRegex2(args) {
        let regex = `${dateRegexSource2}T${timeRegexSource2(args)}`;
        const opts = [];
        opts.push(args.local ? `Z?` : `Z`);
        if (args.offset)
          opts.push(`([+-]\\d{2}:?\\d{2})`);
        regex = `${regex}(${opts.join("|")})`;
        return new RegExp(`^${regex}$`);
      }
      function isValidIP2(ip, version) {
        if ((version === "v4" || !version) && ipv4Regex2.test(ip)) {
          return true;
        }
        if ((version === "v6" || !version) && ipv6Regex2.test(ip)) {
          return true;
        }
        return false;
      }
      function isValidJWT2(jwt, alg) {
        if (!jwtRegex2.test(jwt))
          return false;
        try {
          const [header] = jwt.split(".");
          if (!header)
            return false;
          const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
          const decoded = JSON.parse(atob(base64));
          if (typeof decoded !== "object" || decoded === null)
            return false;
          if ("typ" in decoded && decoded?.typ !== "JWT")
            return false;
          if (!decoded.alg)
            return false;
          if (alg && decoded.alg !== alg)
            return false;
          return true;
        } catch {
          return false;
        }
      }
      function isValidCidr2(ip, version) {
        if ((version === "v4" || !version) && ipv4CidrRegex2.test(ip)) {
          return true;
        }
        if ((version === "v6" || !version) && ipv6CidrRegex2.test(ip)) {
          return true;
        }
        return false;
      }
      var ZodString2 = class _ZodString extends ZodType2 {
        _parse(input) {
          if (this._def.coerce) {
            input.data = String(input.data);
          }
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.string) {
            const ctx2 = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx2, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.string,
              received: ctx2.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const status = new parseUtil_js_1.ParseStatus();
          let ctx = void 0;
          for (const check of this._def.checks) {
            if (check.kind === "min") {
              if (input.data.length < check.value) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_small,
                  minimum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: false,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "max") {
              if (input.data.length > check.value) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_big,
                  maximum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: false,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "length") {
              const tooBig = input.data.length > check.value;
              const tooSmall = input.data.length < check.value;
              if (tooBig || tooSmall) {
                ctx = this._getOrReturnCtx(input, ctx);
                if (tooBig) {
                  (0, parseUtil_js_1.addIssueToContext)(ctx, {
                    code: ZodError_js_1.ZodIssueCode.too_big,
                    maximum: check.value,
                    type: "string",
                    inclusive: true,
                    exact: true,
                    message: check.message
                  });
                } else if (tooSmall) {
                  (0, parseUtil_js_1.addIssueToContext)(ctx, {
                    code: ZodError_js_1.ZodIssueCode.too_small,
                    minimum: check.value,
                    type: "string",
                    inclusive: true,
                    exact: true,
                    message: check.message
                  });
                }
                status.dirty();
              }
            } else if (check.kind === "email") {
              if (!emailRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "email",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "emoji") {
              if (!emojiRegex2) {
                emojiRegex2 = new RegExp(_emojiRegex2, "u");
              }
              if (!emojiRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "emoji",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "uuid") {
              if (!uuidRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "uuid",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "nanoid") {
              if (!nanoidRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "nanoid",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "cuid") {
              if (!cuidRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "cuid",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "cuid2") {
              if (!cuid2Regex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "cuid2",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "ulid") {
              if (!ulidRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "ulid",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "url") {
              try {
                new URL(input.data);
              } catch {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "url",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "regex") {
              check.regex.lastIndex = 0;
              const testResult = check.regex.test(input.data);
              if (!testResult) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "regex",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "trim") {
              input.data = input.data.trim();
            } else if (check.kind === "includes") {
              if (!input.data.includes(check.value, check.position)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  validation: { includes: check.value, position: check.position },
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "toLowerCase") {
              input.data = input.data.toLowerCase();
            } else if (check.kind === "toUpperCase") {
              input.data = input.data.toUpperCase();
            } else if (check.kind === "startsWith") {
              if (!input.data.startsWith(check.value)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  validation: { startsWith: check.value },
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "endsWith") {
              if (!input.data.endsWith(check.value)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  validation: { endsWith: check.value },
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "datetime") {
              const regex = datetimeRegex2(check);
              if (!regex.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  validation: "datetime",
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "date") {
              const regex = dateRegex2;
              if (!regex.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  validation: "date",
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "time") {
              const regex = timeRegex2(check);
              if (!regex.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  validation: "time",
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "duration") {
              if (!durationRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "duration",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "ip") {
              if (!isValidIP2(input.data, check.version)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "ip",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "jwt") {
              if (!isValidJWT2(input.data, check.alg)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "jwt",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "cidr") {
              if (!isValidCidr2(input.data, check.version)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "cidr",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "base64") {
              if (!base64Regex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "base64",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "base64url") {
              if (!base64urlRegex2.test(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  validation: "base64url",
                  code: ZodError_js_1.ZodIssueCode.invalid_string,
                  message: check.message
                });
                status.dirty();
              }
            } else {
              util_js_1.util.assertNever(check);
            }
          }
          return { status: status.value, value: input.data };
        }
        _regex(regex, validation, message) {
          return this.refinement((data) => regex.test(data), {
            validation,
            code: ZodError_js_1.ZodIssueCode.invalid_string,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        _addCheck(check) {
          return new _ZodString({
            ...this._def,
            checks: [...this._def.checks, check]
          });
        }
        email(message) {
          return this._addCheck({ kind: "email", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        url(message) {
          return this._addCheck({ kind: "url", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        emoji(message) {
          return this._addCheck({ kind: "emoji", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        uuid(message) {
          return this._addCheck({ kind: "uuid", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        nanoid(message) {
          return this._addCheck({ kind: "nanoid", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        cuid(message) {
          return this._addCheck({ kind: "cuid", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        cuid2(message) {
          return this._addCheck({ kind: "cuid2", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        ulid(message) {
          return this._addCheck({ kind: "ulid", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        base64(message) {
          return this._addCheck({ kind: "base64", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        base64url(message) {
          return this._addCheck({
            kind: "base64url",
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        jwt(options) {
          return this._addCheck({ kind: "jwt", ...errorUtil_js_1.errorUtil.errToObj(options) });
        }
        ip(options) {
          return this._addCheck({ kind: "ip", ...errorUtil_js_1.errorUtil.errToObj(options) });
        }
        cidr(options) {
          return this._addCheck({ kind: "cidr", ...errorUtil_js_1.errorUtil.errToObj(options) });
        }
        datetime(options) {
          if (typeof options === "string") {
            return this._addCheck({
              kind: "datetime",
              precision: null,
              offset: false,
              local: false,
              message: options
            });
          }
          return this._addCheck({
            kind: "datetime",
            precision: typeof options?.precision === "undefined" ? null : options?.precision,
            offset: options?.offset ?? false,
            local: options?.local ?? false,
            ...errorUtil_js_1.errorUtil.errToObj(options?.message)
          });
        }
        date(message) {
          return this._addCheck({ kind: "date", message });
        }
        time(options) {
          if (typeof options === "string") {
            return this._addCheck({
              kind: "time",
              precision: null,
              message: options
            });
          }
          return this._addCheck({
            kind: "time",
            precision: typeof options?.precision === "undefined" ? null : options?.precision,
            ...errorUtil_js_1.errorUtil.errToObj(options?.message)
          });
        }
        duration(message) {
          return this._addCheck({ kind: "duration", ...errorUtil_js_1.errorUtil.errToObj(message) });
        }
        regex(regex, message) {
          return this._addCheck({
            kind: "regex",
            regex,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        includes(value, options) {
          return this._addCheck({
            kind: "includes",
            value,
            position: options?.position,
            ...errorUtil_js_1.errorUtil.errToObj(options?.message)
          });
        }
        startsWith(value, message) {
          return this._addCheck({
            kind: "startsWith",
            value,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        endsWith(value, message) {
          return this._addCheck({
            kind: "endsWith",
            value,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        min(minLength, message) {
          return this._addCheck({
            kind: "min",
            value: minLength,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        max(maxLength, message) {
          return this._addCheck({
            kind: "max",
            value: maxLength,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        length(len, message) {
          return this._addCheck({
            kind: "length",
            value: len,
            ...errorUtil_js_1.errorUtil.errToObj(message)
          });
        }
        /**
         * Equivalent to `.min(1)`
         */
        nonempty(message) {
          return this.min(1, errorUtil_js_1.errorUtil.errToObj(message));
        }
        trim() {
          return new _ZodString({
            ...this._def,
            checks: [...this._def.checks, { kind: "trim" }]
          });
        }
        toLowerCase() {
          return new _ZodString({
            ...this._def,
            checks: [...this._def.checks, { kind: "toLowerCase" }]
          });
        }
        toUpperCase() {
          return new _ZodString({
            ...this._def,
            checks: [...this._def.checks, { kind: "toUpperCase" }]
          });
        }
        get isDatetime() {
          return !!this._def.checks.find((ch) => ch.kind === "datetime");
        }
        get isDate() {
          return !!this._def.checks.find((ch) => ch.kind === "date");
        }
        get isTime() {
          return !!this._def.checks.find((ch) => ch.kind === "time");
        }
        get isDuration() {
          return !!this._def.checks.find((ch) => ch.kind === "duration");
        }
        get isEmail() {
          return !!this._def.checks.find((ch) => ch.kind === "email");
        }
        get isURL() {
          return !!this._def.checks.find((ch) => ch.kind === "url");
        }
        get isEmoji() {
          return !!this._def.checks.find((ch) => ch.kind === "emoji");
        }
        get isUUID() {
          return !!this._def.checks.find((ch) => ch.kind === "uuid");
        }
        get isNANOID() {
          return !!this._def.checks.find((ch) => ch.kind === "nanoid");
        }
        get isCUID() {
          return !!this._def.checks.find((ch) => ch.kind === "cuid");
        }
        get isCUID2() {
          return !!this._def.checks.find((ch) => ch.kind === "cuid2");
        }
        get isULID() {
          return !!this._def.checks.find((ch) => ch.kind === "ulid");
        }
        get isIP() {
          return !!this._def.checks.find((ch) => ch.kind === "ip");
        }
        get isCIDR() {
          return !!this._def.checks.find((ch) => ch.kind === "cidr");
        }
        get isBase64() {
          return !!this._def.checks.find((ch) => ch.kind === "base64");
        }
        get isBase64url() {
          return !!this._def.checks.find((ch) => ch.kind === "base64url");
        }
        get minLength() {
          let min = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "min") {
              if (min === null || ch.value > min)
                min = ch.value;
            }
          }
          return min;
        }
        get maxLength() {
          let max = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "max") {
              if (max === null || ch.value < max)
                max = ch.value;
            }
          }
          return max;
        }
      };
      exports.ZodString = ZodString2;
      ZodString2.create = (params) => {
        return new ZodString2({
          checks: [],
          typeName: ZodFirstPartyTypeKind2.ZodString,
          coerce: params?.coerce ?? false,
          ...processCreateParams2(params)
        });
      };
      function floatSafeRemainder2(val, step) {
        const valDecCount = (val.toString().split(".")[1] || "").length;
        const stepDecCount = (step.toString().split(".")[1] || "").length;
        const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
        const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
        const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
        return valInt % stepInt / 10 ** decCount;
      }
      var ZodNumber2 = class _ZodNumber extends ZodType2 {
        constructor() {
          super(...arguments);
          this.min = this.gte;
          this.max = this.lte;
          this.step = this.multipleOf;
        }
        _parse(input) {
          if (this._def.coerce) {
            input.data = Number(input.data);
          }
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.number) {
            const ctx2 = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx2, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.number,
              received: ctx2.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          let ctx = void 0;
          const status = new parseUtil_js_1.ParseStatus();
          for (const check of this._def.checks) {
            if (check.kind === "int") {
              if (!util_js_1.util.isInteger(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.invalid_type,
                  expected: "integer",
                  received: "float",
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "min") {
              const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
              if (tooSmall) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_small,
                  minimum: check.value,
                  type: "number",
                  inclusive: check.inclusive,
                  exact: false,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "max") {
              const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
              if (tooBig) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_big,
                  maximum: check.value,
                  type: "number",
                  inclusive: check.inclusive,
                  exact: false,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "multipleOf") {
              if (floatSafeRemainder2(input.data, check.value) !== 0) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.not_multiple_of,
                  multipleOf: check.value,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "finite") {
              if (!Number.isFinite(input.data)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.not_finite,
                  message: check.message
                });
                status.dirty();
              }
            } else {
              util_js_1.util.assertNever(check);
            }
          }
          return { status: status.value, value: input.data };
        }
        gte(value, message) {
          return this.setLimit("min", value, true, errorUtil_js_1.errorUtil.toString(message));
        }
        gt(value, message) {
          return this.setLimit("min", value, false, errorUtil_js_1.errorUtil.toString(message));
        }
        lte(value, message) {
          return this.setLimit("max", value, true, errorUtil_js_1.errorUtil.toString(message));
        }
        lt(value, message) {
          return this.setLimit("max", value, false, errorUtil_js_1.errorUtil.toString(message));
        }
        setLimit(kind, value, inclusive, message) {
          return new _ZodNumber({
            ...this._def,
            checks: [
              ...this._def.checks,
              {
                kind,
                value,
                inclusive,
                message: errorUtil_js_1.errorUtil.toString(message)
              }
            ]
          });
        }
        _addCheck(check) {
          return new _ZodNumber({
            ...this._def,
            checks: [...this._def.checks, check]
          });
        }
        int(message) {
          return this._addCheck({
            kind: "int",
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        positive(message) {
          return this._addCheck({
            kind: "min",
            value: 0,
            inclusive: false,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        negative(message) {
          return this._addCheck({
            kind: "max",
            value: 0,
            inclusive: false,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        nonpositive(message) {
          return this._addCheck({
            kind: "max",
            value: 0,
            inclusive: true,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        nonnegative(message) {
          return this._addCheck({
            kind: "min",
            value: 0,
            inclusive: true,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        multipleOf(value, message) {
          return this._addCheck({
            kind: "multipleOf",
            value,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        finite(message) {
          return this._addCheck({
            kind: "finite",
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        safe(message) {
          return this._addCheck({
            kind: "min",
            inclusive: true,
            value: Number.MIN_SAFE_INTEGER,
            message: errorUtil_js_1.errorUtil.toString(message)
          })._addCheck({
            kind: "max",
            inclusive: true,
            value: Number.MAX_SAFE_INTEGER,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        get minValue() {
          let min = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "min") {
              if (min === null || ch.value > min)
                min = ch.value;
            }
          }
          return min;
        }
        get maxValue() {
          let max = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "max") {
              if (max === null || ch.value < max)
                max = ch.value;
            }
          }
          return max;
        }
        get isInt() {
          return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util_js_1.util.isInteger(ch.value));
        }
        get isFinite() {
          let max = null;
          let min = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
              return true;
            } else if (ch.kind === "min") {
              if (min === null || ch.value > min)
                min = ch.value;
            } else if (ch.kind === "max") {
              if (max === null || ch.value < max)
                max = ch.value;
            }
          }
          return Number.isFinite(min) && Number.isFinite(max);
        }
      };
      exports.ZodNumber = ZodNumber2;
      ZodNumber2.create = (params) => {
        return new ZodNumber2({
          checks: [],
          typeName: ZodFirstPartyTypeKind2.ZodNumber,
          coerce: params?.coerce || false,
          ...processCreateParams2(params)
        });
      };
      var ZodBigInt2 = class _ZodBigInt extends ZodType2 {
        constructor() {
          super(...arguments);
          this.min = this.gte;
          this.max = this.lte;
        }
        _parse(input) {
          if (this._def.coerce) {
            try {
              input.data = BigInt(input.data);
            } catch {
              return this._getInvalidInput(input);
            }
          }
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.bigint) {
            return this._getInvalidInput(input);
          }
          let ctx = void 0;
          const status = new parseUtil_js_1.ParseStatus();
          for (const check of this._def.checks) {
            if (check.kind === "min") {
              const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
              if (tooSmall) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_small,
                  type: "bigint",
                  minimum: check.value,
                  inclusive: check.inclusive,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "max") {
              const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
              if (tooBig) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_big,
                  type: "bigint",
                  maximum: check.value,
                  inclusive: check.inclusive,
                  message: check.message
                });
                status.dirty();
              }
            } else if (check.kind === "multipleOf") {
              if (input.data % check.value !== BigInt(0)) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.not_multiple_of,
                  multipleOf: check.value,
                  message: check.message
                });
                status.dirty();
              }
            } else {
              util_js_1.util.assertNever(check);
            }
          }
          return { status: status.value, value: input.data };
        }
        _getInvalidInput(input) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.bigint,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
        gte(value, message) {
          return this.setLimit("min", value, true, errorUtil_js_1.errorUtil.toString(message));
        }
        gt(value, message) {
          return this.setLimit("min", value, false, errorUtil_js_1.errorUtil.toString(message));
        }
        lte(value, message) {
          return this.setLimit("max", value, true, errorUtil_js_1.errorUtil.toString(message));
        }
        lt(value, message) {
          return this.setLimit("max", value, false, errorUtil_js_1.errorUtil.toString(message));
        }
        setLimit(kind, value, inclusive, message) {
          return new _ZodBigInt({
            ...this._def,
            checks: [
              ...this._def.checks,
              {
                kind,
                value,
                inclusive,
                message: errorUtil_js_1.errorUtil.toString(message)
              }
            ]
          });
        }
        _addCheck(check) {
          return new _ZodBigInt({
            ...this._def,
            checks: [...this._def.checks, check]
          });
        }
        positive(message) {
          return this._addCheck({
            kind: "min",
            value: BigInt(0),
            inclusive: false,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        negative(message) {
          return this._addCheck({
            kind: "max",
            value: BigInt(0),
            inclusive: false,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        nonpositive(message) {
          return this._addCheck({
            kind: "max",
            value: BigInt(0),
            inclusive: true,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        nonnegative(message) {
          return this._addCheck({
            kind: "min",
            value: BigInt(0),
            inclusive: true,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        multipleOf(value, message) {
          return this._addCheck({
            kind: "multipleOf",
            value,
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        get minValue() {
          let min = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "min") {
              if (min === null || ch.value > min)
                min = ch.value;
            }
          }
          return min;
        }
        get maxValue() {
          let max = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "max") {
              if (max === null || ch.value < max)
                max = ch.value;
            }
          }
          return max;
        }
      };
      exports.ZodBigInt = ZodBigInt2;
      ZodBigInt2.create = (params) => {
        return new ZodBigInt2({
          checks: [],
          typeName: ZodFirstPartyTypeKind2.ZodBigInt,
          coerce: params?.coerce ?? false,
          ...processCreateParams2(params)
        });
      };
      var ZodBoolean2 = class extends ZodType2 {
        _parse(input) {
          if (this._def.coerce) {
            input.data = Boolean(input.data);
          }
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.boolean) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.boolean,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodBoolean = ZodBoolean2;
      ZodBoolean2.create = (params) => {
        return new ZodBoolean2({
          typeName: ZodFirstPartyTypeKind2.ZodBoolean,
          coerce: params?.coerce || false,
          ...processCreateParams2(params)
        });
      };
      var ZodDate2 = class _ZodDate extends ZodType2 {
        _parse(input) {
          if (this._def.coerce) {
            input.data = new Date(input.data);
          }
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.date) {
            const ctx2 = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx2, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.date,
              received: ctx2.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          if (Number.isNaN(input.data.getTime())) {
            const ctx2 = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx2, {
              code: ZodError_js_1.ZodIssueCode.invalid_date
            });
            return parseUtil_js_1.INVALID;
          }
          const status = new parseUtil_js_1.ParseStatus();
          let ctx = void 0;
          for (const check of this._def.checks) {
            if (check.kind === "min") {
              if (input.data.getTime() < check.value) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_small,
                  message: check.message,
                  inclusive: true,
                  exact: false,
                  minimum: check.value,
                  type: "date"
                });
                status.dirty();
              }
            } else if (check.kind === "max") {
              if (input.data.getTime() > check.value) {
                ctx = this._getOrReturnCtx(input, ctx);
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.too_big,
                  message: check.message,
                  inclusive: true,
                  exact: false,
                  maximum: check.value,
                  type: "date"
                });
                status.dirty();
              }
            } else {
              util_js_1.util.assertNever(check);
            }
          }
          return {
            status: status.value,
            value: new Date(input.data.getTime())
          };
        }
        _addCheck(check) {
          return new _ZodDate({
            ...this._def,
            checks: [...this._def.checks, check]
          });
        }
        min(minDate, message) {
          return this._addCheck({
            kind: "min",
            value: minDate.getTime(),
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        max(maxDate, message) {
          return this._addCheck({
            kind: "max",
            value: maxDate.getTime(),
            message: errorUtil_js_1.errorUtil.toString(message)
          });
        }
        get minDate() {
          let min = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "min") {
              if (min === null || ch.value > min)
                min = ch.value;
            }
          }
          return min != null ? new Date(min) : null;
        }
        get maxDate() {
          let max = null;
          for (const ch of this._def.checks) {
            if (ch.kind === "max") {
              if (max === null || ch.value < max)
                max = ch.value;
            }
          }
          return max != null ? new Date(max) : null;
        }
      };
      exports.ZodDate = ZodDate2;
      ZodDate2.create = (params) => {
        return new ZodDate2({
          checks: [],
          coerce: params?.coerce || false,
          typeName: ZodFirstPartyTypeKind2.ZodDate,
          ...processCreateParams2(params)
        });
      };
      var ZodSymbol2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.symbol) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.symbol,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodSymbol = ZodSymbol2;
      ZodSymbol2.create = (params) => {
        return new ZodSymbol2({
          typeName: ZodFirstPartyTypeKind2.ZodSymbol,
          ...processCreateParams2(params)
        });
      };
      var ZodUndefined2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.undefined) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.undefined,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodUndefined = ZodUndefined2;
      ZodUndefined2.create = (params) => {
        return new ZodUndefined2({
          typeName: ZodFirstPartyTypeKind2.ZodUndefined,
          ...processCreateParams2(params)
        });
      };
      var ZodNull2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.null) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.null,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodNull = ZodNull2;
      ZodNull2.create = (params) => {
        return new ZodNull2({
          typeName: ZodFirstPartyTypeKind2.ZodNull,
          ...processCreateParams2(params)
        });
      };
      var ZodAny2 = class extends ZodType2 {
        constructor() {
          super(...arguments);
          this._any = true;
        }
        _parse(input) {
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodAny = ZodAny2;
      ZodAny2.create = (params) => {
        return new ZodAny2({
          typeName: ZodFirstPartyTypeKind2.ZodAny,
          ...processCreateParams2(params)
        });
      };
      var ZodUnknown2 = class extends ZodType2 {
        constructor() {
          super(...arguments);
          this._unknown = true;
        }
        _parse(input) {
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodUnknown = ZodUnknown2;
      ZodUnknown2.create = (params) => {
        return new ZodUnknown2({
          typeName: ZodFirstPartyTypeKind2.ZodUnknown,
          ...processCreateParams2(params)
        });
      };
      var ZodNever2 = class extends ZodType2 {
        _parse(input) {
          const ctx = this._getOrReturnCtx(input);
          (0, parseUtil_js_1.addIssueToContext)(ctx, {
            code: ZodError_js_1.ZodIssueCode.invalid_type,
            expected: util_js_1.ZodParsedType.never,
            received: ctx.parsedType
          });
          return parseUtil_js_1.INVALID;
        }
      };
      exports.ZodNever = ZodNever2;
      ZodNever2.create = (params) => {
        return new ZodNever2({
          typeName: ZodFirstPartyTypeKind2.ZodNever,
          ...processCreateParams2(params)
        });
      };
      var ZodVoid2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.undefined) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.void,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
      };
      exports.ZodVoid = ZodVoid2;
      ZodVoid2.create = (params) => {
        return new ZodVoid2({
          typeName: ZodFirstPartyTypeKind2.ZodVoid,
          ...processCreateParams2(params)
        });
      };
      var ZodArray2 = class _ZodArray extends ZodType2 {
        _parse(input) {
          const { ctx, status } = this._processInputParams(input);
          const def = this._def;
          if (ctx.parsedType !== util_js_1.ZodParsedType.array) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.array,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          if (def.exactLength !== null) {
            const tooBig = ctx.data.length > def.exactLength.value;
            const tooSmall = ctx.data.length < def.exactLength.value;
            if (tooBig || tooSmall) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: tooBig ? ZodError_js_1.ZodIssueCode.too_big : ZodError_js_1.ZodIssueCode.too_small,
                minimum: tooSmall ? def.exactLength.value : void 0,
                maximum: tooBig ? def.exactLength.value : void 0,
                type: "array",
                inclusive: true,
                exact: true,
                message: def.exactLength.message
              });
              status.dirty();
            }
          }
          if (def.minLength !== null) {
            if (ctx.data.length < def.minLength.value) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_small,
                minimum: def.minLength.value,
                type: "array",
                inclusive: true,
                exact: false,
                message: def.minLength.message
              });
              status.dirty();
            }
          }
          if (def.maxLength !== null) {
            if (ctx.data.length > def.maxLength.value) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_big,
                maximum: def.maxLength.value,
                type: "array",
                inclusive: true,
                exact: false,
                message: def.maxLength.message
              });
              status.dirty();
            }
          }
          if (ctx.common.async) {
            return Promise.all([...ctx.data].map((item, i) => {
              return def.type._parseAsync(new ParseInputLazyPath2(ctx, item, ctx.path, i));
            })).then((result2) => {
              return parseUtil_js_1.ParseStatus.mergeArray(status, result2);
            });
          }
          const result = [...ctx.data].map((item, i) => {
            return def.type._parseSync(new ParseInputLazyPath2(ctx, item, ctx.path, i));
          });
          return parseUtil_js_1.ParseStatus.mergeArray(status, result);
        }
        get element() {
          return this._def.type;
        }
        min(minLength, message) {
          return new _ZodArray({
            ...this._def,
            minLength: { value: minLength, message: errorUtil_js_1.errorUtil.toString(message) }
          });
        }
        max(maxLength, message) {
          return new _ZodArray({
            ...this._def,
            maxLength: { value: maxLength, message: errorUtil_js_1.errorUtil.toString(message) }
          });
        }
        length(len, message) {
          return new _ZodArray({
            ...this._def,
            exactLength: { value: len, message: errorUtil_js_1.errorUtil.toString(message) }
          });
        }
        nonempty(message) {
          return this.min(1, message);
        }
      };
      exports.ZodArray = ZodArray2;
      ZodArray2.create = (schema, params) => {
        return new ZodArray2({
          type: schema,
          minLength: null,
          maxLength: null,
          exactLength: null,
          typeName: ZodFirstPartyTypeKind2.ZodArray,
          ...processCreateParams2(params)
        });
      };
      function deepPartialify2(schema) {
        if (schema instanceof ZodObject2) {
          const newShape = {};
          for (const key in schema.shape) {
            const fieldSchema = schema.shape[key];
            newShape[key] = ZodOptional2.create(deepPartialify2(fieldSchema));
          }
          return new ZodObject2({
            ...schema._def,
            shape: () => newShape
          });
        } else if (schema instanceof ZodArray2) {
          return new ZodArray2({
            ...schema._def,
            type: deepPartialify2(schema.element)
          });
        } else if (schema instanceof ZodOptional2) {
          return ZodOptional2.create(deepPartialify2(schema.unwrap()));
        } else if (schema instanceof ZodNullable2) {
          return ZodNullable2.create(deepPartialify2(schema.unwrap()));
        } else if (schema instanceof ZodTuple2) {
          return ZodTuple2.create(schema.items.map((item) => deepPartialify2(item)));
        } else {
          return schema;
        }
      }
      var ZodObject2 = class _ZodObject extends ZodType2 {
        constructor() {
          super(...arguments);
          this._cached = null;
          this.nonstrict = this.passthrough;
          this.augment = this.extend;
        }
        _getCached() {
          if (this._cached !== null)
            return this._cached;
          const shape = this._def.shape();
          const keys = util_js_1.util.objectKeys(shape);
          this._cached = { shape, keys };
          return this._cached;
        }
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.object) {
            const ctx2 = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx2, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.object,
              received: ctx2.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const { status, ctx } = this._processInputParams(input);
          const { shape, keys: shapeKeys } = this._getCached();
          const extraKeys = [];
          if (!(this._def.catchall instanceof ZodNever2 && this._def.unknownKeys === "strip")) {
            for (const key in ctx.data) {
              if (!shapeKeys.includes(key)) {
                extraKeys.push(key);
              }
            }
          }
          const pairs = [];
          for (const key of shapeKeys) {
            const keyValidator = shape[key];
            const value = ctx.data[key];
            pairs.push({
              key: { status: "valid", value: key },
              value: keyValidator._parse(new ParseInputLazyPath2(ctx, value, ctx.path, key)),
              alwaysSet: key in ctx.data
            });
          }
          if (this._def.catchall instanceof ZodNever2) {
            const unknownKeys = this._def.unknownKeys;
            if (unknownKeys === "passthrough") {
              for (const key of extraKeys) {
                pairs.push({
                  key: { status: "valid", value: key },
                  value: { status: "valid", value: ctx.data[key] }
                });
              }
            } else if (unknownKeys === "strict") {
              if (extraKeys.length > 0) {
                (0, parseUtil_js_1.addIssueToContext)(ctx, {
                  code: ZodError_js_1.ZodIssueCode.unrecognized_keys,
                  keys: extraKeys
                });
                status.dirty();
              }
            } else if (unknownKeys === "strip") {
            } else {
              throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
            }
          } else {
            const catchall = this._def.catchall;
            for (const key of extraKeys) {
              const value = ctx.data[key];
              pairs.push({
                key: { status: "valid", value: key },
                value: catchall._parse(
                  new ParseInputLazyPath2(ctx, value, ctx.path, key)
                  //, ctx.child(key), value, getParsedType(value)
                ),
                alwaysSet: key in ctx.data
              });
            }
          }
          if (ctx.common.async) {
            return Promise.resolve().then(async () => {
              const syncPairs = [];
              for (const pair of pairs) {
                const key = await pair.key;
                const value = await pair.value;
                syncPairs.push({
                  key,
                  value,
                  alwaysSet: pair.alwaysSet
                });
              }
              return syncPairs;
            }).then((syncPairs) => {
              return parseUtil_js_1.ParseStatus.mergeObjectSync(status, syncPairs);
            });
          } else {
            return parseUtil_js_1.ParseStatus.mergeObjectSync(status, pairs);
          }
        }
        get shape() {
          return this._def.shape();
        }
        strict(message) {
          errorUtil_js_1.errorUtil.errToObj;
          return new _ZodObject({
            ...this._def,
            unknownKeys: "strict",
            ...message !== void 0 ? {
              errorMap: (issue, ctx) => {
                const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
                if (issue.code === "unrecognized_keys")
                  return {
                    message: errorUtil_js_1.errorUtil.errToObj(message).message ?? defaultError
                  };
                return {
                  message: defaultError
                };
              }
            } : {}
          });
        }
        strip() {
          return new _ZodObject({
            ...this._def,
            unknownKeys: "strip"
          });
        }
        passthrough() {
          return new _ZodObject({
            ...this._def,
            unknownKeys: "passthrough"
          });
        }
        // const AugmentFactory =
        //   <Def extends ZodObjectDef>(def: Def) =>
        //   <Augmentation extends ZodRawShape>(
        //     augmentation: Augmentation
        //   ): ZodObject<
        //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
        //     Def["unknownKeys"],
        //     Def["catchall"]
        //   > => {
        //     return new ZodObject({
        //       ...def,
        //       shape: () => ({
        //         ...def.shape(),
        //         ...augmentation,
        //       }),
        //     }) as any;
        //   };
        extend(augmentation) {
          return new _ZodObject({
            ...this._def,
            shape: () => ({
              ...this._def.shape(),
              ...augmentation
            })
          });
        }
        /**
         * Prior to zod@1.0.12 there was a bug in the
         * inferred type of merged objects. Please
         * upgrade if you are experiencing issues.
         */
        merge(merging) {
          const merged = new _ZodObject({
            unknownKeys: merging._def.unknownKeys,
            catchall: merging._def.catchall,
            shape: () => ({
              ...this._def.shape(),
              ...merging._def.shape()
            }),
            typeName: ZodFirstPartyTypeKind2.ZodObject
          });
          return merged;
        }
        // merge<
        //   Incoming extends AnyZodObject,
        //   Augmentation extends Incoming["shape"],
        //   NewOutput extends {
        //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
        //       ? Augmentation[k]["_output"]
        //       : k extends keyof Output
        //       ? Output[k]
        //       : never;
        //   },
        //   NewInput extends {
        //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
        //       ? Augmentation[k]["_input"]
        //       : k extends keyof Input
        //       ? Input[k]
        //       : never;
        //   }
        // >(
        //   merging: Incoming
        // ): ZodObject<
        //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
        //   Incoming["_def"]["unknownKeys"],
        //   Incoming["_def"]["catchall"],
        //   NewOutput,
        //   NewInput
        // > {
        //   const merged: any = new ZodObject({
        //     unknownKeys: merging._def.unknownKeys,
        //     catchall: merging._def.catchall,
        //     shape: () =>
        //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
        //     typeName: ZodFirstPartyTypeKind.ZodObject,
        //   }) as any;
        //   return merged;
        // }
        setKey(key, schema) {
          return this.augment({ [key]: schema });
        }
        // merge<Incoming extends AnyZodObject>(
        //   merging: Incoming
        // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
        // ZodObject<
        //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
        //   Incoming["_def"]["unknownKeys"],
        //   Incoming["_def"]["catchall"]
        // > {
        //   // const mergedShape = objectUtil.mergeShapes(
        //   //   this._def.shape(),
        //   //   merging._def.shape()
        //   // );
        //   const merged: any = new ZodObject({
        //     unknownKeys: merging._def.unknownKeys,
        //     catchall: merging._def.catchall,
        //     shape: () =>
        //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
        //     typeName: ZodFirstPartyTypeKind.ZodObject,
        //   }) as any;
        //   return merged;
        // }
        catchall(index) {
          return new _ZodObject({
            ...this._def,
            catchall: index
          });
        }
        pick(mask) {
          const shape = {};
          for (const key of util_js_1.util.objectKeys(mask)) {
            if (mask[key] && this.shape[key]) {
              shape[key] = this.shape[key];
            }
          }
          return new _ZodObject({
            ...this._def,
            shape: () => shape
          });
        }
        omit(mask) {
          const shape = {};
          for (const key of util_js_1.util.objectKeys(this.shape)) {
            if (!mask[key]) {
              shape[key] = this.shape[key];
            }
          }
          return new _ZodObject({
            ...this._def,
            shape: () => shape
          });
        }
        /**
         * @deprecated
         */
        deepPartial() {
          return deepPartialify2(this);
        }
        partial(mask) {
          const newShape = {};
          for (const key of util_js_1.util.objectKeys(this.shape)) {
            const fieldSchema = this.shape[key];
            if (mask && !mask[key]) {
              newShape[key] = fieldSchema;
            } else {
              newShape[key] = fieldSchema.optional();
            }
          }
          return new _ZodObject({
            ...this._def,
            shape: () => newShape
          });
        }
        required(mask) {
          const newShape = {};
          for (const key of util_js_1.util.objectKeys(this.shape)) {
            if (mask && !mask[key]) {
              newShape[key] = this.shape[key];
            } else {
              const fieldSchema = this.shape[key];
              let newField = fieldSchema;
              while (newField instanceof ZodOptional2) {
                newField = newField._def.innerType;
              }
              newShape[key] = newField;
            }
          }
          return new _ZodObject({
            ...this._def,
            shape: () => newShape
          });
        }
        keyof() {
          return createZodEnum2(util_js_1.util.objectKeys(this.shape));
        }
      };
      exports.ZodObject = ZodObject2;
      ZodObject2.create = (shape, params) => {
        return new ZodObject2({
          shape: () => shape,
          unknownKeys: "strip",
          catchall: ZodNever2.create(),
          typeName: ZodFirstPartyTypeKind2.ZodObject,
          ...processCreateParams2(params)
        });
      };
      ZodObject2.strictCreate = (shape, params) => {
        return new ZodObject2({
          shape: () => shape,
          unknownKeys: "strict",
          catchall: ZodNever2.create(),
          typeName: ZodFirstPartyTypeKind2.ZodObject,
          ...processCreateParams2(params)
        });
      };
      ZodObject2.lazycreate = (shape, params) => {
        return new ZodObject2({
          shape,
          unknownKeys: "strip",
          catchall: ZodNever2.create(),
          typeName: ZodFirstPartyTypeKind2.ZodObject,
          ...processCreateParams2(params)
        });
      };
      var ZodUnion2 = class extends ZodType2 {
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          const options = this._def.options;
          function handleResults(results) {
            for (const result of results) {
              if (result.result.status === "valid") {
                return result.result;
              }
            }
            for (const result of results) {
              if (result.result.status === "dirty") {
                ctx.common.issues.push(...result.ctx.common.issues);
                return result.result;
              }
            }
            const unionErrors = results.map((result) => new ZodError_js_1.ZodError(result.ctx.common.issues));
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_union,
              unionErrors
            });
            return parseUtil_js_1.INVALID;
          }
          if (ctx.common.async) {
            return Promise.all(options.map(async (option) => {
              const childCtx = {
                ...ctx,
                common: {
                  ...ctx.common,
                  issues: []
                },
                parent: null
              };
              return {
                result: await option._parseAsync({
                  data: ctx.data,
                  path: ctx.path,
                  parent: childCtx
                }),
                ctx: childCtx
              };
            })).then(handleResults);
          } else {
            let dirty = void 0;
            const issues = [];
            for (const option of options) {
              const childCtx = {
                ...ctx,
                common: {
                  ...ctx.common,
                  issues: []
                },
                parent: null
              };
              const result = option._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: childCtx
              });
              if (result.status === "valid") {
                return result;
              } else if (result.status === "dirty" && !dirty) {
                dirty = { result, ctx: childCtx };
              }
              if (childCtx.common.issues.length) {
                issues.push(childCtx.common.issues);
              }
            }
            if (dirty) {
              ctx.common.issues.push(...dirty.ctx.common.issues);
              return dirty.result;
            }
            const unionErrors = issues.map((issues2) => new ZodError_js_1.ZodError(issues2));
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_union,
              unionErrors
            });
            return parseUtil_js_1.INVALID;
          }
        }
        get options() {
          return this._def.options;
        }
      };
      exports.ZodUnion = ZodUnion2;
      ZodUnion2.create = (types, params) => {
        return new ZodUnion2({
          options: types,
          typeName: ZodFirstPartyTypeKind2.ZodUnion,
          ...processCreateParams2(params)
        });
      };
      var getDiscriminator2 = (type) => {
        if (type instanceof ZodLazy2) {
          return getDiscriminator2(type.schema);
        } else if (type instanceof ZodEffects2) {
          return getDiscriminator2(type.innerType());
        } else if (type instanceof ZodLiteral2) {
          return [type.value];
        } else if (type instanceof ZodEnum2) {
          return type.options;
        } else if (type instanceof ZodNativeEnum2) {
          return util_js_1.util.objectValues(type.enum);
        } else if (type instanceof ZodDefault2) {
          return getDiscriminator2(type._def.innerType);
        } else if (type instanceof ZodUndefined2) {
          return [void 0];
        } else if (type instanceof ZodNull2) {
          return [null];
        } else if (type instanceof ZodOptional2) {
          return [void 0, ...getDiscriminator2(type.unwrap())];
        } else if (type instanceof ZodNullable2) {
          return [null, ...getDiscriminator2(type.unwrap())];
        } else if (type instanceof ZodBranded2) {
          return getDiscriminator2(type.unwrap());
        } else if (type instanceof ZodReadonly2) {
          return getDiscriminator2(type.unwrap());
        } else if (type instanceof ZodCatch2) {
          return getDiscriminator2(type._def.innerType);
        } else {
          return [];
        }
      };
      var ZodDiscriminatedUnion2 = class _ZodDiscriminatedUnion extends ZodType2 {
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.object) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.object,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const discriminator = this.discriminator;
          const discriminatorValue = ctx.data[discriminator];
          const option = this.optionsMap.get(discriminatorValue);
          if (!option) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_union_discriminator,
              options: Array.from(this.optionsMap.keys()),
              path: [discriminator]
            });
            return parseUtil_js_1.INVALID;
          }
          if (ctx.common.async) {
            return option._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
          } else {
            return option._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
          }
        }
        get discriminator() {
          return this._def.discriminator;
        }
        get options() {
          return this._def.options;
        }
        get optionsMap() {
          return this._def.optionsMap;
        }
        /**
         * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
         * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
         * have a different value for each object in the union.
         * @param discriminator the name of the discriminator property
         * @param types an array of object schemas
         * @param params
         */
        static create(discriminator, options, params) {
          const optionsMap = /* @__PURE__ */ new Map();
          for (const type of options) {
            const discriminatorValues = getDiscriminator2(type.shape[discriminator]);
            if (!discriminatorValues.length) {
              throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
            }
            for (const value of discriminatorValues) {
              if (optionsMap.has(value)) {
                throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
              }
              optionsMap.set(value, type);
            }
          }
          return new _ZodDiscriminatedUnion({
            typeName: ZodFirstPartyTypeKind2.ZodDiscriminatedUnion,
            discriminator,
            options,
            optionsMap,
            ...processCreateParams2(params)
          });
        }
      };
      exports.ZodDiscriminatedUnion = ZodDiscriminatedUnion2;
      function mergeValues2(a, b) {
        const aType = (0, util_js_1.getParsedType)(a);
        const bType = (0, util_js_1.getParsedType)(b);
        if (a === b) {
          return { valid: true, data: a };
        } else if (aType === util_js_1.ZodParsedType.object && bType === util_js_1.ZodParsedType.object) {
          const bKeys = util_js_1.util.objectKeys(b);
          const sharedKeys = util_js_1.util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
          const newObj = { ...a, ...b };
          for (const key of sharedKeys) {
            const sharedValue = mergeValues2(a[key], b[key]);
            if (!sharedValue.valid) {
              return { valid: false };
            }
            newObj[key] = sharedValue.data;
          }
          return { valid: true, data: newObj };
        } else if (aType === util_js_1.ZodParsedType.array && bType === util_js_1.ZodParsedType.array) {
          if (a.length !== b.length) {
            return { valid: false };
          }
          const newArray = [];
          for (let index = 0; index < a.length; index++) {
            const itemA = a[index];
            const itemB = b[index];
            const sharedValue = mergeValues2(itemA, itemB);
            if (!sharedValue.valid) {
              return { valid: false };
            }
            newArray.push(sharedValue.data);
          }
          return { valid: true, data: newArray };
        } else if (aType === util_js_1.ZodParsedType.date && bType === util_js_1.ZodParsedType.date && +a === +b) {
          return { valid: true, data: a };
        } else {
          return { valid: false };
        }
      }
      var ZodIntersection2 = class extends ZodType2 {
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          const handleParsed = (parsedLeft, parsedRight) => {
            if ((0, parseUtil_js_1.isAborted)(parsedLeft) || (0, parseUtil_js_1.isAborted)(parsedRight)) {
              return parseUtil_js_1.INVALID;
            }
            const merged = mergeValues2(parsedLeft.value, parsedRight.value);
            if (!merged.valid) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.invalid_intersection_types
              });
              return parseUtil_js_1.INVALID;
            }
            if ((0, parseUtil_js_1.isDirty)(parsedLeft) || (0, parseUtil_js_1.isDirty)(parsedRight)) {
              status.dirty();
            }
            return { status: status.value, value: merged.data };
          };
          if (ctx.common.async) {
            return Promise.all([
              this._def.left._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx
              }),
              this._def.right._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx
              })
            ]).then(([left, right]) => handleParsed(left, right));
          } else {
            return handleParsed(this._def.left._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            }), this._def.right._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            }));
          }
        }
      };
      exports.ZodIntersection = ZodIntersection2;
      ZodIntersection2.create = (left, right, params) => {
        return new ZodIntersection2({
          left,
          right,
          typeName: ZodFirstPartyTypeKind2.ZodIntersection,
          ...processCreateParams2(params)
        });
      };
      var ZodTuple2 = class _ZodTuple extends ZodType2 {
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.array) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.array,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          if (ctx.data.length < this._def.items.length) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.too_small,
              minimum: this._def.items.length,
              inclusive: true,
              exact: false,
              type: "array"
            });
            return parseUtil_js_1.INVALID;
          }
          const rest = this._def.rest;
          if (!rest && ctx.data.length > this._def.items.length) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.too_big,
              maximum: this._def.items.length,
              inclusive: true,
              exact: false,
              type: "array"
            });
            status.dirty();
          }
          const items = [...ctx.data].map((item, itemIndex) => {
            const schema = this._def.items[itemIndex] || this._def.rest;
            if (!schema)
              return null;
            return schema._parse(new ParseInputLazyPath2(ctx, item, ctx.path, itemIndex));
          }).filter((x) => !!x);
          if (ctx.common.async) {
            return Promise.all(items).then((results) => {
              return parseUtil_js_1.ParseStatus.mergeArray(status, results);
            });
          } else {
            return parseUtil_js_1.ParseStatus.mergeArray(status, items);
          }
        }
        get items() {
          return this._def.items;
        }
        rest(rest) {
          return new _ZodTuple({
            ...this._def,
            rest
          });
        }
      };
      exports.ZodTuple = ZodTuple2;
      ZodTuple2.create = (schemas, params) => {
        if (!Array.isArray(schemas)) {
          throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
        }
        return new ZodTuple2({
          items: schemas,
          typeName: ZodFirstPartyTypeKind2.ZodTuple,
          rest: null,
          ...processCreateParams2(params)
        });
      };
      var ZodRecord2 = class _ZodRecord extends ZodType2 {
        get keySchema() {
          return this._def.keyType;
        }
        get valueSchema() {
          return this._def.valueType;
        }
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.object) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.object,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const pairs = [];
          const keyType = this._def.keyType;
          const valueType = this._def.valueType;
          for (const key in ctx.data) {
            pairs.push({
              key: keyType._parse(new ParseInputLazyPath2(ctx, key, ctx.path, key)),
              value: valueType._parse(new ParseInputLazyPath2(ctx, ctx.data[key], ctx.path, key)),
              alwaysSet: key in ctx.data
            });
          }
          if (ctx.common.async) {
            return parseUtil_js_1.ParseStatus.mergeObjectAsync(status, pairs);
          } else {
            return parseUtil_js_1.ParseStatus.mergeObjectSync(status, pairs);
          }
        }
        get element() {
          return this._def.valueType;
        }
        static create(first, second, third) {
          if (second instanceof ZodType2) {
            return new _ZodRecord({
              keyType: first,
              valueType: second,
              typeName: ZodFirstPartyTypeKind2.ZodRecord,
              ...processCreateParams2(third)
            });
          }
          return new _ZodRecord({
            keyType: ZodString2.create(),
            valueType: first,
            typeName: ZodFirstPartyTypeKind2.ZodRecord,
            ...processCreateParams2(second)
          });
        }
      };
      exports.ZodRecord = ZodRecord2;
      var ZodMap2 = class extends ZodType2 {
        get keySchema() {
          return this._def.keyType;
        }
        get valueSchema() {
          return this._def.valueType;
        }
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.map) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.map,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const keyType = this._def.keyType;
          const valueType = this._def.valueType;
          const pairs = [...ctx.data.entries()].map(([key, value], index) => {
            return {
              key: keyType._parse(new ParseInputLazyPath2(ctx, key, ctx.path, [index, "key"])),
              value: valueType._parse(new ParseInputLazyPath2(ctx, value, ctx.path, [index, "value"]))
            };
          });
          if (ctx.common.async) {
            const finalMap = /* @__PURE__ */ new Map();
            return Promise.resolve().then(async () => {
              for (const pair of pairs) {
                const key = await pair.key;
                const value = await pair.value;
                if (key.status === "aborted" || value.status === "aborted") {
                  return parseUtil_js_1.INVALID;
                }
                if (key.status === "dirty" || value.status === "dirty") {
                  status.dirty();
                }
                finalMap.set(key.value, value.value);
              }
              return { status: status.value, value: finalMap };
            });
          } else {
            const finalMap = /* @__PURE__ */ new Map();
            for (const pair of pairs) {
              const key = pair.key;
              const value = pair.value;
              if (key.status === "aborted" || value.status === "aborted") {
                return parseUtil_js_1.INVALID;
              }
              if (key.status === "dirty" || value.status === "dirty") {
                status.dirty();
              }
              finalMap.set(key.value, value.value);
            }
            return { status: status.value, value: finalMap };
          }
        }
      };
      exports.ZodMap = ZodMap2;
      ZodMap2.create = (keyType, valueType, params) => {
        return new ZodMap2({
          valueType,
          keyType,
          typeName: ZodFirstPartyTypeKind2.ZodMap,
          ...processCreateParams2(params)
        });
      };
      var ZodSet2 = class _ZodSet extends ZodType2 {
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.set) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.set,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const def = this._def;
          if (def.minSize !== null) {
            if (ctx.data.size < def.minSize.value) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_small,
                minimum: def.minSize.value,
                type: "set",
                inclusive: true,
                exact: false,
                message: def.minSize.message
              });
              status.dirty();
            }
          }
          if (def.maxSize !== null) {
            if (ctx.data.size > def.maxSize.value) {
              (0, parseUtil_js_1.addIssueToContext)(ctx, {
                code: ZodError_js_1.ZodIssueCode.too_big,
                maximum: def.maxSize.value,
                type: "set",
                inclusive: true,
                exact: false,
                message: def.maxSize.message
              });
              status.dirty();
            }
          }
          const valueType = this._def.valueType;
          function finalizeSet(elements2) {
            const parsedSet = /* @__PURE__ */ new Set();
            for (const element of elements2) {
              if (element.status === "aborted")
                return parseUtil_js_1.INVALID;
              if (element.status === "dirty")
                status.dirty();
              parsedSet.add(element.value);
            }
            return { status: status.value, value: parsedSet };
          }
          const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath2(ctx, item, ctx.path, i)));
          if (ctx.common.async) {
            return Promise.all(elements).then((elements2) => finalizeSet(elements2));
          } else {
            return finalizeSet(elements);
          }
        }
        min(minSize, message) {
          return new _ZodSet({
            ...this._def,
            minSize: { value: minSize, message: errorUtil_js_1.errorUtil.toString(message) }
          });
        }
        max(maxSize, message) {
          return new _ZodSet({
            ...this._def,
            maxSize: { value: maxSize, message: errorUtil_js_1.errorUtil.toString(message) }
          });
        }
        size(size, message) {
          return this.min(size, message).max(size, message);
        }
        nonempty(message) {
          return this.min(1, message);
        }
      };
      exports.ZodSet = ZodSet2;
      ZodSet2.create = (valueType, params) => {
        return new ZodSet2({
          valueType,
          minSize: null,
          maxSize: null,
          typeName: ZodFirstPartyTypeKind2.ZodSet,
          ...processCreateParams2(params)
        });
      };
      var ZodFunction2 = class _ZodFunction extends ZodType2 {
        constructor() {
          super(...arguments);
          this.validate = this.implement;
        }
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.function) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.function,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          function makeArgsIssue(args, error) {
            return (0, parseUtil_js_1.makeIssue)({
              data: args,
              path: ctx.path,
              errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, (0, errors_js_1.getErrorMap)(), errors_js_1.defaultErrorMap].filter((x) => !!x),
              issueData: {
                code: ZodError_js_1.ZodIssueCode.invalid_arguments,
                argumentsError: error
              }
            });
          }
          function makeReturnsIssue(returns, error) {
            return (0, parseUtil_js_1.makeIssue)({
              data: returns,
              path: ctx.path,
              errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, (0, errors_js_1.getErrorMap)(), errors_js_1.defaultErrorMap].filter((x) => !!x),
              issueData: {
                code: ZodError_js_1.ZodIssueCode.invalid_return_type,
                returnTypeError: error
              }
            });
          }
          const params = { errorMap: ctx.common.contextualErrorMap };
          const fn = ctx.data;
          if (this._def.returns instanceof ZodPromise2) {
            const me = this;
            return (0, parseUtil_js_1.OK)(async function(...args) {
              const error = new ZodError_js_1.ZodError([]);
              const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
                error.addIssue(makeArgsIssue(args, e));
                throw error;
              });
              const result = await Reflect.apply(fn, this, parsedArgs);
              const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
                error.addIssue(makeReturnsIssue(result, e));
                throw error;
              });
              return parsedReturns;
            });
          } else {
            const me = this;
            return (0, parseUtil_js_1.OK)(function(...args) {
              const parsedArgs = me._def.args.safeParse(args, params);
              if (!parsedArgs.success) {
                throw new ZodError_js_1.ZodError([makeArgsIssue(args, parsedArgs.error)]);
              }
              const result = Reflect.apply(fn, this, parsedArgs.data);
              const parsedReturns = me._def.returns.safeParse(result, params);
              if (!parsedReturns.success) {
                throw new ZodError_js_1.ZodError([makeReturnsIssue(result, parsedReturns.error)]);
              }
              return parsedReturns.data;
            });
          }
        }
        parameters() {
          return this._def.args;
        }
        returnType() {
          return this._def.returns;
        }
        args(...items) {
          return new _ZodFunction({
            ...this._def,
            args: ZodTuple2.create(items).rest(ZodUnknown2.create())
          });
        }
        returns(returnType) {
          return new _ZodFunction({
            ...this._def,
            returns: returnType
          });
        }
        implement(func) {
          const validatedFunc = this.parse(func);
          return validatedFunc;
        }
        strictImplement(func) {
          const validatedFunc = this.parse(func);
          return validatedFunc;
        }
        static create(args, returns, params) {
          return new _ZodFunction({
            args: args ? args : ZodTuple2.create([]).rest(ZodUnknown2.create()),
            returns: returns || ZodUnknown2.create(),
            typeName: ZodFirstPartyTypeKind2.ZodFunction,
            ...processCreateParams2(params)
          });
        }
      };
      exports.ZodFunction = ZodFunction2;
      var ZodLazy2 = class extends ZodType2 {
        get schema() {
          return this._def.getter();
        }
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          const lazySchema = this._def.getter();
          return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
        }
      };
      exports.ZodLazy = ZodLazy2;
      ZodLazy2.create = (getter, params) => {
        return new ZodLazy2({
          getter,
          typeName: ZodFirstPartyTypeKind2.ZodLazy,
          ...processCreateParams2(params)
        });
      };
      var ZodLiteral2 = class extends ZodType2 {
        _parse(input) {
          if (input.data !== this._def.value) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              received: ctx.data,
              code: ZodError_js_1.ZodIssueCode.invalid_literal,
              expected: this._def.value
            });
            return parseUtil_js_1.INVALID;
          }
          return { status: "valid", value: input.data };
        }
        get value() {
          return this._def.value;
        }
      };
      exports.ZodLiteral = ZodLiteral2;
      ZodLiteral2.create = (value, params) => {
        return new ZodLiteral2({
          value,
          typeName: ZodFirstPartyTypeKind2.ZodLiteral,
          ...processCreateParams2(params)
        });
      };
      function createZodEnum2(values, params) {
        return new ZodEnum2({
          values,
          typeName: ZodFirstPartyTypeKind2.ZodEnum,
          ...processCreateParams2(params)
        });
      }
      var ZodEnum2 = class _ZodEnum extends ZodType2 {
        _parse(input) {
          if (typeof input.data !== "string") {
            const ctx = this._getOrReturnCtx(input);
            const expectedValues = this._def.values;
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              expected: util_js_1.util.joinValues(expectedValues),
              received: ctx.parsedType,
              code: ZodError_js_1.ZodIssueCode.invalid_type
            });
            return parseUtil_js_1.INVALID;
          }
          if (!this._cache) {
            this._cache = new Set(this._def.values);
          }
          if (!this._cache.has(input.data)) {
            const ctx = this._getOrReturnCtx(input);
            const expectedValues = this._def.values;
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              received: ctx.data,
              code: ZodError_js_1.ZodIssueCode.invalid_enum_value,
              options: expectedValues
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
        get options() {
          return this._def.values;
        }
        get enum() {
          const enumValues = {};
          for (const val of this._def.values) {
            enumValues[val] = val;
          }
          return enumValues;
        }
        get Values() {
          const enumValues = {};
          for (const val of this._def.values) {
            enumValues[val] = val;
          }
          return enumValues;
        }
        get Enum() {
          const enumValues = {};
          for (const val of this._def.values) {
            enumValues[val] = val;
          }
          return enumValues;
        }
        extract(values, newDef = this._def) {
          return _ZodEnum.create(values, {
            ...this._def,
            ...newDef
          });
        }
        exclude(values, newDef = this._def) {
          return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
            ...this._def,
            ...newDef
          });
        }
      };
      exports.ZodEnum = ZodEnum2;
      ZodEnum2.create = createZodEnum2;
      var ZodNativeEnum2 = class extends ZodType2 {
        _parse(input) {
          const nativeEnumValues = util_js_1.util.getValidEnumValues(this._def.values);
          const ctx = this._getOrReturnCtx(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.string && ctx.parsedType !== util_js_1.ZodParsedType.number) {
            const expectedValues = util_js_1.util.objectValues(nativeEnumValues);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              expected: util_js_1.util.joinValues(expectedValues),
              received: ctx.parsedType,
              code: ZodError_js_1.ZodIssueCode.invalid_type
            });
            return parseUtil_js_1.INVALID;
          }
          if (!this._cache) {
            this._cache = new Set(util_js_1.util.getValidEnumValues(this._def.values));
          }
          if (!this._cache.has(input.data)) {
            const expectedValues = util_js_1.util.objectValues(nativeEnumValues);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              received: ctx.data,
              code: ZodError_js_1.ZodIssueCode.invalid_enum_value,
              options: expectedValues
            });
            return parseUtil_js_1.INVALID;
          }
          return (0, parseUtil_js_1.OK)(input.data);
        }
        get enum() {
          return this._def.values;
        }
      };
      exports.ZodNativeEnum = ZodNativeEnum2;
      ZodNativeEnum2.create = (values, params) => {
        return new ZodNativeEnum2({
          values,
          typeName: ZodFirstPartyTypeKind2.ZodNativeEnum,
          ...processCreateParams2(params)
        });
      };
      var ZodPromise2 = class extends ZodType2 {
        unwrap() {
          return this._def.type;
        }
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          if (ctx.parsedType !== util_js_1.ZodParsedType.promise && ctx.common.async === false) {
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.promise,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          const promisified = ctx.parsedType === util_js_1.ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
          return (0, parseUtil_js_1.OK)(promisified.then((data) => {
            return this._def.type.parseAsync(data, {
              path: ctx.path,
              errorMap: ctx.common.contextualErrorMap
            });
          }));
        }
      };
      exports.ZodPromise = ZodPromise2;
      ZodPromise2.create = (schema, params) => {
        return new ZodPromise2({
          type: schema,
          typeName: ZodFirstPartyTypeKind2.ZodPromise,
          ...processCreateParams2(params)
        });
      };
      var ZodEffects2 = class extends ZodType2 {
        innerType() {
          return this._def.schema;
        }
        sourceType() {
          return this._def.schema._def.typeName === ZodFirstPartyTypeKind2.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
        }
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          const effect = this._def.effect || null;
          const checkCtx = {
            addIssue: (arg) => {
              (0, parseUtil_js_1.addIssueToContext)(ctx, arg);
              if (arg.fatal) {
                status.abort();
              } else {
                status.dirty();
              }
            },
            get path() {
              return ctx.path;
            }
          };
          checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
          if (effect.type === "preprocess") {
            const processed = effect.transform(ctx.data, checkCtx);
            if (ctx.common.async) {
              return Promise.resolve(processed).then(async (processed2) => {
                if (status.value === "aborted")
                  return parseUtil_js_1.INVALID;
                const result = await this._def.schema._parseAsync({
                  data: processed2,
                  path: ctx.path,
                  parent: ctx
                });
                if (result.status === "aborted")
                  return parseUtil_js_1.INVALID;
                if (result.status === "dirty")
                  return (0, parseUtil_js_1.DIRTY)(result.value);
                if (status.value === "dirty")
                  return (0, parseUtil_js_1.DIRTY)(result.value);
                return result;
              });
            } else {
              if (status.value === "aborted")
                return parseUtil_js_1.INVALID;
              const result = this._def.schema._parseSync({
                data: processed,
                path: ctx.path,
                parent: ctx
              });
              if (result.status === "aborted")
                return parseUtil_js_1.INVALID;
              if (result.status === "dirty")
                return (0, parseUtil_js_1.DIRTY)(result.value);
              if (status.value === "dirty")
                return (0, parseUtil_js_1.DIRTY)(result.value);
              return result;
            }
          }
          if (effect.type === "refinement") {
            const executeRefinement = (acc) => {
              const result = effect.refinement(acc, checkCtx);
              if (ctx.common.async) {
                return Promise.resolve(result);
              }
              if (result instanceof Promise) {
                throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
              }
              return acc;
            };
            if (ctx.common.async === false) {
              const inner = this._def.schema._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx
              });
              if (inner.status === "aborted")
                return parseUtil_js_1.INVALID;
              if (inner.status === "dirty")
                status.dirty();
              executeRefinement(inner.value);
              return { status: status.value, value: inner.value };
            } else {
              return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
                if (inner.status === "aborted")
                  return parseUtil_js_1.INVALID;
                if (inner.status === "dirty")
                  status.dirty();
                return executeRefinement(inner.value).then(() => {
                  return { status: status.value, value: inner.value };
                });
              });
            }
          }
          if (effect.type === "transform") {
            if (ctx.common.async === false) {
              const base = this._def.schema._parseSync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx
              });
              if (!(0, parseUtil_js_1.isValid)(base))
                return parseUtil_js_1.INVALID;
              const result = effect.transform(base.value, checkCtx);
              if (result instanceof Promise) {
                throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
              }
              return { status: status.value, value: result };
            } else {
              return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
                if (!(0, parseUtil_js_1.isValid)(base))
                  return parseUtil_js_1.INVALID;
                return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
                  status: status.value,
                  value: result
                }));
              });
            }
          }
          util_js_1.util.assertNever(effect);
        }
      };
      exports.ZodEffects = ZodEffects2;
      exports.ZodTransformer = ZodEffects2;
      ZodEffects2.create = (schema, effect, params) => {
        return new ZodEffects2({
          schema,
          typeName: ZodFirstPartyTypeKind2.ZodEffects,
          effect,
          ...processCreateParams2(params)
        });
      };
      ZodEffects2.createWithPreprocess = (preprocess, schema, params) => {
        return new ZodEffects2({
          schema,
          effect: { type: "preprocess", transform: preprocess },
          typeName: ZodFirstPartyTypeKind2.ZodEffects,
          ...processCreateParams2(params)
        });
      };
      var ZodOptional2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType === util_js_1.ZodParsedType.undefined) {
            return (0, parseUtil_js_1.OK)(void 0);
          }
          return this._def.innerType._parse(input);
        }
        unwrap() {
          return this._def.innerType;
        }
      };
      exports.ZodOptional = ZodOptional2;
      ZodOptional2.create = (type, params) => {
        return new ZodOptional2({
          innerType: type,
          typeName: ZodFirstPartyTypeKind2.ZodOptional,
          ...processCreateParams2(params)
        });
      };
      var ZodNullable2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType === util_js_1.ZodParsedType.null) {
            return (0, parseUtil_js_1.OK)(null);
          }
          return this._def.innerType._parse(input);
        }
        unwrap() {
          return this._def.innerType;
        }
      };
      exports.ZodNullable = ZodNullable2;
      ZodNullable2.create = (type, params) => {
        return new ZodNullable2({
          innerType: type,
          typeName: ZodFirstPartyTypeKind2.ZodNullable,
          ...processCreateParams2(params)
        });
      };
      var ZodDefault2 = class extends ZodType2 {
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          let data = ctx.data;
          if (ctx.parsedType === util_js_1.ZodParsedType.undefined) {
            data = this._def.defaultValue();
          }
          return this._def.innerType._parse({
            data,
            path: ctx.path,
            parent: ctx
          });
        }
        removeDefault() {
          return this._def.innerType;
        }
      };
      exports.ZodDefault = ZodDefault2;
      ZodDefault2.create = (type, params) => {
        return new ZodDefault2({
          innerType: type,
          typeName: ZodFirstPartyTypeKind2.ZodDefault,
          defaultValue: typeof params.default === "function" ? params.default : () => params.default,
          ...processCreateParams2(params)
        });
      };
      var ZodCatch2 = class extends ZodType2 {
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          const newCtx = {
            ...ctx,
            common: {
              ...ctx.common,
              issues: []
            }
          };
          const result = this._def.innerType._parse({
            data: newCtx.data,
            path: newCtx.path,
            parent: {
              ...newCtx
            }
          });
          if ((0, parseUtil_js_1.isAsync)(result)) {
            return result.then((result2) => {
              return {
                status: "valid",
                value: result2.status === "valid" ? result2.value : this._def.catchValue({
                  get error() {
                    return new ZodError_js_1.ZodError(newCtx.common.issues);
                  },
                  input: newCtx.data
                })
              };
            });
          } else {
            return {
              status: "valid",
              value: result.status === "valid" ? result.value : this._def.catchValue({
                get error() {
                  return new ZodError_js_1.ZodError(newCtx.common.issues);
                },
                input: newCtx.data
              })
            };
          }
        }
        removeCatch() {
          return this._def.innerType;
        }
      };
      exports.ZodCatch = ZodCatch2;
      ZodCatch2.create = (type, params) => {
        return new ZodCatch2({
          innerType: type,
          typeName: ZodFirstPartyTypeKind2.ZodCatch,
          catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
          ...processCreateParams2(params)
        });
      };
      var ZodNaN2 = class extends ZodType2 {
        _parse(input) {
          const parsedType = this._getType(input);
          if (parsedType !== util_js_1.ZodParsedType.nan) {
            const ctx = this._getOrReturnCtx(input);
            (0, parseUtil_js_1.addIssueToContext)(ctx, {
              code: ZodError_js_1.ZodIssueCode.invalid_type,
              expected: util_js_1.ZodParsedType.nan,
              received: ctx.parsedType
            });
            return parseUtil_js_1.INVALID;
          }
          return { status: "valid", value: input.data };
        }
      };
      exports.ZodNaN = ZodNaN2;
      ZodNaN2.create = (params) => {
        return new ZodNaN2({
          typeName: ZodFirstPartyTypeKind2.ZodNaN,
          ...processCreateParams2(params)
        });
      };
      exports.BRAND = /* @__PURE__ */ Symbol("zod_brand");
      var ZodBranded2 = class extends ZodType2 {
        _parse(input) {
          const { ctx } = this._processInputParams(input);
          const data = ctx.data;
          return this._def.type._parse({
            data,
            path: ctx.path,
            parent: ctx
          });
        }
        unwrap() {
          return this._def.type;
        }
      };
      exports.ZodBranded = ZodBranded2;
      var ZodPipeline2 = class _ZodPipeline extends ZodType2 {
        _parse(input) {
          const { status, ctx } = this._processInputParams(input);
          if (ctx.common.async) {
            const handleAsync = async () => {
              const inResult = await this._def.in._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: ctx
              });
              if (inResult.status === "aborted")
                return parseUtil_js_1.INVALID;
              if (inResult.status === "dirty") {
                status.dirty();
                return (0, parseUtil_js_1.DIRTY)(inResult.value);
              } else {
                return this._def.out._parseAsync({
                  data: inResult.value,
                  path: ctx.path,
                  parent: ctx
                });
              }
            };
            return handleAsync();
          } else {
            const inResult = this._def.in._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inResult.status === "aborted")
              return parseUtil_js_1.INVALID;
            if (inResult.status === "dirty") {
              status.dirty();
              return {
                status: "dirty",
                value: inResult.value
              };
            } else {
              return this._def.out._parseSync({
                data: inResult.value,
                path: ctx.path,
                parent: ctx
              });
            }
          }
        }
        static create(a, b) {
          return new _ZodPipeline({
            in: a,
            out: b,
            typeName: ZodFirstPartyTypeKind2.ZodPipeline
          });
        }
      };
      exports.ZodPipeline = ZodPipeline2;
      var ZodReadonly2 = class extends ZodType2 {
        _parse(input) {
          const result = this._def.innerType._parse(input);
          const freeze = (data) => {
            if ((0, parseUtil_js_1.isValid)(data)) {
              data.value = Object.freeze(data.value);
            }
            return data;
          };
          return (0, parseUtil_js_1.isAsync)(result) ? result.then((data) => freeze(data)) : freeze(result);
        }
        unwrap() {
          return this._def.innerType;
        }
      };
      exports.ZodReadonly = ZodReadonly2;
      ZodReadonly2.create = (type, params) => {
        return new ZodReadonly2({
          innerType: type,
          typeName: ZodFirstPartyTypeKind2.ZodReadonly,
          ...processCreateParams2(params)
        });
      };
      function cleanParams2(params, data) {
        const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
        const p2 = typeof p === "string" ? { message: p } : p;
        return p2;
      }
      function custom2(check, _params = {}, fatal) {
        if (check)
          return ZodAny2.create().superRefine((data, ctx) => {
            const r = check(data);
            if (r instanceof Promise) {
              return r.then((r2) => {
                if (!r2) {
                  const params = cleanParams2(_params, data);
                  const _fatal = params.fatal ?? fatal ?? true;
                  ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
                }
              });
            }
            if (!r) {
              const params = cleanParams2(_params, data);
              const _fatal = params.fatal ?? fatal ?? true;
              ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
            }
            return;
          });
        return ZodAny2.create();
      }
      exports.late = {
        object: ZodObject2.lazycreate
      };
      var ZodFirstPartyTypeKind2;
      (function(ZodFirstPartyTypeKind3) {
        ZodFirstPartyTypeKind3["ZodString"] = "ZodString";
        ZodFirstPartyTypeKind3["ZodNumber"] = "ZodNumber";
        ZodFirstPartyTypeKind3["ZodNaN"] = "ZodNaN";
        ZodFirstPartyTypeKind3["ZodBigInt"] = "ZodBigInt";
        ZodFirstPartyTypeKind3["ZodBoolean"] = "ZodBoolean";
        ZodFirstPartyTypeKind3["ZodDate"] = "ZodDate";
        ZodFirstPartyTypeKind3["ZodSymbol"] = "ZodSymbol";
        ZodFirstPartyTypeKind3["ZodUndefined"] = "ZodUndefined";
        ZodFirstPartyTypeKind3["ZodNull"] = "ZodNull";
        ZodFirstPartyTypeKind3["ZodAny"] = "ZodAny";
        ZodFirstPartyTypeKind3["ZodUnknown"] = "ZodUnknown";
        ZodFirstPartyTypeKind3["ZodNever"] = "ZodNever";
        ZodFirstPartyTypeKind3["ZodVoid"] = "ZodVoid";
        ZodFirstPartyTypeKind3["ZodArray"] = "ZodArray";
        ZodFirstPartyTypeKind3["ZodObject"] = "ZodObject";
        ZodFirstPartyTypeKind3["ZodUnion"] = "ZodUnion";
        ZodFirstPartyTypeKind3["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
        ZodFirstPartyTypeKind3["ZodIntersection"] = "ZodIntersection";
        ZodFirstPartyTypeKind3["ZodTuple"] = "ZodTuple";
        ZodFirstPartyTypeKind3["ZodRecord"] = "ZodRecord";
        ZodFirstPartyTypeKind3["ZodMap"] = "ZodMap";
        ZodFirstPartyTypeKind3["ZodSet"] = "ZodSet";
        ZodFirstPartyTypeKind3["ZodFunction"] = "ZodFunction";
        ZodFirstPartyTypeKind3["ZodLazy"] = "ZodLazy";
        ZodFirstPartyTypeKind3["ZodLiteral"] = "ZodLiteral";
        ZodFirstPartyTypeKind3["ZodEnum"] = "ZodEnum";
        ZodFirstPartyTypeKind3["ZodEffects"] = "ZodEffects";
        ZodFirstPartyTypeKind3["ZodNativeEnum"] = "ZodNativeEnum";
        ZodFirstPartyTypeKind3["ZodOptional"] = "ZodOptional";
        ZodFirstPartyTypeKind3["ZodNullable"] = "ZodNullable";
        ZodFirstPartyTypeKind3["ZodDefault"] = "ZodDefault";
        ZodFirstPartyTypeKind3["ZodCatch"] = "ZodCatch";
        ZodFirstPartyTypeKind3["ZodPromise"] = "ZodPromise";
        ZodFirstPartyTypeKind3["ZodBranded"] = "ZodBranded";
        ZodFirstPartyTypeKind3["ZodPipeline"] = "ZodPipeline";
        ZodFirstPartyTypeKind3["ZodReadonly"] = "ZodReadonly";
      })(ZodFirstPartyTypeKind2 || (exports.ZodFirstPartyTypeKind = ZodFirstPartyTypeKind2 = {}));
      var instanceOfType2 = (cls, params = {
        message: `Input not instance of ${cls.name}`
      }) => custom2((data) => data instanceof cls, params);
      exports.instanceof = instanceOfType2;
      var stringType2 = ZodString2.create;
      exports.string = stringType2;
      var numberType2 = ZodNumber2.create;
      exports.number = numberType2;
      var nanType2 = ZodNaN2.create;
      exports.nan = nanType2;
      var bigIntType2 = ZodBigInt2.create;
      exports.bigint = bigIntType2;
      var booleanType2 = ZodBoolean2.create;
      exports.boolean = booleanType2;
      var dateType2 = ZodDate2.create;
      exports.date = dateType2;
      var symbolType2 = ZodSymbol2.create;
      exports.symbol = symbolType2;
      var undefinedType2 = ZodUndefined2.create;
      exports.undefined = undefinedType2;
      var nullType2 = ZodNull2.create;
      exports.null = nullType2;
      var anyType2 = ZodAny2.create;
      exports.any = anyType2;
      var unknownType2 = ZodUnknown2.create;
      exports.unknown = unknownType2;
      var neverType2 = ZodNever2.create;
      exports.never = neverType2;
      var voidType2 = ZodVoid2.create;
      exports.void = voidType2;
      var arrayType2 = ZodArray2.create;
      exports.array = arrayType2;
      var objectType2 = ZodObject2.create;
      exports.object = objectType2;
      var strictObjectType2 = ZodObject2.strictCreate;
      exports.strictObject = strictObjectType2;
      var unionType2 = ZodUnion2.create;
      exports.union = unionType2;
      var discriminatedUnionType2 = ZodDiscriminatedUnion2.create;
      exports.discriminatedUnion = discriminatedUnionType2;
      var intersectionType2 = ZodIntersection2.create;
      exports.intersection = intersectionType2;
      var tupleType2 = ZodTuple2.create;
      exports.tuple = tupleType2;
      var recordType2 = ZodRecord2.create;
      exports.record = recordType2;
      var mapType2 = ZodMap2.create;
      exports.map = mapType2;
      var setType2 = ZodSet2.create;
      exports.set = setType2;
      var functionType2 = ZodFunction2.create;
      exports.function = functionType2;
      var lazyType2 = ZodLazy2.create;
      exports.lazy = lazyType2;
      var literalType2 = ZodLiteral2.create;
      exports.literal = literalType2;
      var enumType2 = ZodEnum2.create;
      exports.enum = enumType2;
      var nativeEnumType2 = ZodNativeEnum2.create;
      exports.nativeEnum = nativeEnumType2;
      var promiseType2 = ZodPromise2.create;
      exports.promise = promiseType2;
      var effectsType2 = ZodEffects2.create;
      exports.effect = effectsType2;
      exports.transformer = effectsType2;
      var optionalType2 = ZodOptional2.create;
      exports.optional = optionalType2;
      var nullableType2 = ZodNullable2.create;
      exports.nullable = nullableType2;
      var preprocessType2 = ZodEffects2.createWithPreprocess;
      exports.preprocess = preprocessType2;
      var pipelineType2 = ZodPipeline2.create;
      exports.pipeline = pipelineType2;
      var ostring2 = () => stringType2().optional();
      exports.ostring = ostring2;
      var onumber2 = () => numberType2().optional();
      exports.onumber = onumber2;
      var oboolean2 = () => booleanType2().optional();
      exports.oboolean = oboolean2;
      exports.coerce = {
        string: ((arg) => ZodString2.create({ ...arg, coerce: true })),
        number: ((arg) => ZodNumber2.create({ ...arg, coerce: true })),
        boolean: ((arg) => ZodBoolean2.create({
          ...arg,
          coerce: true
        })),
        bigint: ((arg) => ZodBigInt2.create({ ...arg, coerce: true })),
        date: ((arg) => ZodDate2.create({ ...arg, coerce: true }))
      };
      exports.NEVER = parseUtil_js_1.INVALID;
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.cjs
  var require_external = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.cjs"(exports) {
      "use strict";
      var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() {
            return m[k];
          } };
        }
        Object.defineProperty(o, k2, desc);
      }) : (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        o[k2] = m[k];
      }));
      var __exportStar = exports && exports.__exportStar || function(m, exports2) {
        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      __exportStar(require_errors(), exports);
      __exportStar(require_parseUtil(), exports);
      __exportStar(require_typeAliases(), exports);
      __exportStar(require_util(), exports);
      __exportStar(require_types(), exports);
      __exportStar(require_ZodError(), exports);
    }
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/index.cjs
  var require_zod = __commonJS({
    "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/index.cjs"(exports) {
      "use strict";
      var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() {
            return m[k];
          } };
        }
        Object.defineProperty(o, k2, desc);
      }) : (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        o[k2] = m[k];
      }));
      var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }) : function(o, v) {
        o["default"] = v;
      });
      var __importStar = exports && exports.__importStar || function(mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) {
          for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
        }
        __setModuleDefault(result, mod);
        return result;
      };
      var __exportStar = exports && exports.__exportStar || function(m, exports2) {
        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.z = void 0;
      var z = __importStar(require_external());
      exports.z = z;
      __exportStar(require_external(), exports);
      exports.default = z;
    }
  });

  // ../../packages/brotto-action-schema/dist/index.js
  var require_dist = __commonJS({
    "../../packages/brotto-action-schema/dist/index.js"(exports, module) {
      "use strict";
      var __defProp2 = Object.defineProperty;
      var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
      var __getOwnPropNames2 = Object.getOwnPropertyNames;
      var __hasOwnProp2 = Object.prototype.hasOwnProperty;
      var __export2 = (target, all) => {
        for (var name in all)
          __defProp2(target, name, { get: all[name], enumerable: true });
      };
      var __copyProps2 = (to, from, except, desc) => {
        if (from && typeof from === "object" || typeof from === "function") {
          for (let key of __getOwnPropNames2(from))
            if (!__hasOwnProp2.call(to, key) && key !== except)
              __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
        }
        return to;
      };
      var __toCommonJS = (mod) => __copyProps2(__defProp2({}, "__esModule", { value: true }), mod);
      var index_exports = {};
      __export2(index_exports, {
        AXTupleSchema: () => AXTupleSchema2,
        AccessibilityNodeSchema: () => AccessibilityNodeSchema2,
        ActionCommandV1Schema: () => ActionCommandV1Schema3,
        ActionErrorCode: () => ActionErrorCode,
        ActionErrorV1Schema: () => ActionErrorV1Schema2,
        ActionExecutionType: () => ActionExecutionType,
        ActionIdSchema: () => ActionIdSchema2,
        ActionProposalV1Schema: () => ActionProposalV1Schema2,
        ActionResultStatusV1Schema: () => ActionResultStatusV1Schema2,
        ActionResultV1Schema: () => ActionResultV1Schema4,
        ActionType: () => ActionType,
        AgentProposalV1Schema: () => AgentProposalV1Schema2,
        ApprovalIdSchema: () => ApprovalIdSchema2,
        ApprovalResolutionV1Schema: () => ApprovalResolutionV1Schema2,
        ArtifactIdSchema: () => ArtifactIdSchema2,
        AskUserQuestionArgsSchema: () => AskUserQuestionArgsSchema2,
        BoundingBoxSchema: () => BoundingBoxSchema2,
        CancelledActionResultV1Schema: () => CancelledActionResultV1Schema2,
        CompletionFindingV1Schema: () => CompletionFindingV1Schema2,
        CompletionProposalV1Schema: () => CompletionProposalV1Schema2,
        ControlMetadataSchema: () => ControlMetadataSchema2,
        CoordinatesSchema: () => CoordinatesSchema2,
        DialogEffectV1Schema: () => DialogEffectV1Schema2,
        DoubleClickArgsSchema: () => DoubleClickArgsSchema2,
        DragArgsSchema: () => DragArgsSchema2,
        DragCoordinatesSchema: () => DragCoordinatesSchema2,
        EventIdSchema: () => EventIdSchema2,
        ExecutableActionV1Schema: () => ExecutableActionV1Schema2,
        FARA_ACTION_TO_MCP_TOOL: () => FARA_ACTION_TO_MCP_TOOL,
        FORBIDDEN_BROWSER_DATA_KEYS: () => FORBIDDEN_BROWSER_DATA_KEYS2,
        FailedActionResultV1Schema: () => FailedActionResultV1Schema2,
        FaraActionArgsSchema: () => FaraActionArgsSchema2,
        ForbiddenBrowserDataError: () => ForbiddenBrowserDataError3,
        FrameIdSchema: () => FrameIdSchema2,
        FramePathSegmentIdSchema: () => FramePathSegmentIdSchema2,
        HistoryBackArgsSchema: () => HistoryBackArgsSchema2,
        IdempotencyKeySchema: () => IdempotencyKeySchema2,
        KeyArgsSchema: () => KeyArgsSchema2,
        KeyModifiersSchema: () => KeyModifiersSchema22,
        LeftClickArgsSchema: () => LeftClickArgsSchema2,
        LocatorCandidateV1Schema: () => LocatorCandidateV1Schema2,
        McpToolName: () => McpToolName,
        MessageIdSchema: () => MessageIdSchema2,
        MouseMoveArgsSchema: () => MouseMoveArgsSchema2,
        NavigationEffectV1Schema: () => NavigationEffectV1Schema2,
        ObservationIdCounter: () => ObservationIdCounter,
        ObservationIdSchema: () => ObservationIdSchema2,
        ObservationV1Schema: () => ObservationV1Schema3,
        PageStateSchema: () => PageStateSchema2,
        PauseAndMemorizeFactArgsSchema: () => PauseAndMemorizeFactArgsSchema2,
        PolicyContextV1Schema: () => PolicyContextV1Schema2,
        PolicyDecisionIdSchema: () => PolicyDecisionIdSchema2,
        PolicyDecisionV1Schema: () => PolicyDecisionV1Schema2,
        RejectedActionResultV1Schema: () => RejectedActionResultV1Schema2,
        RightClickArgsSchema: () => RightClickArgsSchema2,
        RunIdSchema: () => RunIdSchema2,
        SanitizedAccessibleNameSchema: () => SanitizedAccessibleNameSchema2,
        ScreenshotArgsSchema: () => ScreenshotArgsSchema2,
        ScreenshotSchema: () => ScreenshotSchema2,
        ScrollArgsSchema: () => ScrollArgsSchema2,
        ScrollDeltaSchema: () => ScrollDeltaSchema2,
        SemanticTargetIdSchema: () => SemanticTargetIdSchema2,
        SemanticTargetSchema: () => SemanticTargetSchema2,
        SequenceSchema: () => SequenceSchema2,
        SessionIdSchema: () => SessionIdSchema2,
        ShadowPathSegmentIdSchema: () => ShadowPathSegmentIdSchema2,
        StepIdSchema: () => StepIdSchema2,
        SucceededActionResultV1Schema: () => SucceededActionResultV1Schema2,
        TabIdSchema: () => TabIdSchema2,
        TaskIdSchema: () => TaskIdSchema2,
        TerminateArgsSchema: () => TerminateArgsSchema2,
        TrajectoryEventKindV1Schema: () => TrajectoryEventKindV1Schema2,
        TrajectoryEventV1Schema: () => TrajectoryEventV1Schema2,
        TrajectoryLinkageV1Schema: () => TrajectoryLinkageV1Schema2,
        ViewportContextSchema: () => ViewportContextSchema2,
        ViewportSchema: () => ViewportSchema2,
        VisitUrlArgsSchema: () => VisitUrlArgsSchema2,
        WaitArgsSchema: () => WaitArgsSchema2,
        assertCoordinatesInBounds: () => assertCoordinatesInBounds,
        assertNoForbiddenBrowserData: () => assertNoForbiddenBrowserData3,
        compareObservationIds: () => compareObservationIds,
        createActionFailure: () => createActionFailure,
        createActionSuccess: () => createActionSuccess,
        createDefaultViewport: () => createDefaultViewport,
        createDefaultViewportConfig: () => createDefaultViewportConfig,
        createObservationId: () => createObservationId,
        getActionExecutionType: () => getActionExecutionType,
        getMcpToolName: () => getMcpToolName,
        getNextObservationId: () => getNextObservationId,
        isHttpUrl: () => isHttpUrl2,
        isMcpAction: () => isMcpAction,
        isNavigationAction: () => isNavigationAction,
        isObservationUrl: () => isObservationUrl2,
        isValidObservationId: () => isValidObservationId,
        isViewportAction: () => isViewportAction,
        mapActionToMcpParams: () => mapActionToMcpParams,
        tryValidateActionArgs: () => tryValidateActionArgs,
        validateActionArgs: () => validateActionArgs,
        validateCoordinatesInBounds: () => validateCoordinatesInBounds
      });
      module.exports = __toCommonJS(index_exports);
      var import_zod9 = require_zod();
      var SessionIdSchema2 = import_zod9.z.string().uuid().brand();
      var RunIdSchema2 = import_zod9.z.string().uuid().brand();
      var TaskIdSchema2 = import_zod9.z.string().uuid().brand();
      var StepIdSchema2 = import_zod9.z.string().uuid().brand();
      var ObservationIdSchema2 = import_zod9.z.string().uuid().brand();
      var ActionIdSchema2 = import_zod9.z.string().uuid().brand();
      var PolicyDecisionIdSchema2 = import_zod9.z.string().uuid().brand();
      var EventIdSchema2 = import_zod9.z.string().uuid().brand();
      var MessageIdSchema2 = import_zod9.z.string().uuid().brand();
      var ArtifactIdSchema2 = import_zod9.z.string().uuid().brand();
      var SemanticTargetIdSchema2 = import_zod9.z.string().uuid().brand();
      var TabIdSchema2 = import_zod9.z.string().uuid().brand();
      var FrameIdSchema2 = import_zod9.z.string().uuid().brand();
      var FramePathSegmentIdSchema2 = import_zod9.z.string().uuid().brand();
      var ShadowPathSegmentIdSchema2 = import_zod9.z.string().uuid().brand();
      var ApprovalIdSchema2 = import_zod9.z.string().uuid().brand();
      var SequenceSchema2 = import_zod9.z.number().int().nonnegative();
      var IdempotencyKeySchema2 = import_zod9.z.string().min(1).max(256);
      var import_zod22 = require_zod();
      var FORBIDDEN_BROWSER_DATA_KEYS2 = /* @__PURE__ */ new Set([
        "cookie",
        "cookies",
        "authorization",
        "proxy-authorization",
        "localstorage",
        "sessionstorage",
        "password",
        "credentials",
        "profile"
      ]);
      var normalizedForbiddenKeys2 = new Set(
        [...FORBIDDEN_BROWSER_DATA_KEYS2].map(normalizeBrowserDataKey2)
      );
      var ForbiddenBrowserDataError3 = class extends Error {
        constructor(keyPath) {
          super(`Forbidden browser data key at ${keyPath}`);
          this.keyPath = keyPath;
          this.name = "ForbiddenBrowserDataError";
        }
      };
      function normalizeBrowserDataKey2(key) {
        return key.toLowerCase().replace(/[^a-z0-9]/g, "");
      }
      function isForbiddenBrowserDataKey2(key) {
        const normalized = normalizeBrowserDataKey2(key);
        return [...normalizedForbiddenKeys2].some((forbidden) => normalized.includes(forbidden));
      }
      function isHttpUrl2(url) {
        try {
          return ["http:", "https:"].includes(new URL(url).protocol);
        } catch {
          return false;
        }
      }
      function isObservationUrl2(url) {
        if (url === "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("devtools://")) {
          return true;
        }
        return isHttpUrl2(url);
      }
      function assertNoForbiddenBrowserData3(value) {
        const visited = /* @__PURE__ */ new Set();
        const visit = (current, path) => {
          if (current === null || typeof current !== "object") return;
          if (visited.has(current)) return;
          visited.add(current);
          if (Array.isArray(current)) {
            current.forEach((item, index) => visit(item, `${path}[${index}]`));
            return;
          }
          for (const [key, nestedValue] of Object.entries(current)) {
            const keyPath = `${path}.${key}`;
            if (isForbiddenBrowserDataKey2(key)) {
              throw new ForbiddenBrowserDataError3(keyPath);
            }
            visit(nestedValue, keyPath);
          }
        };
        visit(value, "$");
      }
      function withForbiddenBrowserDataGuard2(schema) {
        return schema.superRefine((value, context) => {
          try {
            assertNoForbiddenBrowserData3(value);
          } catch (error) {
            if (error instanceof ForbiddenBrowserDataError3) {
              context.addIssue({
                code: import_zod22.z.ZodIssueCode.custom,
                message: error.message,
                path: error.keyPath.slice(2).split(".").filter(Boolean)
              });
              return;
            }
            throw error;
          }
        });
      }
      var Sha256Schema2 = import_zod22.z.string().regex(/^[a-f0-9]{64}$/i);
      var sensitiveSemanticContent2 = /\b(?:authorization|cookie|credentials?|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token)\b/i;
      function isSafeSemanticContent2(value) {
        return !sensitiveSemanticContent2.test(value);
      }
      var SafeSemanticTextSchema2 = import_zod22.z.string().min(1).max(512).refine(
        isSafeSemanticContent2,
        "Semantic content may not include sensitive browser data"
      );
      var SafeSemanticAttributesSchema2 = import_zod22.z.object({
        "aria-label": SafeSemanticTextSchema2.optional(),
        "aria-describedby": SafeSemanticTextSchema2.optional(),
        "aria-controls": SafeSemanticTextSchema2.optional(),
        "aria-expanded": import_zod22.z.enum(["true", "false"]).optional(),
        "aria-haspopup": import_zod22.z.enum(["true", "false", "menu", "listbox", "tree", "grid", "dialog"]).optional(),
        "aria-current": import_zod22.z.enum(["true", "false", "page", "step", "location", "date", "time"]).optional(),
        "aria-pressed": import_zod22.z.enum(["true", "false", "mixed"]).optional(),
        "aria-selected": import_zod22.z.enum(["true", "false"]).optional()
      }).strict();
      var SanitizedAccessibleNameSchema2 = import_zod22.z.object({
        source: import_zod22.z.enum(["aria-label", "aria-labelledby", "visible_text"]),
        text: SafeSemanticTextSchema2
      }).strict();
      var LocatorCandidateV1Schema2 = import_zod22.z.discriminatedUnion("kind", [
        import_zod22.z.object({
          kind: import_zod22.z.literal("role_name"),
          role: SafeSemanticTextSchema2,
          name: SanitizedAccessibleNameSchema2
        }).strict(),
        import_zod22.z.object({
          kind: import_zod22.z.literal("label"),
          label: SanitizedAccessibleNameSchema2
        }).strict(),
        import_zod22.z.object({
          kind: import_zod22.z.literal("test_id"),
          testId: SafeSemanticTextSchema2
        }).strict(),
        import_zod22.z.object({
          kind: import_zod22.z.literal("safe_attribute"),
          attribute: import_zod22.z.enum(["aria-label", "aria-describedby", "aria-controls", "aria-current"]),
          value: SafeSemanticTextSchema2
        }).strict()
      ]);
      var ControlMetadataSchema2 = import_zod22.z.discriminatedUnion("kind", [
        import_zod22.z.object({ kind: import_zod22.z.literal("non_input") }).strict(),
        import_zod22.z.object({
          kind: import_zod22.z.literal("input"),
          inputType: import_zod22.z.enum(["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"])
        }).strict()
      ]);
      var ScreenshotSchema2 = withForbiddenBrowserDataGuard2(import_zod22.z.discriminatedUnion("kind", [
        import_zod22.z.object({
          kind: import_zod22.z.literal("inline"),
          encoding: import_zod22.z.enum(["base64", "png", "jpeg", "webp"]),
          // ponytail: data may be empty when the extension captured a chrome://
          // page or other restricted URL that captureVisibleTab refuses to render.
          // width/height default to zero so downstream consumers can detect
          // "no screenshot available" and render a placeholder.
          data: import_zod22.z.string().max(1e7),
          sha256: Sha256Schema2,
          width: import_zod22.z.number().int().nonnegative(),
          height: import_zod22.z.number().int().nonnegative()
        }).strict(),
        import_zod22.z.object({
          kind: import_zod22.z.literal("artifact"),
          artifactId: ArtifactIdSchema2,
          sha256: Sha256Schema2,
          width: import_zod22.z.number().int().positive(),
          height: import_zod22.z.number().int().positive(),
          encoding: import_zod22.z.enum(["png", "jpeg", "webp"])
        }).strict()
      ]));
      var ViewportSchema2 = import_zod22.z.object({
        width: import_zod22.z.number().int().positive(),
        height: import_zod22.z.number().int().positive(),
        devicePixelRatio: import_zod22.z.number().positive().max(8),
        zoom: import_zod22.z.number().positive().max(8),
        scrollX: import_zod22.z.number().finite(),
        scrollY: import_zod22.z.number().finite()
      }).strict();
      var PageStateSchema2 = import_zod22.z.object({
        tabId: TabIdSchema2,
        frameId: FrameIdSchema2,
        lifecycle: import_zod22.z.enum(["loading", "interactive", "complete", "frozen"]),
        visibility: import_zod22.z.enum(["visible", "hidden", "prerender"])
      }).strict();
      var BoundingBoxSchema2 = import_zod22.z.object({
        x: import_zod22.z.number().finite(),
        y: import_zod22.z.number().finite(),
        width: import_zod22.z.number().positive(),
        height: import_zod22.z.number().positive()
      }).strict();
      var SemanticTargetSchema2 = withForbiddenBrowserDataGuard2(import_zod22.z.object({
        targetId: SemanticTargetIdSchema2,
        stableRef: import_zod22.z.string().regex(/^[a-f0-9]{16}$/i).optional(),
        tag: import_zod22.z.string().min(1).max(64),
        role: import_zod22.z.string().min(1).max(128).optional(),
        accessibleName: SanitizedAccessibleNameSchema2.optional(),
        attributes: SafeSemanticAttributesSchema2.optional(),
        control: ControlMetadataSchema2,
        boundingBox: BoundingBoxSchema2,
        visible: import_zod22.z.boolean(),
        framePath: import_zod22.z.array(FramePathSegmentIdSchema2).max(20),
        shadowPath: import_zod22.z.array(ShadowPathSegmentIdSchema2).max(20).optional(),
        locatorCandidates: import_zod22.z.array(LocatorCandidateV1Schema2).max(10)
      }).strict()).superRefine((target, context) => {
        if (target.tag.toLowerCase() === "input" && target.control.kind !== "input") {
          context.addIssue({ code: import_zod22.z.ZodIssueCode.custom, path: ["control"], message: "Input targets require input control metadata" });
        }
      });
      var AXTupleSchema2 = import_zod22.z.object({
        role: import_zod22.z.string(),
        index: import_zod22.z.number().int().nonnegative(),
        name: import_zod22.z.string().optional()
      });
      var AccessibilityNodeSchema2 = import_zod22.z.object({
        axNodeId: import_zod22.z.string(),
        role: import_zod22.z.string(),
        name: import_zod22.z.string().optional(),
        description: import_zod22.z.string().optional(),
        value: import_zod22.z.string().optional(),
        attributes: import_zod22.z.record(import_zod22.z.string(), import_zod22.z.string()).optional(),
        bounds: BoundingBoxSchema2.optional(),
        axPath: import_zod22.z.array(AXTupleSchema2),
        attributeHash: Sha256Schema2
      });
      var ObservationV1Schema3 = withForbiddenBrowserDataGuard2(import_zod22.z.object({
        observationId: ObservationIdSchema2,
        capturedAt: import_zod22.z.string().datetime(),
        url: import_zod22.z.string().refine(isObservationUrl2, "Observation URL must be HTTP(S) or an internal page (about:blank, chrome://)"),
        title: import_zod22.z.string().max(512),
        screenshot: ScreenshotSchema2,
        viewport: ViewportSchema2,
        page: PageStateSchema2,
        semanticTargets: import_zod22.z.array(SemanticTargetSchema2).max(200),
        accessibilityNodes: import_zod22.z.array(AccessibilityNodeSchema2).optional(),
        // ponytail: structured page text (HEADINGS / STATS / LABELS / TEXT blocks).
        // Optional so older payloads still validate. Replaces the lazy
        // accessibilityNodes.slice(0, 400) cap in the planner context builder.
        bodyText: import_zod22.z.string().max(5e4).optional()
      }).strict());
      var import_zod32 = require_zod();
      function guardedStrictObject2(schema) {
        return schema.superRefine((value, context) => {
          try {
            assertNoForbiddenBrowserData3(value);
          } catch (error) {
            if (error instanceof ForbiddenBrowserDataError3) {
              context.addIssue({ code: import_zod32.z.ZodIssueCode.custom, message: error.message });
              return;
            }
            throw error;
          }
        });
      }
      var CoordinateSchema2 = import_zod32.z.number().int().nonnegative();
      var KeyModifiersSchema3 = import_zod32.z.object({
        ctrl: import_zod32.z.boolean().optional(),
        shift: import_zod32.z.boolean().optional(),
        alt: import_zod32.z.boolean().optional(),
        meta: import_zod32.z.boolean().optional()
      }).strict();
      var ExecutableActionV1Schema2 = import_zod32.z.discriminatedUnion("type", [
        import_zod32.z.object({ type: import_zod32.z.literal("left_click"), x: CoordinateSchema2, y: CoordinateSchema2, targetId: SemanticTargetIdSchema2.optional() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("double_click"), x: CoordinateSchema2, y: CoordinateSchema2, targetId: SemanticTargetIdSchema2.optional() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("right_click"), x: CoordinateSchema2, y: CoordinateSchema2, targetId: SemanticTargetIdSchema2.optional() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("drag"), startX: CoordinateSchema2, startY: CoordinateSchema2, endX: CoordinateSchema2, endY: CoordinateSchema2 }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("mouse_move"), x: CoordinateSchema2, y: CoordinateSchema2 }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("scroll"), deltaX: import_zod32.z.number().int(), deltaY: import_zod32.z.number().int() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("key"), key: import_zod32.z.string().min(1).max(128), modifiers: KeyModifiersSchema3.optional() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("insert_text"), text: import_zod32.z.string().min(1).max(1e4), targetId: SemanticTargetIdSchema2.optional() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("visit_url"), url: import_zod32.z.string().url().refine(isHttpUrl2, "Only HTTP(S) navigation URLs are allowed") }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("history_back"), steps: import_zod32.z.number().int().positive().max(20).default(1) }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("wait"), durationMs: import_zod32.z.number().int().positive().max(6e4) }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("ask_user_question"), question: import_zod32.z.string().min(1).max(2e3), choices: import_zod32.z.array(import_zod32.z.string().min(1).max(256)).max(20).optional() }).strict(),
        import_zod32.z.object({ type: import_zod32.z.literal("memorize_fact"), fact: import_zod32.z.string().min(1).max(2e3), category: import_zod32.z.string().min(1).max(128).optional() }).strict()
      ]);
      var ActionProposalV1Schema2 = guardedStrictObject2(import_zod32.z.object({
        kind: import_zod32.z.literal("action"),
        observationId: ObservationIdSchema2,
        proposedAt: import_zod32.z.string().datetime(),
        action: ExecutableActionV1Schema2
      }).strict());
      var CompletionFindingV1Schema2 = import_zod32.z.object({
        fact: import_zod32.z.string().min(1).max(2e3),
        observationIds: import_zod32.z.array(ObservationIdSchema2).min(1).max(20)
      }).strict();
      var CompletionProposalV1Schema2 = guardedStrictObject2(import_zod32.z.object({
        kind: import_zod32.z.literal("completion"),
        observationId: ObservationIdSchema2,
        type: import_zod32.z.literal("terminate"),
        status: import_zod32.z.enum(["succeeded", "partial", "failed"]),
        summary: import_zod32.z.string().min(1).max(4e3),
        findings: import_zod32.z.array(CompletionFindingV1Schema2).max(100),
        unmetCriteria: import_zod32.z.array(import_zod32.z.string().min(1).max(1e3)).max(100),
        confidence: import_zod32.z.number().min(0).max(1)
      }).strict()).superRefine((value, context) => {
        if (value.status === "succeeded" && value.findings.length === 0) {
          context.addIssue({
            code: import_zod32.z.ZodIssueCode.custom,
            path: ["findings"],
            message: "Successful completion requires findings with observation evidence"
          });
        }
      });
      var AgentProposalV1Schema2 = import_zod32.z.union([
        ActionProposalV1Schema2,
        CompletionProposalV1Schema2
      ]);
      var PolicyContextV1Schema2 = import_zod32.z.object({
        policyDecisionId: PolicyDecisionIdSchema2,
        policyVersion: import_zod32.z.string().min(1).max(128),
        approved: import_zod32.z.boolean(),
        approvalId: ApprovalIdSchema2.optional()
      }).strict();
      var PolicyDecisionV1Schema2 = guardedStrictObject2(import_zod32.z.object({
        policyDecisionId: PolicyDecisionIdSchema2,
        actionId: ActionIdSchema2,
        observationId: ObservationIdSchema2,
        decision: import_zod32.z.enum(["allowed", "denied", "approval_required"]),
        decidedAt: import_zod32.z.string().datetime()
      }).strict());
      var ApprovalResolutionV1Schema2 = guardedStrictObject2(import_zod32.z.object({
        approvalId: ApprovalIdSchema2,
        policyDecisionId: PolicyDecisionIdSchema2,
        actionId: ActionIdSchema2,
        status: import_zod32.z.enum(["approved", "denied"]),
        resolvedAt: import_zod32.z.string().datetime()
      }).strict());
      var ActionCommandV1Schema3 = guardedStrictObject2(import_zod32.z.object({
        actionId: ActionIdSchema2,
        stepId: StepIdSchema2,
        observationId: ObservationIdSchema2,
        sequence: SequenceSchema2,
        action: ExecutableActionV1Schema2,
        policyContext: PolicyContextV1Schema2,
        dispatchedAt: import_zod32.z.string().datetime(),
        expiresAt: import_zod32.z.string().datetime(),
        idempotencyKey: IdempotencyKeySchema2
      }).strict());
      var import_zod42 = require_zod();
      var ActionResultStatusV1Schema2 = import_zod42.z.enum([
        "succeeded",
        "failed_recoverable",
        "failed_terminal",
        "rejected_stale",
        "rejected_policy",
        "approval_required",
        "cancelled"
      ]);
      var ActionErrorV1Schema2 = import_zod42.z.object({
        code: import_zod42.z.string().min(1).max(128),
        message: import_zod42.z.string().min(1).max(2e3),
        retryable: import_zod42.z.boolean()
      }).strict();
      var NavigationEffectV1Schema2 = import_zod42.z.object({
        url: import_zod42.z.string().url().refine(isHttpUrl2, "Only HTTP(S) URLs are allowed"),
        title: import_zod42.z.string().max(512).optional()
      }).strict();
      var DialogEffectV1Schema2 = import_zod42.z.object({
        kind: import_zod42.z.enum(["alert", "confirm", "prompt", "beforeunload"]),
        present: import_zod42.z.boolean()
      }).strict();
      var ActionResultBaseV1Schema2 = import_zod42.z.object({
        actionId: ActionIdSchema2,
        stepId: StepIdSchema2,
        observationId: ObservationIdSchema2,
        sequence: SequenceSchema2,
        startedAt: import_zod42.z.string().datetime(),
        completedAt: import_zod42.z.string().datetime(),
        durationMs: import_zod42.z.number().int().nonnegative(),
        target: SemanticTargetSchema2.optional(),
        navigation: NavigationEffectV1Schema2.optional(),
        dialog: DialogEffectV1Schema2.optional()
      });
      var SucceededActionResultV1Schema2 = ActionResultBaseV1Schema2.extend({
        status: import_zod42.z.literal("succeeded"),
        postObservation: ObservationV1Schema3
      }).strict();
      var FailedActionResultV1Schema2 = ActionResultBaseV1Schema2.extend({
        status: import_zod42.z.enum(["failed_recoverable", "failed_terminal"]),
        error: ActionErrorV1Schema2,
        postObservation: ObservationV1Schema3
      }).strict();
      var RejectedActionResultV1Schema2 = ActionResultBaseV1Schema2.extend({
        status: import_zod42.z.enum(["rejected_stale", "rejected_policy", "approval_required"]),
        rejection: ActionErrorV1Schema2
      }).strict();
      var CancelledActionResultV1Schema2 = ActionResultBaseV1Schema2.extend({
        status: import_zod42.z.literal("cancelled"),
        cancellation: import_zod42.z.object({ reason: import_zod42.z.string().min(1).max(2e3).optional() }).strict(),
        postObservation: ObservationV1Schema3
      }).strict();
      var ActionResultV1Schema4 = import_zod42.z.union([
        SucceededActionResultV1Schema2,
        FailedActionResultV1Schema2,
        RejectedActionResultV1Schema2,
        CancelledActionResultV1Schema2
      ]).superRefine((value, context) => {
        try {
          assertNoForbiddenBrowserData3(value);
        } catch (error) {
          if (error instanceof ForbiddenBrowserDataError3) {
            context.addIssue({ code: import_zod42.z.ZodIssueCode.custom, message: error.message });
            return;
          }
          throw error;
        }
      });
      var import_zod52 = require_zod();
      var TrajectoryEventKindV1Schema2 = import_zod52.z.enum([
        "session_lifecycle",
        "observation_captured",
        "model_request",
        "model_response",
        "model_parse_failure",
        "action_proposed",
        "policy_decided",
        "approval_requested",
        "approval_resolved",
        "action_dispatched",
        "action_acknowledged",
        "action_completed",
        "verification_result",
        "task_terminal_outcome"
      ]);
      var TrajectoryEventV1Schema2 = import_zod52.z.object({
        eventId: EventIdSchema2,
        sessionId: SessionIdSchema2,
        taskId: TaskIdSchema2,
        stepId: StepIdSchema2.optional(),
        actionId: ActionIdSchema2.optional(),
        observationId: ObservationIdSchema2.optional(),
        correlationId: import_zod52.z.string().uuid().optional(),
        causationId: EventIdSchema2.optional(),
        sequence: SequenceSchema2,
        occurredAt: import_zod52.z.string().datetime(),
        kind: TrajectoryEventKindV1Schema2,
        summary: import_zod52.z.string().max(2e3).optional()
      }).strict().superRefine((value, context) => {
        try {
          assertNoForbiddenBrowserData3(value);
        } catch (error) {
          if (error instanceof ForbiddenBrowserDataError3) {
            context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, message: error.message });
            return;
          }
          throw error;
        }
      });
      var TrajectoryLinkageV1Schema2 = import_zod52.z.object({
        sourceObservation: ObservationV1Schema3,
        proposal: ActionProposalV1Schema2,
        command: ActionCommandV1Schema3,
        policyDecision: PolicyDecisionV1Schema2,
        approvalResolution: ApprovalResolutionV1Schema2.optional(),
        result: ActionResultV1Schema4
      }).strict().superRefine((value, context) => {
        const { approvalResolution, command, policyDecision, proposal, result, sourceObservation } = value;
        if (sourceObservation.observationId !== proposal.observationId || proposal.observationId !== command.observationId) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["command", "observationId"], message: "Command must reference the proposal observation" });
        }
        if (JSON.stringify(proposal.action) !== JSON.stringify(command.action)) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["command", "action"], message: "Command action must match the proposal action" });
        }
        if (policyDecision.policyDecisionId !== command.policyContext.policyDecisionId) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["policyDecision", "policyDecisionId"], message: "Policy decision must match the command policy context" });
        }
        if (policyDecision.actionId !== command.actionId || policyDecision.observationId !== command.observationId) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["policyDecision"], message: "Policy decision must reference the command action and observation" });
        }
        const hasApprovalProof = command.policyContext.approved && command.policyContext.approvalId !== void 0;
        if (policyDecision.decision === "allowed" && ["rejected_policy", "approval_required"].includes(result.status)) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "status"], message: "Allowed policy decisions cannot produce policy rejection or approval-required results" });
        }
        if (policyDecision.decision === "denied" && result.status !== "rejected_policy") {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "status"], message: "Denied policy decisions require a rejected_policy result" });
        }
        if (policyDecision.decision === "approval_required" && !hasApprovalProof && result.status !== "approval_required") {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "status"], message: "Unproven approval-required decisions require an approval_required result" });
        }
        if (policyDecision.decision === "approval_required" && hasApprovalProof && ["rejected_policy", "approval_required"].includes(result.status)) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "status"], message: "Approved decisions cannot produce policy rejection or approval-required results" });
        }
        if (policyDecision.decision === "approval_required" && hasApprovalProof) {
          if (approvalResolution === void 0 || approvalResolution.status !== "approved" || approvalResolution.approvalId !== command.policyContext.approvalId || approvalResolution.policyDecisionId !== policyDecision.policyDecisionId || approvalResolution.actionId !== command.actionId) {
            context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["approvalResolution"], message: "Approval-required execution needs a matching approved resolution" });
          }
        }
        if (result.actionId !== command.actionId || result.stepId !== command.stepId || result.observationId !== command.observationId || result.sequence <= command.sequence) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result"], message: "Result must follow the command and preserve its identifiers" });
        }
        const sourceCapturedAt = Date.parse(sourceObservation.capturedAt);
        const proposedAt = Date.parse(proposal.proposedAt);
        const decidedAt = Date.parse(policyDecision.decidedAt);
        const dispatchedAt = Date.parse(command.dispatchedAt);
        const startedAt = Date.parse(result.startedAt);
        const completedAt = Date.parse(result.completedAt);
        const resolvedAt = approvalResolution === void 0 ? void 0 : Date.parse(approvalResolution.resolvedAt);
        if (!(sourceCapturedAt <= proposedAt && proposedAt <= decidedAt && decidedAt <= dispatchedAt && dispatchedAt <= startedAt && startedAt <= completedAt && sourceCapturedAt < dispatchedAt && proposedAt < dispatchedAt)) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "startedAt"], message: "Observation, proposal, policy, dispatch, and execution timestamps must be chronological" });
        }
        if (hasApprovalProof && resolvedAt === void 0 || resolvedAt !== void 0 && !(decidedAt < resolvedAt && resolvedAt < dispatchedAt)) {
          context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["approvalResolution", "resolvedAt"], message: "Approval resolution must occur after policy decision and before dispatch" });
        }
        if (result.status === "succeeded" || result.status === "failed_recoverable" || result.status === "failed_terminal" || result.status === "cancelled") {
          if (result.postObservation.observationId === command.observationId) {
            context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "postObservation", "observationId"], message: "Executed action requires a distinct post-observation" });
          }
          if (Date.parse(result.postObservation.capturedAt) <= completedAt) {
            context.addIssue({ code: import_zod52.z.ZodIssueCode.custom, path: ["result", "postObservation", "capturedAt"], message: "Executed action post-observation must be captured after completion" });
          }
        }
      });
      var ActionType = /* @__PURE__ */ ((ActionType2) => {
        ActionType2["LEFT_CLICK"] = "left_click";
        ActionType2["DOUBLE_CLICK"] = "double_click";
        ActionType2["RIGHT_CLICK"] = "right_click";
        ActionType2["DRAG"] = "drag";
        ActionType2["MOUSE_MOVE"] = "mouse_move";
        ActionType2["SCROLL"] = "scroll";
        ActionType2["KEY"] = "key";
        ActionType2["INSERT_TEXT"] = "insert_text";
        ActionType2["VISIT_URL"] = "visit_url";
        ActionType2["HISTORY_BACK"] = "history_back";
        ActionType2["SCREENSHOT"] = "screenshot";
        ActionType2["WAIT"] = "wait";
        ActionType2["ASK_USER_QUESTION"] = "ask_user_question";
        ActionType2["TERMINATE"] = "terminate";
        ActionType2["PAUSE_AND_MEMORIZE_FACT"] = "pause_and_memorize_fact";
        ActionType2["MEMORIZE_FACT"] = "memorize_fact";
        return ActionType2;
      })(ActionType || {});
      function isViewportAction(action) {
        return [
          "left_click",
          "double_click",
          "right_click",
          "drag",
          "mouse_move",
          "scroll"
          /* SCROLL */
        ].includes(action.type);
      }
      function isNavigationAction(action) {
        return [
          "visit_url",
          "history_back"
          /* HISTORY_BACK */
        ].includes(action.type);
      }
      function createDefaultViewport() {
        return { width: 1280, height: 720 };
      }
      function createDefaultViewportConfig() {
        return {
          width: 1280,
          height: 720,
          devicePixelRatio: 1
        };
      }
      function createObservationId(value) {
        if (!Number.isInteger(value) || value < 0) {
          throw new Error(`Invalid observation ID: ${value}. Must be a non-negative integer.`);
        }
        return { value };
      }
      function compareObservationIds(a, b) {
        return a.value - b.value;
      }
      function isValidObservationId(value) {
        return Number.isInteger(value) && value >= 0;
      }
      function getNextObservationId(current) {
        return createObservationId(current.value + 1);
      }
      var ObservationIdCounter = class {
        /**
         * Creates a new counter starting at 0 (or a given initial value).
         */
        constructor(initialValue = 0) {
          if (!isValidObservationId(initialValue)) {
            throw new Error(`Invalid initial observation ID: ${initialValue}`);
          }
          this.currentValue = initialValue;
        }
        /**
         * Returns the next observation ID and increments the counter.
         */
        next() {
          const id = createObservationId(this.currentValue);
          this.currentValue++;
          return id;
        }
        /**
         * Returns the current ID without incrementing.
         */
        peek() {
          return createObservationId(this.currentValue);
        }
        /**
         * Resets the counter to a specific value.
         */
        reset(value = 0) {
          if (!isValidObservationId(value)) {
            throw new Error(`Invalid reset value: ${value}`);
          }
          this.currentValue = value;
        }
        /**
         * Returns the current raw value.
         */
        getCurrentValue() {
          return this.currentValue;
        }
      };
      var ActionErrorCode = /* @__PURE__ */ ((ActionErrorCode2) => {
        ActionErrorCode2["TIMEOUT"] = "timeout";
        ActionErrorCode2["ELEMENT_NOT_FOUND"] = "element_not_found";
        ActionErrorCode2["INVALID_COORDINATES"] = "invalid_coordinates";
        ActionErrorCode2["INVALID_URL"] = "invalid_url";
        ActionErrorCode2["NAVIGATION_FAILED"] = "navigation_failed";
        ActionErrorCode2["PERMISSION_DENIED"] = "permission_denied";
        ActionErrorCode2["CANCELLED"] = "cancelled";
        ActionErrorCode2["NOT_SUPPORTED"] = "not_supported";
        ActionErrorCode2["UNKNOWN"] = "unknown";
        return ActionErrorCode2;
      })(ActionErrorCode || {});
      function createActionSuccess(actionType, data) {
        return {
          actionType,
          success: true,
          timestamp: Date.now(),
          data
        };
      }
      function createActionFailure(actionType, errorCode, message, details) {
        return {
          actionType,
          success: false,
          timestamp: Date.now(),
          error: {
            code: errorCode,
            message,
            details
          }
        };
      }
      var McpToolName = /* @__PURE__ */ ((McpToolName2) => {
        McpToolName2["BROWSER_MOUSE_CLICK_XY"] = "browser_mouse_click_xy";
        McpToolName2["BROWSER_MOUSE_DRAG_XY"] = "browser_mouse_drag_xy";
        McpToolName2["BROWSER_MOUSE_MOVE_XY"] = "browser_mouse_move_xy";
        McpToolName2["BROWSER_MOUSE_WHEEL"] = "browser_mouse_wheel";
        McpToolName2["BROWSER_PRESS_KEY"] = "browser_press_key";
        McpToolName2["BROWSER_NAVIGATE"] = "browser_navigate";
        McpToolName2["BROWSER_NAVIGATE_BACK"] = "browser_navigate_back";
        McpToolName2["BROWSER_TAKE_SCREENSHOT"] = "browser_take_screenshot";
        return McpToolName2;
      })(McpToolName || {});
      var FARA_ACTION_TO_MCP_TOOL = {
        [
          "left_click"
          /* LEFT_CLICK */
        ]: "browser_mouse_click_xy",
        [
          "double_click"
          /* DOUBLE_CLICK */
        ]: "browser_mouse_click_xy",
        [
          "right_click"
          /* RIGHT_CLICK */
        ]: "browser_mouse_click_xy",
        [
          "drag"
          /* DRAG */
        ]: "browser_mouse_drag_xy",
        [
          "mouse_move"
          /* MOUSE_MOVE */
        ]: "browser_mouse_move_xy",
        [
          "scroll"
          /* SCROLL */
        ]: "browser_mouse_wheel",
        [
          "key"
          /* KEY */
        ]: "browser_press_key",
        [
          "insert_text"
          /* INSERT_TEXT */
        ]: null,
        // Handled by client via keyboard.type
        [
          "visit_url"
          /* VISIT_URL */
        ]: "browser_navigate",
        [
          "history_back"
          /* HISTORY_BACK */
        ]: "browser_navigate_back",
        [
          "screenshot"
          /* SCREENSHOT */
        ]: "browser_take_screenshot",
        [
          "wait"
          /* WAIT */
        ]: null,
        // Handled by bounded orchestrator timer
        [
          "ask_user_question"
          /* ASK_USER_QUESTION */
        ]: null,
        // Control-plane approval request
        [
          "terminate"
          /* TERMINATE */
        ]: null,
        // Orchestrator session completion
        [
          "pause_and_memorize_fact"
          /* PAUSE_AND_MEMORIZE_FACT */
        ]: null,
        // Server-side session memory
        [
          "memorize_fact"
          /* MEMORIZE_FACT */
        ]: null
        // Server-side session memory
      };
      function mapActionToMcpParams(action) {
        switch (action.type) {
          case "left_click":
            return {
              x: action.coordinates.x,
              y: action.coordinates.y,
              button: "left",
              clickCount: 1
            };
          case "double_click":
            return {
              x: action.coordinates.x,
              y: action.coordinates.y,
              button: "left",
              clickCount: 2
            };
          case "right_click":
            return {
              x: action.coordinates.x,
              y: action.coordinates.y,
              button: "right",
              clickCount: 1
            };
          case "drag":
            return {
              startX: action.coordinates.start.x,
              startY: action.coordinates.start.y,
              endX: action.coordinates.end.x,
              endY: action.coordinates.end.y
            };
          case "mouse_move":
            return {
              x: action.coordinates.x,
              y: action.coordinates.y
            };
          case "scroll":
            return {
              x: action.coordinates.x,
              y: action.coordinates.y,
              deltaX: action.delta.deltaX,
              deltaY: action.delta.deltaY
            };
          case "key":
            return {
              key: action.key,
              modifiers: action.modifiers
            };
          case "visit_url":
            return {
              url: action.url,
              timeout: action.timeout
            };
          case "history_back":
            return {
              steps: action.steps
            };
          case "screenshot":
            return {
              fullPage: action.fullPage
            };
          default:
            return null;
        }
      }
      function isMcpAction(actionType) {
        return FARA_ACTION_TO_MCP_TOOL[actionType] !== null;
      }
      function getMcpToolName(actionType) {
        return FARA_ACTION_TO_MCP_TOOL[actionType];
      }
      var ActionExecutionType = /* @__PURE__ */ ((ActionExecutionType2) => {
        ActionExecutionType2["MCP_TOOL"] = "mcp_tool";
        ActionExecutionType2["ORCHESTRATOR_TIMER"] = "orchestrator_timer";
        ActionExecutionType2["CONTROL_PLANE_APPROVAL"] = "control_plane_approval";
        ActionExecutionType2["SESSION_COMPLETION"] = "session_completion";
        ActionExecutionType2["SESSION_MEMORY"] = "session_memory";
        return ActionExecutionType2;
      })(ActionExecutionType || {});
      function getActionExecutionType(actionType) {
        switch (actionType) {
          case "wait":
            return "orchestrator_timer";
          case "ask_user_question":
            return "control_plane_approval";
          case "terminate":
            return "session_completion";
          case "pause_and_memorize_fact":
            return "session_memory";
          default:
            return "mcp_tool";
        }
      }
      var import_zod62 = require_zod();
      var CoordinatesSchema2 = import_zod62.z.object({
        x: import_zod62.z.number().int().min(0),
        y: import_zod62.z.number().int().min(0)
      });
      var DragCoordinatesSchema2 = import_zod62.z.object({
        start: CoordinatesSchema2,
        end: CoordinatesSchema2
      });
      var ScrollDeltaSchema2 = import_zod62.z.object({
        deltaX: import_zod62.z.number().int(),
        deltaY: import_zod62.z.number().int()
      });
      var ViewportContextSchema2 = import_zod62.z.object({
        viewportWidth: import_zod62.z.number().int().positive(),
        viewportHeight: import_zod62.z.number().int().positive()
      });
      var KeyModifiersSchema22 = import_zod62.z.object({
        ctrl: import_zod62.z.boolean().optional(),
        shift: import_zod62.z.boolean().optional(),
        alt: import_zod62.z.boolean().optional(),
        meta: import_zod62.z.boolean().optional()
      });
      var BaseActionArgsSchema2 = import_zod62.z.object({
        id: import_zod62.z.string().min(1),
        observationId: import_zod62.z.number().int().min(0),
        timestamp: import_zod62.z.number().int().positive(),
        // ponytail: optional in the schema so older payloads still parse. The model
        // is told to always provide it; the parser falls back to "" when missing.
        reasoning: import_zod62.z.string().optional()
      });
      var LeftClickArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "left_click"
          /* LEFT_CLICK */
        ),
        coordinates: CoordinatesSchema2,
        viewport: ViewportContextSchema2
      });
      var DoubleClickArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "double_click"
          /* DOUBLE_CLICK */
        ),
        coordinates: CoordinatesSchema2,
        viewport: ViewportContextSchema2
      });
      var RightClickArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "right_click"
          /* RIGHT_CLICK */
        ),
        coordinates: CoordinatesSchema2,
        viewport: ViewportContextSchema2
      });
      var DragArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "drag"
          /* DRAG */
        ),
        coordinates: DragCoordinatesSchema2,
        viewport: ViewportContextSchema2
      });
      var MouseMoveArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "mouse_move"
          /* MOUSE_MOVE */
        ),
        coordinates: CoordinatesSchema2,
        viewport: ViewportContextSchema2
      });
      var ScrollArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "scroll"
          /* SCROLL */
        ),
        coordinates: CoordinatesSchema2,
        delta: ScrollDeltaSchema2,
        viewport: ViewportContextSchema2
      });
      var KeyArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "key"
          /* KEY */
        ),
        key: import_zod62.z.string().min(1),
        modifiers: KeyModifiersSchema22.optional()
      });
      var VisitUrlArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "visit_url"
          /* VISIT_URL */
        ),
        url: import_zod62.z.string().url(),
        timeout: import_zod62.z.number().int().positive().optional()
      });
      var HistoryBackArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "history_back"
          /* HISTORY_BACK */
        ),
        steps: import_zod62.z.number().int().positive().optional()
      });
      var ScreenshotArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "screenshot"
          /* SCREENSHOT */
        ),
        fullPage: import_zod62.z.boolean().optional()
      });
      var WaitArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "wait"
          /* WAIT */
        ),
        durationMs: import_zod62.z.number().int().positive()
      });
      var AskUserQuestionArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "ask_user_question"
          /* ASK_USER_QUESTION */
        ),
        question: import_zod62.z.string().min(1),
        context: import_zod62.z.string().optional(),
        choices: import_zod62.z.array(import_zod62.z.string()).optional()
      });
      var TerminateArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "terminate"
          /* TERMINATE */
        ),
        finalAnswer: import_zod62.z.string().optional()
      });
      var PauseAndMemorizeFactArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "pause_and_memorize_fact"
          /* PAUSE_AND_MEMORIZE_FACT */
        ),
        fact: import_zod62.z.string().min(1),
        category: import_zod62.z.string().optional()
      });
      var InsertTextArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "insert_text"
          /* INSERT_TEXT */
        ),
        text: import_zod62.z.string().min(1),
        targetId: import_zod62.z.string().optional()
      });
      var MemorizeFactArgsSchema2 = BaseActionArgsSchema2.extend({
        type: import_zod62.z.literal(
          "memorize_fact"
          /* MEMORIZE_FACT */
        ),
        fact: import_zod62.z.string().min(1),
        category: import_zod62.z.string().optional()
      });
      var FaraActionArgsSchema2 = import_zod62.z.union([
        LeftClickArgsSchema2,
        DoubleClickArgsSchema2,
        RightClickArgsSchema2,
        DragArgsSchema2,
        MouseMoveArgsSchema2,
        ScrollArgsSchema2,
        KeyArgsSchema2,
        InsertTextArgsSchema2,
        VisitUrlArgsSchema2,
        HistoryBackArgsSchema2,
        ScreenshotArgsSchema2,
        WaitArgsSchema2,
        AskUserQuestionArgsSchema2,
        TerminateArgsSchema2,
        PauseAndMemorizeFactArgsSchema2,
        MemorizeFactArgsSchema2
      ]);
      function validateActionArgs(args) {
        return FaraActionArgsSchema2.parse(args);
      }
      function tryValidateActionArgs(args) {
        return FaraActionArgsSchema2.safeParse(args).success ? FaraActionArgsSchema2.parse(args) : null;
      }
      function validateCoordinatesInBounds(x, y, viewportWidth, viewportHeight) {
        return x >= 0 && x < viewportWidth && y >= 0 && y < viewportHeight;
      }
      function assertCoordinatesInBounds(x, y, viewportWidth, viewportHeight) {
        if (!validateCoordinatesInBounds(x, y, viewportWidth, viewportHeight)) {
          throw new Error(
            `Coordinates (${x}, ${y}) are out of bounds for viewport ${viewportWidth}x${viewportHeight}`
          );
        }
      }
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
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, "0");
    return (hex + hex).slice(0, STABLE_REF_HEX_LENGTH);
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

  // src/canonical/execution-pipeline.ts
  var import_brotto_action_schema = __toESM(require_dist());

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
      const parsed = import_brotto_action_schema.ActionCommandV1Schema.safeParse(input);
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

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
  var external_exports = {};
  __export(external_exports, {
    BRAND: () => BRAND,
    DIRTY: () => DIRTY,
    EMPTY_PATH: () => EMPTY_PATH,
    INVALID: () => INVALID,
    NEVER: () => NEVER,
    OK: () => OK,
    ParseStatus: () => ParseStatus,
    Schema: () => ZodType,
    ZodAny: () => ZodAny,
    ZodArray: () => ZodArray,
    ZodBigInt: () => ZodBigInt,
    ZodBoolean: () => ZodBoolean,
    ZodBranded: () => ZodBranded,
    ZodCatch: () => ZodCatch,
    ZodDate: () => ZodDate,
    ZodDefault: () => ZodDefault,
    ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
    ZodEffects: () => ZodEffects,
    ZodEnum: () => ZodEnum,
    ZodError: () => ZodError,
    ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
    ZodFunction: () => ZodFunction,
    ZodIntersection: () => ZodIntersection,
    ZodIssueCode: () => ZodIssueCode,
    ZodLazy: () => ZodLazy,
    ZodLiteral: () => ZodLiteral,
    ZodMap: () => ZodMap,
    ZodNaN: () => ZodNaN,
    ZodNativeEnum: () => ZodNativeEnum,
    ZodNever: () => ZodNever,
    ZodNull: () => ZodNull,
    ZodNullable: () => ZodNullable,
    ZodNumber: () => ZodNumber,
    ZodObject: () => ZodObject,
    ZodOptional: () => ZodOptional,
    ZodParsedType: () => ZodParsedType,
    ZodPipeline: () => ZodPipeline,
    ZodPromise: () => ZodPromise,
    ZodReadonly: () => ZodReadonly,
    ZodRecord: () => ZodRecord,
    ZodSchema: () => ZodType,
    ZodSet: () => ZodSet,
    ZodString: () => ZodString,
    ZodSymbol: () => ZodSymbol,
    ZodTransformer: () => ZodEffects,
    ZodTuple: () => ZodTuple,
    ZodType: () => ZodType,
    ZodUndefined: () => ZodUndefined,
    ZodUnion: () => ZodUnion,
    ZodUnknown: () => ZodUnknown,
    ZodVoid: () => ZodVoid,
    addIssueToContext: () => addIssueToContext,
    any: () => anyType,
    array: () => arrayType,
    bigint: () => bigIntType,
    boolean: () => booleanType,
    coerce: () => coerce,
    custom: () => custom,
    date: () => dateType,
    datetimeRegex: () => datetimeRegex,
    defaultErrorMap: () => en_default,
    discriminatedUnion: () => discriminatedUnionType,
    effect: () => effectsType,
    enum: () => enumType,
    function: () => functionType,
    getErrorMap: () => getErrorMap,
    getParsedType: () => getParsedType,
    instanceof: () => instanceOfType,
    intersection: () => intersectionType,
    isAborted: () => isAborted,
    isAsync: () => isAsync,
    isDirty: () => isDirty,
    isValid: () => isValid,
    late: () => late,
    lazy: () => lazyType,
    literal: () => literalType,
    makeIssue: () => makeIssue,
    map: () => mapType,
    nan: () => nanType,
    nativeEnum: () => nativeEnumType,
    never: () => neverType,
    null: () => nullType,
    nullable: () => nullableType,
    number: () => numberType,
    object: () => objectType,
    objectUtil: () => objectUtil,
    oboolean: () => oboolean,
    onumber: () => onumber,
    optional: () => optionalType,
    ostring: () => ostring,
    pipeline: () => pipelineType,
    preprocess: () => preprocessType,
    promise: () => promiseType,
    quotelessJson: () => quotelessJson,
    record: () => recordType,
    set: () => setType,
    setErrorMap: () => setErrorMap,
    strictObject: () => strictObjectType,
    string: () => stringType,
    symbol: () => symbolType,
    transformer: () => effectsType,
    tuple: () => tupleType,
    undefined: () => undefinedType,
    union: () => unionType,
    unknown: () => unknownType,
    util: () => util,
    void: () => voidType
  });

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
  var util;
  (function(util2) {
    util2.assertEqual = (_) => {
    };
    function assertIs(_arg) {
    }
    util2.assertIs = assertIs;
    function assertNever(_x) {
      throw new Error();
    }
    util2.assertNever = assertNever;
    util2.arrayToEnum = (items) => {
      const obj = {};
      for (const item of items) {
        obj[item] = item;
      }
      return obj;
    };
    util2.getValidEnumValues = (obj) => {
      const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
      const filtered = {};
      for (const k of validKeys) {
        filtered[k] = obj[k];
      }
      return util2.objectValues(filtered);
    };
    util2.objectValues = (obj) => {
      return util2.objectKeys(obj).map(function(e) {
        return obj[e];
      });
    };
    util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
      const keys = [];
      for (const key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) {
          keys.push(key);
        }
      }
      return keys;
    };
    util2.find = (arr, checker) => {
      for (const item of arr) {
        if (checker(item))
          return item;
      }
      return void 0;
    };
    util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
    function joinValues(array, separator = " | ") {
      return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
    }
    util2.joinValues = joinValues;
    util2.jsonStringifyReplacer = (_, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    };
  })(util || (util = {}));
  var objectUtil;
  (function(objectUtil2) {
    objectUtil2.mergeShapes = (first, second) => {
      return {
        ...first,
        ...second
        // second overwrites first
      };
    };
  })(objectUtil || (objectUtil = {}));
  var ZodParsedType = util.arrayToEnum([
    "string",
    "nan",
    "number",
    "integer",
    "float",
    "boolean",
    "date",
    "bigint",
    "symbol",
    "function",
    "undefined",
    "null",
    "array",
    "object",
    "unknown",
    "promise",
    "void",
    "never",
    "map",
    "set"
  ]);
  var getParsedType = (data) => {
    const t = typeof data;
    switch (t) {
      case "undefined":
        return ZodParsedType.undefined;
      case "string":
        return ZodParsedType.string;
      case "number":
        return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
      case "boolean":
        return ZodParsedType.boolean;
      case "function":
        return ZodParsedType.function;
      case "bigint":
        return ZodParsedType.bigint;
      case "symbol":
        return ZodParsedType.symbol;
      case "object":
        if (Array.isArray(data)) {
          return ZodParsedType.array;
        }
        if (data === null) {
          return ZodParsedType.null;
        }
        if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
          return ZodParsedType.promise;
        }
        if (typeof Map !== "undefined" && data instanceof Map) {
          return ZodParsedType.map;
        }
        if (typeof Set !== "undefined" && data instanceof Set) {
          return ZodParsedType.set;
        }
        if (typeof Date !== "undefined" && data instanceof Date) {
          return ZodParsedType.date;
        }
        return ZodParsedType.object;
      default:
        return ZodParsedType.unknown;
    }
  };

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
  var ZodIssueCode = util.arrayToEnum([
    "invalid_type",
    "invalid_literal",
    "custom",
    "invalid_union",
    "invalid_union_discriminator",
    "invalid_enum_value",
    "unrecognized_keys",
    "invalid_arguments",
    "invalid_return_type",
    "invalid_date",
    "invalid_string",
    "too_small",
    "too_big",
    "invalid_intersection_types",
    "not_multiple_of",
    "not_finite"
  ]);
  var quotelessJson = (obj) => {
    const json = JSON.stringify(obj, null, 2);
    return json.replace(/"([^"]+)":/g, "$1:");
  };
  var ZodError = class _ZodError extends Error {
    get errors() {
      return this.issues;
    }
    constructor(issues) {
      super();
      this.issues = [];
      this.addIssue = (sub) => {
        this.issues = [...this.issues, sub];
      };
      this.addIssues = (subs = []) => {
        this.issues = [...this.issues, ...subs];
      };
      const actualProto = new.target.prototype;
      if (Object.setPrototypeOf) {
        Object.setPrototypeOf(this, actualProto);
      } else {
        this.__proto__ = actualProto;
      }
      this.name = "ZodError";
      this.issues = issues;
    }
    format(_mapper) {
      const mapper = _mapper || function(issue) {
        return issue.message;
      };
      const fieldErrors = { _errors: [] };
      const processError = (error) => {
        for (const issue of error.issues) {
          if (issue.code === "invalid_union") {
            issue.unionErrors.map(processError);
          } else if (issue.code === "invalid_return_type") {
            processError(issue.returnTypeError);
          } else if (issue.code === "invalid_arguments") {
            processError(issue.argumentsError);
          } else if (issue.path.length === 0) {
            fieldErrors._errors.push(mapper(issue));
          } else {
            let curr = fieldErrors;
            let i = 0;
            while (i < issue.path.length) {
              const el = issue.path[i];
              const terminal = i === issue.path.length - 1;
              if (!terminal) {
                curr[el] = curr[el] || { _errors: [] };
              } else {
                curr[el] = curr[el] || { _errors: [] };
                curr[el]._errors.push(mapper(issue));
              }
              curr = curr[el];
              i++;
            }
          }
        }
      };
      processError(this);
      return fieldErrors;
    }
    static assert(value) {
      if (!(value instanceof _ZodError)) {
        throw new Error(`Not a ZodError: ${value}`);
      }
    }
    toString() {
      return this.message;
    }
    get message() {
      return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
    }
    get isEmpty() {
      return this.issues.length === 0;
    }
    flatten(mapper = (issue) => issue.message) {
      const fieldErrors = {};
      const formErrors = [];
      for (const sub of this.issues) {
        if (sub.path.length > 0) {
          const firstEl = sub.path[0];
          fieldErrors[firstEl] = fieldErrors[firstEl] || [];
          fieldErrors[firstEl].push(mapper(sub));
        } else {
          formErrors.push(mapper(sub));
        }
      }
      return { formErrors, fieldErrors };
    }
    get formErrors() {
      return this.flatten();
    }
  };
  ZodError.create = (issues) => {
    const error = new ZodError(issues);
    return error;
  };

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
  var errorMap = (issue, _ctx) => {
    let message;
    switch (issue.code) {
      case ZodIssueCode.invalid_type:
        if (issue.received === ZodParsedType.undefined) {
          message = "Required";
        } else {
          message = `Expected ${issue.expected}, received ${issue.received}`;
        }
        break;
      case ZodIssueCode.invalid_literal:
        message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
        break;
      case ZodIssueCode.unrecognized_keys:
        message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
        break;
      case ZodIssueCode.invalid_union:
        message = `Invalid input`;
        break;
      case ZodIssueCode.invalid_union_discriminator:
        message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
        break;
      case ZodIssueCode.invalid_enum_value:
        message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
        break;
      case ZodIssueCode.invalid_arguments:
        message = `Invalid function arguments`;
        break;
      case ZodIssueCode.invalid_return_type:
        message = `Invalid function return type`;
        break;
      case ZodIssueCode.invalid_date:
        message = `Invalid date`;
        break;
      case ZodIssueCode.invalid_string:
        if (typeof issue.validation === "object") {
          if ("includes" in issue.validation) {
            message = `Invalid input: must include "${issue.validation.includes}"`;
            if (typeof issue.validation.position === "number") {
              message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
            }
          } else if ("startsWith" in issue.validation) {
            message = `Invalid input: must start with "${issue.validation.startsWith}"`;
          } else if ("endsWith" in issue.validation) {
            message = `Invalid input: must end with "${issue.validation.endsWith}"`;
          } else {
            util.assertNever(issue.validation);
          }
        } else if (issue.validation !== "regex") {
          message = `Invalid ${issue.validation}`;
        } else {
          message = "Invalid";
        }
        break;
      case ZodIssueCode.too_small:
        if (issue.type === "array")
          message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
        else if (issue.type === "string")
          message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
        else if (issue.type === "number")
          message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
        else if (issue.type === "bigint")
          message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
        else if (issue.type === "date")
          message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
        else
          message = "Invalid input";
        break;
      case ZodIssueCode.too_big:
        if (issue.type === "array")
          message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
        else if (issue.type === "string")
          message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
        else if (issue.type === "number")
          message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
        else if (issue.type === "bigint")
          message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
        else if (issue.type === "date")
          message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
        else
          message = "Invalid input";
        break;
      case ZodIssueCode.custom:
        message = `Invalid input`;
        break;
      case ZodIssueCode.invalid_intersection_types:
        message = `Intersection results could not be merged`;
        break;
      case ZodIssueCode.not_multiple_of:
        message = `Number must be a multiple of ${issue.multipleOf}`;
        break;
      case ZodIssueCode.not_finite:
        message = "Number must be finite";
        break;
      default:
        message = _ctx.defaultError;
        util.assertNever(issue);
    }
    return { message };
  };
  var en_default = errorMap;

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
  var overrideErrorMap = en_default;
  function setErrorMap(map) {
    overrideErrorMap = map;
  }
  function getErrorMap() {
    return overrideErrorMap;
  }

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
  var makeIssue = (params) => {
    const { data, path, errorMaps, issueData } = params;
    const fullPath = [...path, ...issueData.path || []];
    const fullIssue = {
      ...issueData,
      path: fullPath
    };
    if (issueData.message !== void 0) {
      return {
        ...issueData,
        path: fullPath,
        message: issueData.message
      };
    }
    let errorMessage = "";
    const maps = errorMaps.filter((m) => !!m).slice().reverse();
    for (const map of maps) {
      errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
    }
    return {
      ...issueData,
      path: fullPath,
      message: errorMessage
    };
  };
  var EMPTY_PATH = [];
  function addIssueToContext(ctx, issueData) {
    const overrideMap = getErrorMap();
    const issue = makeIssue({
      issueData,
      data: ctx.data,
      path: ctx.path,
      errorMaps: [
        ctx.common.contextualErrorMap,
        // contextual error map is first priority
        ctx.schemaErrorMap,
        // then schema-bound map if available
        overrideMap,
        // then global override map
        overrideMap === en_default ? void 0 : en_default
        // then global default map
      ].filter((x) => !!x)
    });
    ctx.common.issues.push(issue);
  }
  var ParseStatus = class _ParseStatus {
    constructor() {
      this.value = "valid";
    }
    dirty() {
      if (this.value === "valid")
        this.value = "dirty";
    }
    abort() {
      if (this.value !== "aborted")
        this.value = "aborted";
    }
    static mergeArray(status, results) {
      const arrayValue = [];
      for (const s of results) {
        if (s.status === "aborted")
          return INVALID;
        if (s.status === "dirty")
          status.dirty();
        arrayValue.push(s.value);
      }
      return { status: status.value, value: arrayValue };
    }
    static async mergeObjectAsync(status, pairs) {
      const syncPairs = [];
      for (const pair of pairs) {
        const key = await pair.key;
        const value = await pair.value;
        syncPairs.push({
          key,
          value
        });
      }
      return _ParseStatus.mergeObjectSync(status, syncPairs);
    }
    static mergeObjectSync(status, pairs) {
      const finalObject = {};
      for (const pair of pairs) {
        const { key, value } = pair;
        if (key.status === "aborted")
          return INVALID;
        if (value.status === "aborted")
          return INVALID;
        if (key.status === "dirty")
          status.dirty();
        if (value.status === "dirty")
          status.dirty();
        if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
          finalObject[key.value] = value.value;
        }
      }
      return { status: status.value, value: finalObject };
    }
  };
  var INVALID = Object.freeze({
    status: "aborted"
  });
  var DIRTY = (value) => ({ status: "dirty", value });
  var OK = (value) => ({ status: "valid", value });
  var isAborted = (x) => x.status === "aborted";
  var isDirty = (x) => x.status === "dirty";
  var isValid = (x) => x.status === "valid";
  var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
  var errorUtil;
  (function(errorUtil2) {
    errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
    errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
  })(errorUtil || (errorUtil = {}));

  // ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
  var ParseInputLazyPath = class {
    constructor(parent, value, path, key) {
      this._cachedPath = [];
      this.parent = parent;
      this.data = value;
      this._path = path;
      this._key = key;
    }
    get path() {
      if (!this._cachedPath.length) {
        if (Array.isArray(this._key)) {
          this._cachedPath.push(...this._path, ...this._key);
        } else {
          this._cachedPath.push(...this._path, this._key);
        }
      }
      return this._cachedPath;
    }
  };
  var handleResult = (ctx, result) => {
    if (isValid(result)) {
      return { success: true, data: result.value };
    } else {
      if (!ctx.common.issues.length) {
        throw new Error("Validation failed but no issues detected.");
      }
      return {
        success: false,
        get error() {
          if (this._error)
            return this._error;
          const error = new ZodError(ctx.common.issues);
          this._error = error;
          return this._error;
        }
      };
    }
  };
  function processCreateParams(params) {
    if (!params)
      return {};
    const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
    if (errorMap2 && (invalid_type_error || required_error)) {
      throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
    }
    if (errorMap2)
      return { errorMap: errorMap2, description };
    const customMap = (iss, ctx) => {
      const { message } = params;
      if (iss.code === "invalid_enum_value") {
        return { message: message ?? ctx.defaultError };
      }
      if (typeof ctx.data === "undefined") {
        return { message: message ?? required_error ?? ctx.defaultError };
      }
      if (iss.code !== "invalid_type")
        return { message: ctx.defaultError };
      return { message: message ?? invalid_type_error ?? ctx.defaultError };
    };
    return { errorMap: customMap, description };
  }
  var ZodType = class {
    get description() {
      return this._def.description;
    }
    _getType(input) {
      return getParsedType(input.data);
    }
    _getOrReturnCtx(input, ctx) {
      return ctx || {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      };
    }
    _processInputParams(input) {
      return {
        status: new ParseStatus(),
        ctx: {
          common: input.parent.common,
          data: input.data,
          parsedType: getParsedType(input.data),
          schemaErrorMap: this._def.errorMap,
          path: input.path,
          parent: input.parent
        }
      };
    }
    _parseSync(input) {
      const result = this._parse(input);
      if (isAsync(result)) {
        throw new Error("Synchronous parse encountered promise.");
      }
      return result;
    }
    _parseAsync(input) {
      const result = this._parse(input);
      return Promise.resolve(result);
    }
    parse(data, params) {
      const result = this.safeParse(data, params);
      if (result.success)
        return result.data;
      throw result.error;
    }
    safeParse(data, params) {
      const ctx = {
        common: {
          issues: [],
          async: params?.async ?? false,
          contextualErrorMap: params?.errorMap
        },
        path: params?.path || [],
        schemaErrorMap: this._def.errorMap,
        parent: null,
        data,
        parsedType: getParsedType(data)
      };
      const result = this._parseSync({ data, path: ctx.path, parent: ctx });
      return handleResult(ctx, result);
    }
    "~validate"(data) {
      const ctx = {
        common: {
          issues: [],
          async: !!this["~standard"].async
        },
        path: [],
        schemaErrorMap: this._def.errorMap,
        parent: null,
        data,
        parsedType: getParsedType(data)
      };
      if (!this["~standard"].async) {
        try {
          const result = this._parseSync({ data, path: [], parent: ctx });
          return isValid(result) ? {
            value: result.value
          } : {
            issues: ctx.common.issues
          };
        } catch (err) {
          if (err?.message?.toLowerCase()?.includes("encountered")) {
            this["~standard"].async = true;
          }
          ctx.common = {
            issues: [],
            async: true
          };
        }
      }
      return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
        value: result.value
      } : {
        issues: ctx.common.issues
      });
    }
    async parseAsync(data, params) {
      const result = await this.safeParseAsync(data, params);
      if (result.success)
        return result.data;
      throw result.error;
    }
    async safeParseAsync(data, params) {
      const ctx = {
        common: {
          issues: [],
          contextualErrorMap: params?.errorMap,
          async: true
        },
        path: params?.path || [],
        schemaErrorMap: this._def.errorMap,
        parent: null,
        data,
        parsedType: getParsedType(data)
      };
      const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
      const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
      return handleResult(ctx, result);
    }
    refine(check, message) {
      const getIssueProperties = (val) => {
        if (typeof message === "string" || typeof message === "undefined") {
          return { message };
        } else if (typeof message === "function") {
          return message(val);
        } else {
          return message;
        }
      };
      return this._refinement((val, ctx) => {
        const result = check(val);
        const setError = () => ctx.addIssue({
          code: ZodIssueCode.custom,
          ...getIssueProperties(val)
        });
        if (typeof Promise !== "undefined" && result instanceof Promise) {
          return result.then((data) => {
            if (!data) {
              setError();
              return false;
            } else {
              return true;
            }
          });
        }
        if (!result) {
          setError();
          return false;
        } else {
          return true;
        }
      });
    }
    refinement(check, refinementData) {
      return this._refinement((val, ctx) => {
        if (!check(val)) {
          ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
          return false;
        } else {
          return true;
        }
      });
    }
    _refinement(refinement) {
      return new ZodEffects({
        schema: this,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect: { type: "refinement", refinement }
      });
    }
    superRefine(refinement) {
      return this._refinement(refinement);
    }
    constructor(def) {
      this.spa = this.safeParseAsync;
      this._def = def;
      this.parse = this.parse.bind(this);
      this.safeParse = this.safeParse.bind(this);
      this.parseAsync = this.parseAsync.bind(this);
      this.safeParseAsync = this.safeParseAsync.bind(this);
      this.spa = this.spa.bind(this);
      this.refine = this.refine.bind(this);
      this.refinement = this.refinement.bind(this);
      this.superRefine = this.superRefine.bind(this);
      this.optional = this.optional.bind(this);
      this.nullable = this.nullable.bind(this);
      this.nullish = this.nullish.bind(this);
      this.array = this.array.bind(this);
      this.promise = this.promise.bind(this);
      this.or = this.or.bind(this);
      this.and = this.and.bind(this);
      this.transform = this.transform.bind(this);
      this.brand = this.brand.bind(this);
      this.default = this.default.bind(this);
      this.catch = this.catch.bind(this);
      this.describe = this.describe.bind(this);
      this.pipe = this.pipe.bind(this);
      this.readonly = this.readonly.bind(this);
      this.isNullable = this.isNullable.bind(this);
      this.isOptional = this.isOptional.bind(this);
      this["~standard"] = {
        version: 1,
        vendor: "zod",
        validate: (data) => this["~validate"](data)
      };
    }
    optional() {
      return ZodOptional.create(this, this._def);
    }
    nullable() {
      return ZodNullable.create(this, this._def);
    }
    nullish() {
      return this.nullable().optional();
    }
    array() {
      return ZodArray.create(this);
    }
    promise() {
      return ZodPromise.create(this, this._def);
    }
    or(option) {
      return ZodUnion.create([this, option], this._def);
    }
    and(incoming) {
      return ZodIntersection.create(this, incoming, this._def);
    }
    transform(transform) {
      return new ZodEffects({
        ...processCreateParams(this._def),
        schema: this,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect: { type: "transform", transform }
      });
    }
    default(def) {
      const defaultValueFunc = typeof def === "function" ? def : () => def;
      return new ZodDefault({
        ...processCreateParams(this._def),
        innerType: this,
        defaultValue: defaultValueFunc,
        typeName: ZodFirstPartyTypeKind.ZodDefault
      });
    }
    brand() {
      return new ZodBranded({
        typeName: ZodFirstPartyTypeKind.ZodBranded,
        type: this,
        ...processCreateParams(this._def)
      });
    }
    catch(def) {
      const catchValueFunc = typeof def === "function" ? def : () => def;
      return new ZodCatch({
        ...processCreateParams(this._def),
        innerType: this,
        catchValue: catchValueFunc,
        typeName: ZodFirstPartyTypeKind.ZodCatch
      });
    }
    describe(description) {
      const This = this.constructor;
      return new This({
        ...this._def,
        description
      });
    }
    pipe(target) {
      return ZodPipeline.create(this, target);
    }
    readonly() {
      return ZodReadonly.create(this);
    }
    isOptional() {
      return this.safeParse(void 0).success;
    }
    isNullable() {
      return this.safeParse(null).success;
    }
  };
  var cuidRegex = /^c[^\s-]{8,}$/i;
  var cuid2Regex = /^[0-9a-z]+$/;
  var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
  var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
  var nanoidRegex = /^[a-z0-9_-]{21}$/i;
  var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
  var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
  var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
  var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
  var emojiRegex;
  var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
  var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
  var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
  var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
  var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
  var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
  var dateRegex = new RegExp(`^${dateRegexSource}$`);
  function timeRegexSource(args) {
    let secondsRegexSource = `[0-5]\\d`;
    if (args.precision) {
      secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
    } else if (args.precision == null) {
      secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
    }
    const secondsQuantifier = args.precision ? "+" : "?";
    return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
  }
  function timeRegex(args) {
    return new RegExp(`^${timeRegexSource(args)}$`);
  }
  function datetimeRegex(args) {
    let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
    const opts = [];
    opts.push(args.local ? `Z?` : `Z`);
    if (args.offset)
      opts.push(`([+-]\\d{2}:?\\d{2})`);
    regex = `${regex}(${opts.join("|")})`;
    return new RegExp(`^${regex}$`);
  }
  function isValidIP(ip, version) {
    if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
      return true;
    }
    if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
      return true;
    }
    return false;
  }
  function isValidJWT(jwt, alg) {
    if (!jwtRegex.test(jwt))
      return false;
    try {
      const [header] = jwt.split(".");
      if (!header)
        return false;
      const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
      const decoded = JSON.parse(atob(base64));
      if (typeof decoded !== "object" || decoded === null)
        return false;
      if ("typ" in decoded && decoded?.typ !== "JWT")
        return false;
      if (!decoded.alg)
        return false;
      if (alg && decoded.alg !== alg)
        return false;
      return true;
    } catch {
      return false;
    }
  }
  function isValidCidr(ip, version) {
    if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
      return true;
    }
    if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
      return true;
    }
    return false;
  }
  var ZodString = class _ZodString extends ZodType {
    _parse(input) {
      if (this._def.coerce) {
        input.data = String(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.string) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.string,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      const status = new ParseStatus();
      let ctx = void 0;
      for (const check of this._def.checks) {
        if (check.kind === "min") {
          if (input.data.length < check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          if (input.data.length > check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "length") {
          const tooBig = input.data.length > check.value;
          const tooSmall = input.data.length < check.value;
          if (tooBig || tooSmall) {
            ctx = this._getOrReturnCtx(input, ctx);
            if (tooBig) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "string",
                inclusive: true,
                exact: true,
                message: check.message
              });
            } else if (tooSmall) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "string",
                inclusive: true,
                exact: true,
                message: check.message
              });
            }
            status.dirty();
          }
        } else if (check.kind === "email") {
          if (!emailRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "email",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "emoji") {
          if (!emojiRegex) {
            emojiRegex = new RegExp(_emojiRegex, "u");
          }
          if (!emojiRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "emoji",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "uuid") {
          if (!uuidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "uuid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "nanoid") {
          if (!nanoidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "nanoid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "cuid") {
          if (!cuidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "cuid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "cuid2") {
          if (!cuid2Regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "cuid2",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "ulid") {
          if (!ulidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "ulid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "url") {
          try {
            new URL(input.data);
          } catch {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "url",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "regex") {
          check.regex.lastIndex = 0;
          const testResult = check.regex.test(input.data);
          if (!testResult) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "regex",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "trim") {
          input.data = input.data.trim();
        } else if (check.kind === "includes") {
          if (!input.data.includes(check.value, check.position)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: { includes: check.value, position: check.position },
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "toLowerCase") {
          input.data = input.data.toLowerCase();
        } else if (check.kind === "toUpperCase") {
          input.data = input.data.toUpperCase();
        } else if (check.kind === "startsWith") {
          if (!input.data.startsWith(check.value)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: { startsWith: check.value },
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "endsWith") {
          if (!input.data.endsWith(check.value)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: { endsWith: check.value },
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "datetime") {
          const regex = datetimeRegex(check);
          if (!regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: "datetime",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "date") {
          const regex = dateRegex;
          if (!regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: "date",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "time") {
          const regex = timeRegex(check);
          if (!regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: "time",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "duration") {
          if (!durationRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "duration",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "ip") {
          if (!isValidIP(input.data, check.version)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "ip",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "jwt") {
          if (!isValidJWT(input.data, check.alg)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "jwt",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "cidr") {
          if (!isValidCidr(input.data, check.version)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "cidr",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "base64") {
          if (!base64Regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "base64",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "base64url") {
          if (!base64urlRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "base64url",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return { status: status.value, value: input.data };
    }
    _regex(regex, validation, message) {
      return this.refinement((data) => regex.test(data), {
        validation,
        code: ZodIssueCode.invalid_string,
        ...errorUtil.errToObj(message)
      });
    }
    _addCheck(check) {
      return new _ZodString({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    email(message) {
      return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
    }
    url(message) {
      return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
    }
    emoji(message) {
      return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
    }
    uuid(message) {
      return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
    }
    nanoid(message) {
      return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
    }
    cuid(message) {
      return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
    }
    cuid2(message) {
      return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
    }
    ulid(message) {
      return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
    }
    base64(message) {
      return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
    }
    base64url(message) {
      return this._addCheck({
        kind: "base64url",
        ...errorUtil.errToObj(message)
      });
    }
    jwt(options) {
      return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
    }
    ip(options) {
      return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
    }
    cidr(options) {
      return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
    }
    datetime(options) {
      if (typeof options === "string") {
        return this._addCheck({
          kind: "datetime",
          precision: null,
          offset: false,
          local: false,
          message: options
        });
      }
      return this._addCheck({
        kind: "datetime",
        precision: typeof options?.precision === "undefined" ? null : options?.precision,
        offset: options?.offset ?? false,
        local: options?.local ?? false,
        ...errorUtil.errToObj(options?.message)
      });
    }
    date(message) {
      return this._addCheck({ kind: "date", message });
    }
    time(options) {
      if (typeof options === "string") {
        return this._addCheck({
          kind: "time",
          precision: null,
          message: options
        });
      }
      return this._addCheck({
        kind: "time",
        precision: typeof options?.precision === "undefined" ? null : options?.precision,
        ...errorUtil.errToObj(options?.message)
      });
    }
    duration(message) {
      return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
    }
    regex(regex, message) {
      return this._addCheck({
        kind: "regex",
        regex,
        ...errorUtil.errToObj(message)
      });
    }
    includes(value, options) {
      return this._addCheck({
        kind: "includes",
        value,
        position: options?.position,
        ...errorUtil.errToObj(options?.message)
      });
    }
    startsWith(value, message) {
      return this._addCheck({
        kind: "startsWith",
        value,
        ...errorUtil.errToObj(message)
      });
    }
    endsWith(value, message) {
      return this._addCheck({
        kind: "endsWith",
        value,
        ...errorUtil.errToObj(message)
      });
    }
    min(minLength, message) {
      return this._addCheck({
        kind: "min",
        value: minLength,
        ...errorUtil.errToObj(message)
      });
    }
    max(maxLength, message) {
      return this._addCheck({
        kind: "max",
        value: maxLength,
        ...errorUtil.errToObj(message)
      });
    }
    length(len, message) {
      return this._addCheck({
        kind: "length",
        value: len,
        ...errorUtil.errToObj(message)
      });
    }
    /**
     * Equivalent to `.min(1)`
     */
    nonempty(message) {
      return this.min(1, errorUtil.errToObj(message));
    }
    trim() {
      return new _ZodString({
        ...this._def,
        checks: [...this._def.checks, { kind: "trim" }]
      });
    }
    toLowerCase() {
      return new _ZodString({
        ...this._def,
        checks: [...this._def.checks, { kind: "toLowerCase" }]
      });
    }
    toUpperCase() {
      return new _ZodString({
        ...this._def,
        checks: [...this._def.checks, { kind: "toUpperCase" }]
      });
    }
    get isDatetime() {
      return !!this._def.checks.find((ch) => ch.kind === "datetime");
    }
    get isDate() {
      return !!this._def.checks.find((ch) => ch.kind === "date");
    }
    get isTime() {
      return !!this._def.checks.find((ch) => ch.kind === "time");
    }
    get isDuration() {
      return !!this._def.checks.find((ch) => ch.kind === "duration");
    }
    get isEmail() {
      return !!this._def.checks.find((ch) => ch.kind === "email");
    }
    get isURL() {
      return !!this._def.checks.find((ch) => ch.kind === "url");
    }
    get isEmoji() {
      return !!this._def.checks.find((ch) => ch.kind === "emoji");
    }
    get isUUID() {
      return !!this._def.checks.find((ch) => ch.kind === "uuid");
    }
    get isNANOID() {
      return !!this._def.checks.find((ch) => ch.kind === "nanoid");
    }
    get isCUID() {
      return !!this._def.checks.find((ch) => ch.kind === "cuid");
    }
    get isCUID2() {
      return !!this._def.checks.find((ch) => ch.kind === "cuid2");
    }
    get isULID() {
      return !!this._def.checks.find((ch) => ch.kind === "ulid");
    }
    get isIP() {
      return !!this._def.checks.find((ch) => ch.kind === "ip");
    }
    get isCIDR() {
      return !!this._def.checks.find((ch) => ch.kind === "cidr");
    }
    get isBase64() {
      return !!this._def.checks.find((ch) => ch.kind === "base64");
    }
    get isBase64url() {
      return !!this._def.checks.find((ch) => ch.kind === "base64url");
    }
    get minLength() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min;
    }
    get maxLength() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max;
    }
  };
  ZodString.create = (params) => {
    return new ZodString({
      checks: [],
      typeName: ZodFirstPartyTypeKind.ZodString,
      coerce: params?.coerce ?? false,
      ...processCreateParams(params)
    });
  };
  function floatSafeRemainder(val, step) {
    const valDecCount = (val.toString().split(".")[1] || "").length;
    const stepDecCount = (step.toString().split(".")[1] || "").length;
    const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
    const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
    const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
    return valInt % stepInt / 10 ** decCount;
  }
  var ZodNumber = class _ZodNumber extends ZodType {
    constructor() {
      super(...arguments);
      this.min = this.gte;
      this.max = this.lte;
      this.step = this.multipleOf;
    }
    _parse(input) {
      if (this._def.coerce) {
        input.data = Number(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.number) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.number,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      let ctx = void 0;
      const status = new ParseStatus();
      for (const check of this._def.checks) {
        if (check.kind === "int") {
          if (!util.isInteger(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_type,
              expected: "integer",
              received: "float",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "min") {
          const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
          if (tooSmall) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "number",
              inclusive: check.inclusive,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
          if (tooBig) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "number",
              inclusive: check.inclusive,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "multipleOf") {
          if (floatSafeRemainder(input.data, check.value) !== 0) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.not_multiple_of,
              multipleOf: check.value,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "finite") {
          if (!Number.isFinite(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.not_finite,
              message: check.message
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return { status: status.value, value: input.data };
    }
    gte(value, message) {
      return this.setLimit("min", value, true, errorUtil.toString(message));
    }
    gt(value, message) {
      return this.setLimit("min", value, false, errorUtil.toString(message));
    }
    lte(value, message) {
      return this.setLimit("max", value, true, errorUtil.toString(message));
    }
    lt(value, message) {
      return this.setLimit("max", value, false, errorUtil.toString(message));
    }
    setLimit(kind, value, inclusive, message) {
      return new _ZodNumber({
        ...this._def,
        checks: [
          ...this._def.checks,
          {
            kind,
            value,
            inclusive,
            message: errorUtil.toString(message)
          }
        ]
      });
    }
    _addCheck(check) {
      return new _ZodNumber({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    int(message) {
      return this._addCheck({
        kind: "int",
        message: errorUtil.toString(message)
      });
    }
    positive(message) {
      return this._addCheck({
        kind: "min",
        value: 0,
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    negative(message) {
      return this._addCheck({
        kind: "max",
        value: 0,
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    nonpositive(message) {
      return this._addCheck({
        kind: "max",
        value: 0,
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    nonnegative(message) {
      return this._addCheck({
        kind: "min",
        value: 0,
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    multipleOf(value, message) {
      return this._addCheck({
        kind: "multipleOf",
        value,
        message: errorUtil.toString(message)
      });
    }
    finite(message) {
      return this._addCheck({
        kind: "finite",
        message: errorUtil.toString(message)
      });
    }
    safe(message) {
      return this._addCheck({
        kind: "min",
        inclusive: true,
        value: Number.MIN_SAFE_INTEGER,
        message: errorUtil.toString(message)
      })._addCheck({
        kind: "max",
        inclusive: true,
        value: Number.MAX_SAFE_INTEGER,
        message: errorUtil.toString(message)
      });
    }
    get minValue() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min;
    }
    get maxValue() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max;
    }
    get isInt() {
      return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
    }
    get isFinite() {
      let max = null;
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
          return true;
        } else if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        } else if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return Number.isFinite(min) && Number.isFinite(max);
    }
  };
  ZodNumber.create = (params) => {
    return new ZodNumber({
      checks: [],
      typeName: ZodFirstPartyTypeKind.ZodNumber,
      coerce: params?.coerce || false,
      ...processCreateParams(params)
    });
  };
  var ZodBigInt = class _ZodBigInt extends ZodType {
    constructor() {
      super(...arguments);
      this.min = this.gte;
      this.max = this.lte;
    }
    _parse(input) {
      if (this._def.coerce) {
        try {
          input.data = BigInt(input.data);
        } catch {
          return this._getInvalidInput(input);
        }
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.bigint) {
        return this._getInvalidInput(input);
      }
      let ctx = void 0;
      const status = new ParseStatus();
      for (const check of this._def.checks) {
        if (check.kind === "min") {
          const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
          if (tooSmall) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              type: "bigint",
              minimum: check.value,
              inclusive: check.inclusive,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
          if (tooBig) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              type: "bigint",
              maximum: check.value,
              inclusive: check.inclusive,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "multipleOf") {
          if (input.data % check.value !== BigInt(0)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.not_multiple_of,
              multipleOf: check.value,
              message: check.message
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return { status: status.value, value: input.data };
    }
    _getInvalidInput(input) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.bigint,
        received: ctx.parsedType
      });
      return INVALID;
    }
    gte(value, message) {
      return this.setLimit("min", value, true, errorUtil.toString(message));
    }
    gt(value, message) {
      return this.setLimit("min", value, false, errorUtil.toString(message));
    }
    lte(value, message) {
      return this.setLimit("max", value, true, errorUtil.toString(message));
    }
    lt(value, message) {
      return this.setLimit("max", value, false, errorUtil.toString(message));
    }
    setLimit(kind, value, inclusive, message) {
      return new _ZodBigInt({
        ...this._def,
        checks: [
          ...this._def.checks,
          {
            kind,
            value,
            inclusive,
            message: errorUtil.toString(message)
          }
        ]
      });
    }
    _addCheck(check) {
      return new _ZodBigInt({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    positive(message) {
      return this._addCheck({
        kind: "min",
        value: BigInt(0),
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    negative(message) {
      return this._addCheck({
        kind: "max",
        value: BigInt(0),
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    nonpositive(message) {
      return this._addCheck({
        kind: "max",
        value: BigInt(0),
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    nonnegative(message) {
      return this._addCheck({
        kind: "min",
        value: BigInt(0),
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    multipleOf(value, message) {
      return this._addCheck({
        kind: "multipleOf",
        value,
        message: errorUtil.toString(message)
      });
    }
    get minValue() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min;
    }
    get maxValue() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max;
    }
  };
  ZodBigInt.create = (params) => {
    return new ZodBigInt({
      checks: [],
      typeName: ZodFirstPartyTypeKind.ZodBigInt,
      coerce: params?.coerce ?? false,
      ...processCreateParams(params)
    });
  };
  var ZodBoolean = class extends ZodType {
    _parse(input) {
      if (this._def.coerce) {
        input.data = Boolean(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.boolean) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.boolean,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodBoolean.create = (params) => {
    return new ZodBoolean({
      typeName: ZodFirstPartyTypeKind.ZodBoolean,
      coerce: params?.coerce || false,
      ...processCreateParams(params)
    });
  };
  var ZodDate = class _ZodDate extends ZodType {
    _parse(input) {
      if (this._def.coerce) {
        input.data = new Date(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.date) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.date,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      if (Number.isNaN(input.data.getTime())) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_date
        });
        return INVALID;
      }
      const status = new ParseStatus();
      let ctx = void 0;
      for (const check of this._def.checks) {
        if (check.kind === "min") {
          if (input.data.getTime() < check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              message: check.message,
              inclusive: true,
              exact: false,
              minimum: check.value,
              type: "date"
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          if (input.data.getTime() > check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              message: check.message,
              inclusive: true,
              exact: false,
              maximum: check.value,
              type: "date"
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return {
        status: status.value,
        value: new Date(input.data.getTime())
      };
    }
    _addCheck(check) {
      return new _ZodDate({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    min(minDate, message) {
      return this._addCheck({
        kind: "min",
        value: minDate.getTime(),
        message: errorUtil.toString(message)
      });
    }
    max(maxDate, message) {
      return this._addCheck({
        kind: "max",
        value: maxDate.getTime(),
        message: errorUtil.toString(message)
      });
    }
    get minDate() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min != null ? new Date(min) : null;
    }
    get maxDate() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max != null ? new Date(max) : null;
    }
  };
  ZodDate.create = (params) => {
    return new ZodDate({
      checks: [],
      coerce: params?.coerce || false,
      typeName: ZodFirstPartyTypeKind.ZodDate,
      ...processCreateParams(params)
    });
  };
  var ZodSymbol = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.symbol) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.symbol,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodSymbol.create = (params) => {
    return new ZodSymbol({
      typeName: ZodFirstPartyTypeKind.ZodSymbol,
      ...processCreateParams(params)
    });
  };
  var ZodUndefined = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.undefined) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.undefined,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodUndefined.create = (params) => {
    return new ZodUndefined({
      typeName: ZodFirstPartyTypeKind.ZodUndefined,
      ...processCreateParams(params)
    });
  };
  var ZodNull = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.null) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.null,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodNull.create = (params) => {
    return new ZodNull({
      typeName: ZodFirstPartyTypeKind.ZodNull,
      ...processCreateParams(params)
    });
  };
  var ZodAny = class extends ZodType {
    constructor() {
      super(...arguments);
      this._any = true;
    }
    _parse(input) {
      return OK(input.data);
    }
  };
  ZodAny.create = (params) => {
    return new ZodAny({
      typeName: ZodFirstPartyTypeKind.ZodAny,
      ...processCreateParams(params)
    });
  };
  var ZodUnknown = class extends ZodType {
    constructor() {
      super(...arguments);
      this._unknown = true;
    }
    _parse(input) {
      return OK(input.data);
    }
  };
  ZodUnknown.create = (params) => {
    return new ZodUnknown({
      typeName: ZodFirstPartyTypeKind.ZodUnknown,
      ...processCreateParams(params)
    });
  };
  var ZodNever = class extends ZodType {
    _parse(input) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.never,
        received: ctx.parsedType
      });
      return INVALID;
    }
  };
  ZodNever.create = (params) => {
    return new ZodNever({
      typeName: ZodFirstPartyTypeKind.ZodNever,
      ...processCreateParams(params)
    });
  };
  var ZodVoid = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.undefined) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.void,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodVoid.create = (params) => {
    return new ZodVoid({
      typeName: ZodFirstPartyTypeKind.ZodVoid,
      ...processCreateParams(params)
    });
  };
  var ZodArray = class _ZodArray extends ZodType {
    _parse(input) {
      const { ctx, status } = this._processInputParams(input);
      const def = this._def;
      if (ctx.parsedType !== ZodParsedType.array) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.array,
          received: ctx.parsedType
        });
        return INVALID;
      }
      if (def.exactLength !== null) {
        const tooBig = ctx.data.length > def.exactLength.value;
        const tooSmall = ctx.data.length < def.exactLength.value;
        if (tooBig || tooSmall) {
          addIssueToContext(ctx, {
            code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
            minimum: tooSmall ? def.exactLength.value : void 0,
            maximum: tooBig ? def.exactLength.value : void 0,
            type: "array",
            inclusive: true,
            exact: true,
            message: def.exactLength.message
          });
          status.dirty();
        }
      }
      if (def.minLength !== null) {
        if (ctx.data.length < def.minLength.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: def.minLength.value,
            type: "array",
            inclusive: true,
            exact: false,
            message: def.minLength.message
          });
          status.dirty();
        }
      }
      if (def.maxLength !== null) {
        if (ctx.data.length > def.maxLength.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: def.maxLength.value,
            type: "array",
            inclusive: true,
            exact: false,
            message: def.maxLength.message
          });
          status.dirty();
        }
      }
      if (ctx.common.async) {
        return Promise.all([...ctx.data].map((item, i) => {
          return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        })).then((result2) => {
          return ParseStatus.mergeArray(status, result2);
        });
      }
      const result = [...ctx.data].map((item, i) => {
        return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      });
      return ParseStatus.mergeArray(status, result);
    }
    get element() {
      return this._def.type;
    }
    min(minLength, message) {
      return new _ZodArray({
        ...this._def,
        minLength: { value: minLength, message: errorUtil.toString(message) }
      });
    }
    max(maxLength, message) {
      return new _ZodArray({
        ...this._def,
        maxLength: { value: maxLength, message: errorUtil.toString(message) }
      });
    }
    length(len, message) {
      return new _ZodArray({
        ...this._def,
        exactLength: { value: len, message: errorUtil.toString(message) }
      });
    }
    nonempty(message) {
      return this.min(1, message);
    }
  };
  ZodArray.create = (schema, params) => {
    return new ZodArray({
      type: schema,
      minLength: null,
      maxLength: null,
      exactLength: null,
      typeName: ZodFirstPartyTypeKind.ZodArray,
      ...processCreateParams(params)
    });
  };
  function deepPartialify(schema) {
    if (schema instanceof ZodObject) {
      const newShape = {};
      for (const key in schema.shape) {
        const fieldSchema = schema.shape[key];
        newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
      }
      return new ZodObject({
        ...schema._def,
        shape: () => newShape
      });
    } else if (schema instanceof ZodArray) {
      return new ZodArray({
        ...schema._def,
        type: deepPartialify(schema.element)
      });
    } else if (schema instanceof ZodOptional) {
      return ZodOptional.create(deepPartialify(schema.unwrap()));
    } else if (schema instanceof ZodNullable) {
      return ZodNullable.create(deepPartialify(schema.unwrap()));
    } else if (schema instanceof ZodTuple) {
      return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
    } else {
      return schema;
    }
  }
  var ZodObject = class _ZodObject extends ZodType {
    constructor() {
      super(...arguments);
      this._cached = null;
      this.nonstrict = this.passthrough;
      this.augment = this.extend;
    }
    _getCached() {
      if (this._cached !== null)
        return this._cached;
      const shape = this._def.shape();
      const keys = util.objectKeys(shape);
      this._cached = { shape, keys };
      return this._cached;
    }
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.object) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.object,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      const { status, ctx } = this._processInputParams(input);
      const { shape, keys: shapeKeys } = this._getCached();
      const extraKeys = [];
      if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
        for (const key in ctx.data) {
          if (!shapeKeys.includes(key)) {
            extraKeys.push(key);
          }
        }
      }
      const pairs = [];
      for (const key of shapeKeys) {
        const keyValidator = shape[key];
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
      if (this._def.catchall instanceof ZodNever) {
        const unknownKeys = this._def.unknownKeys;
        if (unknownKeys === "passthrough") {
          for (const key of extraKeys) {
            pairs.push({
              key: { status: "valid", value: key },
              value: { status: "valid", value: ctx.data[key] }
            });
          }
        } else if (unknownKeys === "strict") {
          if (extraKeys.length > 0) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.unrecognized_keys,
              keys: extraKeys
            });
            status.dirty();
          }
        } else if (unknownKeys === "strip") {
        } else {
          throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
        }
      } else {
        const catchall = this._def.catchall;
        for (const key of extraKeys) {
          const value = ctx.data[key];
          pairs.push({
            key: { status: "valid", value: key },
            value: catchall._parse(
              new ParseInputLazyPath(ctx, value, ctx.path, key)
              //, ctx.child(key), value, getParsedType(value)
            ),
            alwaysSet: key in ctx.data
          });
        }
      }
      if (ctx.common.async) {
        return Promise.resolve().then(async () => {
          const syncPairs = [];
          for (const pair of pairs) {
            const key = await pair.key;
            const value = await pair.value;
            syncPairs.push({
              key,
              value,
              alwaysSet: pair.alwaysSet
            });
          }
          return syncPairs;
        }).then((syncPairs) => {
          return ParseStatus.mergeObjectSync(status, syncPairs);
        });
      } else {
        return ParseStatus.mergeObjectSync(status, pairs);
      }
    }
    get shape() {
      return this._def.shape();
    }
    strict(message) {
      errorUtil.errToObj;
      return new _ZodObject({
        ...this._def,
        unknownKeys: "strict",
        ...message !== void 0 ? {
          errorMap: (issue, ctx) => {
            const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
            if (issue.code === "unrecognized_keys")
              return {
                message: errorUtil.errToObj(message).message ?? defaultError
              };
            return {
              message: defaultError
            };
          }
        } : {}
      });
    }
    strip() {
      return new _ZodObject({
        ...this._def,
        unknownKeys: "strip"
      });
    }
    passthrough() {
      return new _ZodObject({
        ...this._def,
        unknownKeys: "passthrough"
      });
    }
    // const AugmentFactory =
    //   <Def extends ZodObjectDef>(def: Def) =>
    //   <Augmentation extends ZodRawShape>(
    //     augmentation: Augmentation
    //   ): ZodObject<
    //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
    //     Def["unknownKeys"],
    //     Def["catchall"]
    //   > => {
    //     return new ZodObject({
    //       ...def,
    //       shape: () => ({
    //         ...def.shape(),
    //         ...augmentation,
    //       }),
    //     }) as any;
    //   };
    extend(augmentation) {
      return new _ZodObject({
        ...this._def,
        shape: () => ({
          ...this._def.shape(),
          ...augmentation
        })
      });
    }
    /**
     * Prior to zod@1.0.12 there was a bug in the
     * inferred type of merged objects. Please
     * upgrade if you are experiencing issues.
     */
    merge(merging) {
      const merged = new _ZodObject({
        unknownKeys: merging._def.unknownKeys,
        catchall: merging._def.catchall,
        shape: () => ({
          ...this._def.shape(),
          ...merging._def.shape()
        }),
        typeName: ZodFirstPartyTypeKind.ZodObject
      });
      return merged;
    }
    // merge<
    //   Incoming extends AnyZodObject,
    //   Augmentation extends Incoming["shape"],
    //   NewOutput extends {
    //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
    //       ? Augmentation[k]["_output"]
    //       : k extends keyof Output
    //       ? Output[k]
    //       : never;
    //   },
    //   NewInput extends {
    //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
    //       ? Augmentation[k]["_input"]
    //       : k extends keyof Input
    //       ? Input[k]
    //       : never;
    //   }
    // >(
    //   merging: Incoming
    // ): ZodObject<
    //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
    //   Incoming["_def"]["unknownKeys"],
    //   Incoming["_def"]["catchall"],
    //   NewOutput,
    //   NewInput
    // > {
    //   const merged: any = new ZodObject({
    //     unknownKeys: merging._def.unknownKeys,
    //     catchall: merging._def.catchall,
    //     shape: () =>
    //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
    //     typeName: ZodFirstPartyTypeKind.ZodObject,
    //   }) as any;
    //   return merged;
    // }
    setKey(key, schema) {
      return this.augment({ [key]: schema });
    }
    // merge<Incoming extends AnyZodObject>(
    //   merging: Incoming
    // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
    // ZodObject<
    //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
    //   Incoming["_def"]["unknownKeys"],
    //   Incoming["_def"]["catchall"]
    // > {
    //   // const mergedShape = objectUtil.mergeShapes(
    //   //   this._def.shape(),
    //   //   merging._def.shape()
    //   // );
    //   const merged: any = new ZodObject({
    //     unknownKeys: merging._def.unknownKeys,
    //     catchall: merging._def.catchall,
    //     shape: () =>
    //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
    //     typeName: ZodFirstPartyTypeKind.ZodObject,
    //   }) as any;
    //   return merged;
    // }
    catchall(index) {
      return new _ZodObject({
        ...this._def,
        catchall: index
      });
    }
    pick(mask) {
      const shape = {};
      for (const key of util.objectKeys(mask)) {
        if (mask[key] && this.shape[key]) {
          shape[key] = this.shape[key];
        }
      }
      return new _ZodObject({
        ...this._def,
        shape: () => shape
      });
    }
    omit(mask) {
      const shape = {};
      for (const key of util.objectKeys(this.shape)) {
        if (!mask[key]) {
          shape[key] = this.shape[key];
        }
      }
      return new _ZodObject({
        ...this._def,
        shape: () => shape
      });
    }
    /**
     * @deprecated
     */
    deepPartial() {
      return deepPartialify(this);
    }
    partial(mask) {
      const newShape = {};
      for (const key of util.objectKeys(this.shape)) {
        const fieldSchema = this.shape[key];
        if (mask && !mask[key]) {
          newShape[key] = fieldSchema;
        } else {
          newShape[key] = fieldSchema.optional();
        }
      }
      return new _ZodObject({
        ...this._def,
        shape: () => newShape
      });
    }
    required(mask) {
      const newShape = {};
      for (const key of util.objectKeys(this.shape)) {
        if (mask && !mask[key]) {
          newShape[key] = this.shape[key];
        } else {
          const fieldSchema = this.shape[key];
          let newField = fieldSchema;
          while (newField instanceof ZodOptional) {
            newField = newField._def.innerType;
          }
          newShape[key] = newField;
        }
      }
      return new _ZodObject({
        ...this._def,
        shape: () => newShape
      });
    }
    keyof() {
      return createZodEnum(util.objectKeys(this.shape));
    }
  };
  ZodObject.create = (shape, params) => {
    return new ZodObject({
      shape: () => shape,
      unknownKeys: "strip",
      catchall: ZodNever.create(),
      typeName: ZodFirstPartyTypeKind.ZodObject,
      ...processCreateParams(params)
    });
  };
  ZodObject.strictCreate = (shape, params) => {
    return new ZodObject({
      shape: () => shape,
      unknownKeys: "strict",
      catchall: ZodNever.create(),
      typeName: ZodFirstPartyTypeKind.ZodObject,
      ...processCreateParams(params)
    });
  };
  ZodObject.lazycreate = (shape, params) => {
    return new ZodObject({
      shape,
      unknownKeys: "strip",
      catchall: ZodNever.create(),
      typeName: ZodFirstPartyTypeKind.ZodObject,
      ...processCreateParams(params)
    });
  };
  var ZodUnion = class extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const options = this._def.options;
      function handleResults(results) {
        for (const result of results) {
          if (result.result.status === "valid") {
            return result.result;
          }
        }
        for (const result of results) {
          if (result.result.status === "dirty") {
            ctx.common.issues.push(...result.ctx.common.issues);
            return result.result;
          }
        }
        const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_union,
          unionErrors
        });
        return INVALID;
      }
      if (ctx.common.async) {
        return Promise.all(options.map(async (option) => {
          const childCtx = {
            ...ctx,
            common: {
              ...ctx.common,
              issues: []
            },
            parent: null
          };
          return {
            result: await option._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: childCtx
            }),
            ctx: childCtx
          };
        })).then(handleResults);
      } else {
        let dirty = void 0;
        const issues = [];
        for (const option of options) {
          const childCtx = {
            ...ctx,
            common: {
              ...ctx.common,
              issues: []
            },
            parent: null
          };
          const result = option._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          });
          if (result.status === "valid") {
            return result;
          } else if (result.status === "dirty" && !dirty) {
            dirty = { result, ctx: childCtx };
          }
          if (childCtx.common.issues.length) {
            issues.push(childCtx.common.issues);
          }
        }
        if (dirty) {
          ctx.common.issues.push(...dirty.ctx.common.issues);
          return dirty.result;
        }
        const unionErrors = issues.map((issues2) => new ZodError(issues2));
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_union,
          unionErrors
        });
        return INVALID;
      }
    }
    get options() {
      return this._def.options;
    }
  };
  ZodUnion.create = (types, params) => {
    return new ZodUnion({
      options: types,
      typeName: ZodFirstPartyTypeKind.ZodUnion,
      ...processCreateParams(params)
    });
  };
  var getDiscriminator = (type) => {
    if (type instanceof ZodLazy) {
      return getDiscriminator(type.schema);
    } else if (type instanceof ZodEffects) {
      return getDiscriminator(type.innerType());
    } else if (type instanceof ZodLiteral) {
      return [type.value];
    } else if (type instanceof ZodEnum) {
      return type.options;
    } else if (type instanceof ZodNativeEnum) {
      return util.objectValues(type.enum);
    } else if (type instanceof ZodDefault) {
      return getDiscriminator(type._def.innerType);
    } else if (type instanceof ZodUndefined) {
      return [void 0];
    } else if (type instanceof ZodNull) {
      return [null];
    } else if (type instanceof ZodOptional) {
      return [void 0, ...getDiscriminator(type.unwrap())];
    } else if (type instanceof ZodNullable) {
      return [null, ...getDiscriminator(type.unwrap())];
    } else if (type instanceof ZodBranded) {
      return getDiscriminator(type.unwrap());
    } else if (type instanceof ZodReadonly) {
      return getDiscriminator(type.unwrap());
    } else if (type instanceof ZodCatch) {
      return getDiscriminator(type._def.innerType);
    } else {
      return [];
    }
  };
  var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.object) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.object,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const discriminator = this.discriminator;
      const discriminatorValue = ctx.data[discriminator];
      const option = this.optionsMap.get(discriminatorValue);
      if (!option) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_union_discriminator,
          options: Array.from(this.optionsMap.keys()),
          path: [discriminator]
        });
        return INVALID;
      }
      if (ctx.common.async) {
        return option._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
      } else {
        return option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
      }
    }
    get discriminator() {
      return this._def.discriminator;
    }
    get options() {
      return this._def.options;
    }
    get optionsMap() {
      return this._def.optionsMap;
    }
    /**
     * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
     * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
     * have a different value for each object in the union.
     * @param discriminator the name of the discriminator property
     * @param types an array of object schemas
     * @param params
     */
    static create(discriminator, options, params) {
      const optionsMap = /* @__PURE__ */ new Map();
      for (const type of options) {
        const discriminatorValues = getDiscriminator(type.shape[discriminator]);
        if (!discriminatorValues.length) {
          throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
        }
        for (const value of discriminatorValues) {
          if (optionsMap.has(value)) {
            throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
          }
          optionsMap.set(value, type);
        }
      }
      return new _ZodDiscriminatedUnion({
        typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
        discriminator,
        options,
        optionsMap,
        ...processCreateParams(params)
      });
    }
  };
  function mergeValues(a, b) {
    const aType = getParsedType(a);
    const bType = getParsedType(b);
    if (a === b) {
      return { valid: true, data: a };
    } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
      const bKeys = util.objectKeys(b);
      const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
      const newObj = { ...a, ...b };
      for (const key of sharedKeys) {
        const sharedValue = mergeValues(a[key], b[key]);
        if (!sharedValue.valid) {
          return { valid: false };
        }
        newObj[key] = sharedValue.data;
      }
      return { valid: true, data: newObj };
    } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
      if (a.length !== b.length) {
        return { valid: false };
      }
      const newArray = [];
      for (let index = 0; index < a.length; index++) {
        const itemA = a[index];
        const itemB = b[index];
        const sharedValue = mergeValues(itemA, itemB);
        if (!sharedValue.valid) {
          return { valid: false };
        }
        newArray.push(sharedValue.data);
      }
      return { valid: true, data: newArray };
    } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
      return { valid: true, data: a };
    } else {
      return { valid: false };
    }
  }
  var ZodIntersection = class extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      const handleParsed = (parsedLeft, parsedRight) => {
        if (isAborted(parsedLeft) || isAborted(parsedRight)) {
          return INVALID;
        }
        const merged = mergeValues(parsedLeft.value, parsedRight.value);
        if (!merged.valid) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_intersection_types
          });
          return INVALID;
        }
        if (isDirty(parsedLeft) || isDirty(parsedRight)) {
          status.dirty();
        }
        return { status: status.value, value: merged.data };
      };
      if (ctx.common.async) {
        return Promise.all([
          this._def.left._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }),
          this._def.right._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          })
        ]).then(([left, right]) => handleParsed(left, right));
      } else {
        return handleParsed(this._def.left._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }), this._def.right._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }));
      }
    }
  };
  ZodIntersection.create = (left, right, params) => {
    return new ZodIntersection({
      left,
      right,
      typeName: ZodFirstPartyTypeKind.ZodIntersection,
      ...processCreateParams(params)
    });
  };
  var ZodTuple = class _ZodTuple extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.array) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.array,
          received: ctx.parsedType
        });
        return INVALID;
      }
      if (ctx.data.length < this._def.items.length) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: this._def.items.length,
          inclusive: true,
          exact: false,
          type: "array"
        });
        return INVALID;
      }
      const rest = this._def.rest;
      if (!rest && ctx.data.length > this._def.items.length) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: this._def.items.length,
          inclusive: true,
          exact: false,
          type: "array"
        });
        status.dirty();
      }
      const items = [...ctx.data].map((item, itemIndex) => {
        const schema = this._def.items[itemIndex] || this._def.rest;
        if (!schema)
          return null;
        return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
      }).filter((x) => !!x);
      if (ctx.common.async) {
        return Promise.all(items).then((results) => {
          return ParseStatus.mergeArray(status, results);
        });
      } else {
        return ParseStatus.mergeArray(status, items);
      }
    }
    get items() {
      return this._def.items;
    }
    rest(rest) {
      return new _ZodTuple({
        ...this._def,
        rest
      });
    }
  };
  ZodTuple.create = (schemas, params) => {
    if (!Array.isArray(schemas)) {
      throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
    }
    return new ZodTuple({
      items: schemas,
      typeName: ZodFirstPartyTypeKind.ZodTuple,
      rest: null,
      ...processCreateParams(params)
    });
  };
  var ZodRecord = class _ZodRecord extends ZodType {
    get keySchema() {
      return this._def.keyType;
    }
    get valueSchema() {
      return this._def.valueType;
    }
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.object) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.object,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const pairs = [];
      const keyType = this._def.keyType;
      const valueType = this._def.valueType;
      for (const key in ctx.data) {
        pairs.push({
          key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
          value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
      if (ctx.common.async) {
        return ParseStatus.mergeObjectAsync(status, pairs);
      } else {
        return ParseStatus.mergeObjectSync(status, pairs);
      }
    }
    get element() {
      return this._def.valueType;
    }
    static create(first, second, third) {
      if (second instanceof ZodType) {
        return new _ZodRecord({
          keyType: first,
          valueType: second,
          typeName: ZodFirstPartyTypeKind.ZodRecord,
          ...processCreateParams(third)
        });
      }
      return new _ZodRecord({
        keyType: ZodString.create(),
        valueType: first,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(second)
      });
    }
  };
  var ZodMap = class extends ZodType {
    get keySchema() {
      return this._def.keyType;
    }
    get valueSchema() {
      return this._def.valueType;
    }
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.map) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.map,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const keyType = this._def.keyType;
      const valueType = this._def.valueType;
      const pairs = [...ctx.data.entries()].map(([key, value], index) => {
        return {
          key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
          value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
        };
      });
      if (ctx.common.async) {
        const finalMap = /* @__PURE__ */ new Map();
        return Promise.resolve().then(async () => {
          for (const pair of pairs) {
            const key = await pair.key;
            const value = await pair.value;
            if (key.status === "aborted" || value.status === "aborted") {
              return INVALID;
            }
            if (key.status === "dirty" || value.status === "dirty") {
              status.dirty();
            }
            finalMap.set(key.value, value.value);
          }
          return { status: status.value, value: finalMap };
        });
      } else {
        const finalMap = /* @__PURE__ */ new Map();
        for (const pair of pairs) {
          const key = pair.key;
          const value = pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      }
    }
  };
  ZodMap.create = (keyType, valueType, params) => {
    return new ZodMap({
      valueType,
      keyType,
      typeName: ZodFirstPartyTypeKind.ZodMap,
      ...processCreateParams(params)
    });
  };
  var ZodSet = class _ZodSet extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.set) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.set,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const def = this._def;
      if (def.minSize !== null) {
        if (ctx.data.size < def.minSize.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: def.minSize.value,
            type: "set",
            inclusive: true,
            exact: false,
            message: def.minSize.message
          });
          status.dirty();
        }
      }
      if (def.maxSize !== null) {
        if (ctx.data.size > def.maxSize.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: def.maxSize.value,
            type: "set",
            inclusive: true,
            exact: false,
            message: def.maxSize.message
          });
          status.dirty();
        }
      }
      const valueType = this._def.valueType;
      function finalizeSet(elements2) {
        const parsedSet = /* @__PURE__ */ new Set();
        for (const element of elements2) {
          if (element.status === "aborted")
            return INVALID;
          if (element.status === "dirty")
            status.dirty();
          parsedSet.add(element.value);
        }
        return { status: status.value, value: parsedSet };
      }
      const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
      if (ctx.common.async) {
        return Promise.all(elements).then((elements2) => finalizeSet(elements2));
      } else {
        return finalizeSet(elements);
      }
    }
    min(minSize, message) {
      return new _ZodSet({
        ...this._def,
        minSize: { value: minSize, message: errorUtil.toString(message) }
      });
    }
    max(maxSize, message) {
      return new _ZodSet({
        ...this._def,
        maxSize: { value: maxSize, message: errorUtil.toString(message) }
      });
    }
    size(size, message) {
      return this.min(size, message).max(size, message);
    }
    nonempty(message) {
      return this.min(1, message);
    }
  };
  ZodSet.create = (valueType, params) => {
    return new ZodSet({
      valueType,
      minSize: null,
      maxSize: null,
      typeName: ZodFirstPartyTypeKind.ZodSet,
      ...processCreateParams(params)
    });
  };
  var ZodFunction = class _ZodFunction extends ZodType {
    constructor() {
      super(...arguments);
      this.validate = this.implement;
    }
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.function) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.function,
          received: ctx.parsedType
        });
        return INVALID;
      }
      function makeArgsIssue(args, error) {
        return makeIssue({
          data: args,
          path: ctx.path,
          errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
          issueData: {
            code: ZodIssueCode.invalid_arguments,
            argumentsError: error
          }
        });
      }
      function makeReturnsIssue(returns, error) {
        return makeIssue({
          data: returns,
          path: ctx.path,
          errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
          issueData: {
            code: ZodIssueCode.invalid_return_type,
            returnTypeError: error
          }
        });
      }
      const params = { errorMap: ctx.common.contextualErrorMap };
      const fn = ctx.data;
      if (this._def.returns instanceof ZodPromise) {
        const me = this;
        return OK(async function(...args) {
          const error = new ZodError([]);
          const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
            error.addIssue(makeArgsIssue(args, e));
            throw error;
          });
          const result = await Reflect.apply(fn, this, parsedArgs);
          const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
            error.addIssue(makeReturnsIssue(result, e));
            throw error;
          });
          return parsedReturns;
        });
      } else {
        const me = this;
        return OK(function(...args) {
          const parsedArgs = me._def.args.safeParse(args, params);
          if (!parsedArgs.success) {
            throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
          }
          const result = Reflect.apply(fn, this, parsedArgs.data);
          const parsedReturns = me._def.returns.safeParse(result, params);
          if (!parsedReturns.success) {
            throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
          }
          return parsedReturns.data;
        });
      }
    }
    parameters() {
      return this._def.args;
    }
    returnType() {
      return this._def.returns;
    }
    args(...items) {
      return new _ZodFunction({
        ...this._def,
        args: ZodTuple.create(items).rest(ZodUnknown.create())
      });
    }
    returns(returnType) {
      return new _ZodFunction({
        ...this._def,
        returns: returnType
      });
    }
    implement(func) {
      const validatedFunc = this.parse(func);
      return validatedFunc;
    }
    strictImplement(func) {
      const validatedFunc = this.parse(func);
      return validatedFunc;
    }
    static create(args, returns, params) {
      return new _ZodFunction({
        args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
        returns: returns || ZodUnknown.create(),
        typeName: ZodFirstPartyTypeKind.ZodFunction,
        ...processCreateParams(params)
      });
    }
  };
  var ZodLazy = class extends ZodType {
    get schema() {
      return this._def.getter();
    }
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const lazySchema = this._def.getter();
      return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
    }
  };
  ZodLazy.create = (getter, params) => {
    return new ZodLazy({
      getter,
      typeName: ZodFirstPartyTypeKind.ZodLazy,
      ...processCreateParams(params)
    });
  };
  var ZodLiteral = class extends ZodType {
    _parse(input) {
      if (input.data !== this._def.value) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          received: ctx.data,
          code: ZodIssueCode.invalid_literal,
          expected: this._def.value
        });
        return INVALID;
      }
      return { status: "valid", value: input.data };
    }
    get value() {
      return this._def.value;
    }
  };
  ZodLiteral.create = (value, params) => {
    return new ZodLiteral({
      value,
      typeName: ZodFirstPartyTypeKind.ZodLiteral,
      ...processCreateParams(params)
    });
  };
  function createZodEnum(values, params) {
    return new ZodEnum({
      values,
      typeName: ZodFirstPartyTypeKind.ZodEnum,
      ...processCreateParams(params)
    });
  }
  var ZodEnum = class _ZodEnum extends ZodType {
    _parse(input) {
      if (typeof input.data !== "string") {
        const ctx = this._getOrReturnCtx(input);
        const expectedValues = this._def.values;
        addIssueToContext(ctx, {
          expected: util.joinValues(expectedValues),
          received: ctx.parsedType,
          code: ZodIssueCode.invalid_type
        });
        return INVALID;
      }
      if (!this._cache) {
        this._cache = new Set(this._def.values);
      }
      if (!this._cache.has(input.data)) {
        const ctx = this._getOrReturnCtx(input);
        const expectedValues = this._def.values;
        addIssueToContext(ctx, {
          received: ctx.data,
          code: ZodIssueCode.invalid_enum_value,
          options: expectedValues
        });
        return INVALID;
      }
      return OK(input.data);
    }
    get options() {
      return this._def.values;
    }
    get enum() {
      const enumValues = {};
      for (const val of this._def.values) {
        enumValues[val] = val;
      }
      return enumValues;
    }
    get Values() {
      const enumValues = {};
      for (const val of this._def.values) {
        enumValues[val] = val;
      }
      return enumValues;
    }
    get Enum() {
      const enumValues = {};
      for (const val of this._def.values) {
        enumValues[val] = val;
      }
      return enumValues;
    }
    extract(values, newDef = this._def) {
      return _ZodEnum.create(values, {
        ...this._def,
        ...newDef
      });
    }
    exclude(values, newDef = this._def) {
      return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
        ...this._def,
        ...newDef
      });
    }
  };
  ZodEnum.create = createZodEnum;
  var ZodNativeEnum = class extends ZodType {
    _parse(input) {
      const nativeEnumValues = util.getValidEnumValues(this._def.values);
      const ctx = this._getOrReturnCtx(input);
      if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
        const expectedValues = util.objectValues(nativeEnumValues);
        addIssueToContext(ctx, {
          expected: util.joinValues(expectedValues),
          received: ctx.parsedType,
          code: ZodIssueCode.invalid_type
        });
        return INVALID;
      }
      if (!this._cache) {
        this._cache = new Set(util.getValidEnumValues(this._def.values));
      }
      if (!this._cache.has(input.data)) {
        const expectedValues = util.objectValues(nativeEnumValues);
        addIssueToContext(ctx, {
          received: ctx.data,
          code: ZodIssueCode.invalid_enum_value,
          options: expectedValues
        });
        return INVALID;
      }
      return OK(input.data);
    }
    get enum() {
      return this._def.values;
    }
  };
  ZodNativeEnum.create = (values, params) => {
    return new ZodNativeEnum({
      values,
      typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
      ...processCreateParams(params)
    });
  };
  var ZodPromise = class extends ZodType {
    unwrap() {
      return this._def.type;
    }
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.promise,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
      return OK(promisified.then((data) => {
        return this._def.type.parseAsync(data, {
          path: ctx.path,
          errorMap: ctx.common.contextualErrorMap
        });
      }));
    }
  };
  ZodPromise.create = (schema, params) => {
    return new ZodPromise({
      type: schema,
      typeName: ZodFirstPartyTypeKind.ZodPromise,
      ...processCreateParams(params)
    });
  };
  var ZodEffects = class extends ZodType {
    innerType() {
      return this._def.schema;
    }
    sourceType() {
      return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
    }
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      const effect = this._def.effect || null;
      const checkCtx = {
        addIssue: (arg) => {
          addIssueToContext(ctx, arg);
          if (arg.fatal) {
            status.abort();
          } else {
            status.dirty();
          }
        },
        get path() {
          return ctx.path;
        }
      };
      checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
      if (effect.type === "preprocess") {
        const processed = effect.transform(ctx.data, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(processed).then(async (processed2) => {
            if (status.value === "aborted")
              return INVALID;
            const result = await this._def.schema._parseAsync({
              data: processed2,
              path: ctx.path,
              parent: ctx
            });
            if (result.status === "aborted")
              return INVALID;
            if (result.status === "dirty")
              return DIRTY(result.value);
            if (status.value === "dirty")
              return DIRTY(result.value);
            return result;
          });
        } else {
          if (status.value === "aborted")
            return INVALID;
          const result = this._def.schema._parseSync({
            data: processed,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        }
      }
      if (effect.type === "refinement") {
        const executeRefinement = (acc) => {
          const result = effect.refinement(acc, checkCtx);
          if (ctx.common.async) {
            return Promise.resolve(result);
          }
          if (result instanceof Promise) {
            throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
          }
          return acc;
        };
        if (ctx.common.async === false) {
          const inner = this._def.schema._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          executeRefinement(inner.value);
          return { status: status.value, value: inner.value };
        } else {
          return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
            if (inner.status === "aborted")
              return INVALID;
            if (inner.status === "dirty")
              status.dirty();
            return executeRefinement(inner.value).then(() => {
              return { status: status.value, value: inner.value };
            });
          });
        }
      }
      if (effect.type === "transform") {
        if (ctx.common.async === false) {
          const base = this._def.schema._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (!isValid(base))
            return INVALID;
          const result = effect.transform(base.value, checkCtx);
          if (result instanceof Promise) {
            throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
          }
          return { status: status.value, value: result };
        } else {
          return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
            if (!isValid(base))
              return INVALID;
            return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
              status: status.value,
              value: result
            }));
          });
        }
      }
      util.assertNever(effect);
    }
  };
  ZodEffects.create = (schema, effect, params) => {
    return new ZodEffects({
      schema,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect,
      ...processCreateParams(params)
    });
  };
  ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
    return new ZodEffects({
      schema,
      effect: { type: "preprocess", transform: preprocess },
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      ...processCreateParams(params)
    });
  };
  var ZodOptional = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType === ZodParsedType.undefined) {
        return OK(void 0);
      }
      return this._def.innerType._parse(input);
    }
    unwrap() {
      return this._def.innerType;
    }
  };
  ZodOptional.create = (type, params) => {
    return new ZodOptional({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodOptional,
      ...processCreateParams(params)
    });
  };
  var ZodNullable = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType === ZodParsedType.null) {
        return OK(null);
      }
      return this._def.innerType._parse(input);
    }
    unwrap() {
      return this._def.innerType;
    }
  };
  ZodNullable.create = (type, params) => {
    return new ZodNullable({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodNullable,
      ...processCreateParams(params)
    });
  };
  var ZodDefault = class extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      let data = ctx.data;
      if (ctx.parsedType === ZodParsedType.undefined) {
        data = this._def.defaultValue();
      }
      return this._def.innerType._parse({
        data,
        path: ctx.path,
        parent: ctx
      });
    }
    removeDefault() {
      return this._def.innerType;
    }
  };
  ZodDefault.create = (type, params) => {
    return new ZodDefault({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodDefault,
      defaultValue: typeof params.default === "function" ? params.default : () => params.default,
      ...processCreateParams(params)
    });
  };
  var ZodCatch = class extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const newCtx = {
        ...ctx,
        common: {
          ...ctx.common,
          issues: []
        }
      };
      const result = this._def.innerType._parse({
        data: newCtx.data,
        path: newCtx.path,
        parent: {
          ...newCtx
        }
      });
      if (isAsync(result)) {
        return result.then((result2) => {
          return {
            status: "valid",
            value: result2.status === "valid" ? result2.value : this._def.catchValue({
              get error() {
                return new ZodError(newCtx.common.issues);
              },
              input: newCtx.data
            })
          };
        });
      } else {
        return {
          status: "valid",
          value: result.status === "valid" ? result.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      }
    }
    removeCatch() {
      return this._def.innerType;
    }
  };
  ZodCatch.create = (type, params) => {
    return new ZodCatch({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodCatch,
      catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
      ...processCreateParams(params)
    });
  };
  var ZodNaN = class extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.nan) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.nan,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return { status: "valid", value: input.data };
    }
  };
  ZodNaN.create = (params) => {
    return new ZodNaN({
      typeName: ZodFirstPartyTypeKind.ZodNaN,
      ...processCreateParams(params)
    });
  };
  var BRAND = /* @__PURE__ */ Symbol("zod_brand");
  var ZodBranded = class extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const data = ctx.data;
      return this._def.type._parse({
        data,
        path: ctx.path,
        parent: ctx
      });
    }
    unwrap() {
      return this._def.type;
    }
  };
  var ZodPipeline = class _ZodPipeline extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.common.async) {
        const handleAsync = async () => {
          const inResult = await this._def.in._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inResult.status === "aborted")
            return INVALID;
          if (inResult.status === "dirty") {
            status.dirty();
            return DIRTY(inResult.value);
          } else {
            return this._def.out._parseAsync({
              data: inResult.value,
              path: ctx.path,
              parent: ctx
            });
          }
        };
        return handleAsync();
      } else {
        const inResult = this._def.in._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return {
            status: "dirty",
            value: inResult.value
          };
        } else {
          return this._def.out._parseSync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      }
    }
    static create(a, b) {
      return new _ZodPipeline({
        in: a,
        out: b,
        typeName: ZodFirstPartyTypeKind.ZodPipeline
      });
    }
  };
  var ZodReadonly = class extends ZodType {
    _parse(input) {
      const result = this._def.innerType._parse(input);
      const freeze = (data) => {
        if (isValid(data)) {
          data.value = Object.freeze(data.value);
        }
        return data;
      };
      return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
    }
    unwrap() {
      return this._def.innerType;
    }
  };
  ZodReadonly.create = (type, params) => {
    return new ZodReadonly({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodReadonly,
      ...processCreateParams(params)
    });
  };
  function cleanParams(params, data) {
    const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
    const p2 = typeof p === "string" ? { message: p } : p;
    return p2;
  }
  function custom(check, _params = {}, fatal) {
    if (check)
      return ZodAny.create().superRefine((data, ctx) => {
        const r = check(data);
        if (r instanceof Promise) {
          return r.then((r2) => {
            if (!r2) {
              const params = cleanParams(_params, data);
              const _fatal = params.fatal ?? fatal ?? true;
              ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
            }
          });
        }
        if (!r) {
          const params = cleanParams(_params, data);
          const _fatal = params.fatal ?? fatal ?? true;
          ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
        }
        return;
      });
    return ZodAny.create();
  }
  var late = {
    object: ZodObject.lazycreate
  };
  var ZodFirstPartyTypeKind;
  (function(ZodFirstPartyTypeKind2) {
    ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
    ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
    ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
    ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
    ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
    ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
    ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
    ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
    ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
    ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
    ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
    ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
    ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
    ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
    ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
    ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
    ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
    ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
    ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
    ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
    ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
    ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
    ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
    ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
    ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
    ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
    ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
    ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
    ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
    ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
    ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
    ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
    ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
    ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
    ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
    ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
  })(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
  var instanceOfType = (cls, params = {
    message: `Input not instance of ${cls.name}`
  }) => custom((data) => data instanceof cls, params);
  var stringType = ZodString.create;
  var numberType = ZodNumber.create;
  var nanType = ZodNaN.create;
  var bigIntType = ZodBigInt.create;
  var booleanType = ZodBoolean.create;
  var dateType = ZodDate.create;
  var symbolType = ZodSymbol.create;
  var undefinedType = ZodUndefined.create;
  var nullType = ZodNull.create;
  var anyType = ZodAny.create;
  var unknownType = ZodUnknown.create;
  var neverType = ZodNever.create;
  var voidType = ZodVoid.create;
  var arrayType = ZodArray.create;
  var objectType = ZodObject.create;
  var strictObjectType = ZodObject.strictCreate;
  var unionType = ZodUnion.create;
  var discriminatedUnionType = ZodDiscriminatedUnion.create;
  var intersectionType = ZodIntersection.create;
  var tupleType = ZodTuple.create;
  var recordType = ZodRecord.create;
  var mapType = ZodMap.create;
  var setType = ZodSet.create;
  var functionType = ZodFunction.create;
  var lazyType = ZodLazy.create;
  var literalType = ZodLiteral.create;
  var enumType = ZodEnum.create;
  var nativeEnumType = ZodNativeEnum.create;
  var promiseType = ZodPromise.create;
  var effectsType = ZodEffects.create;
  var optionalType = ZodOptional.create;
  var nullableType = ZodNullable.create;
  var preprocessType = ZodEffects.createWithPreprocess;
  var pipelineType = ZodPipeline.create;
  var ostring = () => stringType().optional();
  var onumber = () => numberType().optional();
  var oboolean = () => booleanType().optional();
  var coerce = {
    string: ((arg) => ZodString.create({ ...arg, coerce: true })),
    number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
    boolean: ((arg) => ZodBoolean.create({
      ...arg,
      coerce: true
    })),
    bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
    date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
  };
  var NEVER = INVALID;

  // ../../packages/brotto-action-schema/dist/index.mjs
  var SessionIdSchema = external_exports.string().uuid().brand();
  var RunIdSchema = external_exports.string().uuid().brand();
  var TaskIdSchema = external_exports.string().uuid().brand();
  var StepIdSchema = external_exports.string().uuid().brand();
  var ObservationIdSchema = external_exports.string().uuid().brand();
  var ActionIdSchema = external_exports.string().uuid().brand();
  var PolicyDecisionIdSchema = external_exports.string().uuid().brand();
  var EventIdSchema = external_exports.string().uuid().brand();
  var MessageIdSchema = external_exports.string().uuid().brand();
  var ArtifactIdSchema = external_exports.string().uuid().brand();
  var SemanticTargetIdSchema = external_exports.string().uuid().brand();
  var TabIdSchema = external_exports.string().uuid().brand();
  var FrameIdSchema = external_exports.string().uuid().brand();
  var FramePathSegmentIdSchema = external_exports.string().uuid().brand();
  var ShadowPathSegmentIdSchema = external_exports.string().uuid().brand();
  var ApprovalIdSchema = external_exports.string().uuid().brand();
  var SequenceSchema = external_exports.number().int().nonnegative();
  var IdempotencyKeySchema = external_exports.string().min(1).max(256);
  var FORBIDDEN_BROWSER_DATA_KEYS = /* @__PURE__ */ new Set([
    "cookie",
    "cookies",
    "authorization",
    "proxy-authorization",
    "localstorage",
    "sessionstorage",
    "password",
    "credentials",
    "profile"
  ]);
  var normalizedForbiddenKeys = new Set(
    [...FORBIDDEN_BROWSER_DATA_KEYS].map(normalizeBrowserDataKey)
  );
  var ForbiddenBrowserDataError = class extends Error {
    constructor(keyPath) {
      super(`Forbidden browser data key at ${keyPath}`);
      this.keyPath = keyPath;
      this.name = "ForbiddenBrowserDataError";
    }
  };
  function normalizeBrowserDataKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function isForbiddenBrowserDataKey(key) {
    const normalized = normalizeBrowserDataKey(key);
    return [...normalizedForbiddenKeys].some((forbidden) => normalized.includes(forbidden));
  }
  function isHttpUrl(url) {
    try {
      return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }
  function isObservationUrl(url) {
    if (url === "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("devtools://")) {
      return true;
    }
    return isHttpUrl(url);
  }
  function assertNoForbiddenBrowserData(value) {
    const visited = /* @__PURE__ */ new Set();
    const visit = (current, path) => {
      if (current === null || typeof current !== "object") return;
      if (visited.has(current)) return;
      visited.add(current);
      if (Array.isArray(current)) {
        current.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      for (const [key, nestedValue] of Object.entries(current)) {
        const keyPath = `${path}.${key}`;
        if (isForbiddenBrowserDataKey(key)) {
          throw new ForbiddenBrowserDataError(keyPath);
        }
        visit(nestedValue, keyPath);
      }
    };
    visit(value, "$");
  }
  function withForbiddenBrowserDataGuard(schema) {
    return schema.superRefine((value, context) => {
      try {
        assertNoForbiddenBrowserData(value);
      } catch (error) {
        if (error instanceof ForbiddenBrowserDataError) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            message: error.message,
            path: error.keyPath.slice(2).split(".").filter(Boolean)
          });
          return;
        }
        throw error;
      }
    });
  }
  var Sha256Schema = external_exports.string().regex(/^[a-f0-9]{64}$/i);
  var sensitiveSemanticContent = /\b(?:authorization|cookie|credentials?|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token)\b/i;
  function isSafeSemanticContent(value) {
    return !sensitiveSemanticContent.test(value);
  }
  var SafeSemanticTextSchema = external_exports.string().min(1).max(512).refine(
    isSafeSemanticContent,
    "Semantic content may not include sensitive browser data"
  );
  var SafeSemanticAttributesSchema = external_exports.object({
    "aria-label": SafeSemanticTextSchema.optional(),
    "aria-describedby": SafeSemanticTextSchema.optional(),
    "aria-controls": SafeSemanticTextSchema.optional(),
    "aria-expanded": external_exports.enum(["true", "false"]).optional(),
    "aria-haspopup": external_exports.enum(["true", "false", "menu", "listbox", "tree", "grid", "dialog"]).optional(),
    "aria-current": external_exports.enum(["true", "false", "page", "step", "location", "date", "time"]).optional(),
    "aria-pressed": external_exports.enum(["true", "false", "mixed"]).optional(),
    "aria-selected": external_exports.enum(["true", "false"]).optional()
  }).strict();
  var SanitizedAccessibleNameSchema = external_exports.object({
    source: external_exports.enum(["aria-label", "aria-labelledby", "visible_text"]),
    text: SafeSemanticTextSchema
  }).strict();
  var LocatorCandidateV1Schema = external_exports.discriminatedUnion("kind", [
    external_exports.object({
      kind: external_exports.literal("role_name"),
      role: SafeSemanticTextSchema,
      name: SanitizedAccessibleNameSchema
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("label"),
      label: SanitizedAccessibleNameSchema
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("test_id"),
      testId: SafeSemanticTextSchema
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("safe_attribute"),
      attribute: external_exports.enum(["aria-label", "aria-describedby", "aria-controls", "aria-current"]),
      value: SafeSemanticTextSchema
    }).strict()
  ]);
  var ControlMetadataSchema = external_exports.discriminatedUnion("kind", [
    external_exports.object({ kind: external_exports.literal("non_input") }).strict(),
    external_exports.object({
      kind: external_exports.literal("input"),
      inputType: external_exports.enum(["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"])
    }).strict()
  ]);
  var ScreenshotSchema = withForbiddenBrowserDataGuard(external_exports.discriminatedUnion("kind", [
    external_exports.object({
      kind: external_exports.literal("inline"),
      encoding: external_exports.enum(["base64", "png", "jpeg", "webp"]),
      // ponytail: data may be empty when the extension captured a chrome://
      // page or other restricted URL that captureVisibleTab refuses to render.
      // width/height default to zero so downstream consumers can detect
      // "no screenshot available" and render a placeholder.
      data: external_exports.string().max(1e7),
      sha256: Sha256Schema,
      width: external_exports.number().int().nonnegative(),
      height: external_exports.number().int().nonnegative()
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("artifact"),
      artifactId: ArtifactIdSchema,
      sha256: Sha256Schema,
      width: external_exports.number().int().positive(),
      height: external_exports.number().int().positive(),
      encoding: external_exports.enum(["png", "jpeg", "webp"])
    }).strict()
  ]));
  var ViewportSchema = external_exports.object({
    width: external_exports.number().int().positive(),
    height: external_exports.number().int().positive(),
    devicePixelRatio: external_exports.number().positive().max(8),
    zoom: external_exports.number().positive().max(8),
    scrollX: external_exports.number().finite(),
    scrollY: external_exports.number().finite()
  }).strict();
  var PageStateSchema = external_exports.object({
    tabId: TabIdSchema,
    frameId: FrameIdSchema,
    lifecycle: external_exports.enum(["loading", "interactive", "complete", "frozen"]),
    visibility: external_exports.enum(["visible", "hidden", "prerender"])
  }).strict();
  var BoundingBoxSchema = external_exports.object({
    x: external_exports.number().finite(),
    y: external_exports.number().finite(),
    width: external_exports.number().positive(),
    height: external_exports.number().positive()
  }).strict();
  var SemanticTargetSchema = withForbiddenBrowserDataGuard(external_exports.object({
    targetId: SemanticTargetIdSchema,
    stableRef: external_exports.string().regex(/^[a-f0-9]{16}$/i).optional(),
    tag: external_exports.string().min(1).max(64),
    role: external_exports.string().min(1).max(128).optional(),
    accessibleName: SanitizedAccessibleNameSchema.optional(),
    attributes: SafeSemanticAttributesSchema.optional(),
    control: ControlMetadataSchema,
    boundingBox: BoundingBoxSchema,
    visible: external_exports.boolean(),
    framePath: external_exports.array(FramePathSegmentIdSchema).max(20),
    shadowPath: external_exports.array(ShadowPathSegmentIdSchema).max(20).optional(),
    locatorCandidates: external_exports.array(LocatorCandidateV1Schema).max(10)
  }).strict()).superRefine((target, context) => {
    if (target.tag.toLowerCase() === "input" && target.control.kind !== "input") {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["control"], message: "Input targets require input control metadata" });
    }
  });
  var AXTupleSchema = external_exports.object({
    role: external_exports.string(),
    index: external_exports.number().int().nonnegative(),
    name: external_exports.string().optional()
  });
  var AccessibilityNodeSchema = external_exports.object({
    axNodeId: external_exports.string(),
    role: external_exports.string(),
    name: external_exports.string().optional(),
    description: external_exports.string().optional(),
    value: external_exports.string().optional(),
    attributes: external_exports.record(external_exports.string(), external_exports.string()).optional(),
    bounds: BoundingBoxSchema.optional(),
    axPath: external_exports.array(AXTupleSchema),
    attributeHash: Sha256Schema
  });
  var ObservationV1Schema = withForbiddenBrowserDataGuard(external_exports.object({
    observationId: ObservationIdSchema,
    capturedAt: external_exports.string().datetime(),
    url: external_exports.string().refine(isObservationUrl, "Observation URL must be HTTP(S) or an internal page (about:blank, chrome://)"),
    title: external_exports.string().max(512),
    screenshot: ScreenshotSchema,
    viewport: ViewportSchema,
    page: PageStateSchema,
    semanticTargets: external_exports.array(SemanticTargetSchema).max(200),
    accessibilityNodes: external_exports.array(AccessibilityNodeSchema).optional(),
    // ponytail: structured page text (HEADINGS / STATS / LABELS / TEXT blocks).
    // Optional so older payloads still validate. Replaces the lazy
    // accessibilityNodes.slice(0, 400) cap in the planner context builder.
    bodyText: external_exports.string().max(5e4).optional()
  }).strict());
  function guardedStrictObject(schema) {
    return schema.superRefine((value, context) => {
      try {
        assertNoForbiddenBrowserData(value);
      } catch (error) {
        if (error instanceof ForbiddenBrowserDataError) {
          context.addIssue({ code: external_exports.ZodIssueCode.custom, message: error.message });
          return;
        }
        throw error;
      }
    });
  }
  var CoordinateSchema = external_exports.number().int().nonnegative();
  var KeyModifiersSchema = external_exports.object({
    ctrl: external_exports.boolean().optional(),
    shift: external_exports.boolean().optional(),
    alt: external_exports.boolean().optional(),
    meta: external_exports.boolean().optional()
  }).strict();
  var ExecutableActionV1Schema = external_exports.discriminatedUnion("type", [
    external_exports.object({ type: external_exports.literal("left_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
    external_exports.object({ type: external_exports.literal("double_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
    external_exports.object({ type: external_exports.literal("right_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
    external_exports.object({ type: external_exports.literal("drag"), startX: CoordinateSchema, startY: CoordinateSchema, endX: CoordinateSchema, endY: CoordinateSchema }).strict(),
    external_exports.object({ type: external_exports.literal("mouse_move"), x: CoordinateSchema, y: CoordinateSchema }).strict(),
    external_exports.object({ type: external_exports.literal("scroll"), deltaX: external_exports.number().int(), deltaY: external_exports.number().int() }).strict(),
    external_exports.object({ type: external_exports.literal("key"), key: external_exports.string().min(1).max(128), modifiers: KeyModifiersSchema.optional() }).strict(),
    external_exports.object({ type: external_exports.literal("insert_text"), text: external_exports.string().min(1).max(1e4), targetId: SemanticTargetIdSchema.optional() }).strict(),
    external_exports.object({ type: external_exports.literal("visit_url"), url: external_exports.string().url().refine(isHttpUrl, "Only HTTP(S) navigation URLs are allowed") }).strict(),
    external_exports.object({ type: external_exports.literal("history_back"), steps: external_exports.number().int().positive().max(20).default(1) }).strict(),
    external_exports.object({ type: external_exports.literal("wait"), durationMs: external_exports.number().int().positive().max(6e4) }).strict(),
    external_exports.object({ type: external_exports.literal("ask_user_question"), question: external_exports.string().min(1).max(2e3), choices: external_exports.array(external_exports.string().min(1).max(256)).max(20).optional() }).strict(),
    external_exports.object({ type: external_exports.literal("memorize_fact"), fact: external_exports.string().min(1).max(2e3), category: external_exports.string().min(1).max(128).optional() }).strict()
  ]);
  var ActionProposalV1Schema = guardedStrictObject(external_exports.object({
    kind: external_exports.literal("action"),
    observationId: ObservationIdSchema,
    proposedAt: external_exports.string().datetime(),
    action: ExecutableActionV1Schema
  }).strict());
  var CompletionFindingV1Schema = external_exports.object({
    fact: external_exports.string().min(1).max(2e3),
    observationIds: external_exports.array(ObservationIdSchema).min(1).max(20)
  }).strict();
  var CompletionProposalV1Schema = guardedStrictObject(external_exports.object({
    kind: external_exports.literal("completion"),
    observationId: ObservationIdSchema,
    type: external_exports.literal("terminate"),
    status: external_exports.enum(["succeeded", "partial", "failed"]),
    summary: external_exports.string().min(1).max(4e3),
    findings: external_exports.array(CompletionFindingV1Schema).max(100),
    unmetCriteria: external_exports.array(external_exports.string().min(1).max(1e3)).max(100),
    confidence: external_exports.number().min(0).max(1)
  }).strict()).superRefine((value, context) => {
    if (value.status === "succeeded" && value.findings.length === 0) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["findings"],
        message: "Successful completion requires findings with observation evidence"
      });
    }
  });
  var AgentProposalV1Schema = external_exports.union([
    ActionProposalV1Schema,
    CompletionProposalV1Schema
  ]);
  var PolicyContextV1Schema = external_exports.object({
    policyDecisionId: PolicyDecisionIdSchema,
    policyVersion: external_exports.string().min(1).max(128),
    approved: external_exports.boolean(),
    approvalId: ApprovalIdSchema.optional()
  }).strict();
  var PolicyDecisionV1Schema = guardedStrictObject(external_exports.object({
    policyDecisionId: PolicyDecisionIdSchema,
    actionId: ActionIdSchema,
    observationId: ObservationIdSchema,
    decision: external_exports.enum(["allowed", "denied", "approval_required"]),
    decidedAt: external_exports.string().datetime()
  }).strict());
  var ApprovalResolutionV1Schema = guardedStrictObject(external_exports.object({
    approvalId: ApprovalIdSchema,
    policyDecisionId: PolicyDecisionIdSchema,
    actionId: ActionIdSchema,
    status: external_exports.enum(["approved", "denied"]),
    resolvedAt: external_exports.string().datetime()
  }).strict());
  var ActionCommandV1Schema2 = guardedStrictObject(external_exports.object({
    actionId: ActionIdSchema,
    stepId: StepIdSchema,
    observationId: ObservationIdSchema,
    sequence: SequenceSchema,
    action: ExecutableActionV1Schema,
    policyContext: PolicyContextV1Schema,
    dispatchedAt: external_exports.string().datetime(),
    expiresAt: external_exports.string().datetime(),
    idempotencyKey: IdempotencyKeySchema
  }).strict());
  var ActionResultStatusV1Schema = external_exports.enum([
    "succeeded",
    "failed_recoverable",
    "failed_terminal",
    "rejected_stale",
    "rejected_policy",
    "approval_required",
    "cancelled"
  ]);
  var ActionErrorV1Schema = external_exports.object({
    code: external_exports.string().min(1).max(128),
    message: external_exports.string().min(1).max(2e3),
    retryable: external_exports.boolean()
  }).strict();
  var NavigationEffectV1Schema = external_exports.object({
    url: external_exports.string().url().refine(isHttpUrl, "Only HTTP(S) URLs are allowed"),
    title: external_exports.string().max(512).optional()
  }).strict();
  var DialogEffectV1Schema = external_exports.object({
    kind: external_exports.enum(["alert", "confirm", "prompt", "beforeunload"]),
    present: external_exports.boolean()
  }).strict();
  var ActionResultBaseV1Schema = external_exports.object({
    actionId: ActionIdSchema,
    stepId: StepIdSchema,
    observationId: ObservationIdSchema,
    sequence: SequenceSchema,
    startedAt: external_exports.string().datetime(),
    completedAt: external_exports.string().datetime(),
    durationMs: external_exports.number().int().nonnegative(),
    target: SemanticTargetSchema.optional(),
    navigation: NavigationEffectV1Schema.optional(),
    dialog: DialogEffectV1Schema.optional()
  });
  var SucceededActionResultV1Schema = ActionResultBaseV1Schema.extend({
    status: external_exports.literal("succeeded"),
    postObservation: ObservationV1Schema
  }).strict();
  var FailedActionResultV1Schema = ActionResultBaseV1Schema.extend({
    status: external_exports.enum(["failed_recoverable", "failed_terminal"]),
    error: ActionErrorV1Schema,
    postObservation: ObservationV1Schema
  }).strict();
  var RejectedActionResultV1Schema = ActionResultBaseV1Schema.extend({
    status: external_exports.enum(["rejected_stale", "rejected_policy", "approval_required"]),
    rejection: ActionErrorV1Schema
  }).strict();
  var CancelledActionResultV1Schema = ActionResultBaseV1Schema.extend({
    status: external_exports.literal("cancelled"),
    cancellation: external_exports.object({ reason: external_exports.string().min(1).max(2e3).optional() }).strict(),
    postObservation: ObservationV1Schema
  }).strict();
  var ActionResultV1Schema = external_exports.union([
    SucceededActionResultV1Schema,
    FailedActionResultV1Schema,
    RejectedActionResultV1Schema,
    CancelledActionResultV1Schema
  ]).superRefine((value, context) => {
    try {
      assertNoForbiddenBrowserData(value);
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });
  var TrajectoryEventKindV1Schema = external_exports.enum([
    "session_lifecycle",
    "observation_captured",
    "model_request",
    "model_response",
    "model_parse_failure",
    "action_proposed",
    "policy_decided",
    "approval_requested",
    "approval_resolved",
    "action_dispatched",
    "action_acknowledged",
    "action_completed",
    "verification_result",
    "task_terminal_outcome"
  ]);
  var TrajectoryEventV1Schema = external_exports.object({
    eventId: EventIdSchema,
    sessionId: SessionIdSchema,
    taskId: TaskIdSchema,
    stepId: StepIdSchema.optional(),
    actionId: ActionIdSchema.optional(),
    observationId: ObservationIdSchema.optional(),
    correlationId: external_exports.string().uuid().optional(),
    causationId: EventIdSchema.optional(),
    sequence: SequenceSchema,
    occurredAt: external_exports.string().datetime(),
    kind: TrajectoryEventKindV1Schema,
    summary: external_exports.string().max(2e3).optional()
  }).strict().superRefine((value, context) => {
    try {
      assertNoForbiddenBrowserData(value);
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });
  var TrajectoryLinkageV1Schema = external_exports.object({
    sourceObservation: ObservationV1Schema,
    proposal: ActionProposalV1Schema,
    command: ActionCommandV1Schema2,
    policyDecision: PolicyDecisionV1Schema,
    approvalResolution: ApprovalResolutionV1Schema.optional(),
    result: ActionResultV1Schema
  }).strict().superRefine((value, context) => {
    const { approvalResolution, command, policyDecision, proposal, result, sourceObservation } = value;
    if (sourceObservation.observationId !== proposal.observationId || proposal.observationId !== command.observationId) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["command", "observationId"], message: "Command must reference the proposal observation" });
    }
    if (JSON.stringify(proposal.action) !== JSON.stringify(command.action)) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["command", "action"], message: "Command action must match the proposal action" });
    }
    if (policyDecision.policyDecisionId !== command.policyContext.policyDecisionId) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["policyDecision", "policyDecisionId"], message: "Policy decision must match the command policy context" });
    }
    if (policyDecision.actionId !== command.actionId || policyDecision.observationId !== command.observationId) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["policyDecision"], message: "Policy decision must reference the command action and observation" });
    }
    const hasApprovalProof = command.policyContext.approved && command.policyContext.approvalId !== void 0;
    if (policyDecision.decision === "allowed" && ["rejected_policy", "approval_required"].includes(result.status)) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "status"], message: "Allowed policy decisions cannot produce policy rejection or approval-required results" });
    }
    if (policyDecision.decision === "denied" && result.status !== "rejected_policy") {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "status"], message: "Denied policy decisions require a rejected_policy result" });
    }
    if (policyDecision.decision === "approval_required" && !hasApprovalProof && result.status !== "approval_required") {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "status"], message: "Unproven approval-required decisions require an approval_required result" });
    }
    if (policyDecision.decision === "approval_required" && hasApprovalProof && ["rejected_policy", "approval_required"].includes(result.status)) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "status"], message: "Approved decisions cannot produce policy rejection or approval-required results" });
    }
    if (policyDecision.decision === "approval_required" && hasApprovalProof) {
      if (approvalResolution === void 0 || approvalResolution.status !== "approved" || approvalResolution.approvalId !== command.policyContext.approvalId || approvalResolution.policyDecisionId !== policyDecision.policyDecisionId || approvalResolution.actionId !== command.actionId) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["approvalResolution"], message: "Approval-required execution needs a matching approved resolution" });
      }
    }
    if (result.actionId !== command.actionId || result.stepId !== command.stepId || result.observationId !== command.observationId || result.sequence <= command.sequence) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result"], message: "Result must follow the command and preserve its identifiers" });
    }
    const sourceCapturedAt = Date.parse(sourceObservation.capturedAt);
    const proposedAt = Date.parse(proposal.proposedAt);
    const decidedAt = Date.parse(policyDecision.decidedAt);
    const dispatchedAt = Date.parse(command.dispatchedAt);
    const startedAt = Date.parse(result.startedAt);
    const completedAt = Date.parse(result.completedAt);
    const resolvedAt = approvalResolution === void 0 ? void 0 : Date.parse(approvalResolution.resolvedAt);
    if (!(sourceCapturedAt <= proposedAt && proposedAt <= decidedAt && decidedAt <= dispatchedAt && dispatchedAt <= startedAt && startedAt <= completedAt && sourceCapturedAt < dispatchedAt && proposedAt < dispatchedAt)) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "startedAt"], message: "Observation, proposal, policy, dispatch, and execution timestamps must be chronological" });
    }
    if (hasApprovalProof && resolvedAt === void 0 || resolvedAt !== void 0 && !(decidedAt < resolvedAt && resolvedAt < dispatchedAt)) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["approvalResolution", "resolvedAt"], message: "Approval resolution must occur after policy decision and before dispatch" });
    }
    if (result.status === "succeeded" || result.status === "failed_recoverable" || result.status === "failed_terminal" || result.status === "cancelled") {
      if (result.postObservation.observationId === command.observationId) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "postObservation", "observationId"], message: "Executed action requires a distinct post-observation" });
      }
      if (Date.parse(result.postObservation.capturedAt) <= completedAt) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["result", "postObservation", "capturedAt"], message: "Executed action post-observation must be captured after completion" });
      }
    }
  });
  var CoordinatesSchema = external_exports.object({
    x: external_exports.number().int().min(0),
    y: external_exports.number().int().min(0)
  });
  var DragCoordinatesSchema = external_exports.object({
    start: CoordinatesSchema,
    end: CoordinatesSchema
  });
  var ScrollDeltaSchema = external_exports.object({
    deltaX: external_exports.number().int(),
    deltaY: external_exports.number().int()
  });
  var ViewportContextSchema = external_exports.object({
    viewportWidth: external_exports.number().int().positive(),
    viewportHeight: external_exports.number().int().positive()
  });
  var KeyModifiersSchema2 = external_exports.object({
    ctrl: external_exports.boolean().optional(),
    shift: external_exports.boolean().optional(),
    alt: external_exports.boolean().optional(),
    meta: external_exports.boolean().optional()
  });
  var BaseActionArgsSchema = external_exports.object({
    id: external_exports.string().min(1),
    observationId: external_exports.number().int().min(0),
    timestamp: external_exports.number().int().positive(),
    // ponytail: optional in the schema so older payloads still parse. The model
    // is told to always provide it; the parser falls back to "" when missing.
    reasoning: external_exports.string().optional()
  });
  var LeftClickArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "left_click"
      /* LEFT_CLICK */
    ),
    coordinates: CoordinatesSchema,
    viewport: ViewportContextSchema
  });
  var DoubleClickArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "double_click"
      /* DOUBLE_CLICK */
    ),
    coordinates: CoordinatesSchema,
    viewport: ViewportContextSchema
  });
  var RightClickArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "right_click"
      /* RIGHT_CLICK */
    ),
    coordinates: CoordinatesSchema,
    viewport: ViewportContextSchema
  });
  var DragArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "drag"
      /* DRAG */
    ),
    coordinates: DragCoordinatesSchema,
    viewport: ViewportContextSchema
  });
  var MouseMoveArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "mouse_move"
      /* MOUSE_MOVE */
    ),
    coordinates: CoordinatesSchema,
    viewport: ViewportContextSchema
  });
  var ScrollArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "scroll"
      /* SCROLL */
    ),
    coordinates: CoordinatesSchema,
    delta: ScrollDeltaSchema,
    viewport: ViewportContextSchema
  });
  var KeyArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "key"
      /* KEY */
    ),
    key: external_exports.string().min(1),
    modifiers: KeyModifiersSchema2.optional()
  });
  var VisitUrlArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "visit_url"
      /* VISIT_URL */
    ),
    url: external_exports.string().url(),
    timeout: external_exports.number().int().positive().optional()
  });
  var HistoryBackArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "history_back"
      /* HISTORY_BACK */
    ),
    steps: external_exports.number().int().positive().optional()
  });
  var ScreenshotArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "screenshot"
      /* SCREENSHOT */
    ),
    fullPage: external_exports.boolean().optional()
  });
  var WaitArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "wait"
      /* WAIT */
    ),
    durationMs: external_exports.number().int().positive()
  });
  var AskUserQuestionArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "ask_user_question"
      /* ASK_USER_QUESTION */
    ),
    question: external_exports.string().min(1),
    context: external_exports.string().optional(),
    choices: external_exports.array(external_exports.string()).optional()
  });
  var TerminateArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "terminate"
      /* TERMINATE */
    ),
    finalAnswer: external_exports.string().optional()
  });
  var PauseAndMemorizeFactArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "pause_and_memorize_fact"
      /* PAUSE_AND_MEMORIZE_FACT */
    ),
    fact: external_exports.string().min(1),
    category: external_exports.string().optional()
  });
  var InsertTextArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "insert_text"
      /* INSERT_TEXT */
    ),
    text: external_exports.string().min(1),
    targetId: external_exports.string().optional()
  });
  var MemorizeFactArgsSchema = BaseActionArgsSchema.extend({
    type: external_exports.literal(
      "memorize_fact"
      /* MEMORIZE_FACT */
    ),
    fact: external_exports.string().min(1),
    category: external_exports.string().optional()
  });
  var FaraActionArgsSchema = external_exports.union([
    LeftClickArgsSchema,
    DoubleClickArgsSchema,
    RightClickArgsSchema,
    DragArgsSchema,
    MouseMoveArgsSchema,
    ScrollArgsSchema,
    KeyArgsSchema,
    InsertTextArgsSchema,
    VisitUrlArgsSchema,
    HistoryBackArgsSchema,
    ScreenshotArgsSchema,
    WaitArgsSchema,
    AskUserQuestionArgsSchema,
    TerminateArgsSchema,
    PauseAndMemorizeFactArgsSchema,
    MemorizeFactArgsSchema
  ]);

  // ../../packages/brotto-relay-protocol/dist/v1/messages.js
  var TimestampSchema = external_exports.string().datetime();
  var ClientSchema = external_exports.enum(["browser_extension", "desktop_connector", "orchestrator"]);
  var ProtocolErrorDetailsSchema = external_exports.record(external_exports.unknown()).superRefine((value, context) => {
    if (Object.keys(value).length > 20) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, message: "Protocol error details may contain at most 20 fields" });
    }
  });
  var SessionOpenSchema = external_exports.object({
    type: external_exports.literal("session.open"),
    client: ClientSchema,
    goal: external_exports.string().trim().min(1).max(4e3)
  }).strict();
  var SessionAcceptedSchema = external_exports.object({
    type: external_exports.literal("session.accepted"),
    acceptedAt: TimestampSchema,
    nextSequence: SequenceSchema
  }).strict();
  var ObservationSubmittedSchema = external_exports.object({
    type: external_exports.literal("observation.submitted"),
    observation: ObservationV1Schema
  }).strict();
  var ActionCommandMessageSchema = external_exports.object({
    type: external_exports.literal("action.command"),
    proposal: ActionProposalV1Schema,
    policyDecision: PolicyDecisionV1Schema,
    command: ActionCommandV1Schema2
  }).strict();
  var ActionAcknowledgedSchema = external_exports.object({
    type: external_exports.literal("action.acknowledged"),
    actionId: ActionIdSchema,
    stepId: StepIdSchema,
    observationId: ObservationIdSchema,
    acknowledgedAt: TimestampSchema
  }).strict();
  var ActionCompletedSchema = external_exports.object({
    type: external_exports.literal("action.completed"),
    result: ActionResultV1Schema
  }).strict();
  var ApprovalRequestedSchema = external_exports.object({
    type: external_exports.literal("approval.requested"),
    approvalId: ApprovalIdSchema,
    policyDecisionId: PolicyDecisionIdSchema,
    actionId: ActionIdSchema,
    observationId: ObservationIdSchema,
    requestedAt: TimestampSchema,
    reason: external_exports.string().min(1).max(2e3)
  }).strict();
  var ApprovalResolvedSchema = external_exports.object({
    type: external_exports.literal("approval.resolved"),
    resolution: ApprovalResolutionV1Schema
  }).strict();
  var SucceededCompletionProposalV1Schema = CompletionProposalV1Schema.superRefine((completion, context) => {
    if (completion.status !== "succeeded") {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, message: "task.completed requires a succeeded completion proposal" });
    }
  });
  var FailedCompletionProposalV1Schema = CompletionProposalV1Schema.superRefine((completion, context) => {
    if (completion.status !== "failed") {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, message: "task.failed requires a failed completion proposal" });
    }
  });
  var TaskCompletedSchema = external_exports.object({
    type: external_exports.literal("task.completed"),
    completion: SucceededCompletionProposalV1Schema
  }).strict();
  var TaskFailedSchema = external_exports.object({
    type: external_exports.literal("task.failed"),
    completion: FailedCompletionProposalV1Schema
  }).strict();
  var TaskCancelledSchema = external_exports.object({
    type: external_exports.literal("task.cancelled"),
    taskId: TaskIdSchema,
    occurredAt: TimestampSchema,
    reason: external_exports.string().min(1).max(2e3),
    observationId: ObservationIdSchema.optional(),
    actionId: ActionIdSchema.optional(),
    stepId: StepIdSchema.optional()
  }).strict();
  var TaskTerminalSchema = external_exports.discriminatedUnion("type", [
    TaskCompletedSchema,
    TaskFailedSchema,
    TaskCancelledSchema
  ]);
  var ReconcileRequestSchema = external_exports.object({
    type: external_exports.literal("reconcile.request"),
    lastReceivedSequence: SequenceSchema,
    lastSentClientSequence: SequenceSchema,
    pendingActionIds: external_exports.array(ActionIdSchema).max(100),
    requestedAt: TimestampSchema
  }).strict();
  var ReconcileResponseSchema = external_exports.object({
    type: external_exports.literal("reconcile.response"),
    nextSequence: SequenceSchema,
    pendingActionIds: external_exports.array(ActionIdSchema).max(100),
    requiresFreshObservation: external_exports.boolean(),
    authoritativeState: external_exports.enum(["CREATED", "OBSERVING", "PLANNING", "VALIDATING", "POLICY_CHECK", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER", "DISPATCHING", "EXECUTING", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED"]),
    command: ActionCommandMessageSchema.optional(),
    storedResult: ActionResultV1Schema.optional(),
    terminal: TaskTerminalSchema.optional(),
    respondedAt: TimestampSchema
  }).strict();
  var HeartbeatSchema = external_exports.object({
    type: external_exports.literal("heartbeat"),
    sentAt: TimestampSchema
  }).strict();
  var ProtocolErrorSchema = external_exports.object({
    type: external_exports.literal("protocol.error"),
    code: external_exports.string().min(1).max(128),
    message: external_exports.string().min(1).max(2e3),
    retryable: external_exports.boolean().optional(),
    details: ProtocolErrorDetailsSchema.optional()
  }).strict();
  var AgentMessageV1BaseSchema = external_exports.discriminatedUnion("type", [
    SessionOpenSchema,
    SessionAcceptedSchema,
    ObservationSubmittedSchema,
    ActionCommandMessageSchema,
    ActionAcknowledgedSchema,
    ActionCompletedSchema,
    ApprovalRequestedSchema,
    ApprovalResolvedSchema,
    TaskCompletedSchema,
    TaskFailedSchema,
    TaskCancelledSchema,
    ReconcileRequestSchema,
    ReconcileResponseSchema,
    HeartbeatSchema,
    ProtocolErrorSchema
  ]);
  var AgentMessageV1Schema = AgentMessageV1BaseSchema.superRefine((message, context) => {
    if (message.type === "reconcile.response" && message.terminal !== void 0) {
      const expected = message.terminal.type === "task.completed" ? "COMPLETED" : message.terminal.type === "task.failed" ? "FAILED" : "CANCELLED";
      if (message.authoritativeState !== expected) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["terminal"], message: "Terminal message does not match authoritative state" });
      }
    }
    try {
      assertNoForbiddenBrowserData(message);
    } catch (error) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Forbidden browser data" });
    }
  });

  // ../../packages/brotto-relay-protocol/dist/v1/envelope.js
  var UuidSchema = external_exports.string().uuid();
  var ExpirySchema = external_exports.number().int().nonnegative();
  var AgentEnvelopeV1Schema = external_exports.object({
    protocolVersion: external_exports.literal("1.0"),
    messageId: MessageIdSchema,
    sessionId: SessionIdSchema,
    correlationId: UuidSchema,
    causationId: UuidSchema,
    recipientId: UuidSchema,
    tenantId: external_exports.string().min(1).max(256).optional(),
    deviceId: external_exports.string().min(1).max(256).optional(),
    sequence: SequenceSchema,
    createdAt: external_exports.string().datetime(),
    expiresAt: ExpirySchema,
    payload: AgentMessageV1Schema,
    signature: external_exports.string().min(1).max(16384).optional()
  }).strict().superRefine((envelope, context) => {
    if (envelope.expiresAt <= Date.parse(envelope.createdAt)) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt must be after createdAt" });
    }
    try {
      assertNoForbiddenBrowserData(envelope);
    } catch (error) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Forbidden browser data" });
    }
  });
  function createEnvelope(input) {
    return AgentEnvelopeV1Schema.parse({ protocolVersion: "1.0", ...input });
  }
  function canonicalJson2(value) {
    if (value === null)
      return "null";
    if (typeof value === "string" || typeof value === "boolean")
      return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new TypeError("Canonical JSON only supports finite numbers");
      return JSON.stringify(value);
    }
    if (Array.isArray(value))
      return `[${value.map(canonicalJson2).join(",")}]`;
    if (typeof value === "object") {
      const record2 = value;
      return `{${Object.keys(record2).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson2(record2[key])}`).join(",")}}`;
    }
    throw new TypeError("Canonical JSON only supports JSON values");
  }
  function canonicalEnvelopeBytes(envelope) {
    const { signature: _signature, ...unsignedEnvelope } = AgentEnvelopeV1Schema.parse(envelope);
    return new TextEncoder().encode(canonicalJson2(unsignedEnvelope));
  }
  async function signEnvelope(envelope, signer) {
    const parsed = AgentEnvelopeV1Schema.parse(envelope);
    const signature = await signer.sign(canonicalEnvelopeBytes(parsed));
    return AgentEnvelopeV1Schema.parse({ ...parsed, signature });
  }

  // ../../packages/brotto-relay-protocol/dist/types.js
  var MAX_SEQUENCE_WINDOW = 1e3;
  var MAX_MESSAGE_SIZE_BYTES = 10 * 1024 * 1024;
  var MAX_PAYLOAD_SIZE_BYTES = 9 * 1024 * 1024;
  var MessageType;
  (function(MessageType2) {
    MessageType2["HELLO"] = "HELLO";
    MessageType2["HELLO_ACK"] = "HELLO_ACK";
    MessageType2["HEARTBEAT"] = "HEARTBEAT";
    MessageType2["HEARTBEAT_ACK"] = "HEARTBEAT_ACK";
    MessageType2["GOODBYE"] = "GOODBYE";
    MessageType2["ERROR"] = "ERROR";
    MessageType2["SESSION_CREATE"] = "SESSION_CREATE";
    MessageType2["SESSION_CREATE_ACK"] = "SESSION_CREATE_ACK";
    MessageType2["SESSION_CREATE_ERROR"] = "SESSION_CREATE_ERROR";
    MessageType2["SESSION_RENEW"] = "SESSION_RENEW";
    MessageType2["SESSION_RENEW_ACK"] = "SESSION_RENEW_ACK";
    MessageType2["SESSION_REVOKE"] = "SESSION_REVOKE";
    MessageType2["SESSION_REVOKED"] = "SESSION_REVOKED";
    MessageType2["CHANNEL_OPEN"] = "CHANNEL_OPEN";
    MessageType2["CHANNEL_OPEN_ACK"] = "CHANNEL_OPEN_ACK";
    MessageType2["CHANNEL_OPEN_ERROR"] = "CHANNEL_OPEN_ERROR";
    MessageType2["CHANNEL_CLOSE"] = "CHANNEL_CLOSE";
    MessageType2["CHANNEL_CLOSED"] = "CHANNEL_CLOSED";
    MessageType2["CDP_FRAME"] = "CDP_FRAME";
    MessageType2["CDP_FRAME_ACK"] = "CDP_FRAME_ACK";
    MessageType2["BACKPRESSURE_BEGIN"] = "BACKPRESSURE_BEGIN";
    MessageType2["BACKPRESSURE_END"] = "BACKPRESSURE_END";
    MessageType2["RATE_LIMIT_UPDATE"] = "RATE_LIMIT_UPDATE";
  })(MessageType || (MessageType = {}));
  var ProtocolErrorCode;
  (function(ProtocolErrorCode2) {
    ProtocolErrorCode2["PROTOCOL_VERSION_MISMATCH"] = "PROTOCOL_VERSION_MISMATCH";
    ProtocolErrorCode2["SEQUENCE_NUMBER_INVALID"] = "SEQUENCE_NUMBER_INVALID";
    ProtocolErrorCode2["SEQUENCE_NUMBER_REPLAY"] = "SEQUENCE_NUMBER_REPLAY";
    ProtocolErrorCode2["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    ProtocolErrorCode2["SESSION_REVOKED"] = "SESSION_REVOKED";
    ProtocolErrorCode2["CHANNEL_NOT_FOUND"] = "CHANNEL_NOT_FOUND";
    ProtocolErrorCode2["CHANNEL_ALREADY_OPEN"] = "CHANNEL_ALREADY_OPEN";
    ProtocolErrorCode2["PAYLOAD_TOO_LARGE"] = "PAYLOAD_TOO_LARGE";
    ProtocolErrorCode2["MESSAGE_TYPE_INVALID"] = "MESSAGE_TYPE_INVALID";
    ProtocolErrorCode2["SIGNATURE_INVALID"] = "SIGNATURE_INVALID";
    ProtocolErrorCode2["AUTHENTICATION_FAILED"] = "AUTHENTICATION_FAILED";
    ProtocolErrorCode2["RATE_LIMIT_EXCEEDED"] = "RATE_LIMIT_EXCEEDED";
    ProtocolErrorCode2["INTERNAL_ERROR"] = "INTERNAL_ERROR";
  })(ProtocolErrorCode || (ProtocolErrorCode = {}));

  // ../../packages/brotto-relay-protocol/dist/sequence.js
  var SequenceTracker = class {
    sessions = /* @__PURE__ */ new Map();
    /**
     * Get or create sequence state for a session/channel
     */
    getState(sessionId, channelId) {
      let sessionMap = this.sessions.get(sessionId);
      if (!sessionMap) {
        sessionMap = /* @__PURE__ */ new Map();
        this.sessions.set(sessionId, sessionMap);
      }
      let state = sessionMap.get(channelId);
      if (!state) {
        state = {
          lastSequenceNumber: -1,
          receivedSequences: /* @__PURE__ */ new Set(),
          windowStart: 0
        };
        sessionMap.set(channelId, state);
      }
      return state;
    }
    /**
     * Validate and process a sequence number
     *
     * Returns a validation result indicating if the message should be accepted.
     * Messages with duplicate sequence numbers within the window are rejected (replay attack).
     * Messages with sequence numbers outside the expected window are also rejected.
     */
    validateAndProcess(sessionId, channelId, sequenceNumber) {
      const state = this.getState(sessionId, channelId);
      const errors = [];
      if (state.lastSequenceNumber === -1) {
        state.lastSequenceNumber = sequenceNumber;
        state.receivedSequences.add(sequenceNumber);
        state.windowStart = sequenceNumber;
        return { isValid: true, errors: [] };
      }
      if (state.receivedSequences.has(sequenceNumber)) {
        errors.push({
          field: "sequenceNumber",
          message: `Duplicate sequence number ${sequenceNumber} detected - possible replay attack`,
          code: ProtocolErrorCode.SEQUENCE_NUMBER_REPLAY
        });
        return { isValid: false, errors };
      }
      const windowEnd = state.lastSequenceNumber + MAX_SEQUENCE_WINDOW;
      const windowStart = state.windowStart;
      if (sequenceNumber < windowStart) {
        errors.push({
          field: "sequenceNumber",
          message: `Sequence number ${sequenceNumber} is below window start ${windowStart} - too old`,
          code: ProtocolErrorCode.SEQUENCE_NUMBER_REPLAY
        });
        return { isValid: false, errors };
      }
      if (sequenceNumber > windowEnd) {
        errors.push({
          field: "sequenceNumber",
          message: `Sequence number ${sequenceNumber} exceeds window end ${windowEnd} - gap detected`,
          code: ProtocolErrorCode.SEQUENCE_NUMBER_INVALID
        });
        return { isValid: false, errors };
      }
      state.lastSequenceNumber = sequenceNumber;
      state.receivedSequences.add(sequenceNumber);
      this.pruneWindow(sessionId, channelId);
      return { isValid: true, errors: [] };
    }
    /**
     * Remove sequence numbers that are now outside the sliding window
     */
    pruneWindow(sessionId, channelId) {
      const state = this.getState(sessionId, channelId);
      const newWindowStart = Math.max(0, state.lastSequenceNumber - MAX_SEQUENCE_WINDOW + 1);
      if (newWindowStart > state.windowStart) {
        state.windowStart = newWindowStart;
        for (const seq of state.receivedSequences) {
          if (seq < state.windowStart) {
            state.receivedSequences.delete(seq);
          }
        }
      }
    }
    /**
     * Get the next expected sequence number for a session/channel
     */
    getNextExpected(sessionId, channelId) {
      const state = this.getState(sessionId, channelId);
      return state.lastSequenceNumber + 1;
    }
    /**
     * Check if a sequence number has been seen (for debugging)
     */
    hasSeen(sessionId, channelId, sequenceNumber) {
      const state = this.getState(sessionId, channelId);
      return state.receivedSequences.has(sequenceNumber);
    }
    /**
     * Reset sequence tracking for a session/channel
     */
    reset(sessionId, channelId) {
      const sessionMap = this.sessions.get(sessionId);
      if (sessionMap) {
        sessionMap.delete(channelId);
        if (sessionMap.size === 0) {
          this.sessions.delete(sessionId);
        }
      }
    }
    /**
     * Reset all sequence tracking (use with caution)
     */
    resetAll() {
      this.sessions.clear();
    }
    /**
     * Get statistics for a session
     */
    getStats(sessionId) {
      const sessionMap = this.sessions.get(sessionId);
      if (!sessionMap) {
        return { channelCount: 0, totalMessagesReceived: 0 };
      }
      let totalMessages = 0;
      for (const state of sessionMap.values()) {
        totalMessages += state.receivedSequences.size;
      }
      return {
        channelCount: sessionMap.size,
        totalMessagesReceived: totalMessages
      };
    }
    /**
     * Clean up expired sessions (call periodically)
     */
    cleanup(maxAgeMs) {
      let cleaned = 0;
      const now = Date.now();
      for (const [sessionId, sessionMap] of this.sessions.entries()) {
        for (const [channelId, state] of sessionMap.entries()) {
          if (state.receivedSequences.size === 0) {
            sessionMap.delete(channelId);
            cleaned++;
          }
        }
        if (sessionMap.size === 0) {
          this.sessions.delete(sessionId);
          cleaned++;
        }
      }
      return cleaned;
    }
  };
  var defaultSequenceTracker = new SequenceTracker();

  // src/canonical/controller.ts
  var import_brotto_action_schema5 = __toESM(require_dist());
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
        return import_brotto_action_schema5.ActionResultV1Schema.parse({
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
      if (pipelineResult.status === "succeeded") return import_brotto_action_schema5.ActionResultV1Schema.parse({ ...executedBase, status: "succeeded" });
      if (pipelineResult.status === "cancelled") return import_brotto_action_schema5.ActionResultV1Schema.parse({
        ...executedBase,
        status: "cancelled",
        cancellation: { reason: "Action cancelled" }
      });
      return import_brotto_action_schema5.ActionResultV1Schema.parse({
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
    return canonicalJson3(command);
  }
  function canonicalJson3(value) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("Command contains a non-finite number");
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson3).join(",")}]`;
    if (typeof value === "object") {
      const record2 = value;
      return `{${Object.keys(record2).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson3(record2[key])}`).join(",")}}`;
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
    return import_brotto_action_schema5.ActionResultV1Schema.parse({
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

  // src/canonical/observation.ts
  var import_brotto_action_schema6 = __toESM(require_dist());

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
  function decodeBase642(data) {
    const decoded = atob(data);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  function encodeBase642(bytes) {
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
    const header = decodeBase642(data.slice(0, 32));
    const { width, height } = validatePngHeader(header);
    const bytes = decodeBase642(data);
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
    const data = encodeBase642(bytes);
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
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getAttribute("aria-hidden") !== "true" && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
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
        navigation: 1,
        banner: 1,
        contentinfo: 1
      };
      const NAV_LINE_RE = /^(sign in|sign up|log in|log out|menu|search|skip to|home|about|contact|privacy|terms|cookie|copyright|©)/i;
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const vis = (el) => {
        if (!el) return false;
        const t = el.tagName.toLowerCase();
        if (SKIP_TAGS[t]) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0;
      };
      const parts = [];
      const heads = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        if (!vis(h)) return;
        const t = clean(h.textContent);
        if (t && t.length < 200) heads.push(`H${h.tagName[1]}: ${t}`);
      });
      if (heads.length) parts.push("=== HEADINGS ===\n" + heads.join("\n"));
      const stats = [];
      document.querySelectorAll("a, span, strong, b, div").forEach((el) => {
        if (!vis(el)) return;
        const own = clean(el.textContent);
        if (!/^\d{1,4}(,\d{3})*(\.\d+)?[KMBkmb]?$/.test(own)) return;
        const p = el.parentElement;
        if (!p) return;
        const pt = clean(p.textContent);
        if (pt.length > 80 || pt.length < own.length + 2) return;
        const label = pt.replace(own, "").trim();
        if (label && label.length < 40) stats.push(`${label}: ${own}`);
      });
      if (stats.length) parts.push("=== STATS ===\n" + stats.join("\n"));
      const lbls = [];
      document.querySelectorAll("label").forEach((l) => {
        if (!vis(l)) return;
        const t = clean(l.textContent);
        if (t && t.length < 80) lbls.push(t);
      });
      if (lbls.length) parts.push("=== LABELS ===\n" + lbls.join("\n"));
      const seen = {};
      const lines = [];
      const walkText = (el, depth) => {
        if (depth > 60 || !el) return;
        if (el.nodeType === Node.TEXT_NODE) {
          const t = clean(el.textContent);
          if (t.length < 3) return;
          if (NAV_LINE_RE.test(t)) return;
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
      if (lines.length) parts.push("=== TEXT ===\n" + lines.join("\n"));
      return parts.join("\n\n");
    })();
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
      bodyTextSnippet
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
  async function defaultCaptureVisibleTab(_tabId, windowId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(securityError(`Visible-tab capture failed: ${error.message}`));
          return;
        }
        if (!dataUrl) {
          reject(securityError("Visible-tab capture returned no data"));
          return;
        }
        resolve(dataUrl);
      });
    });
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
    if (typeof raw.documentToken !== "string" || raw.documentToken.length === 0 || raw.documentToken.length > 512) {
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
      bodyTextSnippet: raw.bodyTextSnippet
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
  function pageSnapshotsMatch(before, after) {
    return before.url === after.url && before.documentToken === after.documentToken;
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
    const captureVisibleTab = options.captureVisibleTab ?? defaultCaptureVisibleTab;
    const getTabIdentity = options.getTabIdentity ?? defaultGetTabIdentity;
    const getZoom = options.getZoom ?? defaultGetZoom;
    const maskScreenshot = options.maskScreenshot ?? defaultMaskScreenshot;
    const initialIdentity = requireActiveIdentity(
      tabId,
      void 0,
      await getTabIdentity(tabId)
    );
    const zoomBefore = requireBoundedPositive("zoom", await getZoom(tabId));
    const topologyBefore = await captureFrameTopology(tabId, sendCdpCommand);
    const before = await capturePageSnapshot(
      tabId,
      sendCdpCommand,
      maxSemanticTargets,
      maxDomElements
    );
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
    const topologyAfter = await captureFrameTopology(tabId, sendCdpCommand);
    const after = await capturePageSnapshot(
      tabId,
      sendCdpCommand,
      maxSemanticTargets,
      maxDomElements
    );
    const zoomAfter = requireBoundedPositive("zoom", await getZoom(tabId));
    if (zoomBefore !== zoomAfter || !pageSnapshotsMatch(before, after)) {
      throw securityError(
        "The page changed during capture; observation rejected"
      );
    }
    if (topologyBefore.mainFrameId !== topologyAfter.mainFrameId) {
      throw securityError("The frame topology changed during capture");
    }
    let maskedScreenshot;
    if (rawScreenshot !== null) {
      validateScreenshotViewport(rawScreenshot, after.viewport, zoomAfter);
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
      validateScreenshotViewport(screenshot2, after.viewport, zoomAfter);
      maskedScreenshot = screenshot2;
    } else {
      maskedScreenshot = { bytes: new Uint8Array(0), width: 0, height: 0, data: "" };
    }
    const screenshot = maskedScreenshot;
    const screenshotHash = screenshot.bytes.length > 0 ? bytesToHex(await sha256(screenshot.bytes)) : "0".repeat(64);
    const pageFrameId = await opaqueUuid(
      `frame:${tabId}:${topologyAfter.mainFrameId}`
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
        zoom: zoomAfter
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
      bodyText: sanitizeBrowserText(after.bodyTextSnippet)
    };
    (0, import_brotto_action_schema6.assertNoForbiddenBrowserData)(observation);
    return import_brotto_action_schema6.ObservationV1Schema.parse(observation);
  }
  async function captureObservation(tabId, options = {}) {
    try {
      return await captureObservationInternal(tabId, options);
    } catch (error) {
      if (error instanceof ObservationSecurityError) throw error;
      if (error instanceof import_brotto_action_schema6.ForbiddenBrowserDataError) {
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
      throw securityError(
        `Captured observation failed the local outbound security boundary: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
        error
      );
    }
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
  var import_brotto_action_schema7 = __toESM(require_dist());
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
      result: import_brotto_action_schema7.ActionResultV1Schema.parse(value.result)
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

  // src/local-driver.ts
  init_debugger();
  var MAX_STEPS = 50;
  var HISTORY_LIMIT = 6;
  var POST_ACTION_PAUSE_MS = 400;
  var WorkingMemory = class {
    constructor() {
      this.facts = /* @__PURE__ */ new Map();
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
        }
      }
    }
    toView() {
      return Array.from(this.facts.values());
    }
    get size() {
      return this.facts.size;
    }
  };
  function renderMemoryBlock(facts) {
    if (facts.length === 0) return "";
    const lines = facts.map((f) => {
      const ev = f.evidence ? `  (evidence: ${f.evidence})` : "";
      return `  - ${f.key} = "${f.value}"${ev}`;
    });
    return `Working memory (structured findings \u2014 do not re-record; carry these forward):
${lines.join("\n")}

`;
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
      case "mouse_move":
        return `${t}:${action.x ?? 0},${action.y ?? 0}`;
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
    if (tail.every((a) => a === tail[0])) return { loop: true, action: tail[0] };
    return { loop: false, action: "" };
  }
  function detectStuckFailures(failures, threshold = 3) {
    if (failures.length < threshold) return { stuck: false, action: "", error: "" };
    const tail = failures.slice(-threshold);
    if (tail.every((f) => f.action === tail[0].action)) {
      return { stuck: true, action: tail[0].action, error: tail[0].error };
    }
    return { stuck: false, action: "", error: "" };
  }
  var APPROVAL_KEYWORDS = [
    "delete",
    "remove",
    "pay",
    "checkout",
    "purchase",
    "confirm purchase",
    "send money",
    "transfer",
    "wire",
    "subscription"
  ];
  var APPROVAL_DOMAINS = [
    "checkout",
    "pay.",
    "payments.",
    "stripe.com",
    "banking",
    "/pay/"
  ];
  function needsApproval(action, observation) {
    const pageText = (observation.bodyText ?? (observation.accessibilityNodes ?? []).map((n) => `${n.name ?? ""} ${n.value ?? ""}`).join(" ")).toLowerCase();
    if (action.type === "visit_url" && typeof action.url === "string") {
      for (const kw of APPROVAL_DOMAINS) {
        if (action.url.toLowerCase().includes(kw)) {
          return { needs: true, reason: `Navigate to "${action.url}" matches approval pattern "${kw}"` };
        }
      }
    }
    if (action.type === "left_click" || action.type === "double_click") {
      for (const kw of APPROVAL_KEYWORDS) {
        if (pageText.includes(kw)) {
          return { needs: true, reason: `Page contains "${kw}" \u2014 clicking may be destructive` };
        }
      }
    }
    if (action.type === "insert_text" && typeof action.text === "string") {
      const lcText = action.text.toLowerCase();
      for (const kw of APPROVAL_KEYWORDS) {
        if (lcText.includes(kw) && pageText.includes(kw)) {
          return { needs: true, reason: `Typing "${action.text}" on a page mentioning "${kw}" may be destructive` };
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
  function renderObservationForPlanner(obs, history, guidance, memory) {
    const lines = [];
    if (memory && memory.length > 0) {
      lines.push(renderMemoryBlock(memory).trimEnd());
      lines.push("");
    }
    lines.push(`URL: ${obs.url}`);
    lines.push(`Title: ${obs.title}`);
    lines.push("");
    if (guidance && guidance.length > 0) {
      lines.push(`User guidance: ${guidance}`);
      lines.push("");
    }
    lines.push("Elements (use IDs, click coords inline):");
    for (const t of obs.semanticTargets) {
      if (!t.visible) continue;
      const bb = t.boundingBox;
      const cx = Math.round(bb.x + bb.width / 2);
      const cy = Math.round(bb.y + bb.height / 2);
      const id = t.stableRef ?? t.targetId.slice(0, 8);
      const name = t.accessibleName?.text ?? t.attributes?.id ?? t.attributes?.name ?? "";
      const value = t.control.kind === "input" ? t.control.value ?? "" : "";
      const type = t.control.kind === "input" ? ` type=${t.control.type ?? ""}` : "";
      const tags = [];
      if (value) tags.push(`value="${value}"`);
      if (t.attributes?.placeholder) tags.push(`placeholder="${t.attributes.placeholder}"`);
      if (t.attributes?.href) tags.push(`href="${t.attributes.href}"`);
      const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
      const nameStr = name ? ` "${name}"` : "";
      lines.push(`  [${id}] <${t.tag}>${nameStr}${type}${tagStr} click=(${cx}, ${cy})`);
    }
    if (obs.semanticTargets.length === 0) lines.push("  (no interactive elements)");
    if (history.length > 0) {
      const tail = history.slice(-HISTORY_LIMIT);
      lines.push("");
      lines.push("Previous steps (most recent last):");
      tail.forEach((h, i) => lines.push(`  ${i + 1}. ${h.action} \u2192 ${h.result}`));
    }
    if (obs.bodyText && obs.bodyText.length > 0) {
      lines.push("");
      lines.push("=== PAGE TEXT (HEADINGS + STATS + LABELS + TEXT \u2014 STATS contains the data the user asked for) ===");
      lines.push(obs.bodyText);
      lines.push("=== END PAGE TEXT ===");
    } else if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
      const text = obs.accessibilityNodes.map((n) => n.name ?? n.value ?? "").filter((s) => s.length > 0).join(" ").slice(0, 400);
      if (text) {
        lines.push("");
        lines.push(`Page text (first 400 chars): "${text}"`);
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
  async function callPlanner(opts, context) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${opts.plannerUrl}/plan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workId: "ext-" + Date.now(),
            sessionId: "00000000-0000-4000-8000-000000000001",
            taskId: "00000000-0000-4000-8000-000000000002",
            goal: opts.goal,
            completionCriteria: [],
            context,
            recentResults: [],
            trajectory: []
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
  async function executeAction(tabId, action) {
    switch (action.type) {
      case "left_click": {
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 1 } });
        await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 1 } });
        return `clicked (${action.x}, ${action.y})`;
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
        await sendCommand(tabId, { method: "Input.insertText", params: { text: action.text } });
        return `typed "${action.text.slice(0, 40)}"`;
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
      default:
        throw new Error(`unknown action type: ${action.type}`);
    }
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
        }, 15e3);
      });
    }
    return tab.id;
  }
  async function captureObservationWithTimeout(tabId, timeoutMs) {
    return Promise.race([
      captureObservation(tabId),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`captureObservation timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  }
  var captureForDriverWithTimeout = (tabId, timeoutMs) => captureObservationWithTimeout(tabId, timeoutMs);
  async function waitForNetworkIdle(_tabId, timeoutMs = 500) {
    await new Promise((r) => setTimeout(r, timeoutMs));
  }
  async function runLocalLoop(opts) {
    log(opts, `opening new tab${opts.startingUrl ? ` at ${opts.startingUrl}` : ""}`);
    let tabId;
    try {
      tabId = await openNewTab(opts.startingUrl);
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
    const failures = [];
    let injectedGuidance;
    const memory = new WorkingMemory();
    const actionSigs = [];
    const obsSigs = [];
    let stagnationHits = 0;
    const STAGNATION_LIMIT = 2;
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
    async function activateAgentTab() {
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch {
      }
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
    try {
      while (stepIndex < MAX_STEPS) {
        if (opts.signal.aborted) {
          terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
          return;
        }
        log(opts, `step ${stepIndex + 1}`);
        await activateAgentTab();
        const obs = await captureForDriverWithTimeout(tabId, 15e3);
        const login = looksLikeLoginPage(obs);
        const challenge = login.login ? null : looksLikeAuthChallenge(obs);
        if (login.login || challenge && challenge.auth) {
          const domain = login.login ? login.domain : challenge.domain;
          const reason = login.login ? `password form on ${login.domain}` : `auth challenge (${challenge.reason})`;
          log(opts, `login pause: ${reason}`);
          opts.onLoginRequired({ url: obs.url, domain });
          const loginResume = await waitForLoginResume(tabId, domain, opts.signal);
          pendingLoginResolvers.delete(tabId);
          if (opts.signal.aborted) {
            terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
            return;
          }
          log(opts, loginResume.auto ? `login resume: ${loginResume.kind}` : "user confirmed login \u2014 resuming loop");
          injectedGuidance = void 0;
          await waitForNetworkIdle(tabId).catch(() => void 0);
          continue;
        }
        const signIn = looksLikeSignInLink(obs);
        if (signIn.link && !injectedGuidance) {
          const targetHint = signIn.targetId ? ` Look for element [${signIn.targetId.slice(0, 8)}] "${signIn.label}" and click its center.` : ` Look for a "${signIn.label}" link/button and click it.`;
          injectedGuidance = `This page is a logged-out landing page. Click the Sign in / Log in link to authenticate \u2014 never type credentials.${targetHint}`;
        }
        const context = renderObservationForPlanner(obs, history, injectedGuidance, memory.toView());
        const outcome = await callPlanner(opts, context);
        if (opts.signal.aborted) {
          terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
          return;
        }
        if (outcome.kind === "completion") {
          terminal = { kind: "complete", complete: { summary: outcome.summary ?? "task completed", steps: stepIndex + 1, finalAnswer: outcome.summary } };
          return;
        }
        if (outcome.kind === "question") {
          const questionText = outcome.question ?? "The agent needs more information.";
          const isProseOnly = outcome.proseOnly === true;
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
          const answer = await opts.onClarify({
            reason: isProseOnly ? "planner returned prose instead of a tool call" : "The planner asked a question",
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
        if (action.type === "terminate") {
          log(opts, `model called terminate at step ${stepIndex + 1}`);
          const finalAnswer = typeof action.finalAnswer === "string" && action.finalAnswer.length > 0 ? action.finalAnswer : typeof action.answer === "string" && action.answer.length > 0 ? action.answer : "";
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
          const findings = memory.toView().filter((f) => !f.key.startsWith("_"));
          let richAnswer = finalAnswer;
          if (findings.length > 0) {
            const lines = findings.map((f) => `  \u2022 ${f.key} = ${f.value}${f.evidence ? `  (${f.evidence})` : ""}`);
            richAnswer = `${finalAnswer}

Notes recorded during run:
${lines.join("\n")}`;
          }
          terminal = { kind: "complete", complete: { summary: richAnswer, steps: stepIndex + 1, finalAnswer: richAnswer } };
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
        let result;
        const actionTs = Date.now();
        try {
          result = await executeAction(tabId, action);
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
        let screenshot = null;
        let postUrl = obs.url;
        try {
          await activateAgentTab();
          const postObs = await captureObservationWithTimeout(tabId, 15e3);
          screenshot = postObs.screenshot && postObs.screenshot.data.length > 0 ? postObs.screenshot.data : null;
          postUrl = postObs.url;
        } catch (err) {
          log(opts, `post-action observation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        history.push({ action: desc, result });
        failures.length = 0;
        opts.onStep({ index: stepIndex, action: desc, result, url: postUrl, screenshot, iconKind, reasoning: action.reasoning });
        actionSigs.push(actionSignature(action));
        obsSigs.push(observationSignature({ url: postUrl, title: obs.title, elements: obs.semanticTargets.slice(0, 1).map((t) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
        const stagnation = detectStagnation(actionSigs, obsSigs);
        if (stagnation) {
          stagnationHits++;
          log(opts, `stagnation: ${stagnation.kind} signature="${stagnation.signature}" hit ${stagnationHits}/${STAGNATION_LIMIT}`);
          if (stagnationHits >= STAGNATION_LIMIT) {
            const findings = memory.toView();
            const blockedMessage = `${stagnation.message}

Findings so far:
${findings.map((f) => `  - ${f.key} = "${f.value}"`).join("\n") || "  (none)"}`;
            terminal = { kind: "error", error: { code: "STAGNATION", message: blockedMessage } };
            return;
          }
          injectedGuidance = stagnation.message;
          opts.onAnswered?.({ question: stagnation.kind, answer: stagnation.message });
        }
        const loop = detectLoop(history);
        if (loop.loop) {
          log(opts, `loop detected: ${loop.action} repeated ${history.length} times`);
          const answer = await opts.onClarify({
            reason: `Action "${loop.action}" repeated ${history.length} times in a row`,
            question: `The agent keeps doing "${loop.action}" without progress. How should it proceed?`,
            context: loop.action
          });
          injectedGuidance = answer;
          opts.onAnswered?.({ question: loop.action, answer });
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
  var BOOTSTRAP_PATH = "/v1...sessions";
  var localAbortController = null;
  var localTabId = null;
  var DEFAULT_PLANNER_URL = "http://127.0.0.1:3001";
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
      if (managedControlPlaneUrl === null) throw new Error("Administrator-managed control-plane URL is unavailable");
      const endpoint = bootstrapEndpoint(managedControlPlaneUrl);
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
          signal: controller_ac.signal,
          onTabOpened: (tabId) => {
            localTabId = tabId;
          },
          onTabEvent: (event) => {
            notifyUi({ type: "tab_event", event });
          },
          onStep: ({ index, action, result, url, screenshot, iconKind, reasoning }) => {
            notifyUi({
              type: "step_card",
              index,
              title: action,
              result,
              url,
              screenshot: screenshot ?? void 0,
              screenshotPlaceholder: screenshot ? void 0 : "Screenshot unavailable (chrome:// page or capture blocked)",
              iconKind,
              ts: Date.now(),
              // ponytail: planner's one-sentence reasoning surfaces as the
              // assistant bubble title in the side panel.
              reasoning
            });
          },
          // ponytail: log events surface as 'observation' kind so the existing
          // popup log handler picks them up without a new message type.
          onLoginRequired: ({ url, domain }) => {
            notifyUi({ type: "login_required", url, domain });
          },
          onComplete: ({ summary, steps, finalAnswer }) => {
            notifyUi({ type: "task_completed", summary, steps, finalAnswer });
          },
          onError: ({ code, message: message2 }) => {
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
          localTabId = null;
          notifyUi({ type: "canonical_status", status: "completed" });
        }).catch((err) => {
          localAbortController = null;
          localTabId = null;
          notifyUi({ type: "canonical_error", code: "LOCAL_LOOP_THREW", message: err instanceof Error ? err.message : String(err) });
        });
        return { success: true };
      }
      case "cancel_local_task": {
        if (localAbortController === null) return { success: false, error: "No local task is running" };
        localAbortController.abort();
        localAbortController = null;
        if (localTabId !== null) {
          await detachFromTab(localTabId).catch(() => void 0);
          localTabId = null;
        }
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
          localTabId = null;
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
    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      throw new Error("Control-plane URL must use HTTPS");
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
  function notifyUi(event) {
    void chrome.runtime.sendMessage(event).catch(() => void 0);
  }
  void initialize();
})();
