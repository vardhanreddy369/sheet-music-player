// Run with: node poly-test.mjs   (verifies polyphonic chord/harp mode on the live site)
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "fs";

// make a sustained C-E-G chord WAV
const SR=44100, dur=1.6, len=Math.round(SR*dur), pcm=Buffer.alloc(len*2), freqs=[261.63,329.63,392.0];
for(let i=0;i<len;i++){ const t=i/SR, fade=Math.min(i,len-i,2000)/2000; let v=0;
  for(const f of freqs) v+=Math.sin(2*Math.PI*f*t);
  pcm.writeInt16LE(Math.max(-1,Math.min(1,0.28*fade*v/3))*32767, i*2); }
const hd=Buffer.alloc(44); hd.write("RIFF",0); hd.writeUInt32LE(36+pcm.length,4); hd.write("WAVE",8);
hd.write("fmt ",12); hd.writeUInt32LE(16,16); hd.writeUInt16LE(1,20); hd.writeUInt16LE(1,22);
hd.writeUInt32LE(SR,24); hd.writeUInt32LE(SR*2,28); hd.writeUInt16LE(2,32); hd.writeUInt16LE(16,34);
hd.write("data",36); hd.writeUInt32LE(pcm.length,40);
writeFileSync("_chord.wav", Buffer.concat([hd,pcm]));

const b = await chromium.launch({ args:["--use-gl=swiftshader","--ignore-gpu-blocklist"] });
const p = await b.newPage();
await p.goto("https://vardhanreddy369.github.io/sheet-music-player/", { waitUntil:"networkidle" });
await p.check("#polyMode");
await p.locator("#uploadInput").setInputFiles("_chord.wav");
await p.waitForFunction(()=>/Done|couldn't|went wrong/i.test(document.getElementById("status").textContent), {timeout:120000}).catch(()=>{});
const notes = await p.locator("#notes").inputValue();
const chord = (notes.match(/\[[^\]]*\]/g)||[]).join(" ");
const ok = /C/.test(chord)&&/E/.test(chord)&&/G/.test(chord);
console.log("notes:", JSON.stringify(notes.trim()), "\nchord:", chord||"(none)");
console.log(ok ? "✅ polyphonic chord/harp mode works on live site" : "❌ failed");
await b.close(); unlinkSync("_chord.wav");
process.exit(ok?0:1);
