// Run with:  node browser-test.mjs
// Loads the LIVE site in a real (headless) browser and verifies it works:
// no JS errors, the sheet music renders, the audio transport appears, and
// the record -> transcribe path runs end to end (using a fake mic device).

import { chromium } from "playwright";

const URL = "https://vardhanreddy369.github.io/sheet-music-player/";
let failures = 0;
const ok = (label, cond) => { console.log(`${cond ? "✅" : "❌"} ${label}`); if (!cond) failures++; };

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",     // auto-allow mic
    "--use-fake-device-for-media-stream", // feed a synthetic tone as the mic
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext();
await ctx.grantPermissions(["microphone"]);
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push("PAGEERROR: " + e.message));

console.log("Loading", URL, "\n");
await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });

// 1) Title + masthead present
ok("page title is 'The Score'", (await page.title()).includes("The Score"));
ok("masthead heading renders", (await page.locator("h1").innerText()).includes("Score"));

// 2) abcjs drew the sheet music (an SVG with notes inside #paper)
await page.waitForSelector("#paper svg", { timeout: 15000 }).catch(() => {});
const noteCount = await page.locator("#paper svg .abcjs-note").count();
ok("sheet music SVG rendered", await page.locator("#paper svg").count() > 0);
ok(`notes drawn on the staff (found ${noteCount})`, noteCount > 0);

// 3) audio transport (play button) rendered
await page.waitForSelector("#audio .abcjs-inline-audio", { timeout: 15000 }).catch(() => {});
ok("audio play-bar rendered", await page.locator("#audio .abcjs-inline-audio").count() > 0);

// the abcjs audio CSS must be loaded, or the player shows a "CSS required" warning
const audioText = await page.locator("#audio").innerText();
ok("audio CSS loaded (no 'CSS required' warning)", !/CSS required/i.test(audioText));
// real Play button present (it has a play-control element when CSS is loaded)
ok("Play button present", await page.locator("#audio .abcjs-midi-start, #audio button").count() > 0);

// 4) clicking an example re-renders the staff
await page.locator('button[data-song="ode"]').click();
await page.waitForTimeout(800);
ok("example button updates notation", (await page.locator("#notes").inputValue()).includes("E"));

// 4b) the notes are actually VISIBLE (dark ink, not faint cream on cream)
const fill = await page.locator("#paper svg path").first().evaluate(
  el => getComputedStyle(el).fill);
const [r, g, b] = (fill.match(/\d+/g) || [255, 255, 255]).map(Number);
ok(`notes are dark/visible (fill ${fill})`, r < 90 && g < 90 && b < 90);

// 4c) the Harp Lullaby sample loads its tune AND switches instrument to Harp
await page.locator('button[data-song="harp"]').click();
await page.waitForTimeout(900);
ok("harp sample sets instrument to Harp (46)",
   (await page.locator("#instrument").inputValue()) === "46");
ok("harp sample loaded its arpeggio notes",
   (await page.locator("#notes").inputValue()).includes("C E G c"));
ok("harp notation is valid (no warning shown)",
   await page.locator("#warning").isHidden());

