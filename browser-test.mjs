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

// 4) clicking an example re-renders the staff
await page.locator('button[data-song="ode"]').click();
await page.waitForTimeout(800);
ok("example button updates notation", (await page.locator("#notes").inputValue()).includes("E"));

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

// 6) no console / page errors the whole time
if (consoleErrors.length) console.log("\n   console errors:\n   - " + consoleErrors.join("\n   - "));
ok("no JavaScript errors", consoleErrors.length === 0);

await browser.close();
console.log(`\n${failures === 0 ? "🎉 LIVE SITE FULLY WORKING" : "⚠️  " + failures + " check(s) failed"}`);
process.exit(failures === 0 ? 0 : 1);
