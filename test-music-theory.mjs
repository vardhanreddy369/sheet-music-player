// Run with:  node test-music-theory.mjs
// Proves the pitch -> ABC notation logic is correct before it ships.

import {
  hzToMidi, midiToAbc, lengthSuffix, framesToNotes, notesToAbc,
} from "./music-theory.js";

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✅" : "❌"} ${label}  ->  ${JSON.stringify(got)}${ok ? "" : "  (wanted " + JSON.stringify(want) + ")"}`);
  ok ? pass++ : fail++;
}

// --- hzToMidi ---
eq("440Hz -> A4 (69)", hzToMidi(440), 69);
eq("261.63Hz -> middle C (60)", hzToMidi(261.63), 60);
eq("880Hz -> A5 (81)", hzToMidi(880), 81);

// --- midiToAbc octave + accidental mapping ---
eq("60 -> C (middle C)", midiToAbc(60), "C");
eq("62 -> D", midiToAbc(62), "D");
eq("71 -> B", midiToAbc(71), "B");
eq("72 -> c (octave up)", midiToAbc(72), "c");
eq("84 -> c' (two up)", midiToAbc(84), "c'");
eq("48 -> C, (octave down)", midiToAbc(48), "C,");
eq("59 -> B, (just below middle C)", midiToAbc(59), "B,");
eq("61 -> ^C (C sharp)", midiToAbc(61), "^C");
eq("49 -> ^C, (C#3)", midiToAbc(49), "^C,");
eq("73 -> ^c (C#5)", midiToAbc(73), "^c");

// --- lengthSuffix (against L:1/4) ---
eq("1 eighth -> /2", lengthSuffix(1), "/2");
eq("2 eighths -> '' (quarter)", lengthSuffix(2), "");
eq("3 eighths -> 3/2 (dotted quarter)", lengthSuffix(3), "3/2");
eq("4 eighths -> 2 (half)", lengthSuffix(4), "2");
eq("8 eighths -> 4 (whole)", lengthSuffix(8), "4");

// --- framesToNotes: merging + dropping short blips ---
// hopTime 0.05s, minNoteSec 0.09 -> need >=2 frames to count as a note
const fm = [60, 60, 60, null, null, 62, 62, /*blip*/ 99, 64, 64];
const notes = framesToNotes(fm, 0.05, { minNoteSec: 0.09 });
eq("frames merge into 5 segments", notes.length, 5);
eq("first note is middle C", notes[0].midi, 60);
eq("single-frame 99 blip became a rest", notes.some(n => n.midi === 99), false);
eq("real 62 note survived", notes.some(n => n.midi === 62), true);

// --- notesToAbc: a C-major-ish scale at 120bpm, quarter notes (0.5s each) ---
const scale = [4, 5, 7, 9].map(i => ({ midi: 60 + i, dur: 0.5 })); // E F G A, each a quarter
eq("scale -> ABC quarters with bar line", notesToAbc(scale, { bpm: 120 }), "E F G A |");

// trims leading/trailing rests
const padded = [{ midi: null, dur: 1 }, { midi: 60, dur: 0.5 }, { midi: null, dur: 1 }];
eq("leading/trailing rests trimmed", notesToAbc(padded, { bpm: 120 }), "C |");

console.log(`\n${fail === 0 ? "🎉 ALL PASS" : "⚠️  FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