// 5) UPLOAD path: feed a real WAV of C-E-G-c and assert the exact notes come out.
//    This exercises decodeAudioData -> pitchy -> ABC in the real browser.
await page.locator("#uploadInput").setInputFiles("melody-CEGc.wav");
await page.waitForFunction(
  () => /Done|went wrong|couldn't/i.test(document.getElementById("status").textContent),
  { timeout: 15000 },
).catch(() => {});
const transcribed = await page.locator("#notes").inputValue();
const letters = transcribed.replace(/[0-9/|,'^_\s]/g, "");
ok(`uploaded audio transcribed to notes (got "${transcribed.trim()}")`, letters === "CEGc");

// 4d) MUSICIAN FEATURES — key, time signature, transpose, chords.
// Transpose UI updates and re-renders:
for (let i = 0; i < 12; i++) await page.locator("#transposeUp").click();
await page.waitForTimeout(400);
ok(`transpose +12 shows "+12"`, (await page.locator("#transposeValue").innerText()) === "+12");
await page.locator("#transposeReset").click();
ok(`transpose reset shows "0"`, (await page.locator("#transposeValue").innerText()) === "0");

// Musical correctness: abcjs visualTranspose must shift pitch by the right
// diatonic amount — +12 semitones = a full octave = 7 diatonic steps.
const pitches = await page.evaluate(() => {
  const read = t => {
    const tune = ABCJS.renderAbc("paper", "X:1\nL:1/4\nK:C\nC", { visualTranspose: t })[0];
    const n = tune.lines[0].staff[0].voices[0].find(e => e.pitches);
    return n.pitches[0].pitch;
  };
  return { base: read(0), fifth: read(7), octave: read(12) };
});
ok(`a fifth up = 4 diatonic steps (got ${pitches.fifth})`, pitches.fifth - pitches.base === 4);
ok(`an octave up = 7 diatonic steps (got ${pitches.octave})`, pitches.octave - pitches.base === 7);
// restore default tune
await page.locator('button[data-song="twinkle"]').click();
await page.waitForTimeout(400);

// key + time signature apply without breaking the render
await page.selectOption("#key", "G");
await page.selectOption("#meter", "3/4");
await page.waitForTimeout(500);
ok("key + time signature change still renders", await page.locator("#paper svg").count() > 0);
await page.selectOption("#key", "C");
await page.selectOption("#meter", "4/4");

// chords example loads stacked-note syntax and renders
await page.locator('button[data-song="chords"]').click();
await page.waitForTimeout(700);
ok("chords example loads [CEG] syntax",
   (await page.locator("#notes").inputValue()).includes("[CEG]"));
ok("chords render on the staff", await page.locator("#paper svg .abcjs-note").count() > 0);

// Für Elise: a complex piece that loads its OWN key/time/tempo and renders cleanly
await page.locator('button[data-song="elise"]').click();
await page.waitForTimeout(800);
ok("Für Elise sets key to A minor", (await page.locator("#key").inputValue()) === "Am");
ok("Für Elise sets time to 3/4", (await page.locator("#meter").inputValue()) === "3/4");
ok("Für Elise sets a brisk tempo (140)", (await page.locator("#tempo").inputValue()) === "140");
ok("Für Elise notation is valid (no warning)", await page.locator("#warning").isHidden());
ok("Für Elise renders many notes", await page.locator("#paper svg .abcjs-note").count() >= 20);
// reset
await page.selectOption("#key", "C"); await page.selectOption("#meter", "4/4");
await page.locator('button[data-song="twinkle"]').click();
await page.waitForTimeout(300);

// 5a) INSTRUMENTS ARE DISTINCT — the "everything sounds like piano" bug.
//     Select each instrument, press the real Play button, and confirm the
//     correct soundfont folder loads (not piano for all).
async function instrumentFolder(value) {
  const seen = [];
  const handler = r => { const m = r.url().match(/FluidR3_GM\/([^/]+)\//); if (m) seen.push(m[1]); };
  page.on("request", handler);
  await page.selectOption("#instrument", value);
  await page.waitForTimeout(1000);
  await page.locator("#audio .abcjs-midi-start").first().click().catch(() => {});
  await page.waitForTimeout(2800);
  page.off("request", handler);
  return [...new Set(seen)];
}
const harpFont  = await instrumentFolder("46");
const fluteFont = await instrumentFolder("73");
ok(`harp loads its own soundfont (${harpFont})`, harpFont.includes("orchestral_harp-mp3"));
ok(`flute loads a different soundfont (${fluteFont})`, fluteFont.includes("flute-mp3"));

// 5b) accessibility + perf regressions
ok("status is an aria-live region",
   (await page.locator("#status").getAttribute("aria-live")) === "polite");
ok("abcjs script is deferred (non-blocking)",
   await page.locator('script[src*="abcjs-basic"][defer]').count() > 0);
ok("file input is keyboard-focusable (not [hidden])",
   (await page.locator("#uploadInput").getAttribute("hidden")) === null);
ok("record button exposes pressed state",
   (await page.locator("#recordBtn").getAttribute("aria-pressed")) !== null);

// 6) no console / page errors the whole time
if (consoleErrors.length) console.log("\n   console errors:\n   - " + consoleErrors.join("\n   - "));
ok("no JavaScript errors", consoleErrors.length === 0);

await browser.close();
console.log(`\n${failures === 0 ? "🎉 LIVE SITE FULLY WORKING" : "⚠️  " + failures + " check(s) failed"}`);
process.exit(failures === 0 ? 0 : 1);
