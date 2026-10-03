// The music bed for both cuts. Generated, not licensed, so there is no
// attribution to carry and nothing to clear.
//
// It is *scored to the cut*, not looped under it. The previous bed was a 10.7s
// cycle, which on a 25.4s video seam-auditions twice at moments nobody chose,
// and a fixed cycle cannot hit an edit. Here every accent is placed on the beat
// nearest a scene start — that is the whole difference between a bed and a cue.
//
//   node tools/bed.mjs   ->  public/bed.mp3
//
// Pure stdlib, plus the ffmpeg the Remotion CLI already ships. No numpy, no tone
// library, no build step.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "bed.mp3");

const SR = 44100;
const BPM = 100;
const BEAT = 60 / BPM; // 0.6s
const DUR = 763 / 30; // the Brag cut, so the cue cannot drift out from under it
const N = Math.round(DUR * SR);

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// Am - F - C - G, the i-VI-III-VII the explainer already used, two beats apart
// and now placed so each chord starts on a scene boundary.
const CHORDS = [
  { at: 0, pad: [57, 64, 69], sub: 45 },
  { at: 4, pad: [53, 60, 65], sub: 41 },
  { at: 8, pad: [55, 60, 64], sub: 36 },
  { at: 12, pad: [55, 62, 67], sub: 43 },
  { at: 16, pad: [57, 64, 69], sub: 45 },
  { at: 20, pad: [53, 60, 65], sub: 41 },
  { at: 24, pad: [55, 60, 64], sub: 36 },
  { at: 28, pad: [55, 62, 67], sub: 43 },
  { at: 32, pad: [57, 64, 69], sub: 45 },
  { at: 36, pad: [53, 60, 65], sub: 41 },
  { at: 40, pad: [57, 64, 69], sub: 45 },
];

// Scene starts in beats, rounded to the nearest beat. These are the accents.
const ACCENTS = [0, 4, 9, 16, 22, 28, 33, 40];

const chordAt = (beat) => {
  let c = CHORDS[0];
  for (const x of CHORDS) if (beat >= x.at) c = x;
  return c;
};

/* A wavetable per timbre, so the pad is six oscillators deep without six sin()
 * calls per sample. Built once, read with linear interpolation. */
const table = (harmonics, size = 2048) => {
  const t = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    let v = 0;
    for (const [h, a] of harmonics) v += a * Math.sin((2 * Math.PI * h * i) / size);
    t[i] = v;
  }
  return t;
};

// Soft and dark, the inverse of a saw: a pad that has harmonics 1-6 falling as
// 1/n but weighted toward the low ones.
const PAD = table([[1, 1], [2, 0.42], [3, 0.2], [4, 0.11], [5, 0.06], [6, 0.04]]);
const PLUCK = table([[1, 1], [2, 0.3], [3, 0.14], [4, 0.05]]);
const SIZES = [PAD.length, PLUCK.length];

const osc = (tbl, phase, freq) => {
  const x = phase * tbl.length;
  const i = x | 0;
  const f = x - i;
  const a = tbl[i % tbl.length];
  const b = tbl[(i + 1) % tbl.length];
  phase += freq / SR;
  return [a + (b - a) * f, phase - Math.floor(phase)];
};

const env = (t, a, d, s, r, dur) => {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur - r) return s;
  return Math.max(0, s * (1 - (t - (dur - r)) / r));
};

/* --- voices ---------------------------------------------------------------- */

const L = new Float32Array(N);
const R = new Float32Array(N);

const add = (i, l, r) => {
  if (i >= 0 && i < N) {
    L[i] += l;
    R[i] += r;
  }
};

