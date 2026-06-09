// ============================================================
//  My Sheet Music Player  —  app.js
//  Wires the page up to abcjs (draws + plays the music).
// ============================================================

// Grab the page elements we need.
const notesBox    = document.getElementById("notes");
const instrument  = document.getElementById("instrument");
const tempo       = document.getElementById("tempo");
const tempoValue  = document.getElementById("tempoValue");
const warning     = document.getElementById("warning");
const keySel      = document.getElementById("key");
const meterSel    = document.getElementById("meter");
const transposeValue = document.getElementById("transposeValue");

// How many semitones to shift the whole piece. abcjs handles the music theory
// (correct key-signature spelling) for us via the visualTranspose render option.
let transpose = 0;

// Title shown above the staff. Examples can set their real name (e.g. Cooley's).
let songTitle = "My Song";

// If the abcjs library failed to load (e.g. the CDN is down), don't leave a
// blank, silent page — tell the user plainly and stop.
if (typeof ABCJS === "undefined") {
  warning.hidden = false;
  warning.textContent = "Couldn't load the music engine — please check your internet connection and refresh.";
  document.getElementById("paper").textContent = "♪ (music couldn't load)";
  throw new Error("abcjs failed to load");
}

// Real instrument sounds come from this full General-MIDI soundfont
// (covers all 128 instruments incl. harp, flute, choir...).
const SOUND_FONT = "https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/";

// A few ready-made tunes for the example buttons.
const SONGS = {
  twinkle: "C C G G | A A G2 | F F E E | D D C2 |\n" +
           "G G F F | E E D2 | G G F F | E E D2 |\n" +
           "C C G G | A A G2 | F F E E | D D C2 |",
  scale:   "C D E F | G A B c | c B A G | F E D C |",
  ode:     "E E F G | G F E D | C C D E | E D D2 |\n" +
           "E E F G | G F E D | C C D E | D C C2 |",
  // A flowing broken-chord lullaby — rolls up and down like a real harp.
  harp:    "C E G c | e c G E | F A c f | a f c A |\n" +
           "G B d g | b g d B | A, C E A | G, B, D G |\n" +
           "C E G c | e g c' e' | c2 G2 | C4 |",
  // Block chords (notes stacked) — shows the [ ] chord syntax.
  chords:  "[CEG] [CEG] [CFA] [CEG] | [B,DG] [B,DG] [CEG]2 |\n" +
           "[CFA] [CFA] [CEG] [CEG] | [B,DG] [B,DG] [CEG]2 |",
  // Beethoven — Für Elise (A section). A minor, 3/4. The famous E–D# oscillation,
  // octave-spanning runs, and the G#/D# accidentals make this a real stress test.
  elise:   "e/2 ^d/2 e/2 ^d/2 e/2 B/2 | d/2 c/2 A z/2 z/2 |\n" +
           "A,/2 C/2 E/2 A z/2 | B,/2 E/2 ^G/2 B z/2 |\n" +
           "e/2 ^d/2 e/2 ^d/2 e/2 B/2 | d/2 c/2 A z/2 z/2 |\n" +
           "A,/2 C/2 E/2 A z/2 | B,/2 E/2 c/2 B z/2 | A3 |",
  // Cooley's Reel — the canonical abcjs version, with guitar chord symbols
  // ("Em"/"D"), rolls (~), repeats, pickups, and the C# leading tone (^c).
  // [L:1/8] makes a plain letter an eighth note (the reel's natural pulse).
  cooley:  '[L:1/8] |:D2|"Em"EBBA B2 EB|~B2 AB dBAG|"D"FDAD BDAD|FDAD dAFD|\n' +
           '"Em"EBBA B2 EB|B2 AB defg|"D"afe^c dBAF|"Em"DEFD E2:|\n' +
           '|:gf|"Em"eB B2 efge|eB B2 gedB|"D"A2 FA DAFA|A2 FA defg|\n' +
           '"Em"eB B2 eBgB|eB B2 defg|"D"afe^c dBAF|"Em"DEFD E2:|',
  // Greensleeves — the timeless Tudor melody, gorgeous on harp. A minor, 6/8.
  greensleeves: "[L:1/8] c3 d2 e | f2 e d2 B | G3 A2 B | c2 A A2 ^G |\n" +
           "c3 d2 e | f2 e d2 B | G2 A ^G2 E | A6 |",
  // Amazing Grace — the most-loved hymn, soft and open on harp. G major, 3/4.
  amazing: "D | G2 B | G2 B | A3 | G2 E | D2 D | G2 B | G2 B | d3 |\n" +
           "d2 B | d2 B | A3 | G2 E | D2 D | G2 B | A2 D | G3 |",
};

// The audio player. abcjs's SynthController caches the tune+instrument it was
// first given and won't reliably update once it's been played — so editing the
// notes and pressing play again would replay the OLD music. We rebuild it
// whenever the music changes (tracked by lastKey: the notes + transpose).
let synthControl;
let lastKey = null;

