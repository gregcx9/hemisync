import { useState, useRef, useEffect } from "react";
import mammoth from "mammoth";

const storage = {
  async get(k) { const v = localStorage.getItem(k); return v == null ? null : { value: v }; },
  async set(k, v) { localStorage.setItem(k, v); },
};


// ============================================================
// EMBERPRESS — 2D generator for quote cards, painted backdrops,
// and short videos. Everything renders on canvas, in-browser.
// PNG export for carousels · recorded video export for TikTok.
// ============================================================

const PALETTES = {
  "Ember (—BORN core)": { bg: "#12100E", tones: ["#1C1917", "#3B2B20", "#7A4A2B", "#C27B3F", "#E8A96B"], ink: "#F4E8D8", accent: "#E8A96B" },
  "Tide (TIDEBORN)": { bg: "#0B1416", tones: ["#102026", "#1B3A42", "#2E6470", "#4E98A5", "#8FD0D8"], ink: "#E6F2F2", accent: "#8FD0D8" },
  "Frost (COLDBORN)": { bg: "#0E1218", tones: ["#151C26", "#25344A", "#3E5A7A", "#6E8FB0", "#B8CCE0"], ink: "#EDF2F8", accent: "#B8CCE0" },
  "Blood (BLOODBORN)": { bg: "#120A0C", tones: ["#1E0F13", "#3C1620", "#6E2231", "#A03A46", "#D0707A"], ink: "#F6E9EA", accent: "#D0707A" },
  "Ash (ASHBORN)": { bg: "#101010", tones: ["#1A1A1A", "#2E2C2A", "#4A4642", "#6E6862", "#A29A90"], ink: "#F0EDE8", accent: "#A29A90" },
  "Gilt (GIFTBORN)": { bg: "#100E0A", tones: ["#1A1712", "#33291A", "#5C4726", "#8F6E38", "#D0AB62"], ink: "#F6EFDF", accent: "#D0AB62" },
  "Toll (TOLLBORN)": { bg: "#0D1210", tones: ["#131C18", "#20322A", "#345244", "#4F7A62", "#86B092"], ink: "#EAF2ED", accent: "#86B092" },
};

const FORMATS = {
  "Carousel 4:5 (1080×1350)": { w: 1080, h: 1350 },
  "Video / Story 9:16 (1080×1920)": { w: 1080, h: 1920 },
  "Square 1:1 (1080×1080)": { w: 1080, h: 1080 },
};

// seeded PRNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- painterly background v2: cinematic layers ----------
function paintBackground(ctx, w, h, pal, seed, t = 0) {
  const rnd = mulberry32(seed);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, w, h);

  // deep color washes
  for (let i = 0; i < 4; i++) {
    const x = rnd() * w, y = rnd() * h, r = (0.35 + rnd() * 0.5) * w;
    const g = ctx.createRadialGradient(x + t * 18 * (i % 2 ? 1 : -1), y + t * 10, 0, x, y, r);
    g.addColorStop(0, pal.tones[Math.floor(rnd() * 3)] + "48");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // flow-field texture strokes (quiet, under everything)
  const angleAt = (x, y) => Math.sin(x * 0.0016 + seed * 0.1) * 2 + Math.cos(y * 0.0013 - seed * 0.07) * 2;
  for (let i = 0; i < 150; i++) {
    let x = rnd() * w, y = rnd() * h;
    ctx.strokeStyle = pal.tones[Math.floor(rnd() * pal.tones.length)] + "16";
    ctx.lineWidth = 2 + rnd() * 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 100; s += 8) {
      const a = angleAt(x, y) + t * 0.35;
      x += Math.cos(a) * 8; y += Math.sin(a) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // smoke wisps: broad, ghosted curves
  for (let i = 0; i < 7; i++) {
    let x = rnd() * w, y = h * (0.2 + rnd() * 0.7);
    ctx.strokeStyle = pal.tones[3] + "0C";
    ctx.lineWidth = 60 + rnd() * 110;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rnd() - 0.5) * w * 0.3;
      y -= h * 0.06 + rnd() * h * 0.05;
      ctx.lineTo(x + Math.sin(t + i) * 14, y);
    }
    ctx.stroke();
  }

  // focal glow behind the text block — the eye's landing zone
  const fg = ctx.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h * 0.46, w * 0.62);
  fg.addColorStop(0, pal.tones[3] + "3A");
  fg.addColorStop(0.45, pal.tones[2] + "1E");
  fg.addColorStop(1, "transparent");
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, w, h);

  // rising embers with bloom
  for (let i = 0; i < 90; i++) {
    const px = rnd() * w;
    const py = (((rnd() * h) - t * (30 + rnd() * 60)) % h + h) % h;
    const big = rnd() > 0.85;
    const r = big ? 3 + rnd() * 4 : 0.8 + rnd() * 1.8;
    const a = big ? 0.16 : 0.5 + rnd() * 0.4;
    ctx.save();
    ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(t * 2 + i));
    ctx.shadowColor = pal.accent;
    ctx.shadowBlur = big ? 18 : 9;
    ctx.fillStyle = big ? pal.accent : pal.tones[4];
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // grain
  const grains = Math.floor((w * h) / 1100);
  for (let i = 0; i < grains; i++) {
    ctx.fillStyle = rnd() > 0.5 ? "#FFFFFF07" : "#0000000E";
    ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }

  // cinematic vignette, heavier corners
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, "transparent");
  v.addColorStop(1, "#000000C8");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

