// ============================================================
//  transcribe.js  —  turn audio (mic or file) into sheet music
//  Loads the melody, detects the pitch at each moment with pitchy,
//  and writes ABC notation into the main text box.
// ============================================================

import { PitchDetector } from "https://esm.sh/pitchy@4";
import {
  hzToMidi, smoothMidi, estimateBpm, framesToNotes, notesToAbc,
  estimatePolyBpm, polyNotesToAbc,
} from "./music-theory.js";

const FRAME = 2048;   // samples analysed at once (~46ms at 44.1kHz)
const HOP = 1024;     // step between windows (~23ms)

// Polyphonic engine (Spotify's Basic Pitch, a TensorFlow.js model). Loaded
// lazily the first time chord/harp mode is used, because it's a few MB.
const BASIC_PITCH_MODEL = "https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json";
let _basicPitch = null;
async function loadBasicPitch() {
  if (!_basicPitch) _basicPitch = await import("https://esm.sh/@spotify/basic-pitch@1.0.1");
  return _basicPitch;
}

// --- page elements ---
const recordBtn   = document.getElementById("recordBtn");
const uploadInput = document.getElementById("uploadInput");
const statusEl    = document.getElementById("status");
const canvas      = document.getElementById("wave");
const notesBox    = document.getElementById("notes");

let recording = false;
let mediaRecorder, mediaStream, audioCtx, analyser, rafId, chunks = [];

function setStatus(msg) { statusEl.textContent = msg; }

// ---- Core: AudioBuffer -> ABC notation text ----
async function audioToAbc(audioBuffer) {
  const sr = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const detector = PitchDetector.forFloat32Array(FRAME);
  const window = new Float32Array(FRAME);
  const frameMidis = [];

  for (let i = 0; i + FRAME <= samples.length; i += HOP) {
    window.set(samples.subarray(i, i + FRAME));

    // loudness of this slice — quiet slices are silence/rests
    let rms = 0;
    for (let j = 0; j < FRAME; j++) rms += window[j] * window[j];
    rms = Math.sqrt(rms / FRAME);

    const [hz, clarity] = detector.findPitch(window, sr);

    // only trust confident, in-range, loud-enough pitches.
    // clarity 0.80 keeps real (slightly wavering) voices; range covers low
    // humming (~65Hz) up through high whistling (~3.5kHz).
    let midi = null;
    if (clarity > 0.80 && rms > 0.012 && hz > 65 && hz < 3500) {
      midi = hzToMidi(hz);
    }
    frameMidis.push(midi);
  }

  // smooth out vibrato wobble so a held note stays one note, then segment
  const smoothed = smoothMidi(frameMidis, 3);
  const hopTime = HOP / sr;
  const notes = framesToNotes(smoothed, hopTime, { minNoteSec: 0.09 });

  // adapt the rhythm grid to how fast the melody actually was
  const bpm = estimateBpm(notes);
  syncTempo(bpm);
  return notesToAbc(notes, { bpm });
}

// Point the tempo slider (and playback) at the detected tempo so the written
// rhythm and the playback speed agree.
function syncTempo(bpm) {
  const tempo = document.getElementById("tempo");
  const tempoValue = document.getElementById("tempoValue");
  if (!tempo) return;
  const clamped = Math.max(Number(tempo.min), Math.min(Number(tempo.max), bpm));
  tempo.value = clamped;
  if (tempoValue) tempoValue.textContent = clamped;
}

// ---- Decode any audio blob/file into samples ----
async function decode(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();
  return buffer;
}

// ---- Polyphonic (chord/harp) transcription via Basic Pitch ----
// Basic Pitch wants mono audio at 22050 Hz, so resample first.
async function resampleTo22050(audioBuffer) {
  const length = Math.ceil(audioBuffer.duration * 22050);
  const offline = new OfflineAudioContext(1, length, 22050);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offline.destination);
  src.start();
  return offline.startRendering();
}

async function audioToAbcPoly(audioBuffer) {
  const bp = await loadBasicPitch();
  const buf = await resampleTo22050(audioBuffer);

  const basicPitch = new bp.BasicPitch(BASIC_PITCH_MODEL);
  const frames = [], onsets = [], contours = [];
  await basicPitch.evaluateModel(
    buf,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    () => {},
  );

  // onsetThreshold, frameThreshold, minNoteLength(frames)
  const raw = bp.noteFramesToTime(
    bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)));
  const events = raw.map(n => ({
    start: n.startTimeSeconds, dur: n.durationSeconds, midi: n.pitchMidi,
  }));
  const bpm = estimatePolyBpm(events);
  syncTempo(bpm);
  return polyNotesToAbc(events, { bpm });
}

// ---- Run a buffer through transcription and show the result ----
async function transcribeAndShow(buffer) {
  const poly = document.getElementById("polyMode")?.checked;
  setStatus(poly
    ? "Listening for chords… (loading the AI model the first time — give it a moment)"
    : "Listening to your melody…");

  let abc;
  try {
    abc = poly ? await audioToAbcPoly(buffer) : await audioToAbc(buffer);
  } catch (err) {
    console.error(err);
    setStatus(poly
      ? "The chord model couldn't load or run. Check your connection, or untick chord mode."
      : "Something went wrong reading that audio. Try again?");
    return;
  }

  if (!abc) {
    setStatus(poly
      ? "I couldn't pick out clear notes from that recording."
      : "I couldn't hear clear notes — try humming a bit louder and steadier.");
    return;
  }

  notesBox.value = abc;
  notesBox.dispatchEvent(new Event("input")); // triggers the staff + sound
  setStatus("Done! Here's what I heard — tweak the notes if you like ✨");
}

// ---- Live amber waveform while recording ----
function drawWave() {
  if (!analyser) return;
  const ctx = canvas.getContext("2d");
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#f2b441";
  ctx.shadowBlur = 12;
  ctx.shadowColor = "rgba(242,180,65,0.7)";
  ctx.beginPath();
  const slice = canvas.width / data.length;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128 - 1;           // -1..1
    const y = canvas.height / 2 + v * (canvas.height / 2 - 4);
    const x = i * slice;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  rafId = requestAnimationFrame(drawWave);
}

// ---- Recording controls ----
async function startRecording() {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser can't record audio. Try the Upload button instead, or use Chrome/Safari.");
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    setStatus("I need microphone permission to listen. Check your browser's prompt.");
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  drawWave();

  chunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = e => chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
      const buffer = await decode(blob);
      await transcribeAndShow(buffer);
    } catch (err) {
      console.error(err);
      setStatus("I couldn't read that recording. Try again, or use the Upload button.");
    }
  };
  mediaRecorder.start();

  recording = true;
  recordBtn.classList.add("recording");
  recordBtn.setAttribute("aria-pressed", "true");
  recordBtn.querySelector(".rec-label").textContent = "Stop";
  setStatus("Recording… hum or whistle a melody, then press Stop.");
}

function stopRecording() {
  recording = false;
  recordBtn.classList.remove("recording");
  recordBtn.setAttribute("aria-pressed", "false");
  recordBtn.querySelector(".rec-label").textContent = "Record";
  cancelAnimationFrame(rafId);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close();
  analyser = null;
}

// ---- Wire up ----
recordBtn.addEventListener("click", () => recording ? stopRecording() : startRecording());

uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files[0];
  if (!file) return;
  setStatus(`Reading “${file.name}”…`);
  try {
    const buffer = await decode(file);
    await transcribeAndShow(buffer);
  } catch {
    setStatus("Couldn't read that file. Try an mp3, wav, or m4a.");
  }
  uploadInput.value = ""; // allow re-uploading the same file
});