// Highlights the note that is currently sounding, like a karaoke ball.
const cursorControl = {
  onStart() {},
  onEvent(ev) {
    if (ev.measureStart && ev.left === null) return; // skip empty events
    document.querySelectorAll(".abcjs-highlight")
      .forEach(el => el.classList.remove("abcjs-highlight"));
    ev.elements.forEach(noteGroup =>
      noteGroup.forEach(el => el.classList.add("abcjs-highlight")));
  },
  onFinish() {
    document.querySelectorAll(".abcjs-highlight")
      .forEach(el => el.classList.remove("abcjs-highlight"));
  },
};

// Build a complete ABC tune from the user's notes + chosen key, time, tempo.
function buildAbc() {
  const userNotes = notesBox.value.trim() || "z"; // z = a rest, so it's never empty
  return [
    "X:1",
    `T:${songTitle}`,
    `M:${meterSel.value}`,
    "L:1/4",
    `Q:1/4=${tempo.value}`,
    `K:${keySel.value}`,
    `%%MIDI program ${instrument.value}`, // <- this picks the instrument sound
    userNotes,
  ].join("\n");
}

// Draw the sheet music and get the audio ready.
async function update() {
  const abc = buildAbc();

  // 1) Draw the staff. visualTranspose shifts every note AND respells the key
  //    signature correctly — abcjs does the music theory, and the playback
  //    follows the transposed notes.
  const tune = ABCJS.renderAbc("paper", abc, {
    responsive: "resize",
    add_classes: true,
    visualTranspose: transpose,
  })[0];

  // 2) Show a gentle message if the notation couldn't be read.
  if (tune.warnings && tune.warnings.length) {
    warning.textContent = "Hmm, check your notation — see the guide below. " +
                          "(" + tune.warnings[0].replace(/<[^>]*>/g, "") + ")";
    warning.hidden = false;
  } else {
    warning.hidden = true;
  }

  // 3) Set up the audio (only if the browser supports it).
  if (!ABCJS.synth.supportsAudio()) {
    warning.textContent = "Your browser can't play audio here — try Chrome or Safari.";
    warning.hidden = false;
    return;
  }

  // Rebuild the player whenever the music changes — different notes, key, time,
  // tempo, instrument (all in `abc`) or transpose. A fresh player guarantees
  // that pressing play ALWAYS sounds what's currently written. When nothing
  // changed (e.g. replaying the same song), we reuse it so play just works.
  const key = abc + "@" + transpose;
  if (!synthControl || key !== lastKey) {
    synthControl = new ABCJS.synth.SynthController();
    synthControl.load("#audio", cursorControl, {
      displayPlay: true,
      displayProgress: true,
      displayRestart: true,
    });
    lastKey = key;
  }

  try {
    await synthControl.setTune(tune, false, { soundFontUrl: SOUND_FONT });
  } catch (err) {
    console.error(err);
  }
}

// --- Hook up the controls ---

// Redraw as he types, but wait until he pauses briefly (debounce).
let typingTimer;
notesBox.addEventListener("input", () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(update, 350);
});

// Instrument change -> show a loading hint (a new soundfont can be a few MB)
// then rebuild.
instrument.addEventListener("change", async () => {
  const status = document.getElementById("status");
  const name = instrument.options[instrument.selectedIndex].text;
  if (status) status.textContent = `Loading ${name} sound…`;
  await update();
  if (status) status.textContent = `${name} ready — press ▶ to play.`;
});

// Tempo slider -> show the number and rebuild.
tempo.addEventListener("input", () => {
  tempoValue.textContent = tempo.value;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(update, 200);
});

// Key and time-signature changes -> redraw.
keySel.addEventListener("change", update);
meterSel.addEventListener("change", update);

// Transpose: shift the whole piece up/down in semitones (abcjs respells it).
function setTranspose(semitones) {
  transpose = Math.max(-12, Math.min(12, semitones));
  transposeValue.textContent = (transpose > 0 ? "+" : "") + transpose;
  update();
}
document.getElementById("transposeUp").addEventListener("click", () => setTranspose(transpose + 1));
document.getElementById("transposeDown").addEventListener("click", () => setTranspose(transpose - 1));
document.getElementById("transposeReset").addEventListener("click", () => setTranspose(0));

// Example song buttons. An example can also carry its own musical setup —
// instrument, key, time signature, tempo — so a piece like Für Elise loads in
// A minor / 3-4 at the right speed, not stuck on the default C major / 4-4.
document.querySelectorAll("button.ex[data-song]").forEach(btn => {
  btn.addEventListener("click", () => {
    notesBox.value = SONGS[btn.dataset.song];
    if (btn.dataset.instrument) instrument.value = btn.dataset.instrument;
    if (btn.dataset.key)    keySel.value = btn.dataset.key;
    if (btn.dataset.meter)  meterSel.value = btn.dataset.meter;
    if (btn.dataset.tempo)  { tempo.value = btn.dataset.tempo; tempoValue.textContent = btn.dataset.tempo; }
    songTitle = btn.dataset.title || "My Song";        // show the piece's real name
    transpose = 0; transposeValue.textContent = "0";   // start each piece at concert pitch
    update();
  });
});

// Clear button.
document.getElementById("clear").addEventListener("click", () => {
  notesBox.value = "";
  notesBox.focus();
  update();
});

// Draw the starting song as soon as the page opens.
update();
