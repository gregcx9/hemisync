import { useState, useRef, useEffect, useCallback } from "react";

const APP_VERSION = "v2.7";

// ============ constants ============
const BANDS = [
  { hz: 2, name: "Delta", note: "deep sleep" },
  { hz: 4, name: "Theta", note: "meditation" },
  { hz: 6, name: "Theta+", note: "drowsy calm" },
  { hz: 10, name: "Alpha", note: "relaxed focus" },
  { hz: 18, name: "Beta", note: "alert" },
  { hz: 40, name: "Gamma", note: "high cognition" },
];
const bandFor = (hz) => {
  if (hz < 4) return { name: "Delta", note: "deep sleep" };
  if (hz < 8) return { name: "Theta", note: "meditation" };
  if (hz < 13) return { name: "Alpha", note: "relaxed focus" };
  if (hz < 30) return { name: "Beta", note: "alert" };
  return { name: "Gamma", note: "high cognition" };
};
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// ============ persistence (scripts + presets via KV, takes via IndexedDB) ============
const kv = {
  async get(key) {
    try { if (window.storage) { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; } } catch (e) {}
    try { const v = window.localStorage?.getItem(key); return v ? JSON.parse(v) : null; } catch (e) {}
    return null;
  },
  async set(key, val) {
    const json = JSON.stringify(val);
    try { if (window.storage) { await window.storage.set(key, json); return; } } catch (e) {}
    try { window.localStorage?.setItem(key, json); } catch (e) {}
  },
};
const SKEY = "hemisync-scripts-v1";
const PKEY = "hemisync-presets-v1";

// Take storage: audio bytes live in the Cache API (same durable bucket iOS
// uses for the installed app itself — survives reboots where IndexedDB doesn't).
// The take index (names/dates) lives in kv alongside scripts, which we know persists.
const TKEY = "hemisync-take-index-v1";
const TCACHE = "hemisync-takes";
const takeStore = {
  async index() { return (await kv.get(TKEY)) || []; },
  async saveIndex(list) { await kv.set(TKEY, list); },
  async putAudio(id, buf, mime) {
    const c = await caches.open(TCACHE);
    await c.put(`/__take__/${id}`, new Response(buf, { headers: { "Content-Type": mime || "audio/mp4" } }));
  },
  async getBlob(id) {
    const c = await caches.open(TCACHE);
    const r = await c.match(`/__take__/${id}`);
    return r ? await r.blob() : null;
  },
  async delAudio(id) {
    const c = await caches.open(TCACHE);
    await c.delete(`/__take__/${id}`);
  },
};

// legacy reader: pull any takes stranded in the old IndexedDB store (one-time migration)
const legacyIdb = {
  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open("hemisync", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("takes", { keyPath: "id" });
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  },
  async all() {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const tx = db.transaction("takes").objectStore("takes").getAll();
        tx.onsuccess = () => res(tx.result || []);
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { return []; }
  },
};
const takeToBlob = (t) => (t.blob instanceof Blob ? t.blob : new Blob([t.buf], { type: t.mime || "audio/mp4" }));

const SEED_SCRIPTS = [
  {
    id: "master-loop",
    title: "Master Loop",
    text: `This moment is enough.
I notice what is good.
I let good moments land.
Small things count double.
Joy needs no permission.
My body knows how to rest.
Every breath slows me down.
Rest is work my body does.
I listen when my body speaks.
My body and I are allies.
Each day, a little stronger.
Every moment of every day, I am getting better, better, and better.
What I practice, I become.
Every skill compounds quietly.
I choose the long game.
I own what I build.
I meet problems as they come.
I choose my next thought.
I choose lightness where I can.
I forgive myself, and mean it.
I am on my own side.
Steady beats perfect.
I am allowed to begin again.`,
  },
];

// ============ audio graph builder (shared by live + offline export) ============
// Builds tones + noise + voice into `dest`. Returns handles for live control.
function buildGraph(ctx, dest, cfg) {
  const {
    mode, base, beatFrom, beatTo, rampSec, // rampSec 0 = static at beatFrom
    noiseType, noiseVol,
    voiceBuf, voiceMode, voiceVol, pulseDepth,
  } = cfg;
  const t0 = ctx.currentTime;
  const handles = { oscs: [], lfos: [], nodes: [] };

  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(dest);
  handles.master = master;

  const schedBeat = (param, mult = 1, offset = 0) => {
    param.setValueAtTime(offset + beatFrom * mult, t0);
    if (rampSec > 0) param.linearRampToValueAtTime(offset + beatTo * mult, t0 + rampSec);
  };

  // ---- tones ----
  const toneBus = ctx.createGain();
  toneBus.gain.value = 0.9;
  toneBus.connect(master);
  handles.toneBus = toneBus;

  if (mode === "binaural") {
    const merger = ctx.createChannelMerger(2);
    merger.connect(toneBus);
    const mk = (sign, channel) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      // freq = base + sign * beat/2, ramped
      osc.frequency.setValueAtTime(base + (sign * beatFrom) / 2, t0);
      if (rampSec > 0) osc.frequency.linearRampToValueAtTime(base + (sign * beatTo) / 2, t0 + rampSec);
      const g = ctx.createGain();
      g.gain.value = 0.9;
      osc.connect(g); g.connect(merger, 0, channel);
      osc.start();
      handles.oscs.push(osc);
      return osc;
    };
    handles.oscL = mk(+1, 0);
    handles.oscR = mk(-1, 1);
  } else {
    // isochronic: one centered tone, gated on/off at the beat rate (no headphones needed)
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    schedBeat(lfo.frequency);
    const lfoAmp = ctx.createGain(); lfoAmp.gain.value = 0.45;
    const lfoOff = ctx.createConstantSource(); lfoOff.offset.value = 0.45;
    lfo.connect(lfoAmp); lfoAmp.connect(gate.gain); lfoOff.connect(gate.gain);
    lfo.start(); lfoOff.start();
    osc.connect(gate); gate.connect(toneBus);
    osc.start();
    handles.oscs.push(osc); handles.lfos.push(lfo, lfoOff);
    handles.isoOsc = osc; handles.isoLfo = lfo;
  }

  // ---- noise bed ----
  if (noiseType !== "off") {
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (noiseType === "air") {
      // pink noise (Paul Kellet)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      // deep (brown) noise
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = noiseVol;
    src.connect(ng); ng.connect(master);
    src.start();
    handles.noiseSrc = src; handles.noiseGain = ng;
  }

  // ---- voice ----
  if (voiceBuf) {
    const src = ctx.createBufferSource();
    src.buffer = voiceBuf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = voiceBuf.duration; // explicit — iOS can mishandle the implicit default
    const vGain = ctx.createGain(); vGain.gain.value = voiceVol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 24; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.2;

    if (voiceMode === "alternate") {
      // bilateral: voice sweeps L↔R at the beat rate
      const pan = ctx.createStereoPanner();
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      schedBeat(lfo.frequency);
      lfo.connect(pan.pan);
      lfo.start();
      src.connect(vGain); vGain.connect(pan); pan.connect(comp);
      handles.lfos.push(lfo); handles.voiceLfo = lfo;
    } else {
      // unison: tremolo throb in phase with the beat
      const trem = ctx.createGain();
      trem.gain.value = 1 - pulseDepth;
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      schedBeat(lfo.frequency);
      const lfoAmp = ctx.createGain(); lfoAmp.gain.value = pulseDepth / 2;
      const lfoOff = ctx.createConstantSource(); lfoOff.offset.value = pulseDepth / 2;
      lfo.connect(lfoAmp); lfoAmp.connect(trem.gain); lfoOff.connect(trem.gain);
      lfo.start(); lfoOff.start();
      src.connect(trem); trem.connect(vGain); vGain.connect(comp);
      handles.lfos.push(lfo, lfoOff); handles.voiceLfo = lfo;
      handles.trem = { trem, lfoAmp, lfoOff };
    }
    comp.connect(master);
    src.start();
    handles.voiceSrc = src; handles.voiceGain = vGain;
  }

  return handles;
}

