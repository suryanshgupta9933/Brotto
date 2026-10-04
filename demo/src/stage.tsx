import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { EASE, Kicker, enter } from "./atoms";
import { RUN, type Spot } from "./seq";
import { FONT_MONO, W, ink } from "./tokens";

/* The staging every short cut shares: a full-height panel hard against the right
 * edge and a type column to its left.
 *
 * It is one module because it is one pixel space. The shots are captured at 2x,
 * so the PNG is 840px wide; drawing it into an 840px slot is a 1:1 mapping that
 * stays sharp and lands the panel's own 11px body text at 11px on the 1920px
 * frame. At the panel's 420px CSS width it landed at five, which is why the
 * shots read as texture rather than as UI. `tools/panel_shot.py` measures the
 * callout anchors in that same 2x space, so a draft that copies these constants
 * gets them right and a draft that re-derives them does not. */

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const PANEL_W = 840;
export const PANEL_H = 1080;
export const PANEL_X = W - PANEL_W - 48;
export const TYPE_X = 96;
/* The last 280px is the gutter the callout label and its leader line live in.
 * 280, not a round 210: the longest label is "per-site consent", and 16 mono
 * uppercase characters at 21px with the letter-spacing below need 246px. At 150
 * usable it silently clipped to "per-site consent" minus its last letter, which
 * reads as a typo rather than as a layout fault. */
export const TYPE_W = PANEL_X - TYPE_X - 280;
export const GUTTER = 280;

/** The panel arriving. A 140px slide, not just a fade — an earlier cut moved
 *  between two identical framings, which is part of what read as static. */
const panelIn = (f: number) => ({
  opacity: interpolate(f, [0, 12], [0, 1], { ...clamp, easing: EASE }),
  transform: `translateX(${interpolate(f, [0, 26], [140, 0], { ...clamp, easing: EASE })}px)`,
});

/** The slow push that stops a still from reading as a still. Skipped on the
 *  sequence beat — those frames are already changing, and drifting the container
 *  as well makes a run look like it is sliding rather than running. */
const drift = (f: number, over: number) => ({
  scale: interpolate(f, [0, over], [1, 1.035], {
    ...clamp,
    easing: EASE,
    output: "perceptual-scale",
  }),
});

const shell = (f: number): React.CSSProperties => ({
  position: "absolute",
  left: PANEL_X,
  top: 0,
  width: PANEL_W,
  height: PANEL_H,
  border: `1px solid ${ink.rule2}`,
  background: ink.paper,
  overflow: "hidden",
  ...panelIn(f),
});

const fill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "top",
};

/** Both panel components read the frame themselves. They used to take it as an
 *  `at` prop and every call site passed the literal `0`, which `panelIn(0)`
 *  turns into `opacity: 0` — the panel was invisible for the whole cut and only
 *  the callouts drew. A prop a caller has to remember is a prop a caller gets
 *  wrong, and `opacity: 0` renders as "no screenshots at all", which is not a
 *  bug a still-frame skim catches. */
export const Shot: React.FC<{ src: string; over: number }> = ({ src, over }) => {
  const at = useCurrentFrame();
  return (
    <div style={shell(at)}>
      <Img src={staticFile(src)} style={{ ...fill, ...drift(at, over) }} />
    </div>
  );
};

/** The run, played. Crossfades between states, because a hard cut between two
 *  captured PNGs reads as a slideshow and the point of this beat is that the
 *  panel is doing something. */
export const RunPanel: React.FC = () => {
  const at = useCurrentFrame();
  let acc = 0;
  let i = 0;
  while (i < RUN.length - 1 && at >= acc + RUN[i].hold) {
    acc += RUN[i].hold;
    i++;
  }
  const into = at - acc;
  const cross = RUN[i].hold > 8 ? Math.min(4, into) : 0;
  const prev = cross > 0 ? RUN[i - 1] : null;
  return (
    <div style={shell(at)}>
      {prev ? (
        <Img src={staticFile(prev.src)} style={{ ...fill, opacity: 1 - cross / 4 }} />
      ) : null}
      <Img src={staticFile(RUN[i].src)} style={{ ...fill, opacity: prev ? cross / 4 : 1 }} />
    </div>
  );
};

