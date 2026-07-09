import { useEffect, useRef, useState, useCallback } from 'react';
import { MemoryStick, Cpu, Activity, Mic, BrainCircuit } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { api } from '../lib/api';
import { usePushToTalk } from '../lib/voice';
import type { OllamaStatus, OllamaPsModel, VoiceConfig } from '../lib/types';

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────
function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}
function shortName(name: string): string {
  return name.split('/').pop() || name;
}

type RGB = { r: number; g: number; b: number };
// CSS-Farb-Token (#RRGGBB) in {r,g,b} umwandeln – für die Canvas-Kugel.
function readVarRgb(name: string, fallback: RGB): RGB {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hex = raw.replace('#', '');
    if (hex.length === 6) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
    }
    const m = raw.match(/rgba?\(([^)]+)\)/);
    if (m) { const [r, g, b] = m[1].split(',').map((s) => parseInt(s, 10)); return { r, g, b }; }
  } catch { /* */ }
  return fallback;
}
const readAccentRgb = () => readVarRgb('--color-accent', { r: 16, g: 185, b: 129 });        // #10B981
const readAccentStrongRgb = () => readVarRgb('--color-accent-strong', { r: 5, g: 150, b: 105 }); // #059669
function isLightTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') !== 'dark';
}

// ── Grobe Kontinent-Maske (Land = Vereinigung von Lat/Lon-Rechtecken) ───────────
const LAND: [number, number, number, number][] = [
  // Nordamerika
  [24, 50, -125, -66], [48, 71, -128, -60], [58, 72, -168, -140], [8, 24, -110, -83], [60, 84, -58, -18],
  // Südamerika
  [-4, 12, -80, -50], [-20, -4, -74, -35], [-35, -20, -73, -53], [-55, -35, -75, -63],
  // Europa
  [36, 60, -9, 28], [55, 71, 5, 30], [40, 56, 28, 48],
  // Afrika
  [12, 36, -17, 34], [-6, 12, -14, 48], [-35, -6, 10, 40],
  // Naher Osten
  [12, 40, 34, 60],
  // Asien
  [40, 72, 48, 180], [30, 45, 48, 96], [8, 30, 68, 90], [20, 42, 95, 122], [30, 45, 128, 146],
  [8, 28, 95, 110], [-10, 8, 95, 142],
  // Australien / Neuseeland
  [-38, -11, 113, 154], [-47, -34, 165, 179],
  // Antarktis
  [-90, -63, -180, 180],
];
function isLand(lat: number, lon: number): boolean {
  for (const [a, b, c, d] of LAND) if (lat >= a && lat <= b && lon >= c && lon <= d) return true;
  return false;
}

