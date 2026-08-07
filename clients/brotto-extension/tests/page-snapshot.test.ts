// ponytail: regression tests for the page-context snapshot script
// (collectPageSnapshot in observation.ts). Runs the actual script
// against a jsdom with GitHub-like DOM and asserts:
//
//   1. pageIdentity correctly differentiates two pages with different
//      content (catches the slice E regression where name was only
//      aria-label/title, leaving identical pageIdentity for any
//      content-only change).
//   2. siblingRoleIndex counts siblings correctly (catches the
//      single-pass refactor regression where n was always 0).
//   3. The same page produces the same pageIdentity across two
//      captures (stability invariant for the stagnation detector).
//   4. After a navigation (DOM mutation), the second capture
//      succeeds and produces a different pageIdentity.

import { readFileSync } from "node:fs";
import { join } from "node:path";
// ponytail: import jsdom from the workspace root's node_modules so
// the test doesn't need to add it as a direct dependency.
// @ts-ignore — jsdom has no @types/jsdom at this resolution path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { JSDOM } from "../../../node_modules/.pnpm/jsdom@24.1.3_supports-color@8.1.1/node_modules/jsdom/lib/api.js";
// ponytail: TypeScript transpile to strip type annotations from the
// page-context script body. We can't `import` the function directly
// because it's a private closure inside observation.ts that runs as
// a string via Runtime.evaluate. Instead, we extract its body and
// transpile it with the workspace's TypeScript.
// @ts-ignore — typescript module is reached via a deep pnpm path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ts from "../../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js";

const SRC = join(__dirname, "..", "src", "canonical", "observation.ts");
const SRC_TEXT = readFileSync(SRC, "utf8");

function extractBody(): string {
  const start = SRC_TEXT.indexOf("function collectPageSnapshot(");
  let depth = 0;
  let j = SRC_TEXT.indexOf("{", start);
  const openPos = j;
  for (; j < SRC_TEXT.length; j++) {
    if (SRC_TEXT[j] === "{") depth += 1;
    else if (SRC_TEXT[j] === "}") { depth -= 1; if (depth === 0) break; }
  }
  return SRC_TEXT.slice(openPos + 1, j);
}

const COMPILED_BODY = ts.transpileModule(extractBody(), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, strict: false, removeComments: true },
}).outputText.replace(/^"use strict";?\s*"|"use strict";?\s*$/g, "");

function buildRunner(window: any): () => any {
  let elemIdx = 0;
  for (const el of window.document.querySelectorAll("*")) {
    el.getBoundingClientRect = () => ({
      x: 10, y: 10 + elemIdx * 20, width: 100, height: 20,
      top: 10 + elemIdx * 20, bottom: 30 + elemIdx * 20, left: 10, right: 110, toJSON() {},
    });
    elemIdx += 1;
  }
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el: Element) => {
    const cs = originalGetComputedStyle(el);
    return new Proxy(cs, {
      get(target, prop) {
        if (prop === "display") return "block";
        if (prop === "visibility") return "visible";
        if (prop === "opacity") return "1";
        return target[prop];
      },
    });
  };
  const inner = `
    const document = arguments[0]; const window = arguments[1]; const Node = window.Node; const NodeFilter = window.NodeFilter;
    const location = window.location; const performance = window.performance;
    const innerWidth = window.innerWidth; const innerHeight = window.innerHeight;
    const devicePixelRatio = 1; const scrollX = 0; const scrollY = 0;
    const getComputedStyle = window.getComputedStyle.bind(window);
    return (function(maxCandidates, maxDomElements, maxSensitiveRegions) { ${COMPILED_BODY} })(200, 15000, 200);
  `;
  return () => new Function(inner)(window.document, window);
}

describe("page-context snapshot (regression)", () => {
  it("differentiates pages by content (not just aria-label)", () => {
    const htmlA = `<!DOCTYPE html><html><body><nav><a href="/x">Sign up</a></nav></body></html>`;
    const htmlB = `<!DOCTYPE html><html><body><nav><a href="/x">Register</a></nav></body></html>`;
    const a = new JSDOM(htmlA, { url: "https://x/" });
    const b = new JSDOM(htmlB, { url: "https://x/" });
    const obsA = buildRunner(a.window)();
    const obsB = buildRunner(b.window)();
    expect(obsA.pageIdentity).not.toBe(obsB.pageIdentity);
  });

  it("counts siblingRoleIndex correctly", () => {
    const html = `<!DOCTYPE html><html><body><nav><a href="/1">One</a><a href="/2">Two</a><a href="/3">Three</a></nav></body></html>`;
    const dom = new JSDOM(html, { url: "https://x/" });
    const obs = buildRunner(dom.window)();
    // ponytail: the three <a>s in <nav> should have indices 0, 1, 2 in
    // the pathFor result. The previous regression had every index = 0.
    const links = obs.links;
    expect(links.map((l: any) => l.text)).toEqual(["One", "Two", "Three"]);
    const indices = links.map((l: any) => l.axPath[l.axPath.length - 1].index);
    expect(indices).toEqual([0, 1, 2]);
  });

  it("produces stable pageIdentity across two captures of the same page", () => {
    const html = `<!DOCTYPE html><html><body><nav><a>One</a><a>Two</a></nav></body></html>`;
    const dom = new JSDOM(html, { url: "https://x/" });
    const run = buildRunner(dom.window);
    expect(run().pageIdentity).toBe(run().pageIdentity);
  });

  it("captures successfully after navigation and reports the new page", () => {
    const htmlA = `<!DOCTYPE html><html><body><nav><a>Sign in</a></nav><main><h1>Sign in</h1></main></body></html>`;
    const dom = new JSDOM(htmlA, { url: "https://github.com/login" });
    const obs1 = buildRunner(dom.window)();
    expect(obs1.pagePurpose).toBe("Sign in");
    expect(obs1.url).toBe("https://github.com/login");

    // ponytail: simulate a navigation by rewriting the DOM in place.
    dom.window.document.body.innerHTML =
      "<nav><a href='/logout'>Sign out</a></nav>" +
      "<main><h1>Your repositories</h1><a href='/r1'>repo1</a><a href='/r2'>repo2</a></main>";
    dom.window.document.title = "suryanshgupta9933";
    dom.window.history.replaceState({}, "", "/suryanshgupta9933");

    const obs2 = buildRunner(dom.window)();
    expect(obs2.pagePurpose).toBe("Your repositories");
    expect(obs2.url).toBe("https://github.com/suryanshgupta9933");
    expect(obs2.pageIdentity).not.toBe(obs1.pageIdentity);
    expect(obs2.links.length).toBe(3); // Sign out + repo1 + repo2
  });
});
