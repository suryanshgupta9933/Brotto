// The API key field must agree with what is actually in storage.
//
// This bug ate the user's key: three writers of `modelApiKey` live on three
// code paths (the panel's Save, the worker's `setStoredModelConfig`, the
// wizard), and each one that *removed* the key left the field showing
// KEY_MASK with nothing behind it. The field was then a lie about whether a
// key exists — and pressing Save hit the `typedKey === KEY_MASK` no-op branch,
// so the credential was never written and the user had no way back.
//
// The fix repaints the field by reading storage rather than by each writer
// announcing its own change, so this asserts the repaint itself: extracted
// from the shipping file, so it cannot drift from what ships.
//
//   node scripts/test-key-mask.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

function extract(name) {
  const start = sidepanel.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = sidepanel.indexOf("(", start); i < sidepanel.length; i++) {
    if (sidepanel[i] === "(") parens++;
    else if (sidepanel[i] === ")" && --parens === 0) { bodyStart = sidepanel.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < sidepanel.length; i++) {
    if (sidepanel[i] === "{") depth++;
    else if (sidepanel[i] === "}" && --depth === 0) return sidepanel.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function run(store, fieldValue) {
  const $modelKey = { value: fieldValue };
  const sandbox = {
    chrome: {
      storage: {
        local: {
          get: async (k) => (k in store ? { [k]: store[k] } : {}),
          set: async () => {},
          remove: async () => {},
        },
      },
    },
    KEY_MASK: "••••••••",
    $modelKey,
  };
  vm.createContext(sandbox);
  vm.runInContext(extract("repaintKeyField"), sandbox);
  return { sandbox, $modelKey };
}

(async () => {
  // A key is in storage: the field says so.
  {
    const { sandbox, $modelKey } = run({ modelApiKey: "sk-live-123" }, "");
    await sandbox.repaintKeyField();
    check("a stored key repaints as the mask",
      $modelKey.value === "••••••••", JSON.stringify($modelKey.value));
  }

  // The bug: storage is empty and the field still carries the mask. Nothing
  // downstream can tell these apart, which is why Save wrote nothing.
  {
    const { sandbox, $modelKey } = run({}, "••••••••");
    await sandbox.repaintKeyField();
    check("a key removed elsewhere clears a stale mask",
      $modelKey.value === "", JSON.stringify($modelKey.value));
    // And the consequence the user actually hit: an empty field is the
    // deliberate clear, so the next Save writes a removal rather than no-op.
    check("…which leaves Save on the removal branch, not the mask no-op",
      !$modelKey.value);
  }

  // A value the user is typing is a draft, not stale storage. Wiping it on
  // every settings open would eat a key mid-paste.
  {
    const { sandbox, $modelKey } = run({}, "sk-pasted");
    await sandbox.repaintKeyField();
    check("a typed draft is left alone",
      $modelKey.value === "sk-pasted", JSON.stringify($modelKey.value));
  }
  {
    const { sandbox, $modelKey } = run({ modelApiKey: "sk-live" }, "sk-pasted");
    await sandbox.repaintKeyField();
    check("…even when storage does hold a key",
      $modelKey.value === "sk-pasted", JSON.stringify($modelKey.value));
  }

  // The save path must call it, or the panel's own writer still leaves the lie.
  {
    const saveBlock = sidepanel.slice(
      sidepanel.search(String.raw`if \(\$modelSave\) \{`),
      sidepanel.search(String.raw`if \(\$modelSave\) \{`) + 4000);
    check("the Save handler repaints after writing",
      /repaintKeyField\(\)/.test(saveBlock));
  }

  // …and the settings-open path, which is the only way a wizard-side removal
  // can reach the panel (the wizard writes storage; the panel only reads it).
  {
    const openIdx = sidepanel.indexOf("settingsBtn.addEventListener('click'");
    check("opening Settings re-reads the key from storage",
      openIdx >= 0 && /repaintKeyField\(\)/.test(sidepanel.slice(openIdx, openIdx + 400)));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();