// ── Weltkugel (immer sichtbar) mit optionalem neuronalem Netz ───────────────────
// - Erdkugel: dichte Punktwolke, deren Dichte/Helligkeit die Kontinente zeigt.
// - Netz + Datenpulse: NUR wenn `online` (Sprachmodell geladen). Offline weg.
// - Farbe = --color-accent (Theme/Farbkonzept). `busy` (KI arbeitet) lässt das
//   Netz aufleuchten, schneller drehen & pulsen.
function AiSphere({ online, busy }: { online: boolean; busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const accent = useRef(readAccentRgb());
  const accentStrong = useRef(readAccentStrongRgb());
  const light = useRef(isLightTheme());
  const onlineRef = useRef(online);
  const busyRef = useRef(busy);
  useEffect(() => { onlineRef.current = online; }, [online]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mo = new MutationObserver(() => {
      accent.current = readAccentRgb();
      accentStrong.current = readAccentStrongRgb();
      light.current = isLightTheme();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Erdkugel-Punkte (Fibonacci) mit Land-Klassifikation ──
    const NG = 3000;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const globe: { x: number; y: number; z: number; land: boolean; keep: boolean }[] = [];
    for (let i = 0; i < NG; i++) {
      const y = 1 - (i / (NG - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      const x = Math.cos(theta) * r, z = Math.sin(theta) * r;
      const lat = Math.asin(y) * 180 / Math.PI;
      const lon = Math.atan2(z, x) * 180 / Math.PI;
      const land = isLand(lat, lon);
      globe.push({ x, y, z, land, keep: land || Math.random() < 0.20 });
    }

    // ── Netz-Punkte (Struktur) + Kanten ──
    const NN = 150;
    const net: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < NN; i++) {
      const y = 1 - (i / (NN - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      net.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
    }
    const edges: [number, number][] = [];
    const MAXD = 0.46;
    for (let i = 0; i < NN; i++) for (let j = i + 1; j < NN; j++) {
      const dx = net[i].x - net[j].x, dy = net[i].y - net[j].y, dz = net[i].z - net[j].z;
      if (dx * dx + dy * dy + dz * dz < MAXD * MAXD) edges.push([i, j]);
    }
    const pulses = Array.from({ length: 22 }, () => ({ e: (Math.random() * edges.length) | 0, t: Math.random(), speed: 0.004 + Math.random() * 0.008 }));

    let raf = 0, dpr = 1, size = 320;
    const resize = () => {
      const w = wrap.clientWidth || 320, h = wrap.clientHeight || 320;
      size = Math.max(260, Math.min(900, Math.min(w, h) * 0.98));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let angle = 0.6, act = 0, netFade = 0;

    const render = () => {
      const lt = light.current;
      // Im Hellmodus kräftigeren, dunkleren Akzent nehmen (auf Weiß gut sichtbar),
      // im Dunkelmodus den hellen Akzent.
      const { r, g, b } = lt ? accentStrong.current : accent.current;
      // Linienfarbe: dezenter als die Punkte. Hell = dunkler Akzent (nicht
      // ausgewaschen), Dunkel = gedämpfte, leicht kühlere Akzent-Variante.
      const AA = accent.current;
      const lr = lt ? accentStrong.current.r : Math.round(AA.r * 0.55 + 40);
      const lg = lt ? accentStrong.current.g : Math.round(AA.g * 0.55 + 50);
      const lb = lt ? accentStrong.current.b : Math.round(AA.b * 0.55 + 55);
      // Themenabhängige Deckkräfte
      const glow0 = lt ? 0.05 : 0.12, glow1 = lt ? 0.02 : 0.045;
      const oceanA = lt ? 0.10 : 0.03, oceanAd = lt ? 0.16 : 0.07;
      const landA0 = lt ? 0.50 : 0.45;
      const lineBase = lt ? 0.07 : 0.02, lineDepth = lt ? 0.16 : 0.085, lineCap = lt ? 0.55 : 0.5;
      const nodeA0 = lt ? 0.50 : 0.22, nodeShadow = lt ? 2 : 5;
      const pulse = lt ? accentStrong.current : { r: 255, g: 255, b: 255 };
      const on = onlineRef.current;
      act += ((on && busyRef.current ? 1 : 0) - act) * 0.06;   // Aktivitätsintensität
      netFade += ((on ? 1 : 0) - netFade) * 0.08;              // Netz sanft ein-/ausblenden
      const cx = size / 2, cy = size / 2;
      const Rg = size * 0.40;                                   // Radius Erdkugel
      const Rn = size * 0.455;                                  // Radius Netz
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      angle += 0.0026 + act * 0.006;                            // schneller, wenn die KI arbeitet
      const tilt = 0.32 + Math.sin(angle * 0.5) * 0.14;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

      const rot = (p: { x: number; y: number; z: number }, R: number) => {
        let x = p.x * cosA + p.z * sinA;
        let z = -p.x * sinA + p.z * cosA;
        let y = p.y;
        const y2 = y * cosT - z * sinT, z2 = y * sinT + z * cosT;
        y = y2; z = z2;
        const persp = 1 / (1.9 - z * 0.9);
        return { sx: cx + x * R * persp, sy: cy + y * R * persp, depth: (z + 1) / 2 };
      };

      // Hintergrund-Glühen (stärker bei Aktivität)
      const glow = ctx.createRadialGradient(cx, cy, Rg * 0.1, cx, cy, Rg * 1.7);
      glow.addColorStop(0, `rgba(${r},${g},${b},${glow0 + act * 0.14})`);
      glow.addColorStop(0.55, `rgba(${r},${g},${b},${glow1 + act * 0.05})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      // Erdkugel (immer): Land dicht/hell, Ozean spärlich/blass
      for (const p of globe) {
        if (!p.keep) continue;
        const q = rot(p, Rg);
        if (p.land) {
          const a = (landA0 + q.depth * 0.45) * (1 + act * 0.3);
          ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a)})`;
          const s = (1.0 + q.depth * 1.9) + act * 0.5;
          ctx.fillRect(q.sx, q.sy, s, s);
        } else {
          ctx.fillStyle = `rgba(${r},${g},${b},${oceanA + q.depth * oceanAd})`;
          const s = 0.5 + q.depth * 0.7;
          ctx.fillRect(q.sx, q.sy, s, s);
        }
      }

      // Neuronales Netz + Pulse – nur wenn online (via netFade sanft)
      if (netFade > 0.01) {
        const proj = net.map((p) => rot(p, Rn));
        ctx.lineWidth = 1;
        for (const [i, j] of edges) {
          const a = proj[i], c = proj[j];
          const d = (a.depth + c.depth) / 2;
          const alpha = (lineBase + d * lineDepth) * (1 + act * 0.9) * netFade;
          ctx.strokeStyle = `rgba(${lr},${lg},${lb},${Math.min(lineCap, alpha)})`;
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(c.sx, c.sy); ctx.stroke();
        }
        for (const p of proj) {
          const rad = (0.7 + p.depth * 1.7) + act * 0.6;
          const alpha = (nodeA0 + p.depth * 0.6) * (1 + act * 0.4) * netFade;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, alpha)})`;
          ctx.shadowBlur = (nodeShadow + act * 8) * p.depth;
          ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
          ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;

        for (const pu of pulses) {
          const edge = edges[pu.e];
          if (!edge) continue;
          const a = proj[edge[0]], c = proj[edge[1]];
          const px = a.sx + (c.sx - a.sx) * pu.t;
          const py = a.sy + (c.sy - a.sy) * pu.t;
          const d = a.depth + (c.depth - a.depth) * pu.t;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${pulse.r},${pulse.g},${pulse.b},${(0.35 + d * 0.5) * (0.7 + act * 0.6) * netFade})`;
          ctx.shadowBlur = 8 + act * 6;
          ctx.shadowColor = `rgba(${r},${g},${b},1)`;
          ctx.arc(px, py, 1.4 + d * 1.2 + act * 0.8, 0, Math.PI * 2); ctx.fill();
          pu.t += pu.speed * (1 + act * 1.6);
          if (pu.t > 1) { pu.t = 0; pu.e = (Math.random() * edges.length) | 0; }
        }
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(render);
    };

    render();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); };
  }, []);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

// ── Wellen-Visualisierung (mittig nach außen, nach Lautstärke) ──────────────────
// Sichtbar nur, wenn ein Weckwort erkannt wurde (Zuhören) bzw. beim Antworten –
// sonst gibt die Komponente nichts aus („ausgeblendet"). Reagiert live auf den
// Pegel des jeweiligen AnalyserNode (Mikrofon beim Verstehen, Ausgabe beim Reden).
function Waveform({ analyser, active }: { analyser: React.RefObject<AnalyserNode | null>; active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 360, H = 150;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const data = new Uint8Array(128);
    let raf = 0;
    const draw = () => {
      const an = analyser.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const accent = (getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#10B981');
      if (an) an.getByteFrequencyData(data);
      const K = 26, bw = 4, gap = 4, cx = W / 2, cy = H / 2;
      for (let k = 0; k <= K; k++) {
        const v = an ? (data[Math.min(127, k * 2)] / 255) : 0;
        const shape = Math.cos((k / K) * (Math.PI / 2));           // Mitte hoch, Ränder niedrig
        const h = Math.max(3, H * 0.92 * shape * (0.12 + 0.88 * v));
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.35 + 0.6 * (1 - k / K);
        const y = cy - h / 2;
        ctx.fillRect(cx + k * (bw + gap) - bw / 2, y, bw, h);
        if (k > 0) ctx.fillRect(cx - k * (bw + gap) - bw / 2, y, bw, h);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, analyser]);
  if (!active) return null;
  return <canvas ref={ref} style={{ display: 'block' }} />;
}

// Summe der Ablauf-Zeitpunkte – steigt, wenn Ollama nach einer Anfrage den
// keep_alive-Timer neu setzt → daran erkennen wir „die KI macht etwas".
function activitySignature(models: OllamaPsModel[]): number {
  return models.reduce((s, m) => s + (Date.parse(m.expires_at) || 0), 0);
}

// ── Status-Badge (online/offline) ───────────────────────────────────────────────
function StatusBadge({ online }: { online: boolean }) {
  const color = online ? 'var(--color-success)' : 'var(--color-faint)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 13px',
      borderRadius: 999, fontSize: 13, fontWeight: 700, letterSpacing: '.02em',
      color, border: `1px solid ${color}`,
      background: online ? 'var(--color-accent-soft)' : 'var(--color-surface-sunken)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: online ? `0 0 8px ${color}` : 'none' }} />
      {online ? tt('online') : tt('offline')}
    </span>
  );
}

// ── Seite: KI-Zentrale ──────────────────────────────────────────────────────────
export function AiHub() {
  const t = useT();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [running, setRunning] = useState<OllamaPsModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const prevSig = useRef<number | null>(null);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sprachsteuerung (nur wenn in den Einstellungen aktiviert)
  const [voiceCfg, setVoiceCfg] = useState<VoiceConfig | null>(null);
  const voiceCfgRef = useRef<VoiceConfig | null>(null);
  const ptt = usePushToTalk(() => voiceCfgRef.current ? { lang: voiceCfgRef.current.lang } : null, (b) => setBusy(b));
  useEffect(() => { api.voice.config().then((c) => { setVoiceCfg(c); voiceCfgRef.current = c; }).catch(() => {}); }, []);

  // Obsidian-Wissensbasis („Gehirn") – Status neben online anzeigen
  const [brain, setBrain] = useState<import('../lib/types').ObsidianStatus | null>(null);
  useEffect(() => { api.obsidian.status().then(setBrain).catch(() => {}); }, []);

  // Push-to-Talk per Leertaste: gedrückt halten = aufnehmen, loslassen = senden.
  const voiceReady = !!voiceCfg?.enabled && !!voiceCfg?.available.daemon && ptt.state.supported;
  useEffect(() => {
    if (!voiceReady) return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping()) return;
      e.preventDefault();
      void ptt.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping()) return;
      e.preventDefault();
      void ptt.stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [voiceReady, ptt]);

  const load = useCallback(async () => {
    try {
      const [s, ps] = await Promise.allSettled([api.ki.status(), api.ki.ps()]);
      if (s.status === 'fulfilled') setStatus(s.value);
      if (ps.status === 'fulfilled') {
        const models = ps.value.models ?? [];
        setRunning(models);
        const sig = activitySignature(models);
        if (prevSig.current !== null && sig - prevSig.current > 1500) {
          // KI wurde benutzt → Netz reagieren lassen
          setBusy(true);
          if (busyTimer.current) clearTimeout(busyTimer.current);
          busyTimer.current = setTimeout(() => setBusy(false), 3000);
        }
        prevSig.current = sig;
      }
    } catch { /* */ }
  }, []);

  const refresh = async () => { setLoading(true); try { await load(); } finally { setLoading(false); } };

  useEffect(() => { void refresh(); }, []);

  // Häufig abfragen, damit Status & Aktivitätsreaktion nahezu live sind
  useEffect(() => {
    const iv = setInterval(load, 2500);
    return () => { clearInterval(iv); if (busyTimer.current) clearTimeout(busyTimer.current); };
  }, [load]);

  const online = running.length > 0;

  if (!status) {
    return (
      <>
        <Topbar title={t('nav.aihub')} />
        <main className="page"><div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div></main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={t('nav.aihub')}
        subtitle={online ? t('page.aihub.subtitle.active', { n: running.length }) : tt('offline')}
        onRefresh={refresh}
        refreshing={loading}
      />
      <main className="page" style={{ display: 'flex', flexDirection: 'column', paddingBottom: 20 }}>
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 16 }}>
            <div className="aihub-layout">

              {/* Große Weltkugel füllt den Platz (immer sichtbar) */}
              <div className="aihub-globe" style={{ position: 'relative' }}>
                <AiSphere online={online} busy={busy} />
                {(ptt.state.recording || ptt.state.speaking) && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none' }}>
                    <Waveform analyser={ptt.state.speaking ? ptt.outAnalyser : ptt.micAnalyser} active={ptt.state.recording || ptt.state.speaking} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent)' }}>
                      {ptt.state.speaking ? tt('Antwortet …') : tt('Ich höre …')}
                    </div>
                  </div>
                )}
              </div>

              {/* Rechte Spalte: Status + welches Modell */}
              <aside className="aihub-side">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <StatusBadge online={online} />
                  {brain?.connected && (
                    <span title={tt('Obsidian als Wissensbasis verbunden')} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 999, color: 'var(--color-success)',
                      background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)',
                    }}>
                      <BrainCircuit size={13} /> {tt('Obsidian')} · {brain.chunks} {tt('Infos')}
                    </span>
                  )}
                  {online && busy && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--color-accent)' }}>
                      <Activity size={13} /> {tt('KI arbeitet …')}
                    </span>
                  )}
                </div>

                {online ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 4 }}>
                      {running.length === 1 ? tt('Modell') : tt('Modelle')}
                    </div>
                    {running.map((rr) => {
                      const onGpu = rr.size_vram >= rr.size && rr.size_vram > 0;
                      return (
                        <div key={rr.name} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px',
                          background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10,
                        }}>
                          {onGpu ? <Cpu size={16} color="var(--color-success)" /> : <MemoryStick size={16} color="var(--color-accent)" />}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rr.name}>
                              {shortName(rr.name)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                              {fmtBytes(rr.size)} · {onGpu ? tt('GPU (VRAM)') : tt('RAM (CPU)')}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 13px', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-muted)' }}>{tt('Kein Sprachmodell geladen')}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-faint)', lineHeight: 1.55 }}>
                      {tt('Lade unter „KI-Modelle" ein Sprachmodell in den Arbeitsspeicher (RAM oder GPU), damit die KI-Visualisierung erscheint.')}
                    </div>
                  </div>
                )}

                {/* Sprachsteuerung – Push-to-Talk per Leertaste */}
                {voiceCfg?.enabled && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{tt('Sprachsteuerung')}</span>

                    {voiceCfg.available.daemon ? (
                      <>
                        <button
                          className={`btn btn--sm ${ptt.state.recording ? 'btn--primary' : 'btn--outline'}`}
                          disabled={!ptt.state.supported || ptt.state.busy}
                          onMouseDown={() => void ptt.start()}
                          onMouseUp={() => void ptt.stop()}
                          onMouseLeave={() => { if (ptt.state.recording) void ptt.stop(); }}
                          title={tt('Gedrückt halten und sprechen (oder Leertaste)')}
                        >
                          <Mic size={13} /> {ptt.state.recording ? tt('Loslassen zum Senden') : tt('Sprechen (Leertaste)')}
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--color-faint)' }}>
                          {tt('Leertaste gedrückt halten und sprechen – loslassen sendet an die KI.')}
                        </div>
                        {(ptt.state.recording || ptt.state.busy || ptt.state.speaking || ptt.state.status) && (
                          <div style={{ fontSize: 11.5, color: ptt.state.recording ? 'var(--color-accent)' : 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: (ptt.state.recording || ptt.state.speaking) ? 'var(--color-accent)' : 'var(--color-faint)', boxShadow: (ptt.state.recording || ptt.state.speaking) ? '0 0 6px var(--color-accent)' : 'none' }} />
                            {ptt.state.status}
                          </div>
                        )}
                        {ptt.state.error && <div style={{ fontSize: 11.5, color: 'var(--color-error)' }}>{ptt.state.error}</div>}
                        {ptt.state.lines.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, maxHeight: '58vh', overflowY: 'auto' }}>
                            {ptt.state.lines.map((ln, i) => (
                              <div key={i} style={{
                                fontSize: 12, lineHeight: 1.45, padding: '6px 10px', borderRadius: 8,
                                background: ln.role === 'you' ? 'var(--color-accent-soft)' : ln.role === 'sys' ? 'var(--color-surface-sunken)' : 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                                color: ln.role === 'sys' ? 'var(--color-error)' : 'var(--color-fg)',
                              }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginRight: 6 }}>
                                  {ln.role === 'you' ? tt('Du') : ln.role === 'ai' ? 'KI' : '!'}
                                </span>
                                {ln.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>{tt('Sprachdienst nicht erreichbar – siehe KI-Modelle → Sprachsteuerung.')}</div>
                    )}
                  </div>
                )}
              </aside>

            </div>
          </div>
        </div>
      </main>
    </>
  );
}
