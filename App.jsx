import { useState, useRef, useEffect, useCallback } from "react";

// ---------- constants ----------
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

const fmtTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- script storage (works in artifact preview AND deployed) ----------
const SKEY = "hemisync-scripts-v1";
const store = {
  async load() {
    try {
      if (typeof window !== "undefined" && window.storage) {
        const r = await window.storage.get(SKEY);
        return r ? JSON.parse(r.value) : null;
      }
    } catch (e) {}
    try {
      const v = window.localStorage?.getItem(SKEY);
      return v ? JSON.parse(v) : null;
    } catch (e) {}
    return null;
  },
  async save(scripts) {
    const json = JSON.stringify(scripts);
    try {
      if (typeof window !== "undefined" && window.storage) {
        await window.storage.set(SKEY, json);
        return;
      }
    } catch (e) {}
    try {
      window.localStorage?.setItem(SKEY, json);
    } catch (e) {}
  },
};

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

// ---------- component ----------
export default function App() {
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(4); // THE number — brain-perceived beat
  const [base, setBase] = useState(200); // carrier
  const [volume, setVolume] = useState(0.5);
  const [elapsed, setElapsed] = useState(0);
  const [voiceReady, setVoiceReady] = useState(false);
  const [scripts, setScripts] = useState(SEED_SCRIPTS);
  const [activeScriptId, setActiveScriptId] = useState("master-loop");
  const [readerOpen, setReaderOpen] = useState(false);
  const [editing, setEditing] = useState(null); // {id?, title, text} or null
  const loadedRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [voiceVol, setVoiceVol] = useState(0.7);
  const [pulseDepth, setPulseDepth] = useState(0.8); // 0 = steady voice, 1 = full 4 Hz throb

  // beat is split symmetrically across the ears
  const leftHz = base + beat / 2;
  const rightHz = base - beat / 2;
  const band = bandFor(beat);

  const ctxRef = useRef(null);
  const oscLRef = useRef(null);
  const oscRRef = useRef(null);
  const gainRef = useRef(null);
  const audioElRef = useRef(null); // HTML audio element — keeps playback alive when screen locks
  const streamDestRef = useRef(null);
  const voiceBufRef = useRef(null); // decoded recording / uploaded audio
  const voiceSrcRef = useRef(null);
  const voiceGainRef = useRef(null);
  const tremLfoRef = useRef(null);
  const tremDepthRef = useRef(null);
  const recRef = useRef(null);
  const recChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const phaseRef = useRef(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // ----- audio -----
  const start = useCallback(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    ctxRef.current = ctx;

    const merger = ctx.createChannelMerger(2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(volume, 0.0001),
      ctx.currentTime + 0.4
    );
    gainRef.current = gain;

    const mk = (hz, channel) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, ctx.currentTime);
      const g = ctx.createGain();
      g.gain.value = 0.9;
      osc.connect(g);
      g.connect(merger, 0, channel);
      osc.start();
      return osc;
    };

    oscLRef.current = mk(base + beat / 2, 0);
    oscRRef.current = mk(base - beat / 2, 1);

    merger.connect(gain);

    // --- voice layer: recorded words looped, amplitude-pulsed at the beat Hz
    // so the voice throbs in unison with the binaural pulse. Fully audible. ---
    if (voiceBufRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = voiceBufRef.current;
      src.loop = true;

      const vGain = ctx.createGain(); // overall voice level
      vGain.gain.value = voiceVol;
      voiceGainRef.current = vGain;

      // tremolo: gain = (1 - depth) + depth * (LFO 0..1)
      const trem = ctx.createGain();
      trem.gain.value = 1 - pulseDepth; // floor
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = beat; // locked to the beat
      const lfoAmp = ctx.createGain();
      lfoAmp.gain.value = pulseDepth / 2;
      const lfoOffset = ctx.createConstantSource();
      lfoOffset.offset.value = pulseDepth / 2;
      lfo.connect(lfoAmp);
      lfoAmp.connect(trem.gain);
      lfoOffset.connect(trem.gain);
      lfo.start();
      lfoOffset.start();
      tremLfoRef.current = lfo;
      tremDepthRef.current = { lfoAmp, lfoOffset, trem };

      src.connect(trem);
      trem.connect(vGain);
      vGain.connect(gain); // voice rides the master fade + background stream
      src.start();
      voiceSrcRef.current = src;
    }

    // --- background playback: route through an <audio> element instead of
    // ctx.destination. iOS suspends bare Web Audio on screen lock, but treats
    // an <audio> element playing a stream as "media", which keeps running. ---
    const streamDest = ctx.createMediaStreamDestination();
    gain.connect(streamDest);
    streamDestRef.current = streamDest;

    const el = audioElRef.current;
    if (el) {
      el.srcObject = streamDest.stream;
      el.play().catch(() => {
        // fallback: if the element refuses, at least play in-foreground
        gain.connect(ctx.destination);
      });
    } else {
      gain.connect(ctx.destination);
    }

    // Media Session: lock-screen title + play/pause controls
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Binaural beat — ${beat.toFixed(1)} Hz`,
        artist: "Hemisync",
        album: "Focus tones",
      });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => {
        ctxRef.current?.resume();
        audioElRef.current?.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        // pausing from lock screen = stop
        stopRef.current?.();
      });
    }

    setPlaying(true);
  }, [base, beat, volume]);

  const stop = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && gainRef.current) {
      const g = gainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(Math.max(g.value, 0.0001), ctx.currentTime);
      g.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      setTimeout(() => {
        try {
          oscLRef.current?.stop();
          oscRRef.current?.stop();
          voiceSrcRef.current?.stop();
          tremLfoRef.current?.stop();
          tremDepthRef.current?.lfoOffset?.stop();
          ctx.close();
        } catch (e) {}
        ctxRef.current = null;
        voiceSrcRef.current = null;
        if (audioElRef.current) {
          audioElRef.current.pause();
          audioElRef.current.srcObject = null;
        }
      }, 350);
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
    }
    setPlaying(false);
  }, []);

  // stable ref so the media-session pause handler can call the latest stop()
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  // if iOS suspends the context while backgrounded, resume on return
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

  const toggle = () => (playing ? stop() : start());

  // live updates
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playing) return;
    oscLRef.current?.frequency.setTargetAtTime(base + beat / 2, ctx.currentTime, 0.05);
    oscRRef.current?.frequency.setTargetAtTime(base - beat / 2, ctx.currentTime, 0.05);
    tremLfoRef.current?.frequency.setTargetAtTime(beat, ctx.currentTime, 0.05); // voice pulse follows the beat
  }, [base, beat, playing]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playing || !voiceGainRef.current) return;
    voiceGainRef.current.gain.setTargetAtTime(voiceVol, ctx.currentTime, 0.05);
  }, [voiceVol, playing]);

  useEffect(() => {
    const ctx = ctxRef.current;
    const t = tremDepthRef.current;
    if (!ctx || !playing || !t) return;
    t.trem.gain.setTargetAtTime(1 - pulseDepth, ctx.currentTime, 0.05);
    t.lfoAmp.gain.setTargetAtTime(pulseDepth / 2, ctx.currentTime, 0.05);
    t.lfoOffset.offset.setTargetAtTime(pulseDepth / 2, ctx.currentTime, 0.05);
  }, [pulseDepth, playing]);

  // ----- script library -----
  useEffect(() => {
    (async () => {
      const saved = await store.load();
      if (saved && Array.isArray(saved) && saved.length) {
        setScripts(saved);
        setActiveScriptId(saved[0].id);
      }
      loadedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (loadedRef.current) store.save(scripts);
  }, [scripts]);

  const activeScript = scripts.find((s) => s.id === activeScriptId) || null;

  const saveScript = () => {
    if (!editing || !editing.title.trim() || !editing.text.trim()) return;
    if (editing.id) {
      setScripts((prev) => prev.map((s) => (s.id === editing.id ? { ...s, title: editing.title, text: editing.text } : s)));
      setActiveScriptId(editing.id);
    } else {
      const id = "s" + Date.now();
      setScripts((prev) => [...prev, { id, title: editing.title, text: editing.text }]);
      setActiveScriptId(id);
    }
    setEditing(null);
  };

  const deleteScript = (id) => {
    if (!confirm("Delete this script?")) return;
    setScripts((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeScriptId === id) setActiveScriptId(next[0]?.id ?? null);
      return next;
    });
    setEditing(null);
  };

  // ----- voice capture -----
  const decodeBlob = async (blob) => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const tmp = new AC();
    const buf = await blob.arrayBuffer();
    const decoded = await tmp.decodeAudioData(buf);
    tmp.close();
    voiceBufRef.current = decoded;
    setVoiceReady(true);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => recChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType });
        await decodeBlob(blob);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      alert("Microphone unavailable here — use 'upload audio' instead, or open the app in Safari.");
    }
  };

  const stopRecording = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    if (f) await decodeBlob(f);
    e.target.value = "";
  };

  const clearVoice = () => {
    try { voiceSrcRef.current?.stop(); } catch (e) {}
    voiceSrcRef.current = null;
    voiceBufRef.current = null;
    setVoiceReady(false);
  };


  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playing || !gainRef.current) return;
    gainRef.current.gain.setTargetAtTime(Math.max(volume, 0.0001), ctx.currentTime, 0.05);
  }, [volume, playing]);

  useEffect(() => {
    if (playing) timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [playing]);

  // keep the lock-screen label current
  useEffect(() => {
    if (playing && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Binaural beat — ${beat.toFixed(1)} Hz`,
        artist: "Hemisync",
        album: "Focus tones",
      });
    }
  }, [beat, playing]);

  useEffect(
    () => () => {
      try {
        oscLRef.current?.stop();
        oscRRef.current?.stop();
        ctxRef.current?.close();
      } catch (e) {}
    },
    []
  );

  // ----- waveform visual -----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const c = canvas.getContext("2d");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      c.clearRect(0, 0, w, h);
      const t = playing && !reduced.current ? phaseRef.current : 0;

      // L and R carriers (visually near-identical, as they truly are)
      const rows = [
        { y: h * 0.24, color: "#E8A34C" },
        { y: h * 0.46, color: "#63C2B0" },
      ];
      rows.forEach((r, i) => {
        c.beginPath();
        for (let x = 0; x <= w; x += 2 * dpr) {
          const y = r.y + Math.sin((x / w) * 7 * Math.PI * 2 + t + i * 0.5) * h * 0.08;
          x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.strokeStyle = r.color;
        c.lineWidth = 1.5 * dpr;
        c.globalAlpha = 0.9;
        c.stroke();
      });

      // the beat: carrier × slow envelope — this is what the brain "hears"
      c.beginPath();
      const beatCycles = Math.max(beat * 0.5, 0.5);
      for (let x = 0; x <= w; x += 2 * dpr) {
        const carrier = Math.sin((x / w) * 12 * Math.PI * 2 + t * 1.4);
        const env = Math.cos((x / w) * beatCycles * Math.PI + t * 0.35);
        const y = h * 0.78 + carrier * env * h * 0.13;
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.strokeStyle = "#EDE9E0";
      c.lineWidth = 1.5 * dpr;
      c.globalAlpha = 0.85;
      c.stroke();
      c.globalAlpha = 1;

      if (playing && !reduced.current) {
        phaseRef.current += 0.045;
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    draw();
    if (playing && !reduced.current) rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [playing, beat]);

  const S = styles;

  return (
    <div style={S.page}>
      <style>{css}</style>

      {/* hidden media element — keeps the tone playing when the screen locks */}
      <audio ref={audioElRef} playsInline style={{ display: "none" }} />

      <header style={S.header}>
        <div style={S.brand}>HEMISYNC</div>
        <div style={S.headphones}>⚠ Stereo headphones required</div>
      </header>

      {/* the one number that matters */}
      <section style={S.readout}>
        <div style={S.beatBig}>
          {beat.toFixed(1)}
          <span style={S.beatUnit}>Hz beat</span>
        </div>
        <div style={S.band}>
          {band.name} · {band.note}
        </div>
        <div style={S.earsRow}>
          <span style={{ color: "#E8A34C" }}>L {leftHz.toFixed(1)} Hz</span>
          <span style={S.earsDivider}>Δ {beat.toFixed(1)}</span>
          <span style={{ color: "#63C2B0" }}>R {rightHz.toFixed(1)} Hz</span>
        </div>
        <canvas ref={canvasRef} style={S.canvas} />
      </section>

      {/* presets */}
      <div style={S.presets}>
        {BANDS.map((b) => {
          const on = beat === b.hz;
          return (
            <button
              key={b.hz}
              onClick={() => setBeat(b.hz)}
              className="chip"
              style={{
                ...S.chip,
                background: on ? "#EDE9E0" : "transparent",
                color: on ? "#14101F" : "#C9C2D8",
                borderColor: on ? "#EDE9E0" : "#2C2540",
              }}
            >
              <span style={S.chipHz}>{b.hz} Hz</span>
              <span style={S.chipName}>{b.name}</span>
            </button>
          );
        })}
      </div>

      {/* script library */}
      <section style={S.voicePanel}>
        <div style={S.voiceHead}>
          <span style={S.sliderLabel}>Scripts</span>
          <button className="chip" style={S.tinyBtn} onClick={() => setEditing({ title: "", text: "" })}>
            + new
          </button>
        </div>
        <div style={S.scriptChips}>
          {scripts.map((s) => {
            const on = s.id === activeScriptId;
            return (
              <button
                key={s.id}
                className="chip"
                onClick={() => setActiveScriptId(s.id)}
                style={{
                  ...S.chip,
                  minWidth: 0,
                  padding: "8px 12px",
                  background: on ? "#EDE9E0" : "transparent",
                  color: on ? "#14101F" : "#C9C2D8",
                  borderColor: on ? "#EDE9E0" : "#2C2540",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{s.title}</span>
              </button>
            );
          })}
        </div>
        {activeScript && !editing && (
          <div style={S.scriptActions}>
            <button className="chip" style={S.voiceBtn} onClick={() => setReaderOpen(true)}>
              ☰ read &amp; record
            </button>
            <button className="chip" style={S.voiceBtn} onClick={() => setEditing({ ...activeScript })}>
              ✎ edit
            </button>
            {scripts.length > 1 && (
              <button className="chip" style={{ ...S.voiceBtn, color: "#9A92AC" }} onClick={() => deleteScript(activeScript.id)}>
                ✕ delete
              </button>
            )}
          </div>
        )}
        {editing && (
          <div style={{ marginTop: 10 }}>
            <input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="Script title"
              style={S.scriptTitleInput}
              maxLength={40}
            />
            <textarea
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              placeholder="One line per affirmation…"
              style={S.scriptTextarea}
              rows={8}
            />
            <div style={S.scriptActions}>
              <button className="chip" style={{ ...S.voiceBtn, background: "#EDE9E0", color: "#14101F", borderColor: "#EDE9E0" }} onClick={saveScript}>
                save script
              </button>
              <button className="chip" style={S.voiceBtn} onClick={() => setEditing(null)}>
                cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* teleprompter overlay */}
      {readerOpen && activeScript && (
        <div style={S.reader}>
          <div style={S.readerHead}>
            <span style={{ ...S.sliderLabel, fontSize: 14 }}>{activeScript.title}</span>
            <button className="chip" style={S.tinyBtn} onClick={() => setReaderOpen(false)}>
              ✕ close
            </button>
          </div>
          <div style={S.readerBody}>
            {activeScript.text.split("\n").filter(Boolean).map((line, i) => (
              <p key={i} style={S.readerLine}>{line}</p>
            ))}
          </div>
          <div style={S.readerFoot}>
            <button
              className="chip"
              onClick={recording ? stopRecording : startRecording}
              style={{
                ...S.voiceBtn,
                flex: 1,
                textAlign: "center",
                padding: "14px 0",
                fontSize: 15,
                background: recording ? "#C2564B" : "#EDE9E0",
                color: recording ? "#EDE9E0" : "#14101F",
                borderColor: recording ? "#C2564B" : "#EDE9E0",
              }}
            >
              {recording ? "◼ stop — save take" : "● record this script"}
            </button>
          </div>
        </div>
      )}

      {/* voice layer */}
      <section style={S.voicePanel}>
        <div style={S.voiceHead}>
          <span style={S.sliderLabel}>Spoken words · pulsed at {beat.toFixed(1)} Hz</span>
          {voiceReady && <span style={S.voiceOn}>● loaded</span>}
        </div>
        <div style={S.voiceBtns}>
          <button
            className="chip"
            onClick={recording ? stopRecording : startRecording}
            style={{
              ...S.voiceBtn,
              background: recording ? "#C2564B" : "transparent",
              color: recording ? "#EDE9E0" : "#C9C2D8",
              borderColor: recording ? "#C2564B" : "#2C2540",
            }}
          >
            {recording ? "◼ stop recording" : "● record words"}
          </button>
          <button className="chip" onClick={() => fileInputRef.current?.click()} style={S.voiceBtn}>
            ⇧ upload audio
          </button>
          {voiceReady && (
            <button className="chip" onClick={clearVoice} style={{ ...S.voiceBtn, color: "#9A92AC" }}>
              ✕ clear
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="audio/*" onChange={onUpload} style={{ display: "none" }} />
        </div>

        {voiceReady && (
          <>
            <div style={{ ...S.sliderHead, marginTop: 12 }}>
              <span style={S.sliderLabel}>Voice level</span>
              <span style={S.sliderValue}>{Math.round(voiceVol * 100)}%</span>
            </div>
            <input type="range" min={0} max={100} value={Math.round(voiceVol * 100)}
              onChange={(e) => setVoiceVol(Number(e.target.value) / 100)}
              style={{ ...S.range, accentColor: "#E8A34C" }} aria-label="Voice level" />

            <div style={{ ...S.sliderHead, marginTop: 10 }}>
              <span style={S.sliderLabel}>Pulse depth</span>
              <span style={S.sliderValue}>{Math.round(pulseDepth * 100)}%</span>
            </div>
            <input type="range" min={0} max={100} value={Math.round(pulseDepth * 100)}
              onChange={(e) => setPulseDepth(Number(e.target.value) / 100)}
              style={{ ...S.range, accentColor: "#E8A34C" }} aria-label="Pulse depth" />
          </>
        )}
      </section>

      {/* transport */}
      <section style={S.transport}>
        <button
          onClick={toggle}
          className="playBtn"
          style={{
            ...S.playBtn,
            background: playing ? "#2A2438" : "#EDE9E0",
            color: playing ? "#EDE9E0" : "#14101F",
            borderColor: playing ? "#4A415F" : "#EDE9E0",
          }}
          aria-label={playing ? "Stop" : "Play"}
        >
          {playing ? "◼ Stop" : "▶ Play"}
        </button>
        <div style={S.timer}>{fmtTime(elapsed)}</div>
        {elapsed > 0 && !playing && (
          <button style={S.resetBtn} onClick={() => setElapsed(0)}>
            reset
          </button>
        )}
      </section>

      {/* controls */}
      <section style={S.controls}>
        <div style={S.sliderRow}>
          <div style={S.sliderHead}>
            <span style={S.sliderLabel}>Beat frequency</span>
            <span style={{ ...S.sliderValue, color: "#EDE9E0" }}>{beat.toFixed(1)} Hz</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={40}
            step={0.5}
            value={beat}
            onChange={(e) => setBeat(Number(e.target.value))}
            style={{ ...S.range, accentColor: "#EDE9E0" }}
            aria-label="Beat frequency"
          />
        </div>

        <div style={S.sliderRow}>
          <div style={S.sliderHead}>
            <span style={S.sliderLabel}>Carrier pitch</span>
            <span style={S.sliderValue}>{base} Hz</span>
          </div>
          <input
            type="range"
            min={100}
            max={500}
            step={1}
            value={base}
            onChange={(e) => setBase(Number(e.target.value))}
            style={{ ...S.range, accentColor: "#9A92AC" }}
            aria-label="Carrier pitch"
          />
        </div>

        <div style={S.sliderRow}>
          <div style={S.sliderHead}>
            <span style={S.sliderLabel}>Volume</span>
            <span style={S.sliderValue}>{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            style={{ ...S.range, accentColor: "#9A92AC" }}
            aria-label="Volume"
          />
        </div>
      </section>

      <footer style={S.footer}>
        You set the beat directly — the app splits it across your ears
        ({leftHz.toFixed(1)} Hz left, {rightHz.toFixed(1)} Hz right) and your
        brain perceives the {beat.toFixed(1)} Hz difference as a slow pulse.
        Carrier pitch only changes how the tone sounds, not the beat. Keep the
        volume low.
      </footer>
    </div>
  );
}

// ---------- styles ----------
const styles = {
  page: {
    minHeight: "100vh",
    background: "#14101F",
    color: "#EDE9E0",
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    display: "flex",
    flexDirection: "column",
    maxWidth: 560,
    margin: "0 auto",
    padding: "20px 20px 32px",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 18,
  },
  brand: { fontSize: 15, letterSpacing: "0.35em", fontWeight: 600 },
  headphones: {
    fontSize: 11,
    color: "#9A92AC",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  readout: {
    background: "#1B1629",
    border: "1px solid #2C2540",
    borderRadius: 16,
    padding: "22px 16px 8px",
    marginBottom: 14,
    textAlign: "center",
  },
  beatBig: { fontSize: 64, fontWeight: 600, lineHeight: 1 },
  beatUnit: {
    fontSize: 14,
    color: "#9A92AC",
    marginLeft: 8,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  band: { marginTop: 8, fontSize: 13, color: "#C9C2D8" },
  earsRow: {
    display: "flex",
    justifyContent: "center",
    gap: 14,
    marginTop: 10,
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  earsDivider: { color: "#9A92AC" },
  canvas: { width: "100%", height: 110, display: "block", marginTop: 12 },
  presets: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 4,
    marginBottom: 16,
    scrollbarWidth: "none",
  },
  chip: {
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "9px 13px",
    borderRadius: 11,
    border: "1px solid",
    cursor: "pointer",
    fontFamily: "inherit",
    minWidth: 62,
  },
  chipHz: { fontSize: 15, fontWeight: 600, lineHeight: 1 },
  chipName: { fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.85 },
  transport: { display: "flex", alignItems: "center", gap: 16, marginBottom: 20 },
  playBtn: {
    flex: 1,
    padding: "16px 0",
    fontSize: 17,
    fontWeight: 600,
    borderRadius: 14,
    border: "1px solid",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.2s, color 0.2s",
  },
  timer: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 20,
    minWidth: 68,
    textAlign: "right",
  },
  resetBtn: {
    background: "none",
    border: "none",
    color: "#9A92AC",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "'IBM Plex Mono', monospace",
    padding: 4,
  },
  controls: { display: "flex", flexDirection: "column", gap: 16, marginBottom: 22 },
  voicePanel: {
    background: "#1B1629",
    border: "1px solid #2C2540",
    borderRadius: 14,
    padding: "14px 14px 16px",
    marginBottom: 18,
  },
  voiceHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  voiceOn: { fontSize: 11, color: "#63C2B0", fontFamily: "'IBM Plex Mono', monospace" },
  voiceBtns: { display: "flex", gap: 8, flexWrap: "wrap" },
  voiceBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #2C2540",
    background: "transparent",
    color: "#C9C2D8",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
  },
  tinyBtn: {
    padding: "5px 10px",
    borderRadius: 8,
    border: "1px solid #2C2540",
    background: "transparent",
    color: "#C9C2D8",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
  },
  scriptChips: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" },
  scriptActions: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  scriptTitleInput: {
    width: "100%",
    boxSizing: "border-box",
    background: "#14101F",
    border: "1px solid #2C2540",
    borderRadius: 10,
    padding: "10px 12px",
    color: "#EDE9E0",
    fontSize: 14,
    fontFamily: "inherit",
    marginBottom: 8,
    outline: "none",
  },
  scriptTextarea: {
    width: "100%",
    boxSizing: "border-box",
    background: "#14101F",
    border: "1px solid #2C2540",
    borderRadius: 10,
    padding: "10px 12px",
    color: "#EDE9E0",
    fontSize: 14,
    lineHeight: 1.6,
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
  },
  reader: {
    position: "fixed",
    inset: 0,
    background: "#14101F",
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    padding: "18px 20px calc(env(safe-area-inset-bottom, 0px) + 16px)",
    boxSizing: "border-box",
  },
  readerHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  readerBody: { flex: 1, overflowY: "auto", padding: "8px 2px" },
  readerLine: { fontSize: 22, lineHeight: 1.5, margin: "0 0 18px", color: "#EDE9E0" },
  readerFoot: { display: "flex", paddingTop: 12 },
  sliderRow: {},
  sliderHead: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  sliderLabel: { fontSize: 13, color: "#C9C2D8" },
  sliderValue: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#9A92AC" },
  range: { width: "100%", height: 28 },
  footer: {
    fontSize: 12,
    lineHeight: 1.55,
    color: "#9A92AC",
    borderTop: "1px solid #2C2540",
    paddingTop: 14,
  },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
.presets::-webkit-scrollbar { display: none; }
input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
input[type=range]::-webkit-slider-runnable-track { height: 4px; background: #2C2540; border-radius: 2px; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 22px; width: 22px; border-radius: 50%; background: currentColor; margin-top: -9px; border: 2px solid #14101F; }
input[type=range]::-moz-range-track { height: 4px; background: #2C2540; border-radius: 2px; }
input[type=range]::-moz-range-thumb { height: 22px; width: 22px; border-radius: 50%; background: currentColor; border: 2px solid #14101F; }
.playBtn:focus-visible, .chip:focus-visible { outline: 2px solid #E8A34C; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
