import { Fragment } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fonts } from "./Fonts";
import { EASE, Kicker, enter } from "./atoms";
import { AX_TREE } from "./seq";
import { Outro, PANEL_X, Shot, TYPE_X, clamp } from "./stage";
import { FONT_MONO, ink } from "./tokens";

/* Draft2 — the accessibility tree.
 *
 * Draft1 argues from the panel: here is the thing, here is what it did. This
 * one argues from the other side, from the lines the model actually receives.
 * The moat is not "it has a nice UI", it is that every control on a page is an
 * addressable node with a stable ref — so a click lands on the button rather
 * than on whatever was near that coordinate when the screenshot was taken.
 *
 * Every line in the tree is read off the real panel over CDP by
 * `tools/panel_shot.py`, in the same 2x pixel space the composition draws, so
 * the ref and the rectangle it lights are the same node. A tree typed by hand
 * would be a drawing of the product.
 *
 * The layout is deliberately not `Beat`. That one spends its left column on a
 * headline and reserves 280px of gutter for a callout label; this cut spends
 * the whole column on the tree, and the panel keeps the right-hand slot so the
 * two line up. Same geometry constants, different claim.
 */

const COL_W = PANEL_X - TYPE_X - 48;
const LINE = 34;
const TREE_TOP = 470;

/** One tree line, as the model sees it. The ref is coloured because the ref is
 *  the whole argument: it is what makes the line an address rather than a
 *  caption. */
const Row: React.FC<{ line: string; on: number; dim?: boolean }> = ({ line, on, dim }) => (
  <div
    style={{
      fontFamily: FONT_MONO,
      fontSize: 23,
      lineHeight: `${LINE}px`,
      height: LINE,
      whiteSpace: "pre",
      color: on ? ink.paper : dim ? ink.rule2 : ink.ink,
      background: on ? ink.ink : "transparent",
      paddingLeft: on ? 10 : 0,
    }}
  >
    {line}
  </div>
);

/** The tree beside the panel, with one line lit and the element it names lit
 *  with it. A 2px outline rather than a filled box, in the same weight as the
 *  leader lines in the other cut: a panel that is already a stack of boxes does
 *  not need a second one drawn round the thing being pointed at. */
const Tree: React.FC<{ at: number; active: number }> = ({ at, active }) => {
  const lit = AX_TREE[active]?.box ?? null;
  const glow = interpolate(at, [0, 6], [0, 1], { ...clamp, easing: EASE });
  return (
    <>
      {/* The tree lands whole, because that is what the model gets: one
          observation, all of it, not a line at a time. */}
      <div
        style={{
          position: "absolute",
          left: TYPE_X,
          top: TREE_TOP,
          width: COL_W,
          opacity: interpolate(at, [2, 16], [0, 1], { ...clamp, easing: EASE }),
        }}
      >
        {AX_TREE.map((n, i) => (
          <Row key={n.ref} line={n.line} on={i === active ? glow : 0} dim={i > active} />
        ))}
      </div>
      {lit ? (
        <>
          <div
            style={{
              position: "absolute",
              left: PANEL_X + lit.x - 10,
              top: lit.y - 6,
              width: lit.w + 20,
              height: lit.h + 12,
              border: `2px solid ${ink.ink}`,
              opacity: glow,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: TYPE_X + COL_W,
              top: lit.y + lit.h / 2,
              width: PANEL_X - TYPE_X - COL_W,
              height: 2,
              background: ink.ink,
              opacity: glow,
            }}
          />
        </>
      ) : null}
    </>
  );
};

/** A line the product wrote to the audit, verbatim. Both strings are the real
 *  ones from `cdp/extension_relay.py` — `Clicked [ref]` and the `Error
 *  executing: ref … is not in the current AX tree` refusal. A paraphrase here
 *  would undercut the only claim this cut makes. */
const Audit: React.FC<{ at: number; lines: string[]; tone: "ok" | "bad"; from: number }> = ({
  at,
  lines,
  tone,
  from,
}) => (
  <div
    style={{
      position: "absolute",
      left: TYPE_X,
      top: TREE_TOP + AX_TREE.length * LINE + 54,
      fontFamily: FONT_MONO,
      fontSize: 23,
      lineHeight: "38px",
      color: tone === "ok" ? ink.ok : ink.bad,
      ...enter(at, from, 14),
    }}
  >
    {lines.map((l) => (
      <div key={l}>{l}</div>
    ))}
  </div>
);

