// ============================================================
//  music-theory.js  —  pure, dependency-free helpers
//  Used by transcribe.js (in the browser) AND by the node test.
//  Converts detected pitches into ABC notation text.
// ============================================================

// Frequency (Hz) -> nearest MIDI note number. 440Hz = A4 = MIDI 69.
export function hzToMidi(hz) {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

// MIDI note number -> ABC note token (e.g. 60 -> "C", 61 -> "^C", 72 -> "c").
// In ABC: uppercase C..B = the octave starting at middle C (MIDI 60..71),
// lowercase = one octave up, commas go down, apostrophes go up.
const PITCH_CLASSES = [
  ["C", ""], ["C", "^"], ["D", ""], ["D", "^"], ["E", ""], ["F", ""],
  ["F", "^"], ["G", ""], ["G", "^"], ["A", ""], ["A", "^"], ["B", ""],
];

export function midiToAbc(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const [letter, accidental] = PITCH_CLASSES[pc];
  const octave = Math.floor(midi / 12) - 1; // MIDI 60 -> octave 4 (middle C)

  let note;
  if (octave >= 5) {
    note = letter.toLowerCase() + "'".repeat(octave - 5);
  } else if (octave === 4) {
    note = letter;
  } else {
    note = letter + ",".repeat(4 - octave);
  }
  return accidental + note;
}

// Median-smooth the per-frame MIDI values so natural vibrato (which wobbles
// a singer ±1 semitone) settles onto one steady note instead of shattering
// into sub-threshold blips. Nulls (silence) are preserved as-is.
export function smoothMidi(frameMidis, radius = 2) {
  const out = new Array(frameMidis.length);
  for (let i = 0; i < frameMidis.length; i++) {
    if (frameMidis[i] === null) { out[i] = null; continue; }
    const vals = [];
    for (let j = i - radius; j <= i + radius; j++) {
      if (j >= 0 && j < frameMidis.length && frameMidis[j] !== null) vals.push(frameMidis[j]);
    }
    vals.sort((a, b) => a - b);
    out[i] = vals[Math.floor(vals.length / 2)];
  }
  return out;
}

// Estimate the tempo from the notes themselves (assume the most common note
// length is about a quarter note), so rhythm adapts to how fast the user hummed
// instead of always assuming 120 bpm.
export function estimateBpm(notes, { min = 50, max = 180, fallback = 120 } = {}) {
  const durs = notes.filter(n => n.midi !== null).map(n => n.dur).sort((a, b) => a - b);
  if (!durs.length) return fallback;
  const median = durs[Math.floor(durs.length / 2)];
  if (!median || !isFinite(median)) return fallback;
  let bpm = 60 / median;            // median note ~ a quarter note
  while (bpm < min) bpm *= 2;       // fold into a sensible range
  while (bpm > max) bpm /= 2;
  return Math.round(bpm);
}

// A list of per-frame MIDI values (or null for silence) -> merged notes.
// Each result is { midi: number|null, dur: seconds }. Short blips become rests.
export function framesToNotes(frameMidis, hopTime, { minNoteSec = 0.09, minRestSec = 0.13 } = {}) {
  // 1) collapse runs of identical frames into segments
  const segs = [];
  let cur = null;
  for (const m of frameMidis) {
    if (cur && cur.midi === m) cur.frames++;
    else { cur = { midi: m, frames: 1 }; segs.push(cur); }
  }

  // 2) notes too short to be real -> treat as silence (noise/clicks)
  const minFrames = Math.max(1, Math.round(minNoteSec / hopTime));
  for (const s of segs) {
    if (s.midi !== null && s.frames < minFrames) s.midi = null;
  }

  // 3) re-merge neighbours that are now the same (e.g. two rests in a row)
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.midi === s.midi) last.frames += s.frames;
    else merged.push({ midi: s.midi, frames: s.frames });
  }

  // 4) absorb tiny rests (the brief gap/glide between two notes) into the
  //    previous note, so a 20ms transition doesn't become a full eighth-rest.
  const minRestFrames = Math.max(1, Math.round(minRestSec / hopTime));
  const out = [];
  for (const s of merged) {
    const last = out[out.length - 1];
    if (s.midi === null && s.frames < minRestFrames && last && last.midi !== null) {
      last.frames += s.frames; // glue the little gap onto the note before it
    } else {
      out.push({ midi: s.midi, frames: s.frames });
    }
  }

  return out.map(s => ({ midi: s.midi, dur: s.frames * hopTime }));
}

