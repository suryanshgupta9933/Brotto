import { interpolate } from "remotion";
import { FONT_MONO, ink } from "./tokens";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** Fade and lift a block in. Returns style, so callers stay declarative. */
export const enter = (frame: number, at: number, dur = 16) => ({
  opacity: interpolate(frame, [at, at + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(frame, [at, at + dur], [16, 0], clamp)}px)`,
});

/** The 10px uppercase mono label the design system uses for every stat and eyebrow. */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = ink.ink3,
}) => (
  <div
    style={{
      fontFamily: FONT_MONO,
      fontSize: 20,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color,
    }}
  >
    {children}
  </div>
);

export const Rule: React.FC<{ w?: number | string; color?: string; style?: React.CSSProperties }> = ({
  w = "100%",
  color = ink.rule,
  style,
}) => <div style={{ width: w, height: 1, background: color, ...style }} />;

/** A single accessibility-tree row. The demo's most important prop. */
export const AxRow: React.FC<{
  depth: number;
  role: string;
  name: string;
  ref?: string;
  dim?: boolean;
}> = ({ depth, role, name, ref, dim }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      gap: 18,
      paddingLeft: depth * 26,
      opacity: dim ? 0.35 : 1,
    }}
  >
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 19,
        color: ink.ink2,
        width: 108,
        flexShrink: 0,
      }}
    >
      {role}
    </span>
    <span style={{ fontSize: 25, color: ink.ink, flex: 1 }}>{name}</span>
    {ref ? (
      <span style={{ fontFamily: FONT_MONO, fontSize: 18, color: ink.ink3 }}>{ref}</span>
    ) : null}
  </div>
);