const Split: React.FC<{
  kicker: string;
  head: React.ReactNode;
  cap?: string;
  panel?: React.ReactNode;
  tree?: React.ReactNode;
}> = ({ kicker, head, cap, panel, tree }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      {panel}
      {tree}
      <div style={{ position: "absolute", left: TYPE_X, top: 130, width: COL_W }}>
        <div style={enter(f, 2)}>
          <Kicker>{kicker}</Kicker>
        </div>
        <div style={{ fontSize: 62, lineHeight: 1.06, letterSpacing: "-0.03em", marginTop: 22, ...enter(f, 8, 20) }}>
          {head}
        </div>
        {cap ? (
          <div
            style={{
              fontSize: 26,
              color: ink.ink2,
              marginTop: 24,
              lineHeight: 1.42,
              ...enter(f, 22, 20),
            }}
          >
            {cap}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/* --- scenes ---------------------------------------------------------------- */

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const three = [AX_TREE[0], AX_TREE[9], AX_TREE[12]];
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: TYPE_X, top: 210, width: COL_W + 200 }}>
        <div style={enter(f, 2)}>
          <Kicker>How it reads</Kicker>
        </div>
        <div
          style={{
            fontSize: 92,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            marginTop: 26,
            ...enter(f, 8, 20),
          }}
        >
          It doesn&rsquo;t see the page.
        </div>
        <div
          style={{
            fontSize: 92,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            marginTop: 12,
            color: ink.ink3,
            ...enter(f, 26, 20),
          }}
        >
          It sees this.
        </div>
      </div>
      <div style={{ position: "absolute", left: TYPE_X, top: TREE_TOP + 60, width: COL_W }}>
        {three.map((n, i) => (
          <div
            key={n.ref}
            style={{
              ...enter(f, 44 + i * 9, 14),
              fontFamily: FONT_MONO,
              fontSize: 30,
              lineHeight: "58px",
              color: i === 2 ? ink.ink2 : ink.ink,
            }}
          >
            {n.line.trim()}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Read: React.FC = () => {
  const f = useCurrentFrame();
  // The tree arrives all at once, then the model walks it. Nine frames a line is
  // slower than it needs to be for thirteen lines and slower than a viewer can
  // comfortably read a ref; the walk exists to show the correspondence, not to
  // be transcribed.
  const lead = 34;
  const active = Math.min(AX_TREE.length - 1, Math.floor((f - lead) / 9));
  return (
    <Split
      kicker="Reads"
      head={<>Every control is a line with a ref.</>}
      cap="The ref is the model's handle on a real element. A screenshot would only tell it where something looked like it was."
      panel={<Shot src="shots/panel-plan.png" over={150} />}
      tree={<Tree at={f} active={active} />}
    />
  );
};

const Act: React.FC = () => {
  const f = useCurrentFrame();
  // The approve line is index 9 in the captured tree — index, not a hard-coded
  // ref, because the ids are whatever Chromium assigns on the day and a pinned
  // `[0:98]` would quietly point at nothing after a panel change.
  const at = 16;
  return (
    <Split
      kicker="Acts"
      head={<>A ref clicks the button.</>}
      cap="Not a pixel near it. The line names an element the run can resolve, and resolution is recorded either way."
      panel={<Shot src="shots/panel-plan.png" over={120} />}
      tree={
        <>
          <Tree at={f} active={9} />
          <Audit at={f} from={at + 30} tone="ok" lines={[`Clicked [${AX_TREE[9].ref.slice(1, -1)}]`]} />
        </>
      }
    />
  );
};

/** A stale ref against the same plan frame, so the comparison is honest: the
 *  panel behind it has not moved, and that is the whole point. */
const Fail: React.FC = () => {
  const f = useCurrentFrame();
  // A ref that is not in this observation. The panel is unchanged behind it,
  // which is the point: nothing on screen moved, so a coordinate-based agent
  // would have clicked something and reported a step.
  return (
    <Split
      kicker="Fails"
      head={<>A stale ref is a recorded failure.</>}
      cap="The run stops and says so. It never clicks the nearest plausible thing and calls it progress."
      panel={<Shot src="shots/panel-plan.png" over={110} />}
      tree={
        <>
          <div style={{ position: "absolute", left: TYPE_X, top: TREE_TOP, width: COL_W }}>
            {AX_TREE.map((n) => (
              <Row key={n.ref} line={n.line} on={0} dim />
            ))}
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 23,
                lineHeight: `${LINE}px`,
                height: LINE,
                whiteSpace: "pre",
                color: ink.bad,
                ...enter(f, 14, 10),
              }}
            >
              {'  [0:412] button "Continue"'}
            </div>
          </div>
          <Audit at={f} from={40} tone="bad" lines={["ok: false", "Error executing: ref '0:412' is not in the current AX tree"]} />
        </>
      }
    />
  );
};

const CUT = linearTiming({ durationInFrames: 8 });

const SCENES: [React.FC, number][] = [
  [Hook, 75],
  [Read, 150],
  [Act, 120],
  [Fail, 110],
  [Outro, 165],
];

export const DRAFT2_DURATION =
  SCENES.reduce((n, [, d]) => n + d, 0) -
  (SCENES.length - 1) * CUT.getDurationInFrames({ fps: 30 });

export const Draft2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: ink.paper, fontFamily: "Geist, sans-serif", color: ink.ink }}>
      <Fonts />
      <Audio
        src={staticFile("bed2.mp3")}
        volume={interpolate(frame, [0, 12, DRAFT2_DURATION - 18, DRAFT2_DURATION], [0, 0.32, 0.32, 0], clamp)}
      />
      {frame === 0 ? (
        <AbsoluteFill style={{ zIndex: 1 }}>
          <Img src={staticFile("draft2.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      ) : null}
      <TransitionSeries>
        {SCENES.map(([Scene, durationInFrames], i) => (
          <Fragment key={i}>
            {i > 0 ? <TransitionSeries.Transition presentation={fade()} timing={CUT} /> : null}
            <TransitionSeries.Sequence durationInFrames={durationInFrames} premountFor={fps}>
              <Scene />
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