// The pad: three notes, each a detuned pair, 0.5s in and 0.4s out. It is the
// floor everything else sits on, so it starts immediately and never stops.
for (const { at, pad } of CHORDS) {
  const start = Math.round(at * BEAT * SR);
  const len = Math.round(BEAT * 4 * SR);
  for (let v = 0; v < pad.length; v++) {
    const f = mtof(pad[v]);
    // Wide on the top note, near-centre on the root: a chord with depth.
    const pan = (v - 1) * 0.35;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (const cents of [-6, 6]) {
      const ff = f * 2 ** (cents / 1200);
      const det = ((v * 977 + (cents > 0 ? 311 : 0)) % 512) / 512;
      let ph = det;
      for (let k = 0; k < len; k++) {
        const t = k / SR;
        const e = env(t, 0.5, 0.3, 0.75, 0.4, len / SR);
        if (e <= 0) continue;
        const [s, np] = osc(PAD, ph, ff);
        ph = np;
        const g = e * 0.030;
        add(start + k, s * g * gl, s * g * gr);
      }
    }
  }
}

// The sub: root, two octaves under the pad, with a hint of second harmonic so it
// survives laptop speakers that roll off below 100Hz.
for (const { at, sub } of CHORDS) {
  const start = Math.round(at * BEAT * SR);
  const len = Math.round(BEAT * 4 * SR);
  const f = mtof(sub);
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const e = env(t, 0.03, 0.2, 0.9, 0.35, len / SR);
    if (e <= 0) continue;
    const s = Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t);
    add(start + k, s * e * 0.11, s * e * 0.11);
  }
}

// The pluck: sixteenths, arpeggiating the chord up and back down. It enters on
// the Reveal rather than the hook, so the first two seconds are the type's.
{
  const step = BEAT / 4;
  const pattern = [0, 2, 1, 3, 2, 4, 1, 3];
  for (let n = 4; n * step < DUR; n++) {
    if (n % 8 === 7) continue; // a rest every eighth note, or it reads as a machine
    const beat = n * step;
    const ch = chordAt(beat);
    const deg = pattern[n % pattern.length];
    const midi = ch.pad[deg % ch.pad.length] + 12 * Math.floor(deg / ch.pad.length);
    const f = mtof(midi);
    const start = Math.round(beat * BEAT * SR);
    const len = Math.round(0.34 * SR);
    const pan = n % 2 ? 0.3 : -0.3;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    // Rests get deeper in the second half, so the arpeggio thins as the outro
    // arrives instead of running under it unchanged.
    const amp = 0.17 * (beat * BEAT < 20 ? 1 : 0.72);
    let ph = (n * 0.37) % 1;
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      const e = Math.exp(-t * 11) * (1 - Math.exp(-t * 900));
      const [s, np] = osc(PLUCK, ph, f);
      ph = np;
      add(start + k, s * e * amp * gl, s * e * amp * gr);
    }
  }
}

// Shaker: eighths, and only from the Asks onward. This is what makes the back
// half feel like it is going somewhere.
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  let hp = 0;
  for (let n = Math.round(16 / (BEAT / 2)); n * (BEAT / 2) < DUR - 0.3; n++) {
    const t = n * (BEAT / 2);
    const start = Math.round(t * SR);
    const len = Math.round(0.05 * SR);
    const amp = n % 2 ? 0.050 : 0.075;
    for (let k = 0; k < len; k++) {
      const e = Math.exp((-k / SR) * 70);
      const w = rnd();
      hp = w - hp * 0.55; // one-pole highpass: the tick, not the hiss
      add(start + k, hp * e * amp, hp * e * amp);
    }
  }
}

// The accent. A short pitch drop, on the beat nearest every scene start — this
// is the bed doing the cutting, which is the only honest way for a bed to cut.
for (const a of ACCENTS) {
  const start = Math.round(a * BEAT * SR);
  const len = Math.round(0.32 * SR);
  const final = a === 40;
  const amp = final ? 0.62 : 0.42;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const e = Math.exp(-t * 13) * (1 - Math.exp(-t * 600));
    const f = 58 - 22 * (1 - Math.exp(-t * 26));
    const s = Math.sin(2 * Math.PI * f * t);
    add(start + k, s * e * amp, s * e * amp);
  }
}