// WAV encoder (16-bit PCM stereo)
function encodeWav(audioBuffer) {
  const nCh = audioBuffer.numberOfChannels;
  const rate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const bytes = 44 + frames * nCh * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const wStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wStr(0, "RIFF"); v.setUint32(4, bytes - 8, true); wStr(8, "WAVE");
  wStr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  wStr(36, "data"); v.setUint32(40, frames * nCh * 2, true);
  let o = 44;
  const chans = [];
  for (let c = 0; c < nCh; c++) chans.push(audioBuffer.getChannelData(c));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < nCh; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new Blob([ab], { type: "audio/wav" });
}

// ============ component ============
export default function App() {
  // core
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState("binaural"); // binaural | isochronic
  const [beat, setBeat] = useState(4);
  const [base, setBase] = useState(200);
  const [volume, setVolume] = useState(0.5);
  const [elapsed, setElapsed] = useState(0);
  // ramp + timer
  const [rampOn, setRampOn] = useState(false);
  const [rampFrom, setRampFrom] = useState(10);
  const [rampMin, setRampMin] = useState(10);
  const [timerMin, setTimerMin] = useState(0); // 0 = off
  // noise
  const [noiseType, setNoiseType] = useState("off"); // off | air | deep
  const [noiseVol, setNoiseVol] = useState(0.25);
  // voice
  const [voiceReady, setVoiceReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceVol, setVoiceVol] = useState(1.2);
  const [pulseDepth, setPulseDepth] = useState(0.65);
  const [voiceMode, setVoiceMode] = useState("unison"); // unison | alternate
  const [takes, setTakes] = useState([]);
  const [activeTakeId, setActiveTakeId] = useState(null);
  // scripts
  const [scripts, setScripts] = useState(SEED_SCRIPTS);
  const [activeScriptId, setActiveScriptId] = useState("master-loop");
  const [readerOpen, setReaderOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // presets
  const [presets, setPresets] = useState([]);
  // export
  const [exporting, setExporting] = useState(false);
  const [exportMin, setExportMin] = useState(3);
  const [exportUrl, setExportUrl] = useState(null);

  const ctxRef = useRef(null);
  const graphRef = useRef(null);
  const sessionGainRef = useRef(null);
  const audioElRef = useRef(null);
  const timerRef = useRef(null);
  const stopTimeoutRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const phaseRef = useRef(0);
  const recRef = useRef(null);
  const recChunksRef = useRef([]);
  const recBlobRef = useRef(null);
  const voiceBufRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadedRef = useRef(false);
  const reduced = useRef(false);
  const startedAtRef = useRef(0);

  const effBeatFrom = rampOn ? rampFrom : beat;
  const effBeatTo = beat;
  const band = bandFor(beat);
  const remaining = timerMin > 0 ? timerMin * 60 - elapsed : null;

  useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // ---------- load persisted ----------
  const [storageOk, setStorageOk] = useState(true);
  useEffect(() => {
    // ask iOS/browsers to mark our storage durable (silently ignored if unsupported)
    try { navigator.storage?.persist?.(); } catch (e) {}
    // self-test: write→read→delete a probe record; if this fails, the phone is
    // blocking app storage and we fall back to saving recordings to Files
    (async () => {
      try {
        await takeStore.putAudio("__probe__", new TextEncoder().encode("ok").buffer, "text/plain");
        const b = await takeStore.getBlob("__probe__");
        await takeStore.delAudio("__probe__");
        setStorageOk(!!b);
      } catch (e) { setStorageOk(false); }
    })();
    (async () => {
      const s = await kv.get(SKEY);
      if (s?.length) { setScripts(s); setActiveScriptId(s[0].id); }
      const p = await kv.get(PKEY);
      if (p?.length) setPresets(p);
      let index = await takeStore.index();
      // one-time rescue of takes stranded in old IndexedDB storage
      try {
        const legacy = await legacyIdb.all();
        for (const t of legacy.filter((x) => x.id !== "__probe__" && !index.some((i) => i.id === x.id))) {
          const blob = takeToBlob(t);
          await takeStore.putAudio(t.id, await blob.arrayBuffer(), blob.type);
          index = [{ id: t.id, name: t.name, date: t.date, mime: blob.type }, ...index];
        }
        if (legacy.length) await takeStore.saveIndex(index);
      } catch (e) {}
      setTakes(index.map(({ id, name, date }) => ({ id, name, date })));
      loadedRef.current = true;
    })();
  }, []);
  useEffect(() => { if (loadedRef.current) kv.set(SKEY, scripts); }, [scripts]);
  useEffect(() => { if (loadedRef.current) kv.set(PKEY, presets); }, [presets]);

  // ---------- start/stop ----------
  const start = useCallback(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    ctxRef.current = ctx;

    // session gain: fade-in, timer fade-out, master volume
    const session = ctx.createGain();
    session.gain.setValueAtTime(0.0001, ctx.currentTime);
    const fadeIn = timerMin > 0 ? 20 : 5;
    session.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), ctx.currentTime + fadeIn);
    sessionGainRef.current = session;

    const rampSec = rampOn ? rampMin * 60 : 0;
    graphRef.current = buildGraph(ctx, session, {
      mode, base,
      beatFrom: effBeatFrom, beatTo: effBeatTo, rampSec,
      noiseType, noiseVol,
      voiceBuf: voiceBufRef.current, voiceMode, voiceVol, pulseDepth,
    });

    // background playback via media element
    const streamDest = ctx.createMediaStreamDestination();
    session.connect(streamDest);
    const el = audioElRef.current;
    if (el) {
      el.srcObject = streamDest.stream;
      el.play().catch(() => session.connect(ctx.destination));
    } else session.connect(ctx.destination);

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${mode === "binaural" ? "Binaural" : "Isochronic"} — ${beat.toFixed(1)} Hz`,
        artist: "Hemisync", album: "Focus tones",
      });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => { ctxRef.current?.resume(); audioElRef.current?.play(); });
      navigator.mediaSession.setActionHandler("pause", () => stopRef.current?.());
    }

    // session timer: fade out over the last 30s, then stop
    if (timerMin > 0) {
      const total = timerMin * 60;
      const g = session.gain;
      g.setTargetAtTime(0.0001, ctx.currentTime + total - 30, 8);
      stopTimeoutRef.current = setTimeout(() => stopRef.current?.(), total * 1000);
    }

    startedAtRef.current = Date.now();
    setElapsed(0);
    setPlaying(true);
  }, [mode, base, beat, effBeatFrom, effBeatTo, rampOn, rampMin, noiseType, noiseVol, voiceMode, voiceVol, pulseDepth, volume, timerMin]);

  const stop = useCallback(() => {
    clearTimeout(stopTimeoutRef.current);
    const ctx = ctxRef.current;
    if (ctx && sessionGainRef.current) {
      const g = sessionGainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(Math.max(g.value, 0.0001), ctx.currentTime);
      g.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      setTimeout(() => {
        try {
          graphRef.current?.oscs.forEach((o) => o.stop());
          graphRef.current?.lfos.forEach((o) => o.stop());
          graphRef.current?.noiseSrc?.stop();
          graphRef.current?.voiceSrc?.stop();
          ctx.close();
        } catch (e) {}
        ctxRef.current = null; graphRef.current = null;
        if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.srcObject = null; }
      }, 550);
    }
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    setPlaying(false);
  }, []);
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  const toggle = () => (playing ? stop() : start());

  // resume when returning from background
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && playing) {
        ctxRef.current?.resume();
        audioElRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [playing]);

  // ---------- live parameter updates (only when NOT ramping) ----------
  useEffect(() => {
    const ctx = ctxRef.current, g = graphRef.current;
    if (!ctx || !playing || !g || rampOn) return;
    const t = ctx.currentTime;
    if (g.oscL) {
      g.oscL.frequency.setTargetAtTime(base + beat / 2, t, 0.05);
      g.oscR.frequency.setTargetAtTime(base - beat / 2, t, 0.05);
    }
    if (g.isoOsc) g.isoOsc.frequency.setTargetAtTime(base, t, 0.05);
    if (g.isoLfo) g.isoLfo.frequency.setTargetAtTime(beat, t, 0.05);
    if (g.voiceLfo) g.voiceLfo.frequency.setTargetAtTime(beat, t, 0.05);
  }, [base, beat, playing, rampOn]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playing || !sessionGainRef.current) return;
    sessionGainRef.current.gain.setTargetAtTime(Math.max(volume, 0.0001), ctx.currentTime, 0.1);
  }, [volume, playing]);

  useEffect(() => {
    const ctx = ctxRef.current, g = graphRef.current;
    if (!ctx || !playing || !g?.voiceGain) return;
    g.voiceGain.gain.setTargetAtTime(voiceVol, ctx.currentTime, 0.05);
  }, [voiceVol, playing]);

  useEffect(() => {
    const ctx = ctxRef.current, g = graphRef.current;
    if (!ctx || !playing || !g?.trem) return;
    const t = ctx.currentTime;
    g.trem.trem.gain.setTargetAtTime(1 - pulseDepth, t, 0.05);
    g.trem.lfoAmp.gain.setTargetAtTime(pulseDepth / 2, t, 0.05);
    g.trem.lfoOff.offset.setTargetAtTime(pulseDepth / 2, t, 0.05);
  }, [pulseDepth, playing]);

  useEffect(() => {
    const ctx = ctxRef.current, g = graphRef.current;
    if (!ctx || !playing || !g?.noiseGain) return;
    g.noiseGain.gain.setTargetAtTime(noiseVol, ctx.currentTime, 0.1);
  }, [noiseVol, playing]);

  // elapsed timer
  useEffect(() => {
    if (playing) timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [playing]);

  useEffect(() => () => { try { stopRef.current?.(); } catch (e) {} }, []);

  // ---------- scripts ----------
  const activeScript = scripts.find((s) => s.id === activeScriptId) || null;
  const saveScript = () => {
    if (!editing?.title.trim() || !editing?.text.trim()) return;
    if (editing.id) {
      setScripts((p) => p.map((s) => (s.id === editing.id ? { ...s, title: editing.title, text: editing.text } : s)));
      setActiveScriptId(editing.id);
    } else {
      const id = "s" + Date.now();
      setScripts((p) => [...p, { id, title: editing.title, text: editing.text }]);
      setActiveScriptId(id);
    }
    setEditing(null);
  };
  const deleteScript = (id) => {
    if (!confirm("Delete this script?")) return;
    setScripts((p) => {
      const n = p.filter((s) => s.id !== id);
      if (activeScriptId === id) setActiveScriptId(n[0]?.id ?? null);
      return n;
    });
    setEditing(null);
  };

  // ---------- voice takes ----------
  const decodeBlob = async (blob) => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const tmp = new AC();
    const decoded = await tmp.decodeAudioData(await blob.arrayBuffer());
    tmp.close();
    voiceBufRef.current = decoded;
    setVoiceReady(true);
  };

  const wakeLockRef = useRef(null);
  const [recSec, setRecSec] = useState(0);
  const recTimerRef = useRef(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // keep the screen awake so iOS doesn't auto-lock and kill the mic mid-read
      try { wakeLockRef.current = await navigator.wakeLock?.request("screen"); } catch (e) {}
      const rec = new MediaRecorder(stream);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => recChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType });
        recBlobRef.current = blob;
        await decodeBlob(blob);
        // save into take library — user names it (prompt pre-filled)
        const suggested = (activeScript?.title || "Take") + " · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        let name = suggested;
        try { name = (window.prompt("Name this recording:", suggested) || suggested).trim() || suggested; } catch (e) {}
        const buf = await blob.arrayBuffer();
        const id = "t" + Date.now();
        const mime = blob.type || "audio/mp4";
        await takeStore.putAudio(id, buf, mime);
        const index = [{ id, name, date: Date.now(), mime }, ...(await takeStore.index())];
        await takeStore.saveIndex(index);
        setTakes(index.map(({ id: i2, name: n2, date: d2 }) => ({ id: i2, name: n2, date: d2 })));
        setActiveTakeId(id);
        // Files is the permanent home for every recording — always save a copy.
        // (This device wipes browser audio storage on reboot; Files cannot be wiped.)
        const ext = (blob.type || "").includes("webm") ? "webm" : "m4a";
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${name.replace(/[^\w\-· ]+/g, "").trim() || "take"}.${ext}`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      rec.start(1000); // collect every second — an interruption keeps everything up to it
      recRef.current = rec;
      setRecording(true);
      setRecSec(0);
      recTimerRef.current = setInterval(() => setRecSec((x) => x + 1), 1000);
    } catch (e) {
      alert("Microphone unavailable here — use 'upload audio', or open the app in Safari.");
    }
  };
  const stopRecording = () => {
    recRef.current?.stop();
    setRecording(false);
    clearInterval(recTimerRef.current);
    try { wakeLockRef.current?.release(); wakeLockRef.current = null; } catch (e) {}
  };

  // wake locks are dropped when the page backgrounds — reacquire if still recording
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === "visible" && recording && !wakeLockRef.current) {
        try { wakeLockRef.current = await navigator.wakeLock?.request("screen"); } catch (e) {}
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [recording]);

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    if (f) {
      await decodeBlob(f);
      const suggested = f.name.replace(/\.[^.]+$/, "");
      let name = suggested;
      try { name = (window.prompt("Name this recording:", suggested) || suggested).trim() || suggested; } catch (e) {}
      const buf = await f.arrayBuffer();
      const id = "t" + Date.now();
      const mime = f.type || "audio/mp4";
      await takeStore.putAudio(id, buf, mime);
      const index = [{ id, name, date: Date.now(), mime }, ...(await takeStore.index())];
      await takeStore.saveIndex(index);
      setTakes(index.map(({ id: i2, name: n2, date: d2 }) => ({ id: i2, name: n2, date: d2 })));
      setActiveTakeId(id);
    }
    e.target.value = "";
  };

  const loadTake = async (id) => {
    const blob = await takeStore.getBlob(id);
    if (blob) { await decodeBlob(blob); setActiveTakeId(id); }
    else alert("This take's audio is missing from storage.");
  };
  const deleteTake = async (id) => {
    if (!confirm("Delete this take?")) return;
    await takeStore.delAudio(id);
    const index = (await takeStore.index()).filter((t) => t.id !== id);
    await takeStore.saveIndex(index);
    setTakes((p) => p.filter((t) => t.id !== id));
    if (activeTakeId === id) { voiceBufRef.current = null; setVoiceReady(false); setActiveTakeId(null); }
  };
  const clearVoice = () => { voiceBufRef.current = null; setVoiceReady(false); setActiveTakeId(null); };

  const renameTake = async (id) => {
    const cur = takes.find((t) => t.id === id);
    let name = null;
    try { name = window.prompt("Rename take:", cur?.name || ""); } catch (e) {}
    if (!name || !name.trim()) return;
    name = name.trim();
    const index = (await takeStore.index()).map((x) => (x.id === id ? { ...x, name } : x));
    await takeStore.saveIndex(index);
    setTakes((p) => p.map((x) => (x.id === id ? { ...x, name } : x)));
  };

  const exportTake = async (id) => {
    const t = takes.find((x) => x.id === id);
    const blob = await takeStore.getBlob(id);
    if (!t || !blob) return;
    const ext = (blob.type || "").includes("webm") ? "webm" : (blob.type || "").includes("mpeg") ? "mp3" : "m4a";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.name.replace(/[^\w\-· ]+/g, "").trim() || "take"}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const previewRef = useRef(null);
  const [previewingId, setPreviewingId] = useState(null);
  const previewTake = async (id) => {
    // dry listen: the take alone, no tones
    if (previewingId === id) {
      previewRef.current?.pause();
      previewRef.current = null;
      setPreviewingId(null);
      return;
    }
    previewRef.current?.pause();
    const blob0 = await takeStore.getBlob(id);
    if (!blob0) return;
    const url = URL.createObjectURL(blob0);
    const a = new Audio(url);
    a.onended = () => { setPreviewingId(null); URL.revokeObjectURL(url); };
    a.play().catch(() => {});
    previewRef.current = a;
    setPreviewingId(id);
  };

  // ---------- presets ----------
  const savePreset = () => {
    const name = prompt("Preset name:", `${band.name} ${beat} Hz${timerMin ? ` · ${timerMin}m` : ""}`);
    if (!name) return;
    const p = { id: "p" + Date.now(), name, beat, base, mode, voiceMode, pulseDepth, noiseType, noiseVol, rampOn, rampFrom, rampMin, timerMin, volume };
    setPresets((prev) => [...prev, p]);
  };
  const applyPreset = (p) => {
    setBeat(p.beat); setBase(p.base); setMode(p.mode); setVoiceMode(p.voiceMode);
    setPulseDepth(p.pulseDepth); setNoiseType(p.noiseType); setNoiseVol(p.noiseVol);
    setRampOn(p.rampOn); setRampFrom(p.rampFrom); setRampMin(p.rampMin);
    setTimerMin(p.timerMin); setVolume(p.volume);
  };
  const deletePreset = (id) => setPresets((p) => p.filter((x) => x.id !== id));

  // ---------- WAV export ----------
  const exportWav = async () => {
    setExporting(true);
    setExportUrl(null);
    try {
      const rate = 44100;
      const seconds = exportMin * 60;
      const off = new OfflineAudioContext(2, rate * seconds, rate);
      const session = off.createGain();
      session.gain.setValueAtTime(0.0001, 0);
      session.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), 5);
      // fade last 10s
      session.gain.setValueAtTime(Math.max(volume, 0.0001), seconds - 10);
      session.gain.exponentialRampToValueAtTime(0.0001, seconds - 0.05);
      session.connect(off.destination);
      const rampSec = rampOn ? Math.min(rampMin * 60, seconds) : 0;
      buildGraph(off, session, {
        mode, base,
        beatFrom: rampOn ? rampFrom : beat, beatTo: beat, rampSec,
        noiseType, noiseVol,
        voiceBuf: voiceBufRef.current, voiceMode, voiceVol, pulseDepth,
      });
      const rendered = await off.startRendering();
      const blob = encodeWav(rendered);
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
    } catch (e) {
      alert("Export failed: " + e.message);
    }
    setExporting(false);
  };

  // ---------- waveform visual ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const c = canvas.getContext("2d");
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = () => {
      const w = canvas.width, h = canvas.height;
      c.clearRect(0, 0, w, h);
      const t = playing && !reduced.current ? phaseRef.current : 0;
      [{ y: h * 0.24, col: "#E8A34C" }, { y: h * 0.46, col: "#63C2B0" }].forEach((r, i) => {
        c.beginPath();
        for (let x = 0; x <= w; x += 2 * dpr) {
          const y = r.y + Math.sin((x / w) * 7 * Math.PI * 2 + t + i * 0.5) * h * 0.08;
          x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.strokeStyle = r.col; c.lineWidth = 1.5 * dpr; c.globalAlpha = 0.9; c.stroke();
      });
      c.beginPath();
      const bc = Math.max(beat * 0.5, 0.5);
      for (let x = 0; x <= w; x += 2 * dpr) {
        const carrier = Math.sin((x / w) * 12 * Math.PI * 2 + t * 1.4);
        const env = Math.cos((x / w) * bc * Math.PI + t * 0.35);
        const y = h * 0.78 + carrier * env * h * 0.13;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.strokeStyle = "#EDE9E0"; c.lineWidth = 1.5 * dpr; c.globalAlpha = 0.85; c.stroke();
      c.globalAlpha = 1;
      if (playing && !reduced.current) { phaseRef.current += 0.045; rafRef.current = requestAnimationFrame(draw); }
    };
    draw();
    if (playing && !reduced.current) rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, [playing, beat]);

  // ---------- UI ----------
  const S = styles;
  const Chip = ({ on, children, ...rest }) => (
    <button className="chip" style={{
      ...S.chip, background: on ? "#EDE9E0" : "transparent",
      color: on ? "#14101F" : "#C9C2D8", borderColor: on ? "#EDE9E0" : "#2C2540",
    }} {...rest}>{children}</button>
  );
  const Row = ({ label, val }) => (
    <div style={S.sliderHead}><span style={S.sliderLabel}>{label}</span><span style={S.sliderValue}>{val}</span></div>
  );

  return (
    <div style={S.page}>
      <style>{css}</style>
      <audio ref={audioElRef} playsInline style={{ display: "none" }} />

      <header style={S.header}>
        <div style={S.brand}>HEMISYNC <span style={{ fontSize: 9, color: "#9A92AC", letterSpacing: "0.1em" }}>{APP_VERSION}</span></div>
        <div style={S.headphones}>{mode === "binaural" ? "⚠ Stereo headphones required" : "Speaker-friendly mode"}</div>
      </header>

      {/* readout */}
      <section style={S.readout}>
        <div style={S.beatBig}>
          {beat.toFixed(1)}<span style={S.beatUnit}>Hz beat</span>
        </div>
        <div style={S.band}>
          {band.name} · {band.note}
          {rampOn && <span style={{ color: "#9A92AC" }}> · ramping {rampFrom}→{beat} Hz over {rampMin}m</span>}
        </div>
        {mode === "binaural" && (
          <div style={S.earsRow}>
            <span style={{ color: "#E8A34C" }}>L {(base + beat / 2).toFixed(1)}</span>
            <span style={S.earsDivider}>Δ {beat.toFixed(1)}</span>
            <span style={{ color: "#63C2B0" }}>R {(base - beat / 2).toFixed(1)}</span>
          </div>
        )}
        <canvas ref={canvasRef} style={S.canvas} />
      </section>

      {/* mode + presets */}
      <div style={S.chipsRow}>
        <Chip on={mode === "binaural"} onClick={() => setMode("binaural")}>
          <span style={S.chipHz}>Binaural</span><span style={S.chipName}>headphones</span>
        </Chip>
        <Chip on={mode === "isochronic"} onClick={() => setMode("isochronic")}>
          <span style={S.chipHz}>Isochronic</span><span style={S.chipName}>any speaker</span>
        </Chip>
      </div>
      <div style={S.chipsRow}>
        {BANDS.map((b) => (
          <Chip key={b.hz} on={!rampOn && beat === b.hz} onClick={() => setBeat(b.hz)}>
            <span style={S.chipHz}>{b.hz} Hz</span><span style={S.chipName}>{b.name}</span>
          </Chip>
        ))}
      </div>

      {/* my presets */}
      {presets.length > 0 && (
        <div style={S.chipsRow}>
          {presets.map((p) => (
            <button key={p.id} className="chip" style={{ ...S.chip, minWidth: 0, padding: "8px 12px", borderColor: "#4A415F", color: "#C9C2D8" }}
              onClick={() => applyPreset(p)}
              onDoubleClick={() => deletePreset(p.id)}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>★ {p.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* session: ramp + timer */}
      <section style={S.panel}>
        <div style={S.voiceHead}>
          <span style={S.sliderLabel}>Session</span>
          <button className="chip" style={S.tinyBtn} onClick={savePreset}>★ save preset</button>
        </div>
        <div style={S.chipsRowTight}>
          <Chip on={!rampOn} onClick={() => setRampOn(false)}><span style={S.chipSm}>Steady</span></Chip>
          <Chip on={rampOn} onClick={() => setRampOn(true)}><span style={S.chipSm}>Ramp ↓</span></Chip>
        </div>
        {rampOn && (
          <>
            <Row label="Start at" val={`${rampFrom} Hz`} />
            <input type="range" min={1} max={40} step={0.5} value={rampFrom} onChange={(e) => setRampFrom(Number(e.target.value))}
              style={{ ...S.range, accentColor: "#9A92AC" }} aria-label="Ramp start" />
            <Row label="Glide time" val={`${rampMin} min`} />
            <input type="range" min={1} max={45} step={1} value={rampMin} onChange={(e) => setRampMin(Number(e.target.value))}
              style={{ ...S.range, accentColor: "#9A92AC" }} aria-label="Ramp duration" />
            <div style={S.hint}>Starts at {rampFrom} Hz, glides to {beat} Hz (the main dial) over {rampMin} min.</div>
          </>
        )}
        <Row label="Auto-stop timer" val={timerMin === 0 ? "off" : `${timerMin} min`} />
        <div style={S.chipsRowTight}>
          {[0, 15, 30, 45, 60, 90].map((m) => (
            <Chip key={m} on={timerMin === m} onClick={() => setTimerMin(m)}>
              <span style={S.chipSm}>{m === 0 ? "∞" : `${m}m`}</span>
            </Chip>
          ))}
        </div>
        {timerMin > 0 && <div style={S.hint}>Fades in over 20s, fades out over the last 30s, stops itself.</div>}
      </section>

      {/* noise bed */}
      <section style={S.panel}>
        <Row label="Noise bed" val={noiseType === "off" ? "off" : noiseType === "air" ? "air (pink)" : "deep (brown)"} />
        <div style={S.chipsRowTight}>
          <Chip on={noiseType === "off"} onClick={() => setNoiseType("off")}><span style={S.chipSm}>Off</span></Chip>
          <Chip on={noiseType === "air"} onClick={() => setNoiseType("air")}><span style={S.chipSm}>Air</span></Chip>
          <Chip on={noiseType === "deep"} onClick={() => setNoiseType("deep")}><span style={S.chipSm}>Deep</span></Chip>
        </div>
        {noiseType !== "off" && (
          <>
            <Row label="Noise level" val={`${Math.round(noiseVol * 100)}%`} />
            <input type="range" min={0} max={100} value={Math.round(noiseVol * 100)} onChange={(e) => setNoiseVol(Number(e.target.value) / 100)}
              style={{ ...S.range, accentColor: "#9A92AC" }} aria-label="Noise level" />
          </>
        )}
        {noiseType !== "off" && playing && <div style={S.hint}>Noise changes take effect on next play.</div>}
      </section>

      {/* scripts */}
      <section style={S.panel}>
        <div style={S.voiceHead}>
          <span style={S.sliderLabel}>Scripts</span>
          <button className="chip" style={S.tinyBtn} onClick={() => setEditing({ title: "", text: "" })}>+ new</button>
        </div>
        <div style={S.chipsRowTight}>
          {scripts.map((s) => (
            <button key={s.id} className="chip" onClick={() => setActiveScriptId(s.id)}
              style={{ ...S.chip, minWidth: 0, padding: "8px 12px",
                background: s.id === activeScriptId ? "#EDE9E0" : "transparent",
                color: s.id === activeScriptId ? "#14101F" : "#C9C2D8",
                borderColor: s.id === activeScriptId ? "#EDE9E0" : "#2C2540" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{s.title}</span>
            </button>
          ))}
        </div>
        {activeScript && !editing && (
          <div style={S.btnRow}>
            <button className="chip" style={S.voiceBtn} onClick={() => setReaderOpen(true)}>☰ read &amp; record</button>
            <button className="chip" style={S.voiceBtn} onClick={() => setEditing({ ...activeScript })}>✎ edit</button>
            {scripts.length > 1 && (
              <button className="chip" style={{ ...S.voiceBtn, color: "#9A92AC" }} onClick={() => deleteScript(activeScript.id)}>✕</button>
            )}
          </div>
        )}
        {editing && (
          <div style={{ marginTop: 10 }}>
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="Script title" style={S.textInput} maxLength={40} />
            <textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              placeholder="One line per affirmation…" style={S.textarea} rows={8} />
            <div style={S.btnRow}>
              <button className="chip" style={{ ...S.voiceBtn, background: "#EDE9E0", color: "#14101F", borderColor: "#EDE9E0" }} onClick={saveScript}>save</button>
              <button className="chip" style={S.voiceBtn} onClick={() => setEditing(null)}>cancel</button>
            </div>
          </div>
        )}
      </section>

      {/* teleprompter */}
      {readerOpen && activeScript && (
        <div style={S.reader}>
          <div style={S.readerHead}>
            <span style={{ ...S.sliderLabel, fontSize: 14 }}>{activeScript.title}</span>
            <button className="chip" style={S.tinyBtn} onClick={() => setReaderOpen(false)}>✕ close</button>
          </div>
          <div style={S.readerBody}>
            {activeScript.text.split("\n").filter(Boolean).map((line, i) => (
              <p key={i} style={S.readerLine}>{line}</p>
            ))}
          </div>
          {recording && <div style={{ ...S.hint, textAlign: "center" }}>Screen stays awake while recording — keep the app open and in view.</div>}
          <div style={S.readerFoot}>
            <button className="chip" onClick={recording ? stopRecording : startRecording}
              style={{ ...S.voiceBtn, flex: 1, textAlign: "center", padding: "14px 0", fontSize: 15,
                background: recording ? "#C2564B" : "#EDE9E0", color: recording ? "#EDE9E0" : "#14101F",
                borderColor: recording ? "#C2564B" : "#EDE9E0" }}>
              {recording ? `◼ stop — save take · ${fmtTime(recSec)}` : "● record this script"}
            </button>
          </div>
        </div>
      )}

      {/* voice */}
      <section style={S.panel}>
        <div style={S.voiceHead}>
          <span style={S.sliderLabel}>Voice · pulsed at the beat</span>
          {voiceReady && <span style={S.voiceOn}>● loaded — loops under Play</span>}
        </div>
        {!storageOk && (
          <div style={{ ...S.hint, color: "#E8A34C", border: "1px solid #4A415F", borderRadius: 8, padding: "8px 10px", marginBottom: 4 }}>
            ⚠ This phone is blocking in-app audio storage. No recordings are
            lost — every take auto-saves to Files (Downloads). Load one back
            any time with ⇧ upload.
          </div>
        )}
        <div style={S.btnRow}>
          <button className="chip" onClick={recording ? stopRecording : startRecording}
            style={{ ...S.voiceBtn, background: recording ? "#C2564B" : "transparent",
              color: recording ? "#EDE9E0" : "#C9C2D8", borderColor: recording ? "#C2564B" : "#2C2540" }}>
            {recording ? `◼ stop · ${fmtTime(recSec)}` : "● record"}
          </button>
          <button className="chip" onClick={() => fileInputRef.current?.click()} style={S.voiceBtn}>⇧ upload</button>
          {voiceReady && <button className="chip" onClick={clearVoice} style={{ ...S.voiceBtn, color: "#9A92AC" }}>✕ unload</button>}
          <input ref={fileInputRef} type="file" accept="audio/*" onChange={onUpload} style={{ display: "none" }} />
        </div>

        {takes.length > 0 && (
          <>
            <div style={{ ...S.sliderHead, marginTop: 12 }}><span style={S.sliderLabel}>Take library — tap a name to load it for playback</span></div>
            <div style={S.hint}>Every recording auto-saves to Files (Downloads) as your permanent copy.
              This list is a quick-access cache — if it's ever empty after a restart,
              tap ⇧ upload and pick the file from Downloads.</div>
            <div style={S.takeList}>
              {takes.map((t) => (
                <div key={t.id} style={{ ...S.takeRow, borderColor: t.id === activeTakeId ? "#E8A34C" : "#2C2540" }}>
                  <button style={S.takeName} onClick={() => loadTake(t.id)}>
                    {t.id === activeTakeId ? "▶ " : ""}{t.name}
                  </button>
                  <button style={{ ...S.takeDel, color: previewingId === t.id ? "#E8A34C" : "#9A92AC" }}
                    title="listen dry" onClick={() => previewTake(t.id)}>
                    {previewingId === t.id ? "◼" : "▷"}
                  </button>
                  <button style={S.takeDel} title="rename" onClick={() => renameTake(t.id)}>✎</button>
                  <button style={S.takeDel} title="save to Files" onClick={() => exportTake(t.id)}>⬇</button>
                  <button style={S.takeDel} title="delete" onClick={() => deleteTake(t.id)}>✕</button>
                </div>
              ))}
            </div>
          </>
        )}

        {voiceReady && (
          <>
            <div style={{ ...S.sliderHead, marginTop: 12 }}><span style={S.sliderLabel}>Pulse style</span></div>
            <div style={S.chipsRowTight}>
              <Chip on={voiceMode === "unison"} onClick={() => setVoiceMode("unison")}>
                <span style={S.chipSm}>Unison throb</span>
              </Chip>
              <Chip on={voiceMode === "alternate"} onClick={() => setVoiceMode("alternate")}>
                <span style={S.chipSm}>Alternating L/R</span>
              </Chip>
            </div>
            {voiceMode === "alternate" && playing && <div style={S.hint}>Mode changes take effect on next play.</div>}

            <Row label="Voice level" val={`${Math.round(voiceVol * 100)}%`} />
            <input type="range" min={0} max={400} value={Math.round(voiceVol * 100)} onChange={(e) => setVoiceVol(Number(e.target.value) / 100)}
              style={{ ...S.range, accentColor: "#E8A34C" }} aria-label="Voice level" />
            {voiceMode === "unison" && (
              <>
                <Row label="Pulse depth" val={`${Math.round(pulseDepth * 100)}%`} />
                <input type="range" min={0} max={100} value={Math.round(pulseDepth * 100)} onChange={(e) => setPulseDepth(Number(e.target.value) / 100)}
                  style={{ ...S.range, accentColor: "#E8A34C" }} aria-label="Pulse depth" />
              </>
            )}
          </>
        )}
      </section>

      {/* transport */}
      <section style={S.transport}>
        <button onClick={toggle} className="playBtn"
          style={{ ...S.playBtn, background: playing ? "#2A2438" : "#EDE9E0",
            color: playing ? "#EDE9E0" : "#14101F", borderColor: playing ? "#4A415F" : "#EDE9E0" }}>
          {playing ? "◼ Stop" : "▶ Play"}
        </button>
        <div style={S.timerCol}>
          <div style={S.timer}>{fmtTime(elapsed)}</div>
          {remaining !== null && playing && <div style={S.remaining}>−{fmtTime(remaining)}</div>}
        </div>
      </section>

      {/* main sliders */}
      <section style={S.controls}>
        <div>
          <Row label={rampOn ? "End beat (ramp target)" : "Beat frequency"} val={`${beat.toFixed(1)} Hz`} />
          <input type="range" min={0.5} max={40} step={0.5} value={beat} onChange={(e) => setBeat(Number(e.target.value))}
            style={{ ...S.range, accentColor: "#EDE9E0" }} aria-label="Beat frequency" />
        </div>
        <div>
          <Row label="Carrier pitch" val={`${base} Hz`} />
          <input type="range" min={100} max={500} step={1} value={base} onChange={(e) => setBase(Number(e.target.value))}
            style={{ ...S.range, accentColor: "#9A92AC" }} aria-label="Carrier pitch" />
        </div>
        <div>
          <Row label="Volume" val={`${Math.round(volume * 100)}%`} />
          <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)}
            style={{ ...S.range, accentColor: "#9A92AC" }} aria-label="Volume" />
        </div>
      </section>

      {/* export */}
      <section style={S.panel}>
        <div style={S.voiceHead}>
          <span style={S.sliderLabel}>Export session → WAV</span>
        </div>
        <div style={S.chipsRowTight}>
          {[1, 3, 5, 10].map((m) => (
            <Chip key={m} on={exportMin === m} onClick={() => setExportMin(m)}><span style={S.chipSm}>{m} min</span></Chip>
          ))}
        </div>
        <div style={S.btnRow}>
          <button className="chip" style={{ ...S.voiceBtn, flex: 1, textAlign: "center" }} onClick={exportWav} disabled={exporting}>
            {exporting ? "rendering…" : "⬇ render current settings"}
          </button>
        </div>
        {exportUrl && (
          <a href={exportUrl} download={`hemisync-${beat}hz-${exportMin}min.wav`} style={S.dlLink}>
            save hemisync-{beat}hz-{exportMin}min.wav
          </a>
        )}
        <div style={S.hint}>Renders tones + noise + loaded voice with fade in/out. WAV ≈ 10 MB/min.</div>
      </section>

      <footer style={S.footer}>
        {mode === "binaural"
          ? `Each ear gets the carrier ± half the beat; your brain hears the ${beat.toFixed(1)} Hz difference.`
          : `The tone itself pulses on/off at ${beat.toFixed(1)} Hz — works from any speaker.`}{" "}
        Keep the volume low; the effect doesn't need loudness.
      </footer>
    </div>
  );
}

// ============ styles ============
const styles = {
  page: { minHeight: "100vh", background: "#14101F", color: "#EDE9E0",
    fontFamily: "'Space Grotesk', system-ui, sans-serif", display: "flex", flexDirection: "column",
    maxWidth: 560, margin: "0 auto", padding: "20px 20px 32px", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 },
  brand: { fontSize: 15, letterSpacing: "0.35em", fontWeight: 600 },
  headphones: { fontSize: 11, color: "#9A92AC", fontFamily: "'IBM Plex Mono', monospace" },
  readout: { background: "#1B1629", border: "1px solid #2C2540", borderRadius: 16,
    padding: "22px 16px 8px", marginBottom: 14, textAlign: "center" },
  beatBig: { fontSize: 60, fontWeight: 600, lineHeight: 1 },
  beatUnit: { fontSize: 14, color: "#9A92AC", marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace" },
  band: { marginTop: 8, fontSize: 13, color: "#C9C2D8" },
  earsRow: { display: "flex", justifyContent: "center", gap: 14, marginTop: 10, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" },
  earsDivider: { color: "#9A92AC" },
  canvas: { width: "100%", height: 100, display: "block", marginTop: 12 },
  chipsRow: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10, scrollbarWidth: "none" },
  chipsRowTight: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginTop: 8, scrollbarWidth: "none" },
  chip: { flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    padding: "9px 13px", borderRadius: 11, border: "1px solid", cursor: "pointer", fontFamily: "inherit", minWidth: 62 },
  chipHz: { fontSize: 14, fontWeight: 600, lineHeight: 1 },
  chipName: { fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.85 },
  chipSm: { fontSize: 12, fontWeight: 600 },
  panel: { background: "#1B1629", border: "1px solid #2C2540", borderRadius: 14, padding: "14px 14px 16px", marginBottom: 14 },
  voiceHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 },
  voiceOn: { fontSize: 11, color: "#63C2B0", fontFamily: "'IBM Plex Mono', monospace" },
  btnRow: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  voiceBtn: { padding: "10px 14px", borderRadius: 10, border: "1px solid #2C2540", background: "transparent",
    color: "#C9C2D8", cursor: "pointer", fontFamily: "inherit", fontSize: 13 },
  tinyBtn: { padding: "5px 10px", borderRadius: 8, border: "1px solid #2C2540", background: "transparent",
    color: "#C9C2D8", cursor: "pointer", fontFamily: "inherit", fontSize: 12 },
  textInput: { width: "100%", boxSizing: "border-box", background: "#14101F", border: "1px solid #2C2540",
    borderRadius: 10, padding: "10px 12px", color: "#EDE9E0", fontSize: 14, fontFamily: "inherit", marginBottom: 8, outline: "none" },
  textarea: { width: "100%", boxSizing: "border-box", background: "#14101F", border: "1px solid #2C2540",
    borderRadius: 10, padding: "10px 12px", color: "#EDE9E0", fontSize: 14, lineHeight: 1.6,
    fontFamily: "inherit", resize: "vertical", outline: "none" },
  takeList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 6, maxHeight: 160, overflowY: "auto" },
  takeRow: { display: "flex", alignItems: "center", gap: 6, border: "1px solid", borderRadius: 9, padding: "2px 4px" },
  takeName: { flex: 1, textAlign: "left", background: "none", border: "none", color: "#C9C2D8",
    fontSize: 12.5, padding: "8px 8px", cursor: "pointer", fontFamily: "inherit",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  takeDel: { background: "none", border: "none", color: "#9A92AC", fontSize: 12, cursor: "pointer", padding: 8 },
  reader: { position: "fixed", inset: 0, background: "#14101F", zIndex: 50, display: "flex", flexDirection: "column",
    padding: "18px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)", boxSizing: "border-box" },
  readerHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  readerBody: { flex: 1, overflowY: "auto", padding: "8px 2px" },
  readerLine: { fontSize: 22, lineHeight: 1.5, margin: "0 0 18px", color: "#EDE9E0" },
  readerFoot: { display: "flex", paddingTop: 12 },
  transport: { display: "flex", alignItems: "center", gap: 16, marginBottom: 18 },
  playBtn: { flex: 1, padding: "16px 0", fontSize: 17, fontWeight: 600, borderRadius: 14, border: "1px solid",
    cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s, color 0.2s" },
  timerCol: { display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 68 },
  timer: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 20 },
  remaining: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#9A92AC" },
  controls: { display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 },
  sliderHead: { display: "flex", justifyContent: "space-between", marginBottom: 6, marginTop: 8 },
  sliderLabel: { fontSize: 13, color: "#C9C2D8" },
  sliderValue: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#9A92AC" },
  range: { width: "100%", height: 28 },
  hint: { fontSize: 11, color: "#9A92AC", marginTop: 8, lineHeight: 1.5 },
  dlLink: { display: "block", marginTop: 10, padding: "12px 14px", background: "#EDE9E0", color: "#14101F",
    borderRadius: 10, textAlign: "center", fontSize: 14, fontWeight: 600, textDecoration: "none" },
  footer: { fontSize: 12, lineHeight: 1.55, color: "#9A92AC", borderTop: "1px solid #2C2540", paddingTop: 14 },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
div::-webkit-scrollbar { display: none; }
input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
input[type=range]::-webkit-slider-runnable-track { height: 4px; background: #2C2540; border-radius: 2px; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 22px; width: 22px; border-radius: 50%; background: currentColor; margin-top: -9px; border: 2px solid #14101F; }
input[type=range]::-moz-range-track { height: 4px; background: #2C2540; border-radius: 2px; }
input[type=range]::-moz-range-thumb { height: 22px; width: 22px; border-radius: 50%; background: currentColor; border: 2px solid #14101F; }
.playBtn:focus-visible, .chip:focus-visible { outline: 2px solid #E8A34C; outline-offset: 3px; }
button:disabled { opacity: 0.5; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
