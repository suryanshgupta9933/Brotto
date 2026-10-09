// Build HyperFrames compositions of the Brotto side panel.
//
// Nothing here draws the panel. The stylesheet, the markup and the card
// builders are the shipping files, copied in verbatim, so a GIF cannot show a
// panel that differs from the one users get. Same reasoning as
// scripts/*.test.js: a mockup is an absence nobody reviews.
//
// gsap.min.js is vendored rather than pulled from a CDN: the compositions run
// through a headless renderer, and a build that silently depends on the network
// is a build that can change under you. Vendoring only helps if something
// checks the copy, so build.mjs verifies it and refuses to emit on a mismatch —
// a digest in a comment is not a control.
//
//   node build.mjs            # all compositions
//   node build.mjs approval   # one
//
// Then: npx hyperframes render -c approval.html --format=gif

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "clients", "brotto-extension", "src");

// gsap 3.14.2, from https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js
const GSAP_SHA256 = "c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280";

const gsap = fs.readFileSync(path.join(HERE, "gsap.min.js"));
const got = crypto.createHash("sha256").update(gsap).digest("hex");
if (got !== GSAP_SHA256) {
  throw new Error(
    `gsap.min.js does not match the pinned gsap 3.14.2 copy.\n` +
    `  expected ${GSAP_SHA256}\n  got      ${got}\n` +
    `Refusing to emit compositions from a file that is not the one this was built against.`,
  );
}

const panelHtml = fs.readFileSync(path.join(SRC, "sidepanel.html"), "utf8");

const style = panelHtml.match(/<style>[\s\S]*?<\/style>/)[0];
const body = panelHtml.slice(
  panelHtml.indexOf("</head>") + 7,
  panelHtml.indexOf('<script src="model_catalog.js">')
);

const WIDTH = 400;
const HEIGHT = 760;
const DURATION = 6;

// The header pill names the model the agent is running. An id from the
// catalog's fallback list, so it is a name the panel could actually show.
// The pill is 104px and every Anthropic id is wider than its 88px window, so
// it would marquee for the whole loop; this one sits still.
const MODEL = "gpt-6.1-sol";

// The capture clock runs ahead of the GSAP timeline, so the settle is authored
// early and the card holds in its answered state for the back half of the loop.
const SETTLE_AT = 0.8;

// ── Scenes ──────────────────────────────────────────────────────────────────
// `story` is real panel code: it calls the shipping builders, in the browser,
// at load time. `spec` tells the director how that scene settles.
//
// The animation crossfades between two snapshots of the real markup instead of
// mutating the DOM mid-timeline, so frames can render in any order.

const SCENES = {
  approval: {
    spec: { card: ".approval-card", outcome: "approval-decision", text: "Approved" },
    story: `
      appendMessage({ role: "user", text: "Change my plan to the Team tier." });
      appendMessage({ role: "assistant", text: "I can do that — opening your billing page." });
      appendApprovalCard({
        id: 1,
        reason: "Brotto wants to open a site you have not visited in this task.",
        action: { type: "navigate", url: "https://billing.example.com/settings/plan" },
      });`,
  },

  clarify: {
    spec: { card: ".clarify-card", outcome: "clarify-answer", text: "You: 9:00 AM" },
    story: `
      appendMessage({ role: "user", text: "Move the launch announcement to Tuesday." });
      appendMessage({ role: "assistant", text: "Happy to. One thing before I move it." });
      appendClarifyCard({
        id: "q1",
        question: "Which time on Tuesday should it go out?",
        reason: "The launch holds a specific slot.",
      });`,
  },

  login: {
    spec: {},
    story: `
      appendMessage({ role: "user", text: "Email the launch note to the team list." });
      appendLoginCard({
        domain: "mail.google.com",
        url: "https://accounts.google.com/ServiceLogin",
        title: "Sign in — Google Accounts",
        task: "Send the launch note to eng-announce",
      });`,
  },
};

function settle(scene) {
  // Both cards settle through the panel's own code. The sign-in wall is not a
  // resolveCard call with a different selector — it has its own entry point,
  // and that is what drops the Continue button.
  const call = scene.spec.card
    ? `resolveCard(messages.querySelector(${JSON.stringify(scene.spec.card)}),
              ${JSON.stringify(scene.spec.outcome)},
              ${JSON.stringify(scene.spec.text)});`
    : `clearLoginPrompt();`;

  return `function settle(messages) {
  const box = document.createElement("div");
  box.innerHTML = messages.innerHTML;
  messages.replaceChildren(...box.childNodes);
  ${call}
  return messages.innerHTML;
}`;
}