// ---------- text layout ----------
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCard(ctx, w, h, pal, seed, { hook, quote, attribution, handle }, t = 0, fade = 1) {
  paintBackground(ctx, w, h, pal, seed, t);
  const margin = w * 0.1;
  const glyph = pal.accent === "#8FD0D8" ? "♣" : "❖"; // Tide keeps its clover
  ctx.textAlign = "center";
  ctx.globalAlpha = fade;

  // ---- hook: letterspaced small caps with side rules ----
  if (hook) {
    const hs = Math.round(w * 0.028);
    ctx.font = `600 ${hs}px 'IBM Plex Mono', monospace`;
    const spaced = hook.toUpperCase().split("").join("\u200A");
    ctx.fillStyle = pal.accent;
    ctx.fillText(spaced, w / 2, h * 0.135);
    const tw = ctx.measureText(spaced).width;
    ctx.strokeStyle = pal.accent + "88";
    ctx.lineWidth = 1.5;
    const ry = h * 0.135 - hs * 0.32;
    ctx.beginPath();
    ctx.moveTo(margin, ry); ctx.lineTo(w / 2 - tw / 2 - w * 0.03, ry);
    ctx.moveTo(w / 2 + tw / 2 + w * 0.03, ry); ctx.lineTo(w - margin, ry);
    ctx.stroke();
  }

  // ---- quote: mixed regular + gilded-italic final clause ----
  const qSize = Math.round(w * 0.072);
  const fontReg = `500 ${qSize}px 'Spectral', serif`;
  const fontEm = `italic 600 ${qSize}px 'Spectral', serif`;
  // emphasis = text after the last comma, else the last three words (capped at 6 words)
  let emStart;
  const lastComma = quote.lastIndexOf(", ");
  if (lastComma > 0 && quote.slice(lastComma + 2).split(/\s+/).length <= 6) emStart = lastComma + 2;
  else { const ws = quote.split(/\s+/); emStart = quote.length - ws.slice(-3).join(" ").length; }
  const tokens = quote.split(/\s+/).filter(Boolean);
  let pos = 0;
  const styled = tokens.map((word) => {
    const idx = quote.indexOf(word, pos);
    pos = idx + word.length;
    return { word, em: idx >= emStart };
  });

  // wrap with per-token fonts
  const maxW = w - margin * 2;
  const lines = [[]];
  let lineW = 0;
  const spaceW = (font) => { ctx.font = font; return ctx.measureText(" ").width; };
  for (const tk of styled) {
    ctx.font = tk.em ? fontEm : fontReg;
    const tw = ctx.measureText(tk.word).width;
    const sw = lines[lines.length - 1].length ? spaceW(tk.em ? fontEm : fontReg) : 0;
    if (lineW + sw + tw > maxW && lines[lines.length - 1].length) { lines.push([tk]); lineW = tw; }
    else { lines[lines.length - 1].push(tk); lineW += sw + tw; }
  }

  const lh = qSize * 1.28;
  const blockH = lines.length * lh;
  const startY = h * 0.46 - blockH / 2 + lh * 0.6;
  ctx.shadowColor = "#000000CC";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 3;
  lines.forEach((ln, li) => {
    // measure line width
    let total = 0;
    ln.forEach((tk, i) => {
      ctx.font = tk.em ? fontEm : fontReg;
      total += ctx.measureText(tk.word).width + (i ? ctx.measureText(" ").width : 0);
    });
    let x = w / 2 - total / 2;
    const y = startY + li * lh;
    ctx.textAlign = "left";
    ln.forEach((tk, i) => {
      ctx.font = tk.em ? fontEm : fontReg;
      if (i) x += ctx.measureText(" ").width;
      ctx.fillStyle = tk.em ? pal.accent : pal.ink;
      ctx.fillText(tk.word, x, y);
      x += ctx.measureText(tk.word).width;
    });
  });
  ctx.textAlign = "center";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ---- ornament: rule · glyph · rule ----
  const oy = startY + (lines.length - 1) * lh + lh * 0.95;
  ctx.strokeStyle = pal.accent + "99";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(w / 2 - w * 0.11, oy); ctx.lineTo(w / 2 - w * 0.035, oy);
  ctx.moveTo(w / 2 + w * 0.035, oy); ctx.lineTo(w / 2 + w * 0.11, oy);
  ctx.stroke();
  ctx.font = `${Math.round(w * 0.026)}px serif`;
  ctx.fillStyle = pal.accent;
  ctx.fillText(glyph, w / 2, oy + w * 0.009);

  // ---- attribution ----
  if (attribution) {
    ctx.font = `500 italic ${Math.round(w * 0.03)}px 'Spectral', serif`;
    ctx.fillStyle = pal.ink + "D8";
    ctx.fillText(attribution, w / 2, oy + w * 0.058);
  }

  // ---- handle ----
  if (handle) {
    ctx.font = `600 ${Math.round(w * 0.024)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.ink + "8C";
    ctx.fillText(handle.split("").join("\u200A"), w / 2, h * 0.94);
  }
  ctx.globalAlpha = 1;
}

export default function App() {
  const canvasRef = useRef(null);
  const [palName, setPalName] = useState("Ember (—BORN core)");
  const [fmtName, setFmtName] = useState("Carousel 4:5 (1080×1350)");
  const [seed, setSeed] = useState(7);
  const [hook, setHook] = useState("THE —BORN UNIVERSE");
  const [quote, setQuote] = useState("She did not ask what the debt would cost. She asked who would carry it.");
  const [attribution, setAttribution] = useState("DEBTBORN, Book One");
  const [handle, setHandle] = useState("@lenore.sable");
  const [batch, setBatch] = useState("");
  const [recording, setRecording] = useState(false);
  const [videoSecs, setVideoSecs] = useState(7);
  const [fontsReady, setFontsReady] = useState(false);
  const [gallery, setGallery] = useState([]);
  const [videoOut, setVideoOut] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [includeCta, setIncludeCta] = useState(true);
  const [ctaMain, setCtaMain] = useState("Follow for daily lines from the —BORN Universe");
  const [ctaSub, setCtaSub] = useState("DEBTBORN Book One — free in Kindle Unlimited");
  const [library, setLibrary] = useState([]);
  const [mining, setMining] = useState(false);
  const [openBook, setOpenBook] = useState(null);
  const bookRef = useRef(null);
  const sceneRef = useRef(null);
  const [sceneImg, setSceneImg] = useState(null); // HTMLImageElement
  const [v1, setV1] = useState("Why do you keep your hands in fists?");
  const [v2, setV2] = useState("So they don't reach for you.");
  const [pairList, setPairList] = useState([]);
  const [charHer, setCharHer] = useState("a young woman in her early twenties with long auburn-red wavy hair and pale skin, wearing a plain grey-brown long-sleeved period dress with a modest neckline");
  const [charHim, setCharHim] = useState("a man in his mid-thirties with dark tousled hair and short stubble, wearing a deep green hooded cloak over an olive-green tunic with a brown leather cross-body strap and belt, dark trousers and tall leather boots");
  const [staging, setStaging] = useState("walking side by side down a winding dirt road through moorland hills, a careful distance apart");
  const [builtPrompt, setBuiltPrompt] = useState("");

  const STAGINGS = [
    "walking side by side down a winding dirt road through moorland hills, a careful distance apart",
    "seated on opposite sides of a small campfire at night on a forest road, sparks rising between them",
    "seated at a rough candlelit wooden table, their hands resting near each other but not touching, a single candle between them",
    "she stands guarded in pale mist near a bare twisted tree while he kneels before her, one hand raised",
    "she sleeps curled on a simple bed in a candlelit stone room while he keeps watch seated by the door with a wooden staff",
    "standing at a stone harbor wall at dusk, boats and grey water behind them",
    "sheltering in a snowbound doorway, breath visible, lantern light on the snow",
  ];

  const LIGHTMOODS = {
    "Ember (—BORN core)": "warm ochres, burnt sienna and umber, late golden-hour light",
    "Tide (TIDEBORN)": "cold sea-greens and slate blues, overcast coastal light",
    "Frost (COLDBORN)": "pale blues and greys, thin winter light, cold breath in the air",
    "Blood (BLOODBORN)": "deep wine reds and shadowed browns, low firelight",
    "Ash (ASHBORN)": "grey and charcoal tones with faint warm embers, smoke-hazed light",
    "Gilt (GIFTBORN)": "dark bronze and antique gold tones, candlelit warmth against deep shadow",
    "Toll (TOLLBORN)": "muted sea-greens and fog greys, cold shoreline light",
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("emberpress:chars");
        if (r && r.value) { const c = JSON.parse(r.value); if (c.her) setCharHer(c.her); if (c.him) setCharHim(c.him); }
      } catch (e) { /* first run */ }
    })();
  }, []);
  const saveChars = (her, him) => { storage.set("emberpress:chars", JSON.stringify({ her, him })).catch(() => {}); };

  function robustCopy(text) {
    // Try the modern API first; fall back to execCommand, which works in webviews that block navigator.clipboard
    const legacy = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => alert("Prompt copied — paste it into ChatGPT."),
          () => alert(legacy() ? "Prompt copied — paste it into ChatGPT." : "Copy blocked — tap the prompt text below to select it, then copy manually.")
        );
      } else {
        alert(legacy() ? "Prompt copied — paste it into ChatGPT." : "Copy blocked — tap the prompt text below to select it, then copy manually.");
      }
    } catch (e) {
      alert(legacy() ? "Prompt copied — paste it into ChatGPT." : "Copy blocked — tap the prompt text below to select it, then copy manually.");
    }
  }

  const [paintText, setPaintText] = useState(true);
  const [campaignNo, setCampaignNo] = useState(1);
  const [coverImg, setCoverImg] = useState(null);
  const [campaignPrompts, setCampaignPrompts] = useState("");
  const [campaignCaption, setCampaignCaption] = useState("");
  const [campaignInfo, setCampaignInfo] = useState("");
  const [vidImgs, setVidImgs] = useState([]);
  const [vidPer, setVidPer] = useState(2.6);
  const vidRef = useRef(null);
  const coverRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("emberpress:campaign");
        if (r && r.value) setCampaignNo(parseInt(r.value, 10) || 1);
      } catch (e) { /* first run */ }
    })();
  }, []);

  function onCoverFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setCoverImg(img);
      img.onerror = () => alert("Couldn't decode that image — use a JPEG or PNG of the cover.");
      img.src = reader.result;
    };
    reader.onerror = () => alert("Couldn't read that file — try again.");
    reader.readAsDataURL(file);
  }

  function drawLiveCard(ctx, w, h, n) {
    paintBackground(ctx, w, h, pal, n * 31 + 5, 0);
    ctx.textAlign = "center";
    // banner
    ctx.font = `700 ${Math.round(w * 0.105)}px 'Spectral', serif`;
    ctx.fillStyle = pal.accent;
    ctx.shadowColor = pal.accent + "88"; ctx.shadowBlur = 40;
    ctx.fillText("LIVE NOW", w / 2, h * 0.15);
    ctx.shadowBlur = 0;
    ctx.font = `600 ${Math.round(w * 0.026)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.ink + "CC";
    ctx.fillText("O N   K I N D L E   U N L I M I T E D", w / 2, h * 0.195);
    // cover with shadow
    const maxW = w * 0.54, maxH = h * 0.52;
    const s = Math.min(maxW / coverImg.width, maxH / coverImg.height);
    const cw = coverImg.width * s, chh = coverImg.height * s;
    ctx.save();
    ctx.shadowColor = "#000000CC"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 16;
    ctx.drawImage(coverImg, (w - cw) / 2, h * 0.52 - chh / 2, cw, chh);
    ctx.restore();
    // rule + line
    const oy = h * 0.52 + chh / 2 + h * 0.045;
    ctx.strokeStyle = pal.accent + "99"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2 - w * 0.12, oy); ctx.lineTo(w / 2 + w * 0.12, oy);
    ctx.stroke();
    ctx.font = `italic 600 ${Math.round(w * 0.034)}px 'Spectral', serif`;
    ctx.fillStyle = pal.ink;
    ctx.shadowColor = "#000000CC"; ctx.shadowBlur = 18;
    wrapText(ctx, ctaSub, w * 0.8).forEach((ln, i) => ctx.fillText(ln, w / 2, oy + w * 0.05 + i * w * 0.048));
    ctx.shadowBlur = 0;
    if (handle) {
      ctx.font = `600 ${Math.round(w * 0.024)}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = pal.ink + "8C";
      ctx.fillText(handle.split("").join("\u200A"), w / 2, h * 0.95);
    }
  }

  function buildCampaign() {
    const n = Math.max(1, Math.floor(campaignNo) || 1);
    const rnd = mulberry32(n * 7919 + 13);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

    // pair: real mined/starred first, seeded composer otherwise
    const pairPool = [...favPairs, ...library.flatMap((b) => b.pairs || [])];
    const pair = pairPool.length ? pairPool[Math.floor(rnd() * pairPool.length)] : offlinePairs(5, n * 7919 + 13)[0];
    // quote: starred/mined first
    const quotePool = [...favLines, ...library.flatMap((b) => b.quotes || [])];
    const q = quotePool.length ? quotePool[Math.floor(rnd() * quotePool.length)] : offlineQuotes(5, n * 104729 + 7)[0];

    // three distinct stagings, seeded
    const idx = STAGINGS.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const stagings = idx.slice(0, 3).map((i) => STAGINGS[i]);

    // set working state so scene mode is pre-loaded
    setV1(pair[0]); setV2(pair[1]); setQuote(q);

    // one combined prompt: 3 scenes + 1 painted quote card, single paste
    const mood = LIGHTMOODS[palName] || LIGHTMOODS["Ember (—BORN core)"];
    const seriesName = (attribution.split(",")[0] || "SET").trim();
    const setLabel = `${seriesName.charAt(0).toUpperCase()}${seriesName.slice(1).toLowerCase()} set ${n}`;
    const prompts = `${setLabel}

You will create FOUR separate 2D images for me. CRITICAL RULES:
- ONE image at a time, each as its OWN full-resolution image generation.
- NEVER combine them into a grid, collage, panel layout, or contact sheet.
- Generate ONLY IMAGE 1 now. Then WAIT. Each time I reply "next", generate the following image.
- Begin EVERY reply with the line "${setLabel} — image X of 4" (X = the image you are generating) so I can track which set and image this is.
- Keep the SAME two characters, the same faces and clothing, and the same oil-painting style across images 1–3.

${stagings.map((st, i) => `============ IMAGE ${i + 1} of 4 — SCENE PAINTING ============\n\n${promptTextFor(st, pair[0], pair[1], true)}`).join("\n\n")}

============ IMAGE 4 of 4 — QUOTE CARD ============

Create a 2D image: a typographic quote card, portrait 4:5 aspect ratio. Background: an abstract painterly texture in the same oil-on-canvas style — ${mood} — with soft glow, drifting embers, heavy dark vignette, NO people or figures.

TEXT — RENDER EXACTLY, verbatim, correct spelling, nothing added:
Main quote, centered, elegant serif, soft off-white (#F5F0E6), large (each line's capital height ~5% of image height), wrapped to 3–4 centered lines:
“${q}”
Below it, smaller italic serif in the same off-white at 80% opacity:
— ${attribution}
At the very bottom, small monospaced letterspaced text:
${handle}
Render the final clause of the main quote (the words after the last comma, or the last three words) in warm antique-gold italic. No other text anywhere. Double-check all text letter-for-letter before finishing.`;
    setCampaignPrompts(prompts);
    robustCopy(prompts);

    // TikTok caption + hashtags for this campaign
    const seriesTag = (attribution.split(",")[0] || "").trim().toLowerCase().replace(/\W/g, "");
    setCampaignCaption(`“${pair[0]}”
“${pair[1]}”

${ctaSub}

Follow ${handle} for daily lines from the —BORN Universe.

#booktok #darkromantasy #fantasyromance #kindleunlimited #kubooks${seriesTag ? " #" + seriesTag : ""} #bookquotes #slowburn #newbooks`);

    // cards into gallery
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const out = [];
    drawCard(ctx, fmt.w, fmt.h, pal, n * 101 + 3, { hook, quote: q, attribution, handle });
    out.push({ src: c.toDataURL("image/jpeg", 0.92), label: `${setLabel} — Quote card` });
    if (coverImg) {
      drawLiveCard(ctx, fmt.w, fmt.h, n);
      out.push({ src: c.toDataURL("image/jpeg", 0.92), label: `${setLabel} — LIVE NOW card` });
    }
    setGallery([...out, ...gallery]);
    drawCard(ctx, fmt.w, fmt.h, pal, seed, { hook, quote: q, attribution, handle });

    setCampaignInfo(`${setLabel} · ${attribution} · exchange: “${pair[0]}” / “${pair[1]}” · quote: “${q}” · stagings: ${idx.slice(0, 3).map((i) => i + 1).join(", ")}${coverImg ? "" : " · (no cover uploaded — LIVE NOW card skipped)"}`);

    const next = n + 1;
    setCampaignNo(next);
    storage.set("emberpress:campaign", String(next)).catch(() => {});
  }
  const [includeCover, setIncludeCover] = useState(true);
  const [coverHook, setCoverHook] = useState("Five lines from a debt that was never hers to pay");
  const [cdTitle, setCdTitle] = useState("DEBTBORN BOOK TWO");
  const [cdDays, setCdDays] = useState(3);
  const [cdSub, setCdSub] = useState("The bargain continues — Kindle Unlimited");
  const [favLines, setFavLines] = useState([]);
  const [favPairs, setFavPairs] = useState([]);

  const SERIES_PRESETS = [
    { s: "DEBTBORN", p: "Ember (—BORN core)", cta: "DEBTBORN Book One — free in Kindle Unlimited" },
    { s: "GIFTBORN", p: "Gilt (GIFTBORN)", cta: "GIFTBORN: The Gift Held — live in Kindle Unlimited" },
    { s: "COLDBORN", p: "Frost (COLDBORN)", cta: "COLDBORN Book One — coming to Kindle Unlimited" },
    { s: "BLOODBORN", p: "Blood (BLOODBORN)", cta: "BLOODBORN Book One — coming to Kindle Unlimited" },
    { s: "ASHBORN", p: "Ash (ASHBORN)", cta: "ASHBORN Book One — coming to Kindle Unlimited" },
    { s: "TIDEBORN", p: "Tide (TIDEBORN)", cta: "TIDEBORN Book One — coming this October" },
    { s: "TOLLBORN", p: "Toll (TOLLBORN)", cta: "TOLLBORN — the Third Spine begins soon" },
  ];
  const applyPreset = (pr) => {
    setPalName(pr.p);
    setHook("THE —BORN UNIVERSE");
    setAttribution(`${pr.s}, Book One`);
    setCtaSub(pr.cta);
    // clear stale campaign output built under previous settings
    setCampaignPrompts(""); setCampaignCaption(""); setCampaignInfo("");
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("emberpress:favs");
        if (r && r.value) { const f = JSON.parse(r.value); setFavLines(f.lines || []); setFavPairs(f.pairs || []); }
      } catch (e) { /* first run */ }
    })();
  }, []);
  const saveFavs = (lines, pairs) => {
    setFavLines(lines); setFavPairs(pairs);
    storage.set("emberpress:favs", JSON.stringify({ lines, pairs })).catch(() => {});
  };
  const toggleFavLine = (q) => saveFavs(favLines.includes(q) ? favLines.filter((x) => x !== q) : [q, ...favLines], favPairs);
  const toggleFavPair = (p) => {
    const key = p.join("|");
    const has = favPairs.some((x) => x.join("|") === key);
    saveFavs(favLines, has ? favPairs.filter((x) => x.join("|") !== key) : [p, ...favPairs]);
  };

  // ---- cover slide: the swipe-earner ----
  function drawCoverCard(ctx, w, h) {
    paintBackground(ctx, w, h, pal, seed + 501, 0);
    const glyph = pal.accent === "#8FD0D8" ? "♣" : "❖";
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(w * 0.026)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(hook.toUpperCase().split("").join("\u200A"), w / 2, h * 0.13);
    const cs = Math.round(w * 0.085);
    ctx.font = `600 ${cs}px 'Spectral', serif`;
    ctx.fillStyle = pal.ink;
    ctx.shadowColor = "#000000CC"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 3;
    const lines = wrapText(ctx, coverHook, w * 0.82);
    const lh = cs * 1.22;
    const startY = h * 0.46 - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, startY + i * lh));
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    const oy = startY + (lines.length - 1) * lh + lh * 0.9;
    ctx.strokeStyle = pal.accent + "99"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2 - w * 0.11, oy); ctx.lineTo(w / 2 - w * 0.035, oy);
    ctx.moveTo(w / 2 + w * 0.035, oy); ctx.lineTo(w / 2 + w * 0.11, oy);
    ctx.stroke();
    ctx.font = `${Math.round(w * 0.026)}px serif`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(glyph, w / 2, oy + w * 0.009);
    ctx.font = `600 ${Math.round(w * 0.028)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.accent;
    ctx.fillText("S W I P E  →", w / 2, h * 0.88);
    if (handle) {
      ctx.font = `600 ${Math.round(w * 0.024)}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = pal.ink + "8C";
      ctx.fillText(handle.split("").join("\u200A"), w / 2, h * 0.94);
    }
  }

  // ---- countdown card ----
  function makeCountdownCard() {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    paintBackground(ctx, fmt.w, fmt.h, pal, seed + 777, 0);
    const w = fmt.w, h = fmt.h;
    ctx.textAlign = "center";
    ctx.font = `600 ${Math.round(w * 0.03)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(cdTitle.toUpperCase().split("").join("\u200A"), w / 2, h * 0.2);
    ctx.font = `600 ${Math.round(w * 0.3)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.ink;
    ctx.shadowColor = pal.accent + "AA"; ctx.shadowBlur = 60;
    ctx.fillText(String(cdDays), w / 2, h * 0.52);
    ctx.shadowBlur = 0;
    ctx.font = `600 ${Math.round(w * 0.045)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.accent;
    ctx.fillText("D A Y S", w / 2, h * 0.6);
    ctx.font = `italic 600 ${Math.round(w * 0.036)}px 'Spectral', serif`;
    ctx.fillStyle = pal.ink + "E0";
    ctx.shadowColor = "#000000CC"; ctx.shadowBlur = 18;
    wrapText(ctx, cdSub, w * 0.8).forEach((ln, i) => ctx.fillText(ln, w / 2, h * 0.7 + i * w * 0.05));
    ctx.shadowBlur = 0;
    if (handle) {
      ctx.font = `600 ${Math.round(w * 0.024)}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = pal.ink + "8C";
      ctx.fillText(handle.split("").join("\u200A"), w / 2, h * 0.94);
    }
    setGallery([{ src: c.toDataURL("image/jpeg", 0.92), label: `Countdown — ${cdDays} days` }, ...gallery]);
    drawCard(ctx, fmt.w, fmt.h, pal, seed, { hook, quote, attribution, handle });
  }

  // ---- Ken Burns scene video: slow zoom over the painting, captions fade in sequence ----
  function drawSceneFrame(ctx, w, h, el, durMs) {
    const p = Math.min(1, el / durMs);
    const zoom = 1 + 0.12 * p;
    const s = Math.max(w / sceneImg.width, h / sceneImg.height) * zoom;
    const dw = sceneImg.width * s, dh = sceneImg.height * s;
    const dx = (w - dw) / 2 + w * 0.02 * p;
    const dy = (h - dh) / 2;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(sceneImg, dx, dy, dw, dh);
    const quoteify = (t) => (/^[“"]/.test(t) ? t : "“" + t + "”");
    const drawVoice = (text, cx, topY, alpha) => {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      const size = Math.round(w * 0.042);
      ctx.font = `italic 600 ${size}px 'Spectral', serif`;
      ctx.textAlign = "center";
      const lines = wrapText(ctx, quoteify(text), w * 0.4);
      const lh = size * 1.28;
      lines.forEach((ln, i) => {
        const y = topY + i * lh;
        ctx.lineWidth = size * 0.16; ctx.strokeStyle = "#00000088"; ctx.lineJoin = "round";
        ctx.shadowColor = "#000000AA"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2;
        ctx.strokeText(ln, cx, y);
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(ln, cx, y);
      });
      ctx.restore();
    };
    const f1 = Math.max(0, Math.min(1, (el - 700) / 800));
    const f2 = Math.max(0, Math.min(1, (el - 2300) / 800));
    if (v1.trim()) drawVoice(v1, w * 0.29, h * 0.14, f1);
    if (v2.trim()) drawVoice(v2, w * 0.71, h * 0.095, f2);
    if (handle) {
      ctx.font = `600 ${Math.round(w * 0.022)}px 'IBM Plex Mono', monospace`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "#00000066";
      ctx.strokeText(handle, w / 2, h * 0.965);
      ctx.fillStyle = "#FFFFFFB0";
      ctx.fillText(handle, w / 2, h * 0.965);
    }
  }

  function recordSceneVideo() {
    if (!sceneImg) { alert("Upload a painting first."); return; }
    recordVideo();
  }

  // ---- slideshow video: the whole gallery as one crossfading video ----
  function recordSlideshow() {
    if (gallery.length < 2) { alert("Make a batch of slides first — the slideshow uses the gallery below."); return; }
    const imgs = [];
    let loaded = 0;
    gallery.forEach((g) => {
      const im = new Image();
      im.onload = () => { loaded++; if (loaded === gallery.length) runSlideshowVideo(imgs); };
      im.src = g.src;
      imgs.push(im);
    });
  }

  // ---- campaign video: photos you upload, in order ----
  function onVidFiles(files) {
    const list = Array.from(files);
    const slots = new Array(list.length).fill(null);
    let done = 0;
    const finish = () => {
      done++;
      if (done === list.length) {
        const ok = slots.filter(Boolean);
        if (!ok.length) { alert("Couldn't read those photos — try again, or pick them in smaller batches."); return; }
        setVidImgs((prev) => [...prev, ...ok]);
      }
    };
    list.forEach((f, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        const im = new Image();
        im.onload = () => { slots[i] = im; finish(); };
        im.onerror = finish;
        im.src = reader.result;
      };
      reader.onerror = finish;
      reader.readAsDataURL(f);
    });
  }

  // ---- slideshow engine: any image list → one crossfading video ----
  function runSlideshowVideo(imgs, per = 2600) {
    {
      const c = canvasRef.current, ctx = c.getContext("2d");
      const fadeMs = 450;
      const dur = per * imgs.length;
      const drawFrame = (el) => {
        const idx = Math.min(imgs.length - 1, Math.floor(el / per));
        const local = el - idx * per;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, fmt.w, fmt.h);
        const drawImg = (im, alpha, zoomP) => {
          const z = 1 + 0.06 * zoomP;
          const s = Math.max(fmt.w / im.width, fmt.h / im.height) * z;
          const dw = im.width * s, dh = im.height * s;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.drawImage(im, (fmt.w - dw) / 2, (fmt.h - dh) / 2, dw, dh);
          ctx.restore();
        };
        drawImg(imgs[idx], 1, local / per);
        if (idx + 1 < imgs.length && local > per - fadeMs) {
          drawImg(imgs[idx + 1], (local - (per - fadeMs)) / fadeMs, 0);
        }
      };
      const canMp4 = typeof MediaRecorder !== "undefined" && typeof c.captureStream === "function"
        && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("video/mp4");
      if (!canMp4) {
        alert(`Slideshow: ${imgs.length} slides, ~${Math.round(dur / 1000)}s.\n\n1. Start iOS screen recording (Control Centre → ⏺)\n2. Tap OK — 3-second countdown, then the slideshow plays\n3. Stop, trim in Photos.`);
        setRecording(true);
        const pre = 3000;
        const t0 = performance.now();
        const loop = (now) => {
          const el = now - t0;
          if (el < pre) {
            ctx.fillStyle = "#000"; ctx.fillRect(0, 0, fmt.w, fmt.h);
            ctx.textAlign = "center"; ctx.fillStyle = "#FFF";
            ctx.font = `700 ${Math.round(fmt.w * 0.28)}px 'IBM Plex Mono', monospace`;
            ctx.fillText(String(3 - Math.floor(el / 1000)), fmt.w / 2, fmt.h * 0.54);
            requestAnimationFrame(loop);
          } else {
            const el2 = el - pre;
            drawFrame(Math.min(el2, dur - 1));
            if (el2 < dur) requestAnimationFrame(loop);
            else restorePreview(ctx);
          }
        };
        requestAnimationFrame(loop);
        return;
      }
      try {
        const stream = c.captureStream(30);
        let rec;
        try { rec = new MediaRecorder(stream, { mimeType: "video/mp4", videoBitsPerSecond: 8_000_000 }); }
        catch { rec = new MediaRecorder(stream); }
        const chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: rec.mimeType });
          setVideoOut({ url: URL.createObjectURL(blob), ext: "mp4", blob });
          restorePreview(ctx);
        };
        setRecording(true);
        rec.start();
        const t0 = performance.now();
        const loop = (now) => {
          const el = now - t0;
          drawFrame(Math.min(el, dur - 1));
          if (el < dur) requestAnimationFrame(loop);
          else rec.stop();
        };
        requestAnimationFrame(loop);
      } catch (e) {
        alert("Recording failed — use screen recording via the ▶ button instead.");
        restorePreview(ctx);
      }
    }
  }

  // ---- post kit: caption + tags, one tap ----
  function copyPostKit() {
    const series = (attribution.split(",")[0] || "").trim();
    const tag = series.toLowerCase().replace(/\W/g, "");
    const kit = `${coverHook}

${ctaSub}

Follow ${handle} for daily lines from the —BORN Universe.

#booktok #darkromantasy #fantasyromance #kindleunlimited #kubooks${tag ? " #" + tag : ""} #bookquotes`;
    robustCopy(kit);
  }

  function promptTextFor(stagingStr, q1raw, q2raw, withText) {
    const mood = LIGHTMOODS[palName] || LIGHTMOODS["Ember (—BORN core)"];
    const q1 = `“${q1raw.replace(/^[“"]|[”"]$/g, "")}”`;
    const q2 = `“${q2raw.replace(/^[“"]|[”"]$/g, "")}”`;
    const textBlock = withText
      ? `TEXT — RENDER EXACTLY, THIS IS CRITICAL:
Two dialogue captions are painted directly onto the image as clean typeset text (not hand-lettered), in an elegant italic serif typeface (like a classic book face), soft off-white (#F5F0E6) with a very subtle dark outer glow / soft drop shadow so it reads against sky and shadow. Sentence case, enclosed in curly quotation marks exactly as written.

CAPTION 1 (hers) — exact text, verbatim, correct spelling, nothing added:
${q1}
Position: upper-LEFT quadrant, centered around 28% from the left edge, first line starting about 13% from the top, above or beside the woman. Wrap to 2–3 centered lines, block no wider than 40% of the image width. Each line's capital height about 3.5% of the image height.

CAPTION 2 (his) — exact text, verbatim, correct spelling, nothing added:
${q2}
Position: upper-RIGHT quadrant, centered around 72% from the left edge, first line starting about 9% from the top, above or beside the man. Same style and size, wrap to 2–3 centered lines, block no wider than 40% of the image width.

No other text anywhere in the image. Double-check both captions letter-for-letter against the text above before finishing.`
      : `Keep the upper quarter of the image relatively simple (sky, mist, or plain wall) so caption text can be added later. Do NOT paint any text.`;

    return `Create a 2D image: a traditional oil painting on textured canvas with visible brushstrokes, in a muted, painterly historical-fantasy style. Palette: ${mood}.

SCENE: ${stagingStr}.

CHARACTERS: On the left, ${charHer}. On the right, ${charHim}. Their body language is restrained and full of unspoken tension — longing without touching. The emotional register matches the dialogue: she says ${q1} and he answers ${q2}.

${textBlock}

COMPOSITION: portrait orientation, 2:3 aspect ratio (e.g. 1024×1536). Full or three-quarter figures visible. Soft cinematic light, melancholic romantic atmosphere, fine grain and canvas texture.

STRICT: no watermark, no signature, no modern objects${withText ? ", no text other than the two captions specified above" : ", no text or lettering of any kind"}.`;
  }

  function buildPaintingPrompt() {
    const p = promptTextFor(staging, v1, v2, paintText);
    setBuiltPrompt(p);
    robustCopy(p);
  }

  // ---- mine real dialogue exchanges: adjacent quoted lines ----
  function minePairs(text) {
    const qs = [...text.matchAll(/“([^”]{8,140})”|"([^"]{8,140})"/g)]
      .map((m) => ({ s: (m[1] || m[2]).trim(), i: m.index }));
    const pairs = [];
    const seen = new Set();
    for (let k = 0; k + 1 < qs.length && pairs.length < 20; k++) {
      const a = qs[k], b = qs[k + 1];
      if (b.i - a.i > 320) continue;
      const wa = a.s.split(/\s+/).length, wb = b.s.split(/\s+/).length;
      if (wa < 3 || wa > 20 || wb < 3 || wb > 20) continue;
      const key = (a.s + b.s).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a.s, b.s]);
    }
    return pairs;
  }

  // ---- offline pair composer ----
  function offlinePairs(n = 5, seedVal) {
    const bank = BANKS[palName] || BANKS["Ember (—BORN core)"];
    const rnd = mulberry32(seedVal ?? ((Date.now() + 7) % 100000));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const shapes = [
      () => ["Why do you keep your distance?", `So ${pick(bank.n)} never learns your name.`],
      () => [`Everyone leaves ${pick(bank.img)}.`, "Then I'll be the one who doesn't."],
      () => [`You can't carry ${pick(bank.n)} for me.`, "Then I'll carry you."],
      () => ["What do you want from me?", `Nothing ${pick(bank.n)} hasn't already taken.`],
      () => [`Don't follow me ${pick(bank.img)}.`, "Then walk slower."],
      () => [`I'm not worth ${pick(bank.n)}.`, "You were never the price. You were the reason."],
    ];
    const out = [];
    const used = new Set();
    while (out.length < n) {
      const p = pick(shapes)();
      const key = p.join("|");
      if (!used.has(key)) { used.add(key); out.push(p); }
    }
    return out;
  }

  async function generatePairs(n = 5) {
    setAiBusy(true); setAiErr("");
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          messages: [{ role: "user", content: `Write ${n} original two-line dialogue exchanges for dark romantasy quote cards. Themes: ${THEMES[palName] || THEMES["Ember (—BORN core)"]}. Pattern: line 1 is her guarded question or deflection (4–12 words); line 2 is his devoted, costly answer (4–14 words). No names, no clichés. These are original, not from any book. Respond with ONLY a JSON array of ${n} arrays of two strings, no fences, no preamble.` }],
        }),
      });
      const data = await response.json();
      const text = (data.content || []).map((i) => i.text || "").join("");
      const match = text.match(/\[[\s\S]*\]/);
      const arr = JSON.parse((match ? match[0] : text).trim());
      if (!Array.isArray(arr) || !arr.length) throw new Error("bad");
      setPairList(arr.map((p) => [String(p[0]), String(p[1])]));
      setV1(String(arr[0][0])); setV2(String(arr[0][1]));
    } catch (e) {
      const arr = offlinePairs(n);
      setPairList(arr);
      setV1(arr[0][0]); setV2(arr[0][1]);
      setAiErr("AI unavailable — used the built-in pair composer instead. Edit freely.");
    }
    setAiBusy(false);
  }

  function onSceneFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setSceneImg(img);
      img.onerror = () => alert("Couldn't decode that image. If it's a HEIC photo, re-save it as JPEG (screenshot it, or Photos → share → save as file) and upload that.");
      img.src = reader.result;
    };
    reader.onerror = () => alert("Couldn't read that file — try again.");
    reader.readAsDataURL(file);
  }

  // ---- scene card: user's painting + dialogue-pair captions ----
  function drawSceneCard(ctx, w, h) {
    // cover-crop the painting
    const s = Math.max(w / sceneImg.width, h / sceneImg.height);
    const dw = sceneImg.width * s, dh = sceneImg.height * s;
    ctx.drawImage(sceneImg, (w - dw) / 2, (h - dh) / 2, dw, dh);

    const quoteify = (t) => (/^[“"]/.test(t) ? t : "“" + t + "”");
    const drawVoice = (text, cx, topY) => {
      const size = Math.round(w * 0.042);
      ctx.font = `italic 600 ${size}px 'Spectral', serif`;
      ctx.textAlign = "center";
      const lines = wrapText(ctx, quoteify(text), w * 0.4);
      const lh = size * 1.28;
      lines.forEach((ln, i) => {
        const y = topY + i * lh;
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = "#00000088";
        ctx.lineJoin = "round";
        ctx.shadowColor = "#000000AA"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2;
        ctx.strokeText(ln, cx, y);
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(ln, cx, y);
      });
    };
    if (v1.trim()) drawVoice(v1, w * 0.29, h * 0.14);
    if (v2.trim()) drawVoice(v2, w * 0.71, h * 0.095);

    if (handle) {
      ctx.font = `600 ${Math.round(w * 0.022)}px 'IBM Plex Mono', monospace`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "#00000066";
      ctx.strokeText(handle, w / 2, h * 0.965);
      ctx.fillStyle = "#FFFFFFB0";
      ctx.fillText(handle, w / 2, h * 0.965);
    }
  }

  const makeSceneCard = () => {
    if (!sceneImg) { alert("Upload a painting first."); return; }
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    drawSceneCard(ctx, fmt.w, fmt.h);
    setGallery([{ src: c.toDataURL("image/jpeg", 0.92), label: "Scene card" }, ...gallery]);
    // restore normal preview
    drawCard(ctx, fmt.w, fmt.h, pal, seed, { hook, quote, attribution, handle });
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("emberpress:library");
        if (r && r.value) setLibrary(JSON.parse(r.value));
      } catch (e) { /* first run */ }
    })();
  }, []);
  const saveLibrary = (next) => { setLibrary(next); storage.set("emberpress:library", JSON.stringify(next)).catch(() => {}); };

  // ---- quote mining: deterministic, runs on-device ----
  const PUNCH = ["never", "always", "nothing", "everything", "name", "blood", "debt", "cost", "price", "promise", "tide", "cold", "ash", "gift", "toll", "owe", "owed", "carry", "carried", "keep", "kept", "burn", "drown", "bone", "heart", "dark", "sea", "winter", "vow", "no one"];
  function mineQuotes(text) {
    const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+/);
    const seen = new Set();
    const scored = [];
    for (let s of sentences) {
      s = s.trim().replace(/^[“”"']+|[“”"']+$/g, "");
      const wc = s.split(/\s+/).length;
      if (wc < 6 || wc > 24) continue;
      if (/\d/.test(s)) continue;
      if (/\b(said|asked|replied|muttered|whispered|shouted)\b/i.test(s)) continue;
      if (!/[.!?…]$/.test(s)) continue;
      const low = s.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      let score = 0;
      for (const p of PUNCH) if (low.includes(p)) score += 2;
      if (/\b(not|never|no one|nothing)\b/i.test(s)) score += 2;
      if (wc >= 9 && wc <= 18) score += 2;
      if (/^(The|She|He|You|They|Some|No)\b/.test(s)) score += 1;
      if (score >= 4) scored.push({ q: s, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 24).map((x) => x.q);
  }

  async function onBookFile(file) {
    setMining(true);
    try {
      let text;
      if (file.name.toLowerCase().endsWith(".docx")) {
        const buf = await file.arrayBuffer();
        text = (await mammoth.extractRawText({ arrayBuffer: buf })).value;
      } else text = await file.text();
      const quotes = mineQuotes(text);
      const pairs = minePairs(text);
      const entry = { name: file.name.replace(/\.(docx|txt|md)$/i, ""), quotes, pairs };
      saveLibrary([entry, ...library.filter((b) => b.name !== entry.name)]);
      setOpenBook(entry.name);
    } catch (e) { alert("Couldn't read that file — use .docx or .txt"); }
    setMining(false);
  }

  // ---- one-tap save via the iOS share sheet ----
  // Files must be built synchronously: iOS voids the tap "gesture" after any await,
  // and refuses to open the share sheet outside a gesture.
  function dataURLtoFile(dataUrl, name) {
    const [head, b64] = dataUrl.split(",");
    const mime = (head.match(/data:(.*?);/) || [])[1] || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  }
  function shareImage(dataUrl, name = "card") {
    try {
      const file = dataURLtoFile(dataUrl, `${name}.jpg`);
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        navigator.share({ files: [file] }).catch((e) => {
          if (e && e.name !== "AbortError") alert("Share failed (" + e.name + ") — long-press the image → Add to Photos instead.");
        });
      } else alert("This viewer can't open the share sheet — long-press the image → Add to Photos instead.");
    } catch (e) { alert("Save failed — long-press the image → Add to Photos instead."); }
  }
  function shareVideo() {
    try {
      const file = new File([videoOut.blob], `emberpress.${videoOut.ext}`, { type: videoOut.blob.type });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        navigator.share({ files: [file] }).catch((e) => {
          if (e && e.name !== "AbortError") alert("Share failed (" + e.name + ") — long-press the video, or screen-record it fullscreen.");
        });
      } else alert("This viewer can't share video — long-press the video, or screen-record it fullscreen.");
    } catch (e) { alert("Save failed — long-press the video, or screen-record it fullscreen."); }
  }

  function drawCtaCard(ctx, w, h) {
    paintBackground(ctx, w, h, pal, seed + 999, 0);
    const glyph = pal.accent === "#8FD0D8" ? "♣" : "❖";
    ctx.textAlign = "center";

    // large glyph mark
    ctx.shadowColor = pal.accent + "AA";
    ctx.shadowBlur = 40;
    ctx.font = `${Math.round(w * 0.11)}px serif`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(glyph, w / 2, h * 0.34);
    ctx.shadowBlur = 0;

    // handle, big
    ctx.font = `600 ${Math.round(w * 0.052)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = pal.ink;
    ctx.shadowColor = "#000000CC"; ctx.shadowBlur = 24;
    ctx.fillText(handle, w / 2, h * 0.45);
    ctx.shadowBlur = 0;

    // main CTA line (wrapped serif)
    const cs = Math.round(w * 0.05);
    ctx.font = `500 ${cs}px 'Spectral', serif`;
    ctx.fillStyle = pal.ink + "E6";
    const lines = wrapText(ctx, ctaMain, w * 0.78);
    const lh = cs * 1.3;
    ctx.shadowColor = "#000000CC"; ctx.shadowBlur = 20;
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h * 0.55 + i * lh));
    ctx.shadowBlur = 0;

    // rules + sub-line (the commercial hook)
    const oy = h * 0.55 + lines.length * lh + h * 0.02;
    ctx.strokeStyle = pal.accent + "99"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2 - w * 0.12, oy); ctx.lineTo(w / 2 + w * 0.12, oy);
    ctx.stroke();
    ctx.font = `italic 600 ${Math.round(w * 0.034)}px 'Spectral', serif`;
    ctx.fillStyle = pal.accent;
    ctx.fillText(ctaSub, w / 2, oy + w * 0.05);
  }

  const THEMES = {
    "Ember (—BORN core)": "debts, bargains, inheritance of burdens, what is owed and who carries it",
    "Tide (TIDEBORN)": "tides, harbors, refusal and return, what the sea keeps",
    "Frost (COLDBORN)": "cold, keeping, endurance, the held inch, bells in winter",
    "Blood (BLOODBORN)": "blood, lineage, the price of belonging, old wounds",
    "Ash (ASHBORN)": "ash, aftermath, rebuilding, the whole ground, what fire leaves",
    "Gilt (GIFTBORN)": "gifts held, poured, spent, kept and woven; the cost of giving",
    "Toll (TOLLBORN)": "tolls, crossings, a coast that eats maps, paying with true self-knowledge",
  };

  const BANKS = {
    "Ember (—BORN core)": { n: ["the debt", "the bargain", "what was owed", "the ledger", "the burden"], v: ["carried", "kept", "paid", "inherited", "counted"], img: ["in the dark", "past the last door", "before the ash cools", "under a borrowed name", "when no one is watching"] },
    "Tide (TIDEBORN)": { n: ["the harbor", "the tide", "the refusal", "what the sea kept", "the last mooring"], v: ["returned", "held", "refused", "remembered", "answered"], img: ["at low water", "beyond the seawall", "when the bell rings", "under a turning sky", "before the storm names itself"] },
    "Frost (COLDBORN)": { n: ["the cold", "the held inch", "the keeping", "the long winter", "the last bell"], v: ["endured", "kept", "held", "outlasted", "answered"], img: ["past the frost line", "in the keeper's silence", "when the fires fail", "three months south", "before the thaw"] },
    "Blood (BLOODBORN)": { n: ["the blood", "the old wound", "the lineage", "the price of belonging", "the vow"], v: ["remembered", "demanded", "carried", "bound", "claimed"], img: ["down the long line", "at the family table", "under the same roof", "before the naming", "when the past knocks"] },
    "Ash (ASHBORN)": { n: ["the ash", "the whole ground", "what the fire left", "the rebuilding", "the aftermath"], v: ["carried", "held", "rebuilt", "answered", "reclaimed"], img: ["after the burning", "in the grey morning", "where the house stood", "under new rafters", "when the smoke clears"] },
    "Gilt (GIFTBORN)": { n: ["the gift", "what was poured", "what was spent", "the keeping", "the weaving"], v: ["counted", "held", "returned", "repaid", "kept"], img: ["more than once", "in open hands", "before it was asked", "against the taking", "twice over"] },
    "Toll (TOLLBORN)": { n: ["the toll", "the crossing", "the coast", "the map", "the true name"], v: ["paid", "crossed", "answered", "named", "charted"], img: ["at the water's edge", "before the chart ended", "in your own hand", "at every crossing", "where the coast eats maps"] },
  };

  function offlineQuotes(n = 5, seedVal) {
    const bank = BANKS[palName] || BANKS["Ember (—BORN core)"];
    const rnd = mulberry32(seedVal ?? (Date.now() % 100000));
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const shapes = [
      () => `She learned early that ${pick(bank.n)} must be ${pick(bank.v)} ${pick(bank.img)}.`,
      () => `No one warns you that ${pick(bank.n)} is ${pick(bank.v)} ${pick(bank.img)}.`,
      () => `Some promises are ${pick(bank.v)} ${pick(bank.img)}. Hers was one of them.`,
      () => `You can refuse ${pick(bank.n)}. You cannot refuse being ${pick(bank.v)} by it.`,
      () => `${cap(pick(bank.n))} always ${pick(bank.v)} more than it promised.`,
      () => `They said ${pick(bank.n)} could be ${pick(bank.v)}. They never said by whom.`,
      () => `${cap(pick(bank.n))} knows your name, even ${pick(bank.img)}.`,
    ];
    const out = new Set();
    while (out.size < n) out.add(pick(shapes)());
    return [...out];
  }

  async function generateQuotes(n = 5) {
    setAiBusy(true); setAiErr("");
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Write ${n} original quote-card lines for a dark romantasy TikTok account. Themes: ${THEMES[palName] || THEMES["Ember (—BORN core)"]}. Rules: each line 8–20 words, standalone, evocative, second or third person, no character names, no clichés like "little did she know", no em-dash openings, no hashtags. These are original teaser lines, NOT quotes from any existing book. Respond with ONLY a JSON array of ${n} strings, no markdown fences, no preamble.`,
          }],
        }),
      });
      const data = await response.json();
      const text = (data.content || []).map((i) => i.text || "").join("");
      const match = text.match(/\[[\s\S]*\]/);
      const arr = JSON.parse((match ? match[0] : text).replace(/```json|```/g, "").trim());
      if (!Array.isArray(arr) || !arr.length) throw new Error("bad");
      setQuote(String(arr[0]));
      setBatch(arr.map(String).join("\n"));
    } catch (e) {
      const arr = offlineQuotes(n);
      setQuote(arr[0]);
      setBatch(arr.join("\n"));
      setAiErr("AI unavailable — used the built-in line composer instead. Edit freely.");
    }
    setAiBusy(false);
  }

  const pal = PALETTES[palName];
  const fmt = FORMATS[fmtName];

  useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    if (!fontsReady) return;
    const c = canvasRef.current;
    c.width = fmt.w; c.height = fmt.h;
    drawCard(c.getContext("2d"), fmt.w, fmt.h, pal, seed, { hook, quote, attribution, handle });
  }, [palName, fmtName, seed, hook, quote, attribution, handle, fontsReady]);

  const makePNG = () => {
    setGallery([{ src: canvasRef.current.toDataURL("image/jpeg", 0.92), label: `Card · seed ${seed}` }]);
  };

  const exportBatch = () => {
    const quotes = batch.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!quotes.length) return;
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const out = [];
    if (includeCover) {
      drawCoverCard(ctx, fmt.w, fmt.h);
      out.push({ src: c.toDataURL("image/jpeg", 0.92), label: "Slide 1 — cover / hook" });
    }
    for (let i = 0; i < quotes.length; i++) {
      drawCard(ctx, fmt.w, fmt.h, pal, seed + i * 13, { hook, quote: quotes[i], attribution, handle });
      out.push({ src: c.toDataURL("image/jpeg", 0.92), label: `Slide ${i + 1} of ${quotes.length + (includeCta ? 1 : 0)}` });
    }
    if (includeCta) {
      drawCtaCard(ctx, fmt.w, fmt.h);
      out.push({ src: c.toDataURL("image/jpeg", 0.92), label: `Slide ${quotes.length + 1} — CTA end-card` });
    }
    setGallery(out);
    // redraw current
    drawCard(ctx, fmt.w, fmt.h, pal, seed, { hook, quote, attribution, handle });
  };

  // ---- unified video engine: works on uploaded painting OR generated card ----
  function videoFrame(ctx, el, dur) {
    if (sceneImg) drawSceneFrame(ctx, fmt.w, fmt.h, el, dur);
    else drawCard(ctx, fmt.w, fmt.h, pal, seed, { hook, quote, attribution, handle }, (el / 1000) * 0.25, Math.min(1, el / 1200));
  }
  function playLoop(ctx, dur, onDone) {
    const t0 = performance.now();
    const loop = (now) => {
      const el = now - t0;
      videoFrame(ctx, el, dur);
      if (el < dur) requestAnimationFrame(loop);
      else { onDone && onDone(); }
    };
    requestAnimationFrame(loop);
  }
  function restorePreview(ctx) {
    setRecording(false);
    drawCard(ctx, fmt.w, fmt.h, pal, seed, { hook, quote, attribution, handle });
  }
  function playWithCountdown(ctx, dur) {
    setRecording(true);
    const pre = 3000;
    const t0 = performance.now();
    const loop = (now) => {
      const el = now - t0;
      if (el < pre) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, fmt.w, fmt.h);
        ctx.textAlign = "center";
        ctx.fillStyle = "#FFFFFF";
        ctx.font = `700 ${Math.round(fmt.w * 0.28)}px 'IBM Plex Mono', monospace`;
        ctx.fillText(String(3 - Math.floor(el / 1000)), fmt.w / 2, fmt.h * 0.54);
        requestAnimationFrame(loop);
      } else {
        const el2 = el - pre;
        videoFrame(ctx, el2, dur);
        if (el2 < dur) requestAnimationFrame(loop);
        else restorePreview(ctx);
      }
    };
    requestAnimationFrame(loop);
  }
  function playForScreenRecording() {
    const c = canvasRef.current, ctx = c.getContext("2d");
    playWithCountdown(ctx, videoSecs * 1000);
  }
  function recordVideo() {
    const c = canvasRef.current, ctx = c.getContext("2d");
    const dur = videoSecs * 1000;
    const canMp4 = typeof MediaRecorder !== "undefined" && typeof c.captureStream === "function"
      && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("video/mp4");
    if (!canMp4) {
      alert("This viewer can't produce a saveable video file. Do this instead:\n\n1. Start iOS screen recording (Control Centre → ⏺)\n2. Tap OK — a 3-second countdown plays, then the animation\n3. Stop recording, trim to the animation in Photos.");
      playWithCountdown(ctx, dur);
      return;
    }
    try {
      const stream = c.captureStream(30);
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: "video/mp4", videoBitsPerSecond: 8_000_000 }); }
      catch { rec = new MediaRecorder(stream); }
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType });
        setVideoOut({ url: URL.createObjectURL(blob), ext: "mp4", blob });
        restorePreview(ctx);
      };
      setRecording(true);
      rec.start();
      playLoop(ctx, dur, () => rec.stop());
    } catch (e) {
      alert("Recording failed — use screen recording instead: start Control Centre → ⏺, tap OK, capture the countdown + animation, trim in Photos.");
      playWithCountdown(ctx, dur);
    }
  }

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        button { cursor: pointer; font-family: 'Inter', sans-serif; }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid #C27B3F; outline-offset: 2px; }
        input, textarea, select { font-family: 'Inter', sans-serif; }
      `}</style>

      <header style={S.header}>
        <span style={S.brand}>EMBERPRESS</span>
        <span style={S.sub}>2D generator · cards · painted backdrops · video · v7</span>
      </header>

      <main style={S.main}>
        <div style={S.cols}>
          {/* Controls */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={S.label}>Series presets — one tap sets palette, hook, attribution & CTA</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SERIES_PRESETS.map((pr) => (
                <button key={pr.s} style={{ ...S.ghostBtn, padding: "8px 12px", fontSize: 12.5 }} onClick={() => applyPreset(pr)}>{pr.s}</button>
              ))}
            </div>
            <div style={S.panel}>
              <div style={S.panelTitle}>⚡ Campaign generator — one tap, one numbered set</div>
              <p style={S.small}>One tap = one numbered set: a SINGLE ChatGPT prompt that orders all 4 images (3 scene paintings + 1 painted quote card), plus an in-app quote card and LIVE NOW cover card into the gallery. Same number always rebuilds the same set; the counter advances automatically. Uses your starred/mined lines first.</p>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ width: 120 }}>
                  <label style={S.label}>Campaign #</label>
                  <input type="number" min={1} style={S.input} value={campaignNo} onChange={(e) => setCampaignNo(Math.max(1, +e.target.value || 1))} />
                </div>
                <button style={{ ...S.ghostBtn, flex: 1, minWidth: 160 }} onClick={() => coverRef.current.click()}>
                  {coverImg ? "✓ Cover loaded — replace" : "📕 Upload book cover"}
                </button>
                <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files[0]; if (f) onCoverFile(f); e.target.value = ""; }} />
              </div>
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 12 }} onClick={buildCampaign}>⚡ Generate campaign set</button>
              {campaignInfo && <p style={{ ...S.small, color: "#D8D0C4", marginTop: 10 }}>{campaignInfo}</p>}
              {campaignPrompts && (
                <>
                  <button style={{ ...S.ghostBtn, width: "100%", marginTop: 10 }} onClick={() => robustCopy(campaignPrompts)}>Copy the full 4-image ChatGPT prompt</button>
                  <textarea readOnly style={{ ...S.input, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, marginTop: 8 }} rows={8} value={campaignPrompts} onFocus={(e) => e.target.select()} />
                </>
              )}
              {campaignCaption && (
                <>
                  <div style={{ ...S.panelTitle, marginTop: 14 }}>TikTok caption + hashtags</div>
                  <textarea readOnly style={{ ...S.input, resize: "vertical", fontSize: 13, marginTop: 8 }} rows={7} value={campaignCaption} onFocus={(e) => e.target.select()} />
                  <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8 }} onClick={() => robustCopy(campaignCaption)}>📋 Copy caption + hashtags</button>
                </>
              )}

              <div style={{ borderTop: "1px solid #2A2622", marginTop: 16, paddingTop: 12 }}>
                <div style={S.panelTitle}>🎬 Campaign video — from your 5 finished images</div>
                <p style={S.small}>When the paintings come back from ChatGPT and your cards are saved: select all 5 photos IN ORDER (scene 1 → 2 → 3 → quote card → LIVE NOW cover). One video, crossfades, gentle zoom.</p>
                <input ref={vidRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { if (e.target.files.length) onVidFiles(e.target.files); e.target.value = ""; }} />
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <button style={{ ...S.ghostBtn, flex: 1, minWidth: 160 }} onClick={() => vidRef.current.click()}>
                    {vidImgs.length ? `✓ ${vidImgs.length} images — add more` : "🖼 Select images (in order)"}
                  </button>
                  <div style={{ width: 130 }}>
                    <label style={S.label}>Secs / slide</label>
                    <input type="number" min={1.5} max={5} step={0.1} style={S.input} value={vidPer} onChange={(e) => setVidPer(Math.max(1.5, Math.min(5, +e.target.value || 2.6)))} />
                  </div>
                </div>
                {vidImgs.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    {vidImgs.map((im, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <img src={im.src} alt={"slide " + (i + 1)} style={{ width: 56, height: 74, objectFit: "cover", borderRadius: 6, border: "1px solid #3A342E" }} />
                        <span style={{ position: "absolute", top: 2, left: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#fff", textShadow: "0 1px 3px #000" }}>{i + 1}</span>
                      </div>
                    ))}
                    <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => setVidImgs([])}>Clear</button>
                  </div>
                )}
                <button style={{ ...S.primaryBtn, width: "100%", marginTop: 12, opacity: recording ? 0.6 : 1 }} disabled={recording}
                  onClick={() => { if (vidImgs.length < 2) { alert("Select at least 2 images first."); return; } runSlideshowVideo(vidImgs, vidPer * 1000); }}>
                  {recording ? "Working… watch the preview" : `🎬 Make campaign video (${vidImgs.length} slides, ~${Math.round(vidImgs.length * vidPer)}s)`}
                </button>
                <p style={S.small}>The finished MP4 appears in the save section below with a save button.</p>
              </div>
            </div>

            <label style={S.label}>Palette (series mood)</label>
            <select style={S.input} value={palName} onChange={(e) => setPalName(e.target.value)}>
              {Object.keys(PALETTES).map((p) => <option key={p}>{p}</option>)}
            </select>

            <label style={S.label}>Format</label>
            <select style={S.input} value={fmtName} onChange={(e) => setFmtName(e.target.value)}>
              {Object.keys(FORMATS).map((f) => <option key={f}>{f}</option>)}
            </select>

            <label style={S.label}>Hook (top line)</label>
            <input style={S.input} value={hook} onChange={(e) => setHook(e.target.value)} />

            <label style={S.label}>Quote</label>
            <textarea style={{ ...S.input, resize: "vertical" }} rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} />

            <label style={S.label}>Attribution</label>
            <input style={S.input} value={attribution} onChange={(e) => setAttribution(e.target.value)} />

            <label style={S.label}>Handle / watermark</label>
            <input style={S.input} value={handle} onChange={(e) => setHandle(e.target.value)} />

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button style={S.ghostBtn} onClick={() => setSeed(Math.floor(Math.random() * 100000))}>↻ New painting</button>
              <button style={S.primaryBtn} onClick={makePNG}>Make card → save below</button>
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Video export</div>
              <p style={S.small}>
                Source: <strong style={{ color: "#EDE7DE" }}>{sceneImg ? "your uploaded painting (slow zoom + captions fade in)" : "the current generated card (drifting paint + text fade)"}</strong>
                {!sceneImg && " — upload a painting to animate it instead:"}
              </p>
              {!sceneImg && (
                <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8 }} onClick={() => sceneRef.current.click()}>🖼 Upload an image to animate</button>
              )}
              <label style={S.label}>Length (seconds)</label>
              <input type="number" min={3} max={15} style={{ ...S.input, width: 100 }} value={videoSecs} onChange={(e) => setVideoSecs(Math.max(3, Math.min(15, +e.target.value)))} />
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 10, opacity: recording ? 0.6 : 1 }} onClick={recordVideo} disabled={recording}>
                {recording ? `Working… watch the preview` : "🎬 Record video"}
              </button>
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, opacity: recording ? 0.6 : 1 }} onClick={playForScreenRecording} disabled={recording}>
                ▶ Play animation (for iOS screen recording)
              </button>
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, opacity: recording ? 0.6 : 1 }} onClick={recordSlideshow} disabled={recording}>
                🎞 Slideshow video from gallery ({gallery.length} slides)
              </button>
              <p style={S.small}>If direct recording isn't supported in this viewer, it plays the animation instead — capture it with Control Centre → ⏺ screen record, then trim in Photos. The finished clip (when recorded) appears in the save section below.</p>
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Quote engine</div>
              <p style={S.small}>Writes original teaser lines in the selected palette's mood — the first fills the card, all five fill the batch box. These are new lines, not verbatim book quotes; swap in real ones where you want authenticity.</p>
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 10, opacity: aiBusy ? 0.6 : 1 }} onClick={() => generateQuotes(5)} disabled={aiBusy}>
                {aiBusy ? "Writing…" : "✦ Auto-generate 5 quotes"}
              </button>
              {aiErr && <p style={{ ...S.small, color: "#D0707A" }}>{aiErr}</p>}
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Book library — real quotes from your manuscripts</div>
              <p style={S.small}>Upload a book (.docx or .txt) and it mines the most quotable lines from your actual prose, on-device. Nothing is uploaded anywhere; only the mined lines are kept.</p>
              <input ref={bookRef} type="file" accept=".docx,.txt,.md" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files[0]; if (f) onBookFile(f); e.target.value = ""; }} />
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 10, opacity: mining ? 0.6 : 1 }} onClick={() => bookRef.current.click()} disabled={mining}>
                {mining ? "Mining lines…" : "📚 Upload a book"}
              </button>
              {library.map((b) => (
                <div key={b.name} style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button style={{ ...S.ghostBtn, flex: 1, textAlign: "left", padding: "10px 12px" }} onClick={() => setOpenBook(openBook === b.name ? null : b.name)}>
                      {openBook === b.name ? "▾" : "▸"} {b.name} · {b.quotes.length} lines
                    </button>
                    <button style={{ ...S.ghostBtn, padding: "10px 12px", color: "#D0707A" }} onClick={() => saveLibrary(library.filter((x) => x.name !== b.name))}>✕</button>
                  </div>
                  {openBook === b.name && b.quotes.map((q, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
                      <p style={{ ...S.small, flex: 1, margin: 0, color: "#D8D0C4" }}>{q}</p>
                      <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => toggleFavLine(q)}>{favLines.includes(q) ? "★" : "☆"}</button>
                      <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => setQuote(q)}>Use</button>
                      <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => setBatch(batch ? batch + "\n" + q : q)}>+ Batch</button>
                    </div>
                  ))}
                  {openBook === b.name && (b.pairs || []).length > 0 && (
                    <>
                      <div style={{ ...S.panelTitle, marginTop: 14 }}>Dialogue exchanges found</div>
                      {(b.pairs || []).map((p, i) => (
                        <div key={"p" + i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
                          <p style={{ ...S.small, flex: 1, margin: 0, color: "#D8D0C4" }}>“{p[0]}” / “{p[1]}”</p>
                          <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => toggleFavPair(p)}>{favPairs.some((x) => x.join("|") === p.join("|")) ? "★" : "☆"}</button>
                          <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => { setV1(p[0]); setV2(p[1]); }}>Use in scene</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Scene mode — dialogue pair over your painting</div>
              <p style={S.small}>Upload one of your character paintings; the pair is set over it in the caption style — her line upper-left, his upper-right, white italic serif with shadow.</p>
              <input ref={sceneRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files[0]; if (f) onSceneFile(f); e.target.value = ""; }} />
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 10 }} onClick={() => sceneRef.current.click()}>
                {sceneImg ? "✓ Painting loaded — replace" : "🖼 Upload painting"}
              </button>
              <label style={S.label}>Voice 1 (upper-left)</label>
              <input style={S.input} value={v1} onChange={(e) => setV1(e.target.value)} />
              <label style={S.label}>Voice 2 (upper-right)</label>
              <input style={S.input} value={v2} onChange={(e) => setV2(e.target.value)} />
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 12, opacity: aiBusy ? 0.6 : 1 }} onClick={() => generatePairs(5)} disabled={aiBusy}>
                {aiBusy ? "Writing…" : "✦ Auto-generate 5 pairs"}
              </button>
              {pairList.length > 1 && pairList.slice(1).map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
                  <p style={{ ...S.small, flex: 1, margin: 0, color: "#D8D0C4" }}>“{p[0]}” / “{p[1]}”</p>
                  <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => { setV1(p[0]); setV2(p[1]); }}>Use</button>
                </div>
              ))}
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 12 }} onClick={makeSceneCard}>Make scene card → save below</button>
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, opacity: recording ? 0.6 : 1 }} onClick={recordSceneVideo} disabled={recording}>
                {recording ? "Recording…" : "🎬 Record scene video (slow zoom + captions fade in)"}
              </button>

              <div style={{ borderTop: "1px solid #2A2622", marginTop: 18, paddingTop: 14 }}>
                <div style={S.panelTitle}>Painting prompt builder — for ChatGPT</div>
                <p style={S.small}>Builds an exact image prompt in your established painted style, staged to the dialogue pair above, with the top of the frame kept clear for captions. Generate the painting in ChatGPT, save it, then upload it here.</p>
                <label style={S.label}>Her (character sheet — saved)</label>
                <textarea style={{ ...S.input, resize: "vertical" }} rows={2} value={charHer} onChange={(e) => { setCharHer(e.target.value); saveChars(e.target.value, charHim); }} />
                <label style={S.label}>Him (character sheet — saved)</label>
                <textarea style={{ ...S.input, resize: "vertical" }} rows={2} value={charHim} onChange={(e) => { setCharHim(e.target.value); saveChars(charHer, e.target.value); }} />
                <label style={S.label}>Staging</label>
                <select style={S.input} value={staging} onChange={(e) => setStaging(e.target.value)}>
                  {STAGINGS.map((s) => <option key={s} value={s}>{s.slice(0, 64)}…</option>)}
                </select>
                <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <input type="checkbox" checked={paintText} onChange={(e) => setPaintText(e.target.checked)} style={{ width: 18, height: 18 }} />
                  ChatGPT paints the captions (exact text, size & position in prompt)
                </label>
                <button style={{ ...S.primaryBtn, width: "100%", marginTop: 10 }} onClick={buildPaintingPrompt}>🎨 Build & copy ChatGPT prompt</button>
                {builtPrompt && (
                  <>
                    <textarea readOnly style={{ ...S.input, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, marginTop: 10 }} rows={10} value={builtPrompt} onFocus={(e) => e.target.select()} />
                    <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8 }} onClick={() => robustCopy(builtPrompt)}>Copy again</button>
                  </>
                )}
              </div>
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Batch — carousel slides</div>
              <label style={S.label}>One quote per line → one slide each (varied paintings, same palette)</label>
              <textarea style={{ ...S.input, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }} rows={4} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder={"Quote for slide 1\nQuote for slide 2\nQuote for slide 3"} />
              <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={includeCover} onChange={(e) => setIncludeCover(e.target.checked)} style={{ width: 18, height: 18 }} />
                Add cover / hook slide as slide 1
              </label>
              {includeCover && (
                <>
                  <label style={S.label}>Cover hook line</label>
                  <input style={S.input} value={coverHook} onChange={(e) => setCoverHook(e.target.value)} />
                </>
              )}
              <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                <input type="checkbox" checked={includeCta} onChange={(e) => setIncludeCta(e.target.checked)} style={{ width: 18, height: 18 }} />
                Add CTA end-card as the final slide
              </label>
              {includeCta && (
                <>
                  <label style={S.label}>CTA line</label>
                  <input style={S.input} value={ctaMain} onChange={(e) => setCtaMain(e.target.value)} />
                  <label style={S.label}>Sub-line (the commercial hook)</label>
                  <input style={S.input} value={ctaSub} onChange={(e) => setCtaSub(e.target.value)} />
                </>
              )}
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 10 }} onClick={exportBatch}>Make slides → save below</button>
              <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8 }} onClick={copyPostKit}>📋 Copy post kit (caption + hashtags)</button>
              <p style={S.small}>Post at 8:00 AM and 9:00 PM PHT for US/UK reach.</p>
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Countdown card — launch week</div>
              <label style={S.label}>Title</label>
              <input style={S.input} value={cdTitle} onChange={(e) => setCdTitle(e.target.value)} />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 110 }}>
                  <label style={S.label}>Days</label>
                  <input type="number" min={0} max={99} style={S.input} value={cdDays} onChange={(e) => setCdDays(Math.max(0, Math.min(99, +e.target.value)))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={S.label}>Sub-line</label>
                  <input style={S.input} value={cdSub} onChange={(e) => setCdSub(e.target.value)} />
                </div>
              </div>
              <button style={{ ...S.primaryBtn, width: "100%", marginTop: 12 }} onClick={makeCountdownCard}>Make countdown card → save below</button>
            </div>

            <div style={S.panel}>
              <div style={S.panelTitle}>Favourites — your proven lines</div>
              {favLines.length === 0 && favPairs.length === 0 && <p style={S.small}>Star lines and pairs (★ buttons) to keep them here for reuse across formats.</p>}
              {favLines.map((q, i) => (
                <div key={"fl" + i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
                  <p style={{ ...S.small, flex: 1, margin: 0, color: "#D8D0C4" }}>{q}</p>
                  <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => setQuote(q)}>Use</button>
                  <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => setBatch(batch ? batch + "\n" + q : q)}>+ Batch</button>
                  <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12, color: "#D0707A" }} onClick={() => toggleFavLine(q)}>✕</button>
                </div>
              ))}
              {favPairs.map((p, i) => (
                <div key={"fp" + i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
                  <p style={{ ...S.small, flex: 1, margin: 0, color: "#D8D0C4" }}>“{p[0]}” / “{p[1]}”</p>
                  <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12 }} onClick={() => { setV1(p[0]); setV2(p[1]); }}>Use in scene</button>
                  <button style={{ ...S.ghostBtn, padding: "6px 10px", fontSize: 12, color: "#D0707A" }} onClick={() => toggleFavPair(p)}>✕</button>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div style={{ flex: 1.2, minWidth: 300 }}>
            <div style={{ position: "sticky", top: 12 }}>
              <canvas ref={canvasRef} style={{ width: "100%", borderRadius: 12, border: "1px solid #2A2622", display: "block", boxShadow: "0 12px 40px #00000066" }} />
              <p style={S.small}>Preview renders at full export resolution ({fmt.w}×{fmt.h}). Seed {seed} — every painting is reproducible.</p>
            </div>
          </div>
        </div>

        {/* SAVE GALLERY — long-press images to add to Photos */}
        {(gallery.length > 0 || videoOut) && (
          <section style={{ marginTop: 26 }}>
            <div style={{ ...S.panelTitle, fontSize: 13 }}>SAVE TO PHOTOS</div>
            <p style={{ ...S.small, marginTop: 4 }}>
              <strong style={{ color: "#EDE7DE" }}>Long-press each image → “Add to Photos”.</strong> These are the full-resolution files, not the preview.
            </p>
            {videoOut && (
              <div style={{ marginTop: 12 }}>
                <video controls playsInline src={videoOut.url} style={{ width: "100%", maxWidth: 480, borderRadius: 12, border: "1px solid #2A2622", display: "block" }} />
                <button style={{ ...S.primaryBtn, marginTop: 8 }} onClick={shareVideo}>⬇ Save video to Photos</button>
              </div>
            )}
            {gallery.map((g, i) => (
              <div key={i} style={{ marginTop: 14 }}>
                <img src={g.src} alt={g.label} style={{ width: "100%", maxWidth: 480, borderRadius: 12, border: "1px solid #2A2622", display: "block" }} />
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  <button style={{ ...S.primaryBtn, padding: "10px 16px" }} onClick={() => shareImage(g.src, g.label.replace(/\W+/g, "-"))}>⬇ Save to Photos</button>
                  <span style={{ ...S.small, margin: 0 }}>{g.label}</span>
                </div>
              </div>
            ))}
            <button style={{ ...S.ghostBtn, marginTop: 14 }} onClick={() => { setGallery([]); setVideoOut(null); }}>Clear gallery</button>
          </section>
        )}
      </main>

      <footer style={S.footer}>All generation is procedural and local — no AI images, no uploads, nothing leaves the page. Use only quotes you own.</footer>
    </div>
  );
}

const S = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#171412", minHeight: "100vh", color: "#EDE7DE" },
  header: { display: "flex", alignItems: "baseline", gap: 12, padding: "16px 20px", borderBottom: "1px solid #2A2622", flexWrap: "wrap" },
  brand: { fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 22, letterSpacing: 3, color: "#E8A96B" },
  sub: { color: "#8F857A", fontSize: 12.5 },
  main: { maxWidth: 1000, margin: "0 auto", padding: "18px 18px 60px" },
  cols: { display: "flex", gap: 22, flexWrap: "wrap" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#B0A69A", marginTop: 12, marginBottom: 5, letterSpacing: 0.4 },
  input: { display: "block", width: "100%", boxSizing: "border-box", border: "1px solid #3A342E", borderRadius: 8, padding: "10px 12px", fontSize: 14, background: "#221E1A", color: "#EDE7DE" },
  primaryBtn: { background: "#C27B3F", color: "#171412", border: "none", borderRadius: 8, padding: "12px 18px", fontSize: 14, fontWeight: 700 },
  ghostBtn: { background: "none", border: "1px solid #4A4238", color: "#EDE7DE", borderRadius: 8, padding: "12px 18px", fontSize: 14, fontWeight: 600 },
  panel: { background: "#1E1B17", border: "1px solid #2A2622", borderRadius: 10, padding: "14px 16px", marginTop: 18 },
  panelTitle: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: 1.5, color: "#E8A96B", fontWeight: 600 },
  small: { fontSize: 11.5, color: "#8F857A", marginTop: 8, lineHeight: 1.5 },
  footer: { textAlign: "center", fontSize: 11.5, color: "#8F857A", padding: "0 20px 30px", maxWidth: 1000, margin: "0 auto" },
};
