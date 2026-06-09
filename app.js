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
};

// The audio player. abcjs's SynthController caches the FIRST instrument it
// loads and ignores later program changes, so we rebuild it whenever the
// instrument actually changes (tracked by loadedProgram).
let synthControl;
let loadedProgram = null;

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

// Build a complete ABC tune from the user's notes + chosen instrument + tempo.
function buildAbc() {
  const userNotes = notesBox.value.trim() || "z"; // z = a rest, so it's never empty
  return [
    "X:1",
    "T:My Song",
    "M:4/4",
    "L:1/4",
    `Q:1/4=${tempo.value}`,
    "K:C",
    `%%MIDI program ${instrument.value}`, // <- this picks the instrument sound
    userNotes,
  ].join("\n");
}

// Draw the sheet music and get the audio ready.
async function update() {
  const abc = buildAbc();

  // 1) Draw the staff. renderAbc returns info about the tune, incl. any warnings.
  const tune = ABCJS.renderAbc("paper", abc, {
    responsive: "resize",
    add_classes: true,
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

  // Rebuild the player when the instrument changes (abcjs caches the first
  // one otherwise — which made every instrument sound like piano).
  const program = instrument.value;
  if (!synthControl || program !== loadedProgram) {
    synthControl = new ABCJS.synth.SynthController();
    synthControl.load("#audio", cursorControl, {
      displayPlay: true,
      displayProgress: true,
      displayRestart: true,
    });
    loadedProgram = program;
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

// Example song buttons. Some also switch the instrument (e.g. the harp sample).
document.querySelectorAll("button.ex[data-song]").forEach(btn => {
  btn.addEventListener("click", () => {
    notesBox.value = SONGS[btn.dataset.song];
    if (btn.dataset.instrument) instrument.value = btn.dataset.instrument;
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