function director(scene, id) {
  return `
(function () {
  // Panel chrome, driven through the panel's own setters so the frame is what
  // a connected, running panel looks like — not a mock of it.
  setModelPill(${JSON.stringify(MODEL)});
  setConnPill("connected", "Connected");
  state.stepCount = 4;
  updateStepCount();
  state.lastContext = { tokens: 380000, window: 1000000, pct: 38 };
  updateContextUsage();
  setOutcome("running");
  // renderElapsed is driven by Date.now(), which a composition may not use, and
  // its format is seconds with a decimal — four steps at ~30s each. Written the
  // way renderElapsed would have written it, so the frame is not a format the
  // panel cannot produce.
  document.getElementById("timerActive").textContent = "118.4s";
  document.getElementById("statusBar").classList.add("active");

  const messages = document.getElementById("messages");
  messages.innerHTML = "";
${scene.story}

  const before = messages.innerHTML;
  const after = settle(messages);
  messages.innerHTML = "";

  const layer = (html) => {
    const el = document.createElement("div");
    el.className = "scene";
    el.innerHTML = html;
    messages.appendChild(el);
    return el;
  };
  const a = layer(before);
  const b = layer(after);
  b.style.opacity = "0";

  const tl = gsap.timeline({ paused: true });
  tl.fromTo(a, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0.1);
  // A real crossfade: the unanswered state has to leave as the answered one
  // arrives. Fading b in alone leaves a opaque over it for the rest of the loop.
  tl.to(a, { opacity: 0, duration: 0.3 }, ${SETTLE_AT});
  tl.to(b, { opacity: 1, duration: 0.3 }, ${SETTLE_AT});
  tl.to([a, b], { opacity: 0, duration: 0.4 }, ${DURATION - 0.5});
  window.__timelines = window.__timelines || {};
  window.__timelines[${JSON.stringify(id)}] = tl;
  tl.seek(0);
})();`;
}

// ── Emit ────────────────────────────────────────────────────────────────────

const only = process.argv[2];

for (const [id, scene] of Object.entries(SCENES)) {
  if (only && only !== id) continue;

  // The composition sits beside the copies it loads. A directory down, every
  // relative src in the panel markup resolves to nothing.
  for (const file of ["sidepanel.js", "model_catalog.js", "panel-tokens.css"]) {
    fs.copyFileSync(path.join(SRC, file), path.join(HERE, file));
  }
  fs.cpSync(path.join(SRC, "assets"), path.join(HERE, "assets"), { recursive: true });

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="gsap.min.js"></script>
    <link rel="stylesheet" href="panel-tokens.css" />
${style.replace("</style>", `
    /* The composition frame. The panel sizes itself from its host, and the
       host is the frame. */
    html, body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      max-width: none;
    }
    #messages { position: relative; }

    /* The two states are stacked in one grid cell rather than positioned with
       z-index, so which one paints on top is decided by the grid and not by
       the order inline styles happen to land in. */
    #messages { display: grid; }
    .scene { grid-area: 1 / 1; }

    /* The sign-in badge pulses forever, which keeps the renderer treating the
       page as live and costs frames for a 1.6s loop nobody reads at GIF speed.
       This is the rule the panel's own reduced-motion block already applies. */
    .login-required-badge::before { animation: none; }

    /* Same for the model pill's marquee. fitModelPill measures once the webfont
       has loaded, so the very first frames are captured with the fallback face
       measuring wide — .marquee on, name travelling. It settles within a frame
       and the loop would show a name mid-scroll for its first half-second.

       The second copy is the one the marquee hands off to, and it is
       aria-hidden for that reason alone. With the travel stopped it just shows
       as a clipped stub of the name past the pill's edge. */
    .marquee .model-pill-track { animation: none; }
    .model-pill-track > span[aria-hidden="true"] { display: none; }

    /* The grain overlay is the one deliberate departure from the panel. Its 1.5%
       noise is invisible at GIF scale and costs roughly 4× the file size: the
       dithering re-quantises differently on every frame, so nothing matches the
       previous frame. Everything else here is the shipping CSS. */
    .grain { display: none; }
  </style>`)}
  </head>
${body.replace(
    "<body>",
    `<body data-composition-id="${id}" data-start="0" data-duration="${DURATION}" data-width="${WIDTH}" data-height="${HEIGHT}">`
  )}
  <script src="chrome-stub.js"></script>
  <script src="model_catalog.js"></script>
  <script src="sidepanel.js"></script>
  <script>
${settle(scene)}
${director(scene, id)}
  </script>
</html>
`;

  fs.writeFileSync(path.join(HERE, `${id}.html`), html);
  console.log(`wrote ${id}.html`);
}