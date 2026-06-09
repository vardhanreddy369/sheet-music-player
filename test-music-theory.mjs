// Run with:  node test-music-theory.mjs
// Proves the pitch -> ABC notation logic is correct before it ships.

import {
  hzToMidi, midiToAbc, lengthSuffix, framesToNotes, notesToAbc,
  smoothMidi, estimateBpm, polyNotesToAbc, estimatePolyBpm,
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
// minRestSec:0 isolates merge/blip behaviour (no rest absorption)
const notes = framesToNotes(fm, 0.05, { minNoteSec: 0.09, minRestSec: 0 });
eq("frames merge into 5 segments", notes.length, 5);
eq("first note is middle C", notes[0].midi, 60);
eq("single-frame 99 blip became a rest", notes.some(n => n.midi === 99), false);
eq("real 62 note survived", notes.some(n => n.midi === 62), true);

// rest absorption: a tiny gap between two notes gets glued onto the note before it
const gappy = [60, 60, 60, null, 64, 64, 64]; // 1-frame gap (0.05s) between two notes
const absorbed = framesToNotes(gappy, 0.05, { minNoteSec: 0.09, minRestSec: 0.13 });
eq("tiny rest absorbed -> 2 notes, no rest", absorbed.length, 2);
eq("no rests remain", absorbed.some(n => n.midi === null), false);

// --- notesToAbc: a C-major-ish scale at 120bpm, quarter notes (0.5s each) ---
const scale = [4, 5, 7, 9].map(i => ({ midi: 60 + i, dur: 0.5 })); // E F G A, each a quarter
eq("scale -> ABC quarters with bar line", notesToAbc(scale, { bpm: 120 }), "E F G A |");

// trims leading/trailing rests
const padded = [{ midi: null, dur: 1 }, { midi: 60, dur: 0.5 }, { midi: null, dur: 1 }];
eq("leading/trailing rests trimmed", notesToAbc(padded, { bpm: 120 }), "C |");

// --- smoothMidi: a single-frame octave jump in a held note is removed ---
eq("smoothMidi flattens a 1-frame jump", smoothMidi([60, 60, 72, 60, 60], 2), [60, 60, 60, 60, 60]);
eq("smoothMidi keeps silence (null) as null", smoothMidi([60, null, 60], 1)[1], null);
// a held note with occasional wobble settles to the dominant pitch
eq("smoothMidi settles occasional wobble", smoothMidi([60, 61, 60, 60, 61, 60, 60], 2), [60, 60, 60, 60, 60, 60, 60]);

// --- estimateBpm: notes ~0.5s long imply ~120bpm (quarter = 0.5s) ---
eq("estimateBpm ~120 for half-second notes",
   estimateBpm([{ midi: 60, dur: 0.5 }, { midi: 62, dur: 0.5 }, { midi: 64, dur: 0.5 }]), 120);
eq("estimateBpm ~60 for one-second notes",
   estimateBpm([{ midi: 60, dur: 1.0 }, { midi: 62, dur: 1.0 }]), 60);
eq("estimateBpm falls back to 120 on empty", estimateBpm([]), 120);

// --- barline: a long note must not create an empty measure (| |) ---
eq("long note -> no double barline", notesToAbc([{ midi: 60, dur: 4.0 }], { bpm: 120 }), "C8 |");

// --- polyphonic: simultaneous notes become a chord ---
eq("3 simultaneous notes -> a chord",
   polyNotesToAbc([{start:0,dur:0.5,midi:60},{start:0,dur:0.5,midi:64},{start:0,dur:0.5,midi:67}], {bpm:120}),
   "[CEG] |");
eq("a sequence reads left to right",
   polyNotesToAbc([{start:0,dur:0.5,midi:60},{start:0.5,dur:0.5,midi:64}], {bpm:120}),
   "C E |");
eq("near-simultaneous (within tolerance) = chord; later note separate",
   polyNotesToAbc([{start:0,dur:0.5,midi:60},{start:0.04,dur:0.5,midi:67},{start:0.5,dur:0.5,midi:72}], {bpm:120}),
   "[CG] c |");
eq("estimatePolyBpm from onsets (~120)",
   estimatePolyBpm([{start:0,midi:60},{start:0.5,midi:62},{start:1.0,midi:64}]), 120);

console.log(`\n${fail === 0 ? "🎉 ALL PASS" : "⚠️  FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
