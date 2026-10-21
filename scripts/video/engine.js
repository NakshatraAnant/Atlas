// ATLAS Academy video engine. Runs inside Microsoft Edge (loaded from a file:// page, a secure
// context) and renders a timed script frame by frame to a canvas, encodes VP9 video and Opus audio
// with WebCodecs, and muxes WebM with webm-muxer. Deterministic: the same script and narration
// produce the same frames. Exposes window.renderVideo(job).
/* global WebMMuxer */
(function () {
  const W = 1280;
  const H = 720;
  const FPS = 30;
  const RATE = 48000;
  const BG = '#0d1524';
  const INK = '#e6eaf1';
  const MUTED = '#9fb0c6';
  const LINE = '#2a3548';
  const UP = '#7ed6a2';
  const DOWN = '#f39a8e';
  const FONT = '"Segoe UI", "IBM Plex Sans", Arial, sans-serif';

  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const fmt = (v, d) => (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

  // '%' → 12.5%; '₹ cr' → ₹1,250 cr (rupee sign first, as written in India).
  const withUnit = (n, unit) => (unit === '%' ? n + '%' : unit.startsWith('₹') ? '₹' + n + unit.slice(1) : n + ' ' + unit);

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function text(ctx, s, x, y, size, color, weight = 400, align = 'left') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }
  function para(ctx, s, x, y, size, color, maxWidth, lineHeight, weight = 400, align = 'left') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(ctx, s, maxWidth);
    lines.forEach((l, i) => text(ctx, l, x, y + i * lineHeight, size, color, weight, align));
    return lines.length * lineHeight;
  }
  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function frame(ctx, job, t) {
    const { script, timeline, total } = job;
    const accent = script.accent;
    // Background and chrome.
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#12203a');
    g.addColorStop(1, BG);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 6);
    text(ctx, 'ATLAS ACADEMY', 48, 52, 18, INK, 700);
    text(ctx, script.scenes[0].visual.course || '', 220, 52, 18, MUTED, 500);
    // Progress bar.
    ctx.fillStyle = LINE;
    ctx.fillRect(48, H - 26, W - 96, 4);
    ctx.fillStyle = accent;
    ctx.fillRect(48, H - 26, (W - 96) * Math.min(1, t / total), 4);
    // Active scene with a short cross-fade.
    const i = Math.max(0, timeline.findIndex((s) => t >= s.start && t < s.end));
    const idx = t >= total ? timeline.length - 1 : i;
    const s = timeline[idx];
    const local = t - s.start;
    const fadeIn = ease(local / 0.45);
    const fadeOut = idx < timeline.length - 1 ? 1 - ease((t - (s.end - 0.35)) / 0.35) : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
    drawVisual(ctx, script.scenes[idx].visual, local, s.end - s.start, accent);
    ctx.restore();
  }

  function heading(ctx, s, k, accent) {
    text(ctx, s, 48 + (1 - k) * -30, 128, 40, INK, 700);
    ctx.fillStyle = accent;
    ctx.fillRect(48, 146, 90 * k, 4);
  }
  function note(ctx, s) {
    if (!s) return;
    roundRect(ctx, 48, H - 82, Math.min(W - 96, 40 + s.length * 9), 38, 8, 'rgba(232,176,106,0.14)', 'rgba(232,176,106,0.6)');
    text(ctx, s, 66, H - 57, 18, '#e8b06a', 600);
  }

  function drawVisual(ctx, v, t, dur, accent) {
    const k = ease(t / 0.8);
    if (v.type === 'title') {
      text(ctx, v.course, W / 2, 250, 26, accent, 700, 'center');
      ctx.font = `700 60px ${FONT}`;
      para(ctx, v.title, W / 2, 340 + (1 - k) * 30, 60, INK, 1080, 70, 700, 'center');
      para(ctx, v.subtitle, W / 2, 470, 28, MUTED, 960, 38, 400, 'center');
      return;
    }
    if (v.type === 'end') {
      heading(ctx, v.heading, k, accent);
      roundRect(ctx, 120, 220, W - 240, 220, 18, 'rgba(127,178,236,0.08)', accent);
      para(ctx, v.takeaway, W / 2, 310 + (1 - k) * 20, 44, INK, W - 340, 56, 700, 'center');
      text(ctx, v.note, W / 2, 520, 24, MUTED, 500, 'center');
      return;
    }
    heading(ctx, v.heading, k, accent);
    if (v.type === 'bullets') {
      const per = Math.max(0.6, (dur - 1.2) / v.items.length);
      v.items.forEach((it, n) => {
        const kk = ease((t - 0.5 - n * per) / 0.5);
        if (kk <= 0) return;
        ctx.save();
        ctx.globalAlpha *= kk;
        const y = 230 + n * 92;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(80 + (1 - kk) * 20, y - 12, 9, 0, Math.PI * 2);
        ctx.fill();
        para(ctx, it, 110 + (1 - kk) * 20, y, 34, INK, W - 220, 42, 500);
        ctx.restore();
      });
    } else if (v.type === 'flow') {
      const n = v.nodes.length;
      const gap = 28;
      const bw = (W - 96 - gap * (n - 1)) / n;
      const per = Math.max(0.7, (dur - 1.5) / n);
      v.nodes.forEach((node, j) => {
        const kk = ease((t - 0.5 - j * per) / 0.6);
        if (kk <= 0) return;
        const x = 48 + j * (bw + gap);
        ctx.save();
        ctx.globalAlpha *= kk;
        roundRect(ctx, x, 300 + (1 - kk) * 30, bw, 150, 14, 'rgba(255,255,255,0.05)', accent);
        para(ctx, node, x + bw / 2, 370 + (1 - kk) * 30, 26, INK, bw - 30, 32, 600, 'center');
        if (j > 0) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x - gap + 4, 375);
          ctx.lineTo(x - 6, 375);
          ctx.stroke();
        }
        ctx.restore();
      });
    } else if (v.type === 'compare') {
      [v.left, v.right].forEach((side, j) => {
        const kk = ease((t - 0.4 - j * 1.2) / 0.7);
        if (kk <= 0) return;
        const x = j ? W / 2 + 16 : 48;
        const w = W / 2 - 64;
        ctx.save();
        ctx.globalAlpha *= kk;
        roundRect(ctx, x + (j ? 1 : -1) * (1 - kk) * 40, 200, w, 380, 16, 'rgba(255,255,255,0.05)', j ? accent : '#5f7392');
        text(ctx, side.title, x + 32, 260, 32, INK, 700);
        side.points.forEach((p, q) => para(ctx, '• ' + p, x + 32, 330 + q * 70, 28, MUTED, w - 64, 34, 500));
        ctx.restore();
      });
    } else if (v.type === 'bars') {
      const max = Math.max(...v.items.map((i) => Math.abs(i.value)));
      const per = Math.max(0.5, (dur - 1.5) / v.items.length);
      v.items.forEach((it, j) => {
        const kk = ease((t - 0.5 - j * per) / 0.9);
        const y = 220 + j * (320 / v.items.length);
        text(ctx, it.label, 48, y + 34, 26, INK, 500);
        const x0 = 520;
        const w = ((W - 96 - x0 - 140) * Math.abs(it.value) * kk) / max;
        roundRect(ctx, x0, y + 8, Math.max(2, w), 40, 6, accent, null);
        if (kk > 0.05) text(ctx, withUnit(fmt(it.value * kk, v.decimals ?? 1), v.unit), x0 + w + 16, y + 38, 26, INK, 700);
      });
    } else if (v.type === 'waterfall') {
      const steps = v.steps;
      let lvl = 0;
      const pts = steps.map((s) => {
        if (s.total) { lvl = s.value; return { ...s, a: 0, b: s.value }; }
        const a = lvl;
        lvl += s.value;
        return { ...s, a, b: lvl };
      });
      const max = Math.max(...pts.map((p) => Math.max(p.a, p.b)));
      const base = 600;
      const scale = 360 / max;
      const bw = (W - 96) / steps.length - 18;
      const per = Math.max(0.6, (dur - 1.5) / steps.length);
      pts.forEach((p, j) => {
        const kk = ease((t - 0.5 - j * per) / 0.7);
        if (kk <= 0) return;
        const x = 48 + j * (bw + 18);
        const lo = Math.min(p.a, p.b);
        const hi = Math.max(p.a, p.b);
        const h = (hi - lo) * scale * kk;
        const color = p.total ? accent : p.value < 0 ? DOWN : UP;
        roundRect(ctx, x, base - lo * scale - h, bw, Math.max(2, h), 4, color, null);
        text(ctx, `${p.value < 0 ? '−' : ''}${fmt(Math.abs(p.value), 2)}`, x + bw / 2, base - hi * scale - 12, 22, INK, 700, 'center');
        para(ctx, p.label, x + bw / 2, base + 30, 19, MUTED, bw, 22, 500, 'center');
      });
      ctx.fillStyle = LINE;
      ctx.fillRect(48, base, W - 96, 2);
    } else if (v.type === 'line') {
      const vals = v.points.map((p) => p.value);
      const lo = Math.min(...vals) * 0.9;
      const hi = Math.max(...vals) * 1.05;
      const X = (j) => 140 + (j / (vals.length - 1)) * (W - 320);
      const Y = (val) => 560 - ((val - lo) / (hi - lo)) * 330;
      const prog = ease((t - 0.6) / Math.max(1.5, dur * 0.6)) * (vals.length - 1);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let j = 0; j <= Math.floor(prog); j++) j === 0 ? ctx.moveTo(X(0), Y(vals[0])) : ctx.lineTo(X(j), Y(vals[j]));
      const f = prog - Math.floor(prog);
      const j0 = Math.floor(prog);
      if (j0 < vals.length - 1) ctx.lineTo(X(j0) + (X(j0 + 1) - X(j0)) * f, Y(vals[j0]) + (Y(vals[j0 + 1]) - Y(vals[j0])) * f);
      ctx.stroke();
      v.points.forEach((p, j) => {
        if (j > prog + 0.01) return;
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(X(j), Y(p.value), 8, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, `${v.unit}${fmt(p.value, p.value % 1 ? 2 : 0)}`, X(j), Y(p.value) - 22, 28, INK, 700, 'center');
        text(ctx, p.label, X(j), 610, 22, MUTED, 500, 'center');
      });
    }
    note(ctx, v.note);
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64F32(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  window.renderVideo = async function (job) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const target = new WebMMuxer.ArrayBufferTarget();
    const muxer = new WebMMuxer.Muxer({ target, video: { codec: 'V_VP9', width: W, height: H, frameRate: FPS }, audio: { codec: 'A_OPUS', sampleRate: RATE, numberOfChannels: 1 }, firstTimestampBehavior: 'offset' });
    let failure = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
    venc.configure({ codec: 'vp09.00.10.08', width: W, height: H, bitrate: 700_000, bitrateMode: 'variable', framerate: FPS, latencyMode: 'quality' });
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e; } });
    aenc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: 96000 });

    // Audio: place each narration segment at its scene start.
    const totalSamples = Math.ceil(job.total * RATE);
    const mix = new Float32Array(totalSamples);
    job.timeline.forEach((s, i) => {
      const pcm = fromBase64F32(job.audio[i]);
      const off = Math.round((s.start + s.leadIn) * RATE);
      mix.set(pcm.subarray(0, Math.max(0, Math.min(pcm.length, totalSamples - off))), off);
    });
    const chunk = 4800;
    for (let i = 0; i < totalSamples; i += chunk) {
      const n = Math.min(chunk, totalSamples - i);
      const data = new AudioData({ format: 'f32', sampleRate: RATE, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i / RATE) * 1e6), data: mix.slice(i, i + n) });
      aenc.encode(data);
      data.close();
    }

    const frames = Math.ceil(job.total * FPS);
    let poster = null;
    for (let f = 0; f < frames; f++) {
      const t = f / FPS;
      frame(ctx, job, t);
      if (!poster && t >= job.posterAt) poster = canvas.toDataURL('image/png');
      const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 });
      vf.close();
      if (venc.encodeQueueSize > 12) await new Promise((r) => setTimeout(r, 0));
      if (failure) throw failure;
    }
    await venc.flush();
    await aenc.flush();
    muxer.finalize();
    if (failure) throw failure;
    return { webm: toBase64(target.buffer), poster, frames, bytes: target.buffer.byteLength };
  };
})();
