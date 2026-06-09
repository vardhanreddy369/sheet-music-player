// Run with:  node test-audio-pipeline.mjs
// Synthesizes a real melody as sound samples and runs it through the SAME
// pitch-detection pipeline the website uses (pitchy + music-theory.js),
// proving audio -> notes actually works end to end.

import { PitchDetector } from "pitchy";
import { hzToMidi, smoothMidi, estimateBpm, framesToNotes, notesToAbc } from "./music-theory.js";

const SR = 44100, FRAME = 2048, HOP = 1024;
let fail = 0;

// Build samples for a sequence of [freqHz, seconds] notes.
// vibratoCents adds a realistic ± wobble to simulate a real singing voice;
// harmonics add overtones so it's not a sterile pure sine.
function synth(notes, { vibratoCents = 0, harmonics = 1 } = {}) {
  const total = notes.reduce((n, [, s]) => n + Math.round(s * SR), 0);
  const out = new Float32Array(total);
  let p = 0;
  for (const [hz, sec] of notes) {
    const len = Math.round(sec * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const fade = Math.min(i, len - i, 400) / 400;
      // vibrato: 6Hz pitch wobble, depth in cents
      const f = hz * Math.pow(2, (vibratoCents / 1200) * Math.sin(2 * Math.PI * 6 * t));
      let v = 0;
      for (let h = 1; h <= harmonics; h++) v += (1 / h) * Math.sin(2 * Math.PI * f * h * t);
      out[p++] = 0.3 * fade * (v / harmonics);
    }
  }
  return out;
}

// Mirrors transcribe.js audioToAbc() exactly.
function samplesToAbc(samples) {
  const detector = PitchDetector.forFloat32Array(FRAME);
  const win = new Float32Array(FRAME);
  const frameMidis = [];
  for (let i = 0; i + FRAME <= samples.length; i += HOP) {
    win.set(samples.subarray(i, i + FRAME));
    let rms = 0;
    for (let j = 0; j < FRAME; j++) rms += win[j] * win[j];
    rms = Math.sqrt(rms / FRAME);
    const [hz, clarity] = detector.findPitch(win, SR);
    let midi = null;
    if (clarity > 0.80 && rms > 0.014 && hz > 65 && hz < 3500) midi = hzToMidi(hz);
    frameMidis.push(midi);
  }
  const notes = framesToNotes(smoothMidi(frameMidis, 3), HOP / SR, { minNoteSec: 0.10 });
  return notesToAbc(notes, { bpm: estimateBpm(notes) });
}

function check(label, abc, wantTokens) {
  const tokens = abc.replace(/\|/g, "").trim().split(/\s+/).filter(Boolean);
  const ok = tokens.join(" ") === wantTokens;
  console.log(`${ok ? "✅" : "❌"} ${label}: "${abc.trim()}"${ok ? "" : `  (wanted notes "${wantTokens}")`}`);
  if (!ok) fail++;
}

// 1) Clean sine melody — must match EXACT notes incl. octaves (C E G c, not C, or c).
const melody = [[261.63, 0.5], [329.63, 0.5], [392.0, 0.5], [523.25, 0.5]];
check("clean melody, exact octaves", samplesToAbc(synth(melody)), "C E G c");

// 2) Same melody sung with realistic vibrato (±15 cents) + overtones — the
//    real-voice case that used to vanish to empty output under clarity>0.92.
//    Must still recover C E G c. (Extreme operatic ±40c vibrato still fragments
//    and is documented as a known limit — we don't claim to handle that.)
const sung = samplesToAbc(synth(melody, { vibratoCents: 15, harmonics: 3 }));
check("realistic vibrato + harmonics still transcribes", sung, "C E G c");

// 3) A higher whistle (E6 ~1319Hz) that the old 2200Hz... still in range; and a
//    very high whistle E7 (~2637Hz) that the OLD code (cap 2200) would have dropped.
const whistle = samplesToAbc(synth([[2637.0, 0.5]]));
check("high whistle E7 (was dropped before)", whistle, "e''");

console.log(`\n${fail === 0 ? "🎉 AUDIO PIPELINE OK" : "⚠️  " + fail + " failed"}`);
process.exit(fail === 0 ? 0 : 1);