/** A leader line running out of the panel to a label in the gutter. It used to
 *  end in a rectangle drawn around the card — a box, on top of a panel that is
 *  itself a stack of boxes, which is a second outline of something the viewer
 *  can already see. The line and the label are enough: they say *this row*.
 *
 *  The anchor is measured off the live panel by `tools/panel_shot.py`, so a
 *  panel that changes moves the label with it instead of leaving it pointing at
 *  the gap where a card used to be. The label is clamped to the frame: the
 *  history drawer's delete button sits 45px from the top, and an unclamped
 *  label drew off the edge. */
export const Callout: React.FC<{ spot: Spot; label: string; at: number; lead: number }> = ({
  spot,
  label,
  at,
  lead,
}) => {
  const t = interpolate(at, [lead, lead + 10], [0, 1], { ...clamp, easing: EASE });
  const left = PANEL_X + spot.x - 8;
  const midY = spot.y + spot.h / 2;
  const LEAD = 72;
  // The label is clamped to the panel's left edge. An anchor in the panel's
  // right half — the history drawer's delete-all button sits at x≈700 of 840 —
  // otherwise pushes a right-aligned label straight off the gutter and over the
  // panel it is annotating, which is text drawn on top of the thing it names.
  // The leader takes up the slack and runs to the element, so the long way
  // costs a rule and the short way costs correctness.
  const labelRight = Math.min(left - LEAD - 18, PANEL_X);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: labelRight,
          top: midY,
          width: left - labelRight,
          height: 2,
          background: ink.ink,
          transform: `scaleX(${t})`,
          transformOrigin: "left",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: labelRight - (GUTTER - 30),
          top: Math.max(6, Math.min(PANEL_H - 44, midY - 13)),
          width: GUTTER - 30,
          textAlign: "right",
          fontFamily: FONT_MONO,
          fontSize: 21,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: ink.ink,
          opacity: t,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </>
  );
};

/** A beat: the claim on the left, the evidence on the right. `callout` is
 *  optional because not every beat's evidence needs naming, and `extra` because
 *  one cut puts a block under the claim rather than a sentence. */
export const Beat: React.FC<{
  kicker: string;
  head: React.ReactNode;
  cap?: string;
  panel: React.ReactNode;
  callout?: { spot: string; label: string; lead: number };
  spot?: Spot;
  extra?: React.ReactNode;
}> = ({ kicker, head, cap, panel, callout, spot, extra }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      {panel}
      {spot ? <Callout spot={spot} label={callout?.label ?? ""} at={f} lead={callout?.lead ?? 0} /> : null}
      <div
        style={{
          position: "absolute",
          left: TYPE_X,
          top: 0,
          width: TYPE_W,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={enter(f, 2)}>
          <Kicker>{kicker}</Kicker>
        </div>
        <div
          style={{
            fontSize: 86,
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
            marginTop: 30,
            ...enter(f, 10, 20),
          }}
        >
          {head}
        </div>
        {cap ? (
          <div
            style={{
              fontSize: 31,
              color: ink.ink2,
              marginTop: 30,
              lineHeight: 1.42,
              maxWidth: TYPE_W - 70,
              ...enter(f, 24, 20),
            }}
          >
            {cap}
          </div>
        ) : null}
        {/* The rule that ties the two columns together, drawn from the left. */}
        <div
          style={{
            marginTop: 44,
            height: 3,
            background: ink.ink,
            transformOrigin: "left",
            transform: `scaleX(${interpolate(f, [34, 64], [0, 1], { ...clamp, easing: EASE })})`,
          }}
        />
        {extra ? <div style={{ marginTop: 34, ...enter(f, 40, 20) }}>{extra}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

/** The outro every short cut ends on: what it is, then how to get it. */
export const Outro: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${TYPE_X}px` }}>
      <div style={enter(f, 4, 16)}>
        <Kicker>Self-hosted · Open source · Apache-2.0</Kicker>
      </div>
      <div
        style={{
          fontSize: 96,
          lineHeight: 1.06,
          letterSpacing: "-0.03em",
          marginTop: 28,
          ...enter(f, 12, 18),
        }}
      >
        Your keys. Your browser.
        <br />
        Your account.
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 32,
          color: ink.ink2,
          marginTop: 46,
          ...enter(f, 30, 18),
        }}
      >
        docker compose up &nbsp;·&nbsp; load the extension &nbsp;·&nbsp; done
      </div>
    </AbsoluteFill>
  );
};