// Two risers, one into the Outro and one into the resolve.
for (const at of [32, 39]) {
  const start = Math.round(at * BEAT * SR);
  const len = Math.round(BEAT * SR);
  let seed = 9876 + at;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const x = k / len;
    const e = x * x * x;
    const tone = Math.sin(2 * Math.PI * (200 + 1400 * x * x) * (k / SR));
    const s = (rnd() * 0.5 + tone * 0.5) * e * 0.05;
    add(start + k, s, s);
  }
}

/* --- glue ------------------------------------------------------------------ */

// A Schroeder reverb on two channels with different comb lengths, so the tail
// is wide rather than centred. This is what turns seven dry voices into one
// instrument instead of a stack.
const reverb = (buf, combs, gain) => {
  const out = new Float32Array(buf.length);
  for (const d of combs) {
    const line = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = line[p];
      out[i] += y;
      line[p] = buf[i] + y * 0.8;
      p = p + 1 === d ? 0 : p + 1;
    }
  }
  for (let i = 0; i < out.length; i++) buf[i] += out[i] * gain;
};
reverb(L, [1687, 1601, 2053], 0.1);
reverb(R, [1901, 1789, 2221], 0.1);

// Soft clip, then normalise to a known peak so the Remotion volume in the
// composition is a real number rather than a hope.
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.2);
  R[i] = Math.tanh(R[i] * 1.2);
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.707 / (peak || 1);
const fadeIn = Math.round(0.03 * SR);
const fadeOut = Math.round(0.4 * SR);
for (let i = 0; i < N; i++) {
  const g =
    norm * Math.min(1, i / fadeIn, (N - 1 - i) / fadeOut);
  L[i] *= g;
  R[i] *= g;
}

/* --- write ----------------------------------------------------------------- */

const wav = Buffer.alloc(44 + N * 4);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + N * 4, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(N * 4, 40);
let rms = 0;
for (let i = 0; i < N; i++) {
  const l = Math.max(-1, Math.min(1, L[i]));
  const r = Math.max(-1, Math.min(1, R[i]));
  rms += l * l + r * r;
  wav.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
}

// The compositor's ffmpeg is a bare dylib that only resolves under the CLI's
// loader, so go through `remotion ffmpeg` rather than invoking it directly.
const cli = join(HERE, "..", "node_modules", ".bin", "remotion");
if (!existsSync(cli)) {
  console.error("remotion CLI not found — run `npm install` in demo/ first");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "bed-"));
const tmp = join(dir, "bed.wav");
writeFileSync(tmp, wav);
const res = spawnSync(cli, ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-codec:a", "libmp3lame", "-b:a", "192k", OUT], { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
if (res.status !== 0) process.exit(res.status ?? 1);

let outPeak = 0;
for (let i = 0; i < N; i++) outPeak = Math.max(outPeak, Math.abs(L[i]), Math.abs(R[i]));
if (outPeak > 1) {
  console.error(`clipping: peak ${outPeak.toFixed(3)}`);
  process.exit(1);
}
console.log(
  `bed.mp3  ${DUR.toFixed(2)}s  ${BPM}bpm  ${CHORDS.length} chords  ` +
    `peak ${outPeak.toFixed(3)}  rms ${Math.sqrt(rms / (N * 2)).toFixed(3)}  ` +
    `final resolve at ${(40 * BEAT).toFixed(2)}s`,
);

// The arrangement is a claim about loudness over time, and it is the one thing
// here nobody can check by reading the code. A bar per second makes a dropped
// layer or a stuck note obvious without listening.
const win = SR / 2;
const bars = [];
for (let s = 0; s * win < N; s++) {
  let acc = 0;
  for (let i = s * win; i < Math.min(N, (s + 1) * win); i++) acc += L[i] * L[i] + R[i] * R[i];
  bars.push(Math.sqrt(acc / (Math.min(N, (s + 1) * win) - s * win) / 2));
}
const top = Math.max(...bars);
console.log(
  "energy  " +
    bars.map((v) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.round((v / top) * 7))]).join(""),
);

