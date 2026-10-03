import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Fonts } from "./Fonts";
import { AxRow, Kicker, Rule, enter } from "./atoms";
import { FONT_MONO, FONT_UI, ink } from "./tokens";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A real screenshot of the panel, in a hairline frame. No shadow — see tokens. */
const PanelShot: React.FC<{ src: string; h: number }> = ({ src, h }) => (
  <div style={{ height: h, border: `1px solid ${ink.rule2}`, background: ink.paper, overflow: "hidden" }}>
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
  </div>
);

const Headline: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({
  children,
  size = 66,
  style,
}) => (
  <div
    style={{
      fontSize: size,
      fontWeight: 600,
      lineHeight: 1.12,
      letterSpacing: "-0.02em",
      color: ink.ink,
      ...style,
    }}
  >
    {children}
  </div>
);

// ── 1. title ──────────────────────────────────────────────────────────────────
const Title: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...enter(f, 8, 22), textAlign: "center" }}>
        <Img src={staticFile("logo.svg")} style={{ width: 96, height: 96 }} />
        <div style={{ fontSize: 104, fontWeight: 700, letterSpacing: "-0.035em", marginTop: 22 }}>
          Brotto
        </div>
        <div style={{ marginTop: 30, fontSize: 38, color: ink.ink2, fontWeight: 400 }}>
          Ask an AI to do a task in the browser you&rsquo;re already signed in to.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 2. the problem: a cloud browser you never logged into ─────────────────────
const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const lock = enter(f, 70, 20);
  return (
    <AbsoluteFill style={{ padding: "0 130px", flexDirection: "row", gap: 80, alignItems: "center" }}>
      {/* The column is 1000 wide because the longest headline line is
          "a browser you've never logged into." — 33 glyphs at 56px, which is
          ~960. At the old 62px it overflowed and wrapped to a third line. */}
      <div style={{ width: 1000, flexShrink: 0 }}>
        <div style={enter(f, 0, 18)}>
          <Kicker>The problem</Kicker>
        </div>
        <Headline size={56} style={{ marginTop: 26, ...enter(f, 8, 20) }}>
          Most browser agents run in
          <br />a browser you&rsquo;ve never logged into.
        </Headline>
        <div style={{ marginTop: 40, ...enter(f, 150, 20) }}>
          {[
            "Reads the page as a screenshot",
            "Burns context per pixel",
            "Guesses which rectangle is a button",
          ].map((line, i) => (
            <div key={line} style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 18, ...enter(f, 150 + i * 14, 16) }}>
              <span style={{ color: ink.bad, fontSize: 30, lineHeight: 1 }}>✕</span>
              <span style={{ fontSize: 29, color: ink.ink2, textDecoration: "line-through", textDecorationColor: ink.rule2 }}>
                {line}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, ...enter(f, 40, 22) }}>
        <div style={{ border: `1px solid ${ink.rule2}`, background: ink.paper, height: 620, position: "relative", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 22px", borderBottom: `1px solid ${ink.rule}`, background: ink.paper }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 20, color: ink.ink2 }}>mail.google.com</span>
          </div>
          <div style={{ padding: 40 }}>
            {[420, 300, 500, 240, 360].map((w, i) => (
              <div key={i} style={{ height: 22, width: w, background: ink.paper3, marginTop: i === 0 ? 0 : 22 }} />
            ))}
          </div>
          {/* A centred card, not a full-bleed scrim. The scrim was
              rgba(255,255,255,0.94) over #EBEBEB bars on #F5F5F5 — which
              flattened to one shade and erased the page entirely, so the
              mock read as an empty box rather than a page it cannot get in. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...lock,
            }}
          >
            <div style={{ width: 440, background: ink.paper, border: `2px solid ${ink.bad}`, padding: "38px 44px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              {/* Square corners throughout, so the shackle has to be drawn:
                  an arch of 36x38 sitting on a 72x42 body, both sharing a
                  centre line at x=44. At the earlier 24px it read as a notch. */}
              <div style={{ width: 88, height: 88, position: "relative" }}>
                <div style={{ position: "absolute", top: 8, left: 26, width: 36, height: 38, border: `3px solid ${ink.bad}`, borderBottom: "none", boxSizing: "border-box" }} />
                <div style={{ position: "absolute", top: 46, left: 8, width: 72, height: 42, border: `3px solid ${ink.bad}`, boxSizing: "border-box" }} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 600, color: ink.ink, marginTop: 10 }}>Not signed in</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 21, color: ink.ink3 }}>2fa required · try again</div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 3. the two bets ───────────────────────────────────────────────────────────
