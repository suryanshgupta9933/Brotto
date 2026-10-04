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
import { Kicker, enter } from "./atoms";
import { SPOTS } from "./seq";
import { Beat, Outro, Shot, TYPE_X, clamp } from "./stage";
import { FONT_MONO, ink } from "./tokens";

/* Draft3 — the disk.
 *
 * The other two cuts argue about what the agent can do. This one argues about
 * what it leaves behind, because "self-hosted" is the whole product claim and
 * nobody can check it by looking at a screenshot of the panel: it is a fact
 * about a filesystem.
 *
 * So the second column is a file listing rather than a picture. Both names in
 * it are real — the audit document and its scratchpad, at the paths
 * `agent/audit.py` writes them — and the third beat's list is the set of
 * artefacts this project deliberately stopped writing. The `.pages.json` bodies
 * sidecar lost its last writer and `ax_diff` went with it; what survives per
 * page is a 200-character digest. A hosted competitor writes all three, and
 * that is the whole difference between the two products.
 *
 * `Beat` is reused as-is rather than forked: it is the layout for a claim on the
 * left and evidence on the right, and this cut is that. The one thing it needed
 * was somewhere to put a block that is not a sentence.
 */

const Mono: React.FC<{ children: React.ReactNode; tone?: string; strike?: boolean }> = ({
  children,
  tone = ink.ink,
  strike,
}) => (
  <div
    style={{
      fontFamily: FONT_MONO,
      fontSize: 25,
      lineHeight: 1.62,
      color: tone,
      textDecoration: strike ? "line-through" : "none",
      textDecorationThickness: 3,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: TYPE_X, top: 230, width: 1200 }}>
        <div style={enter(f, 2)}>
          <Kicker>Where it runs</Kicker>
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
          Not on our box.
        </div>
        <div
          style={{
            fontSize: 92,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            marginTop: 12,
            color: ink.ink3,
            ...enter(f, 24, 20),
          }}
        >
          On yours.
        </div>
        <div style={{ marginTop: 52, ...enter(f, 44, 18) }}>
          <Mono>docker compose up</Mono>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CUT = linearTiming({ durationInFrames: 8 });

const SCENES: [React.FC, number][] = [
  [Hook, 75],
  [
    () => (
      <Beat
        kicker="On disk"
        head={<>A run is two files.</>}
        cap="Both plain JSON in a folder you can open, edit and back up without asking anyone."
        panel={<Shot src="shots/panel-history.png" over={125} />}
        extra={
          <div>
            <Mono>sessions/a1b2c3d4-0001.json</Mono>
            <Mono tone={ink.ink2}>sessions/a1b2c3d4-0001.scratchpad.txt</Mono>
          </div>
        }
      />
    ),
    125,
  ],
  [
    () => (
      <Beat
        kicker="Not on disk"
        head={<>And two things it used to write.</>}
        cap="Page text and a per-step diff both reached the sidecar once. Neither has a writer now — what is left per page is a 200-character digest."
        panel={<Shot src="shots/panel-idle.png" over={120} />}
        extra={
          <div>
            <Mono tone={ink.ink3} strike>sessions/&lt;id&gt;.pages.json</Mono>
            <Mono tone={ink.ink3} strike>ax_diff → audit document</Mono>
          </div>
        }
      />
    ),
    120,
  ],
  [
    () => (
      <Beat
        kicker="Yours"
        head={<>One button ends it.</>}
        cap="The transcript, the scratchpad and the registry entry go together, because a session that comes back after you deleted it is a session you did not delete."
        panel={<Shot src="shots/panel-history.png" over={120} />}
        spot={SPOTS.deleteAll}
        callout={{ spot: "deleteAll", label: "delete everything", lead: 30 }}
      />
    ),
    120,
  ],
  [Outro, 165],
];

export const DRAFT3_DURATION =
  SCENES.reduce((n, [, d]) => n + d, 0) -
  (SCENES.length - 1) * CUT.getDurationInFrames({ fps: 30 });

export const Draft3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: ink.paper, fontFamily: "Geist, sans-serif", color: ink.ink }}>
      <Fonts />
      <Audio
        src={staticFile("bed3.mp3")}
        volume={interpolate(
          frame,
          [0, 12, DRAFT3_DURATION - 18, DRAFT3_DURATION],
          [0, 0.32, 0.32, 0],
          clamp,
        )}
      />
      {frame === 0 ? (
        <AbsoluteFill style={{ zIndex: 1 }}>
          <Img src={staticFile("draft3.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
