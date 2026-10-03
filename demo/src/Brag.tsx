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
import { RUN, RUN_FRAMES, SPOTS, type Spot } from "./seq";
import { FONT_MONO, FPS, W, ink } from "./tokens";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/* The panel is the hero, so it is staged like one: full height, hard against
 * the right edge, with the type in a column to its left.
 *
 * 840 is the point, not a preference. The shots are captured at 2x, so the PNG
 * is 840px wide; displaying it in an 840px slot is a 1:1 mapping and stays
 * sharp, and the panel's own 11px body text lands at 11px on the 1920px frame.
 * At the panel's 420px CSS width it landed at five — which is why the shots read
 * as texture rather than as UI. The callout rectangles come out of
 * `tools/panel_shot.py` in the same pixel space, so both sides agree. */
const PANEL_W = 840;
const PANEL_H = 1080;
const PANEL_X = W - PANEL_W - 48;
const TYPE_X = 96;
/* The last 210px is the gutter the callout label and its leader line live in. */
const TYPE_W = PANEL_X - TYPE_X - 210;
const GUTTER = 210;

/** The panel arriving. A 140px slide, not just a fade — the previous cut moved
 *  between two identical framings, which is part of what read as static. */
const panelIn = (f: number) => ({
  opacity: interpolate(f, [0, 12], [0, 1], { ...clamp, easing: EASE }),
  transform: `translateX(${interpolate(f, [0, 26], [140, 0], { ...clamp, easing: EASE })}px)`,
});

