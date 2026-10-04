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
import { EASE } from "./atoms";
import { RUN_FRAMES, SPOTS } from "./seq";
import { Beat, Outro, RunPanel, Shot, TYPE_X, clamp } from "./stage";
import { FPS, ink } from "./tokens";

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
        spot={SPOTS.composer}
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
        spot={SPOTS.plan}
        callout={{ spot: "plan", label: "per-site consent", lead: 3 }}
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
        spot={SPOTS.approval}
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
        spot={SPOTS.answer}
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
        spot={SPOTS.deleteAll}
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

export const Draft1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: ink.paper, fontFamily: "Geist, sans-serif", color: ink.ink }}>
      <Fonts />
      {/* The generated cue (see README and `tools/bed.mjs`), scored to this cut's
          scene starts rather than looped under them. The fade-out is 20 frames,
          not 60: the last chord resolves at 24.0s and the cut runs to 25.4s, so a
          two-second fade would swallow the one moment the music lands. */}
      <Audio
        src={staticFile("bed.mp3")}
        volume={interpolate(frame, [0, 12, DURATION - 20, DURATION], [0, 0.32, 0.32, 0], clamp)}
      />
      {/* The poster covers frame 0 and nothing else. Platforms that grab a
          thumbnail off the first frame would otherwise get the hook
          mid-entrance — grey, half-typed, no claim. Covering the frame keeps
          the render reproducible from `npm run render` alone; splicing the
          file afterwards would not be, and a 1-frame scene cannot sit in a
          `TransitionSeries` anyway (the next transition is 8 frames long). */}
      {frame === 0 ? (
        <AbsoluteFill style={{ zIndex: 1 }}>
          <Img src={staticFile("draft1.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