// Length in eighth-notes -> ABC suffix, written against L:1/4 (a plain
// letter = a quarter note = 2 eighths).
export function lengthSuffix(eighths) {
  if (eighths % 2 === 0) {
    const quarters = eighths / 2;
    return quarters === 1 ? "" : String(quarters); // 2->half, 3->dotted half...
  }
  if (eighths === 1) return "/2";  // a single eighth note
  return eighths + "/2";           // 3/2 = dotted quarter, etc.
}

// Notes (with durations in seconds) -> a tidy ABC notation body string,
// snapped to an eighth-note grid with bar lines every measure.
export function notesToAbc(notes, { bpm = 120, beatsPerBar = 4 } = {}) {
  const eighthSec = 60 / bpm / 2;          // one eighth note, in seconds
  const eighthsPerBar = beatsPerBar * 2;   // 4/4 -> 8 eighths per bar

  // trim leading/trailing silence
  const arr = notes.slice();
  while (arr.length && arr[0].midi === null) arr.shift();
  while (arr.length && arr[arr.length - 1].midi === null) arr.pop();
  if (!arr.length) return "";

  const tokens = [];
  let eighthsInBar = 0;
  for (const n of arr) {
    let e = Math.round(n.dur / eighthSec);
    if (e < 1) e = 1;
    if (e > 16) e = 16; // cap runaway lengths
    const base = n.midi === null ? "z" : midiToAbc(n.midi);
    tokens.push(base + lengthSuffix(e));

    eighthsInBar += e;
    while (eighthsInBar >= eighthsPerBar) {
      eighthsInBar -= eighthsPerBar;
      tokens.push("|");
    }
  }

  let body = tokens.join(" ").replace(/\s+/g, " ").trim();
  body = body.replace(/\|(\s*\|)+/g, "|");   // collapse any empty measures (| |)
  if (!body.endsWith("|")) body += " |";
  return body;
}

// ----- Polyphonic path (for the Basic Pitch / chord+harp mode) -----

// Estimate tempo from the gaps between note ONSETS (not durations), since
// polyphonic notes overlap. Median inter-onset interval ~ a quarter note.
export function estimatePolyBpm(events, { min = 50, max = 180, fallback = 100 } = {}) {
  const starts = [...new Set(events.map(e => e.start))].sort((a, b) => a - b);
  if (starts.length < 2) return fallback;
  const iois = [];
  for (let i = 1; i < starts.length; i++) iois.push(starts[i] - starts[i - 1]);
  iois.sort((a, b) => a - b);
  const med = iois[Math.floor(iois.length / 2)];
  if (!med || !isFinite(med)) return fallback;
  let bpm = 60 / med;
  while (bpm < min) bpm *= 2;
  while (bpm > max) bpm /= 2;
  return Math.round(bpm);
}

// Note events {start, dur, midi} (possibly overlapping) -> ABC. Notes that
// start at nearly the same time become a chord [CEG]; the rest read left to
// right. Durations come from the gap to the next onset, so chords/arpeggios
// read as a clean rhythm.
export function polyNotesToAbc(events, { bpm = 100, chordTolSec = 0.08, beatsPerBar = 4 } = {}) {
  if (!events.length) return "";
  const sorted = events.slice().sort((a, b) => a.start - b.start || a.midi - b.midi);

  // group near-simultaneous onsets into chords
  const groups = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last && e.start - last.start <= chordTolSec) {
      if (!last.midis.includes(e.midi)) last.midis.push(e.midi);
      last.dur = Math.max(last.dur, e.dur);
    } else {
      groups.push({ start: e.start, midis: [e.midi], dur: e.dur });
    }
  }

  const eighthSec = 60 / bpm / 2;
  const eighthsPerBar = beatsPerBar * 2;
  const tokens = [];
  let eighthsInBar = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const span = i < groups.length - 1 ? groups[i + 1].start - g.start : g.dur;
    let e = Math.round(span / eighthSec);
    if (e < 1) e = 1; if (e > 16) e = 16;
    const suffix = lengthSuffix(e);
    const midis = g.midis.slice().sort((a, b) => a - b);
    tokens.push(midis.length === 1
      ? midiToAbc(midis[0]) + suffix
      : "[" + midis.map(midiToAbc).join("") + "]" + suffix);

    eighthsInBar += e;
    while (eighthsInBar >= eighthsPerBar) { eighthsInBar -= eighthsPerBar; tokens.push("|"); }
  }

  let body = tokens.join(" ").replace(/\s+/g, " ").trim();
  body = body.replace(/\|(\s*\|)+/g, "|");
  if (!body.endsWith("|")) body += " |";
  return body;
}
