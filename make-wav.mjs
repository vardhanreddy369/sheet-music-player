// Writes a real 16-bit WAV of a C-E-G-c melody for the upload test.
import { writeFileSync } from "fs";
const SR = 44100;
const notes = [[261.63,0.5],[329.63,0.5],[392.0,0.5],[523.25,0.5]];
const total = notes.reduce((n,[,s])=>n+Math.round(s*SR),0);
const pcm = Buffer.alloc(total*2);
let p=0;
for (const [hz,sec] of notes){ const len=Math.round(sec*SR);
  for(let i=0;i<len;i++){ const fade=Math.min(i,len-i,400)/400;
    const v=0.3*fade*Math.sin(2*Math.PI*hz*(i/SR));
    pcm.writeInt16LE(Math.max(-1,Math.min(1,v))*32767, p); p+=2; } }
const h=Buffer.alloc(44); h.write("RIFF",0); h.writeUInt32LE(36+pcm.length,4);
h.write("WAVE",8); h.write("fmt ",12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20);
h.writeUInt16LE(1,22); h.writeUInt32LE(SR,24); h.writeUInt32LE(SR*2,28);
h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write("data",36); h.writeUInt32LE(pcm.length,40);
writeFileSync("melody-CEGc.wav", Buffer.concat([h,pcm]));
console.log("wrote melody-CEGc.wav", (44+pcm.length), "bytes");
