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
import { FONT_MONO, FPS, ink } from "./tokens";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** The panel, at size, in a hairline frame. Screenshotted by
 *  `tools/panel_shot.py` from the shipped `sidepanel.html` — see the plan in
 *  `brag-plan.md`. */
const PANEL_W = 420;

const Panel: React.FC<{ src: string; h: number; at: number; over: number }> = ({
  src,
  h,
  at,
  over,
}) => (
  <div
    style={{
      height: h,
      width: PANEL_W,
      border: `1px solid ${ink.rule2}`,
      background: ink.paper,
      overflow: "hidden",
    }}
  >
    <Img
      src={staticFile(src)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "top",
        // Same reasoning as the explainer's panel: a still that never moves
        // reads as a still, and `perceptual-scale` keeps the perceived rate
        // even as the scale grows.
        scale: interpolate(at, [0, over], [1, 1.05], {
          ...clamp,
          easing: EASE,
          output: "perceptual-scale",
        }),
      }}
    />
  </div>
);

/** A beat: a line, a rule, and — when there is one — the panel beside it. */
const Beat: React.FC<{
  kicker: string;
  head: string;
  cap?: string;
  panel?: string;
}> = ({ kicker, head, cap, panel }) => {
  const f = useCurrentFrame();
  return (
  <AbsoluteFill
    style={{
      flexDirection: "row",
      gap: 80,
      alignItems: "center",
      padding: "0 130px",
    }}
  >
    <div style={{ width: panel ? 760 : "100%", flexShrink: 0 }}>
      <div style={enter(f, 4)}>
        <Kicker>{kicker}</Kicker>
      </div>
      <div
        style={{
          fontSize: panel ? 74 : 96,
          lineHeight: 1.06,
          letterSpacing: "-0.025em",
          marginTop: 26,
          maxWidth: 1000,
          ...enter(f, 12, 18),
        }}
      >
        {head}
      </div>
      {cap ? (
        <div style={{ fontSize: 32, color: ink.ink2, marginTop: 28, lineHeight: 1.4, ...enter(f, 24, 18) }}>
          {cap}
        </div>
      ) : null}
    </div>
    {panel ? (
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <div style={enter(f, 8, 20)}>
          {/* Natural size. The capture is 420×900, and a panel that has to be
              asked for its width comes back shrink-to-fit at half this — which
              is what the first render did, and the cards were unreadable. */}
          <Panel src={panel} h={940} at={f} over={90} />
        </div>
      </div>
    ) : null}
  </AbsoluteFill>
  );
};

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  // Two lines, hard. The strikethrough is the whole argument: no build-up, no
  // setup, because the first two seconds have to carry it alone.
  const second = interpolate(f, [26, 42], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 150px" }}>
      <div style={{ fontSize: 104, lineHeight: 1.05, letterSpacing: "-0.03em", position: "relative" }}>
        <span style={{ textDecoration: "line-through", textDecorationThickness: 6, color: f < 24 ? ink.ink : ink.ink3 }}>
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
        <div style={{ width: interpolate(f, [34, 52], [0, 320], { ...clamp, easing: EASE }), height: 3, background: ink.ink }} />
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 150px" }}>
      <div style={enter(f, 4, 16)}>
        <Kicker>Self-hosted · Open source · Apache-2.0</Kicker>
      </div>
      <div style={{ fontSize: 96, lineHeight: 1.06, letterSpacing: "-0.03em", marginTop: 28, ...enter(f, 12, 18) }}>
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
  [() => (
    <Beat
      kicker="Brotto"
      head="It runs in the browser you already signed into."
      cap="Your accounts are open to it because they were always open to you."
      panel="shots/panel-idle.png"
    />
  ), 90],
  [() => (
    <Beat
      kicker="Reads"
      head="It reads the page’s structure, not a screenshot."
      cap="Every link, field and button is addressable — which is why a click lands where it should."
      panel="shots/panel-plan.png"
    />
  ), 90],
  [() => (
    <Beat
      kicker="Asks"
      head="Anything sensitive, it stops and asks you."
      cap="The panel is the checkpoint. Nothing is approved on your behalf."
      panel="shots/panel-approval.png"
    />
  ), 90],
  [() => (
    <Beat
      kicker="Yours"
      head="Every run, on your own disk. Yours to delete."
      cap="There is no account to sign up for, because there is no operator between you and the page."
      panel="shots/panel-history.png"
    />
  ), 75],
  [Outro, 180],
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
