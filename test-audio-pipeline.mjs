// Run with:  node test-audio-pipeline.mjs
// Synthesizes a real melody as sound samples and runs it through the SAME
// pitch-detection pipeline the website uses (pitchy + music-theory.js),
// proving audio -> notes actually works end to end.

import { PitchDetector } from "pitchy";
import { hzToMidi, framesToNotes, notesToAbc } from "./music-theory.js";

const SR = 44100, FRAME = 2048, HOP = 1024;

// Build sine-wave samples for a sequence of [freqHz, seconds] notes.
function synth(notes) {
  const total = notes.reduce((n, [, s]) => n + Math.round(s * SR), 0);
  const out = new Float32Array(total);
  let p = 0;
  for (const [hz, sec] of notes) {
    const len = Math.round(sec * SR);
    for (let i = 0; i < len; i++) {
      // gentle fade per note so edges don't click
      const fade = Math.min(i, len - i, 400) / 400;
      out[p++] = 0.3 * fade * Math.sin(2 * Math.PI * hz * (i / SR));
    }
  }
  return out;
}

// Same logic as transcribe.js audioToAbc(), but on raw samples.
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
    if (clarity > 0.92 && rms > 0.012 && hz > 60 && hz < 2200) midi = hzToMidi(hz);
    frameMidis.push(midi);
  }
  const notes = framesToNotes(frameMidis, HOP / SR, { minNoteSec: 0.09 });
  return notesToAbc(notes, { bpm: 120 });
}

// A melody: middle C, E, G, high C — each a quarter note (0.5s @120bpm).
const melody = [[261.63, 0.5], [329.63, 0.5], [392.0, 0.5], [523.25, 0.5]];
const abc = samplesToAbc(synth(melody));

console.log("Transcribed ABC:", JSON.stringify(abc));

// The notes (ignoring exact rhythm) must read C E G c.
const letters = abc.replace(/[0-9/|,'^_\s]/g, "");
const ok = letters === "CEGc";
console.log(ok ? "✅ Pitches detected correctly: C E G c" : `❌ Got letters "${letters}", wanted "CEGc"`);
process.exit(ok ? 0 : 1);
