import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("https://vardhanreddy369.github.io/sheet-music-player/", { waitUntil: "networkidle" });

const result = await p.evaluate(async () => {
  const { hzToMidi, smoothMidi, framesToNotes } = await import("https://vardhanreddy369.github.io/sheet-music-player/music-theory.js");
  const { PitchDetector } = await import("https://esm.sh/pitchy@4");
  const ac = new (window.AudioContext||window.webkitAudioContext)();

  const INSTR = { flute:"flute-mp3", piano:"acoustic_grand_piano-mp3", violin:"violin-mp3", harp:"orchestral_harp-mp3" };
  const NAT = {0:"C",2:"D",4:"E",5:"F",7:"G",9:"A",11:"B"};
  const noteName = m => NAT[((m%12)+12)%12] + (Math.floor(m/12)-1);

  const MELODIES = {
    scale:   [60,62,64,65,67,69,71,72],
    twinkle: [60,60,67,67,69,69,67],
    leaps:   [60,67,64,72,69,65,60],
  };

  // fetch every needed real note recording, decode, cache
  const cache = {};
  async function getNote(dir, midi) {
    const key = dir+"/"+midi;
    if (cache[key]) return cache[key];
    const url = `https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/${dir}/${noteName(midi)}.mp3`;
    const ab = await (await fetch(url)).arrayBuffer();
    const buf = await ac.decodeAudioData(ab);
    return (cache[key] = buf);
  }

  // build melody audio from real samples (noteDurSec each, small fade to avoid clicks)
  async function buildMelody(dir, seq, noteDurSec, sr) {
    const noteLen = Math.round(noteDurSec*sr);
    const out = new Float32Array(noteLen*seq.length);
    for (let k=0;k<seq.length;k++){
      const buf = await getNote(dir, seq[k]);
      const src = buf.getChannelData(0);
      const ratio = buf.sampleRate/sr;
      for (let i=0;i<noteLen;i++){
        const si = Math.floor(i*ratio);
        const fade = Math.min(i, noteLen-i, 600)/600;
        out[k*noteLen + i] = (src[si]||0)*fade;
      }
    }
    return out;
  }

  const FRAME=2048, HOP=1024, SR=44100;
  function pipeline(samples, params){
    const det = PitchDetector.forFloat32Array(FRAME);
    const w = new Float32Array(FRAME); const fm=[];
    for (let i=0;i+FRAME<=samples.length;i+=HOP){
      w.set(samples.subarray(i,i+FRAME));
      let rms=0; for(let j=0;j<FRAME;j++) rms+=w[j]*w[j]; rms=Math.sqrt(rms/FRAME);
      const [hz,cl]=det.findPitch(w,SR);
      let m=null; if(cl>params.clarity && rms>params.rms && hz>65 && hz<3500) m=hzToMidi(hz);
      fm.push(m);
    }
    const notes = framesToNotes(smoothMidi(fm, params.smooth), HOP/SR, { minNoteSec: params.minNote });
    return notes.filter(n=>n.midi!==null).map(n=>n.midi);
  }
  // edit-distance accuracy: 1.0 = exact; penalises wrong, missing AND extra notes
  function score(det, truth){
    const m=det.length, n=truth.length;
    const dp=Array.from({length:m+1},(_,i)=>{const r=new Array(n+1).fill(0); r[0]=i; return r;});
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)
      dp[i][j]= det[i-1]===truth[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return 1 - dp[m][n]/Math.max(m,n,1);
  }

  // build all audio once
  const clips = [];
  for (const [iname,dir] of Object.entries(INSTR))
    for (const [mname,seq] of Object.entries(MELODIES)){
      const samples = await buildMelody(dir, seq, 0.5, SR);
      clips.push({ iname, mname, seq, samples });
    }


  // add a synthetic "real voice": vibrato + harmonics humming C E G c
  function synthVib(seq, sr){
    const noteLen=Math.round(0.5*sr); const out=new Float32Array(noteLen*seq.length);
    for(let k=0;k<seq.length;k++){ const hz=440*Math.pow(2,(seq[k]-69)/12);
      for(let i=0;i<noteLen;i++){ const t=i/sr; const fade=Math.min(i,noteLen-i,600)/600;
        const f=hz*Math.pow(2,(15/1200)*Math.sin(2*Math.PI*6*t)); let v=0;
        for(let h=1;h<=3;h++) v+=(1/h)*Math.sin(2*Math.PI*f*h*t);
        out[k*noteLen+i]=0.3*fade*(v/3); } }
    return out;
  }
  clips.push({ iname:"voice", mname:"vibrato", seq:[60,64,67,72], samples:synthVib([60,64,67,72],SR) });

  const baseline = { clarity:0.80, rms:0.012, smooth:3, minNote:0.09 };
  function evalParams(prm){
    let cleanTot=0, cleanN=0, vib=0; const per={};
    for (const c of clips){ const s=score(pipeline(c.samples,prm), c.seq);
      if (c.iname==="voice"){ vib=s; } else { cleanTot+=s; cleanN++; per[c.iname]=(per[c.iname]||0)+s; } }
    for (const k in per) per[k]=+(per[k]/Object.keys(MELODIES).length).toFixed(3);
    return { clean:+(cleanTot/cleanN).toFixed(3), vibrato:+vib.toFixed(3), per };
  }

  const base = evalParams(baseline);

  // sweep
  let best={prm:null,res:{clean:-1}};
  for (const clarity of [0.75,0.80,0.85])
   for (const rms of [0.010,0.014])
    for (const smooth of [2,3,4])
     for (const minNote of [0.06,0.08,0.10]){
       const prm={clarity,rms,smooth,minNote}; const r=evalParams(prm);
       // require it to still nail vibrato humming, then maximise clean accuracy
       if (r.vibrato>=0.99 && r.clean>best.res.clean){ best={prm, res:r}; }
     }
  return { baseline:{prm:baseline, ...base}, best };
});
console.log(JSON.stringify(result, null, 2));
await b.close();