/** The slow push that stops a still from reading as a still. Skipped on the
 *  sequence beat — those frames are already changing, and drifting the container
 *  as well makes the run look like it is sliding rather than running. */
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
const Shot: React.FC<{ src: string; over: number }> = ({ src, over }) => {
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
const RunPanel: React.FC = () => {
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

/** A frame drawn around the thing on screen that proves the claim, with a
 *  leader line running out of the panel and back to the label in the gutter.
 *  The rectangles are measured off the live panel by `tools/panel_shot.py` — a
 *  hand-placed one drifts silently, framing the wrong card while still looking
 *  deliberate. The label is clamped to the frame: the history drawer's delete
 *  button sits 22px from the top, and an unclamped label drew off the edge. */
const Callout: React.FC<{ spot: Spot; label: string; at: number; lead: number }> = ({
  spot,
  label,
  at,
  lead,
}) => {
  const t = interpolate(at, [lead, lead + 10], [0, 1], { ...clamp, easing: EASE });
  const left = PANEL_X + spot.x - 8;
  const midY = spot.y + spot.h / 2;
  const LEAD = 72;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: left - LEAD,
          top: midY,
          width: LEAD,
          height: 2,
          background: ink.ink,
          transform: `scaleX(${t})`,
          transformOrigin: "right",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: left - LEAD - 18 - (GUTTER - 60),
          top: Math.max(6, Math.min(PANEL_H - 44, midY - 13)),
          width: GUTTER - 60,
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
      <div
        style={{
          position: "absolute",
          left,
          top: spot.y - 8,
          width: spot.w + 16,
          height: spot.h + 16,
          border: `2px solid ${ink.ink}`,
          opacity: t,
          transform: `scale(${0.93 + 0.07 * t})`,
        }}
      />
    </>
  );
};

/** A beat: the claim on the left, the evidence on the right. */
const Beat: React.FC<{
  kicker: string;
  head: React.ReactNode;
  cap?: string;
  panel: React.ReactNode;
  callout: { spot: string; label: string; lead: number };
}> = ({ kicker, head, cap, panel, callout }) => {
  const f = useCurrentFrame();
  const spot = SPOTS[callout.spot];
  return (
    <AbsoluteFill>
      {panel}
      {spot ? <Callout spot={spot} label={callout.label} at={f} lead={callout.lead} /> : null}
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
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  // Two lines, hard. The strikethrough is the whole argument: no build-up, no
  // setup, because the first two seconds have to carry it alone.
  const second = interpolate(f, [26, 42], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: `0 ${TYPE_X}px` }}>
      <div style={{ fontSize: 104, lineHeight: 1.05, letterSpacing: "-0.03em" }}>
        <span
          style={{
            textDecoration: "line-through",
            textDecorationThickness: 6,
            color: f < 24 ? ink.ink : ink.ink3,
          }}
        >
          AI can&rsquo;t log in.
        </span>
      </div>
      <div
        style={{
          fontSize: 104,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          marginTop: 18,
          opacity: second,
          transform: `translateY(${interpolate(f, [26, 42], [26, 0], { ...clamp, easing: EASE })}px)`,
        }}
      >
        So it can&rsquo;t use your accounts.
      </div>
      <div style={{ marginTop: 44, opacity: second }}>
        <div
          style={{
            width: interpolate(f, [34, 52], [0, 320], { ...clamp, easing: EASE }),
            height: 3,
            background: ink.ink,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
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

// Scene lengths, not round numbers: each is sized to what it has to hold, and
// the composition total is derived from this table rather than typed, because
// `TransitionSeries` overlaps its scenes and a hand-written total truncates the
// last one by however much the two drift.
const CUT = linearTiming({ durationInFrames: 8 });

const SCENES: [React.FC, number][] = [
  [Hook, 75],
  [
    () => (
      <Beat
        kicker="Brotto"
        head={<>It runs in the browser you already signed into.</>}
        cap="Your accounts are open to it because they were always open to you."
        panel={<Shot src="shots/panel-idle.png" over={105} />}
        callout={{ spot: "composer", label: "ask it here", lead: 26 }}
      />
    ),
    105,
  ],
  [
    () => (
      <Beat
        kicker="Reads"
        head={<>It reads the page&rsquo;s structure, not a screenshot.</>}
        cap="Every link, field and button is addressable — which is why a click lands where it should."
        panel={<RunPanel />}
        callout={{ spot: "plan", label: "per-site consent", lead: RUN_FRAMES - 40 }}
      />
    ),
    RUN_FRAMES,
  ],
  [
    () => (
      <Beat
        kicker="Asks"
        head={<>Anything sensitive, it stops and asks you.</>}
        cap="The panel is the checkpoint. Nothing is approved on your behalf."
        panel={<Shot src="seq/07-asks.png" over={120} />}
        callout={{ spot: "approval", label: "your call", lead: 30 }}
      />
    ),
    120,
  ],
  [
    () => (
      <Beat
        kicker="Answers"
        head={<>Then it comes back with the answer.</>}
        cap="Three direct flights, the cheapest $412 return — and the run is in the panel, not on someone else's server."
        panel={<Shot src="seq/08-done.png" over={110} />}
        callout={{ spot: "answer", label: "the result", lead: 30 }}
      />
    ),
    110,
  ],
  [
    () => (
      <Beat
        kicker="Yours"
        head={<>Every run, on your own disk. Yours to delete.</>}
        cap="There is no account to sign up for, because there is no operator between you and the page."
        panel={<Shot src="shots/panel-history.png" over={110} />}
        callout={{ spot: "deleteAll", label: "yours to delete", lead: 30 }}
      />
    ),
    110,
  ],
  [Outro, 165],
];

export const DURATION =
  SCENES.reduce((n, [, d]) => n + d, 0) -
  (SCENES.length - 1) * CUT.getDurationInFrames({ fps: FPS });

export const Brag: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: ink.paper, fontFamily: "Geist, sans-serif", color: ink.ink }}>
      <Fonts />
      {/* The same generated bed as the explainer (see README), sitting lower
          because this cut moves faster. */}
      <Audio
        src={staticFile("bed.mp3")}
        loop
        loopVolumeCurveBehavior="extend"
        volume={interpolate(frame, [0, 18, DURATION - 60, DURATION], [0, 0.11, 0.11, 0], clamp)}
      />
      {/* The poster covers frame 0 and nothing else. Platforms that grab a
          thumbnail off the first frame would otherwise get the hook
          mid-entrance — grey, half-typed, no claim. Covering the frame keeps
          the render reproducible from `npm run render` alone; splicing the
          file afterwards would not be, and a 1-frame scene cannot sit in a
          `TransitionSeries` anyway (the next transition is 8 frames long). */}
      {frame === 0 ? (
        <AbsoluteFill style={{ zIndex: 1 }}>
          <Img src={staticFile("brag.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