const AX: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const rows = [
    { role: "heading", name: "Primary", ref: "[0:1]" },
    { role: "link", name: "Promotions", ref: "[0:88]" },
    { role: "textbox", name: "Search mail", ref: "[0:412]" },
    { role: "button", name: "Compose", ref: "[0:417]" },
    { role: "combobox", name: "Labels", ref: "[0:502]" },
  ];
  return (
    <div style={{ border: `1px solid ${ink.rule2}`, background: ink.paper, padding: "34px 38px" }}>
      <div style={enter(f, at, 16)}>
        <Kicker color={ink.ink2}>Accessibility.getFullAXTree</Kicker>
      </div>
      <Rule style={{ margin: "18px 0 22px" }} />
      {rows.map((r, i) => (
        <div key={r.role} style={{ marginTop: i === 0 ? 0 : 14, ...enter(f, at + i * 10, 14) }}>
          <AxRow depth={0} {...r} />
        </div>
      ))}
    </div>
  );
};

const Bet: React.FC = () => {
  const f = useCurrentFrame();
  // The screenshot lands at 200; the tree replaces it at 300 as the payoff.
  const treeIn = interpolate(f, [300, 320], [0, 1], clamp);
  const shotOut = interpolate(f, [292, 312], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ padding: "0 140px", flexDirection: "row", gap: 90, alignItems: "center" }}>
      <div style={{ width: 820, flexShrink: 0 }}>
        <div style={enter(f, 0, 18)}>
          <Kicker>What it does instead</Kicker>
        </div>
        <Headline size={56} style={{ marginTop: 26, ...enter(f, 8, 20) }}>
          It drives your tab.
        </Headline>
        <div style={{ fontSize: 30, color: ink.ink2, marginTop: 20, ...enter(f, 30, 20) }}>
          Your cookies, your MFA, your SSO. There is nothing to log in to.
        </div>
        <Rule style={{ margin: "44px 0 40px" }} />
        <Headline size={56} style={enter(f, 120, 20)}>
          It reads the accessibility tree,
          <br />
          not pixels.
        </Headline>
        <div style={{ fontSize: 30, color: ink.ink2, marginTop: 20, ...enter(f, 150, 20) }}>
          The structure a screen reader already navigates by. Roles, labels, values, stable refs.
        </div>
      </div>

      <div style={{ flex: 1, height: 880, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", opacity: shotOut }}>
          <div style={{ ...enter(f, 196, 24) }}>
            <PanelShot src="panel-task-completion.webp" h={860} />
          </div>
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", opacity: treeIn, transform: `translateY(${interpolate(f, [300, 322], [24, 0], clamp)}px)` }}>
          <div style={{ width: "100%" }}>
            <AX at={320} />
            <div style={{ marginTop: 34, fontSize: 27, color: ink.ink2, ...enter(f, 392, 18) }}>
              No vision model. No image tokens. It works on what the web already publishes.
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 4. what it does, in three real panels ─────────────────────────────────────
const Does: React.FC = () => {
  const f = useCurrentFrame();
  const shots = [
    { src: "panel-idle.webp", kicker: "Idle", head: "Ask it anything about this page.", cap: "The panel offers what the page in front of you could be asked to do." },
    { src: "panel-task-completion.webp", kicker: "Working", head: "It works in your session.", cap: "A real run over a real inbox, with a plan and the result." },
    { src: "panel-session-history.webp", kicker: "History", head: "Nothing is kept you can’t see.", cap: "Every run, on your own disk, yours to delete." },
  ];
  const HOLD = 108;
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={shots.length * HOLD}>
        {shots.map((s, i) => {
          const local = f - i * HOLD;
          const vis = interpolate(local, [-1, 0, HOLD, HOLD + 1], [0, 1, 1, 0], clamp);
          if (vis === 0) return null;
          return (
            <AbsoluteFill key={s.src} style={{ opacity: vis, flexDirection: "row", gap: 90, alignItems: "center", padding: "0 140px" }}>
              <div style={{ width: 760, flexShrink: 0 }}>
                <div style={enter(local, 6, 16)}>
                  <Kicker>{s.kicker}</Kicker>
                </div>
                <Headline size={54} style={{ marginTop: 26, ...enter(local, 14, 18) }}>
                  {s.head}
                </Headline>
                <div style={{ fontSize: 29, color: ink.ink2, marginTop: 24, ...enter(local, 26, 18) }}>
                  {s.cap}
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <div style={enter(local, 10, 20)}>
                  <PanelShot src={s.src} h={860} />
                </div>
              </div>
            </AbsoluteFill>
          );
        })}
      </Sequence>
    </AbsoluteFill>
  );
};

// ── 5. it asks first ──────────────────────────────────────────────────────────
const Asks: React.FC = () => {
  const f = useCurrentFrame();
  const lines = [
    "I’m about to send this email to 3 recipients.",
    "To: dana@…, raj@…, priya@…",
    "Subject: Invoice #2291 — March",
  ];
  return (
    <AbsoluteFill style={{ padding: "0 140px", flexDirection: "row", gap: 90, alignItems: "center" }}>
      <div style={{ width: 760, flexShrink: 0 }}>
        <div style={enter(f, 0, 18)}>
          <Kicker>Approval required</Kicker>
        </div>
        <Headline size={58} style={{ marginTop: 26, ...enter(f, 8, 20) }}>
          It asks before the risky parts.
        </Headline>
        <div style={{ fontSize: 30, color: ink.ink2, marginTop: 28, ...enter(f, 24, 20) }}>
          Before it sends an email, takes a payment, deletes something, publishes, or changes a
          password &mdash; and before it acts on a site for the first time.
        </div>
        <div style={{ marginTop: 44, ...enter(f, 60, 20) }}>
          <Rule w={64} color={ink.ink} style={{ marginBottom: 20 }} />
          <div style={{ fontSize: 32, fontWeight: 600 }}>There is no setting that turns this off.</div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={{ width: 560, border: `2px solid ${ink.ink}`, background: ink.paper, padding: 40, ...enter(f, 40, 24) }}>
          <Kicker>Confirm this action</Kicker>
          <div style={{ marginTop: 24, fontSize: 29, lineHeight: 1.45, color: ink.ink }}>
            {lines.map((l, i) => (
              <div key={i} style={{ ...enter(f, 70 + i * 12, 14), color: i === 0 ? ink.ink : ink.ink2, fontSize: i === 0 ? 29 : 24 }}>
                {l}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 36, ...enter(f, 130, 16) }}>
            <div style={{ padding: "16px 30px", border: `2px solid ${ink.ink}`, fontSize: 26, fontWeight: 600, background: ink.paper }}>
              Send
            </div>
            <div style={{ padding: "16px 30px", border: `1px solid ${ink.rule2}`, fontSize: 26, color: ink.ink2 }}>
              Edit
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 6. self-host ──────────────────────────────────────────────────────────────
const SelfHost: React.FC = () => {
  const f = useCurrentFrame();
  const cmds = ["git clone https://github.com/suryanshgupta9933/brotto.git", "cd brotto", "cp .env.example .env", "docker compose up -d"];
  return (
    <AbsoluteFill style={{ padding: "0 200px", flexDirection: "column", justifyContent: "center" }}>
      <div style={enter(f, 0, 18)}>
        <Kicker>Self-host</Kicker>
      </div>
      <Headline size={58} style={{ marginTop: 26, ...enter(f, 8, 20) }}>
        One container. One extension.
      </Headline>
      <div style={{ fontSize: 30, color: ink.ink2, marginTop: 22, ...enter(f, 20, 20) }}>
        There is no Brotto account and no Brotto server. The agent loop runs on a box you chose.
      </div>
      <div style={{ border: `1px solid ${ink.rule2}`, background: ink.paper2, marginTop: 48, padding: "38px 44px", minHeight: 318, ...enter(f, 40, 22) }}>
        {cmds.map((c, i) => {
          const at = 60 + i * 26;
          const shown = c.slice(0, Math.max(0, Math.min(c.length, (f - at) * 2)));
          return (
            <div key={c} style={{ fontFamily: FONT_MONO, fontSize: 28, color: ink.ink, marginTop: i === 0 ? 0 : 16, opacity: f > at ? 1 : 0 }}>
              <span style={{ color: ink.ink3, marginRight: 18 }}>$</span>
              {shown}
              {f > at + c.length / 2 && f < at + 34 ? <span style={{ color: ink.ink }}>▍</span> : null}
            </div>
          );
        })}
        <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px solid ${ink.rule}`, fontFamily: FONT_MONO, fontSize: 22, color: ink.ok, opacity: interpolate(f, [190, 210], [0, 1], clamp) }}>
          ✓ 510 MB image, no browser in it · listening on :8000
        </div>
      </div>
      <div style={{ fontSize: 27, color: ink.ink2, marginTop: 30, ...enter(f, 210, 20) }}>
        Session history, your blocklist and your remembered model stay on your own disk.
      </div>
    </AbsoluteFill>
  );
};

// ── 7. end card ───────────────────────────────────────────────────────────────
const End: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...enter(f, 4, 20), textAlign: "center" }}>
        <Img src={staticFile("logo.svg")} style={{ width: 84, height: 84 }} />
        <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 20 }}>Brotto</div>
        <Rule w={80} color={ink.ink} style={{ margin: "28px auto" }} />
        <div style={{ fontFamily: FONT_MONO, fontSize: 26, color: ink.ink2, letterSpacing: "0.06em" }}>
          github.com/suryanshgupta9933/brotto
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 20, color: ink.ink3, letterSpacing: "0.14em", marginTop: 20, textTransform: "uppercase" }}>
          Apache 2.0 · bring your own key
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── composition ───────────────────────────────────────────────────────────────
// Each scene is sized to its own content, not to a round number. Bet needed
// 420 and SelfHost 265: both were shorter than their last `enter()`, so the AX
// rows were still staggering and the payoff line had not fired when the scene
// cut. A hard cut mid-animation reads as a missing feature, not a fast edit.
const S = {
  title: [0, 150],
  problem: [150, 430],
  bet: [430, 850],
  does: [850, 1174],
  asks: [1174, 1390],
  selfHost: [1390, 1655],
  end: [1655, 1715],
} as const;

export const Brotto: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: ink.paper, fontFamily: FONT_UI, color: ink.ink }}>
      <Fonts />
      <Sequence from={S.title[0]} durationInFrames={S.title[1] - S.title[0]}>
        <Title />
      </Sequence>
      <Sequence from={S.problem[0]} durationInFrames={S.problem[1] - S.problem[0]}>
        <Problem />
      </Sequence>
      <Sequence from={S.bet[0]} durationInFrames={S.bet[1] - S.bet[0]}>
        <Bet />
      </Sequence>
      <Sequence from={S.does[0]} durationInFrames={S.does[1] - S.does[0]}>
        <Does />
      </Sequence>
      <Sequence from={S.asks[0]} durationInFrames={S.asks[1] - S.asks[0]}>
        <Asks />
      </Sequence>
      <Sequence from={S.selfHost[0]} durationInFrames={S.selfHost[1] - S.selfHost[0]}>
        <SelfHost />
      </Sequence>
      <Sequence from={S.end[0]} durationInFrames={S.end[1] - S.end[0]}>
        <End />
      </Sequence>
    </AbsoluteFill>
  );
};
