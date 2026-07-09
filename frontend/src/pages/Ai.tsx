import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BrainCircuit, Download, Trash2, RefreshCw, HardDrive, Cpu, Tag,
  Search, ExternalLink, Eye, Code2, Mic, Zap, FileText, ChevronRight, MemoryStick,
  ChevronDown, Info, Globe, WifiOff, Lock, LockOpen, Play, Power, Timer,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Switch } from '../components/ui/Switch';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { AiExtensionsPanel } from './Settings';
import type { OllamaStatus, OllamaModel, OllamaModelShow, HFSearchResult, KiHardware, KiAccess, HFGgufFile, OllamaPsModel } from '../lib/types';

// ── capability inference from model name/family ──────────────────────────────
type Cap = 'text' | 'code' | 'vision' | 'audio' | 'reasoning' | 'math' | 'embeddings' | 'multilingual';

function inferCaps(name: string, family?: string): Cap[] {
  const n = name.toLowerCase();
  if (/embed/.test(n)) return ['embeddings'];
  const caps: Cap[] = ['text'];
  if (/code|coder|codestral|starcoder|wizard-?coder|devstral/.test(n)) caps.push('code');
  if (/vision|llava|moondream|bakllava|minicpm-?v|cogvlm|pixtral|idefics|qwen.*vl|phi.*vision|llama.*vision/.test(n)) caps.push('vision');
  if (/whisper|audio/.test(n)) caps.push('audio');
  if (/r1|o1|thinking|qwq|deepseek-r/.test(n)) caps.push('reasoning');
  if (/math|mathstral/.test(n)) caps.push('math');
  if (/qwen|gemma|mistral|llama/.test((family ?? n))) caps.push('multilingual');
  return caps;
}

function OllamaUrl({ href, https }: { href: string; https?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontFamily: 'var(--font-mono)',
        color: https ? 'var(--color-success)' : 'var(--color-accent)',
        textDecoration: 'none',
        background: https ? 'rgba(16,185,129,.08)' : 'rgba(99,102,241,.08)',
        border: `1px solid ${https ? 'rgba(16,185,129,.3)' : 'rgba(99,102,241,.25)'}`,
        borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap',
      }}
    >
      {href} <ExternalLink size={9} />
    </a>
  );
}

const CAP_LABEL: Record<Cap, string> = {
  text: 'Text', code: 'Code', vision: 'Bilder', audio: 'Audio',
  reasoning: 'Reasoning', math: 'Mathe', embeddings: 'Embeddings', multilingual: 'Mehrsprachig',
};
const CAP_COLOR: Record<Cap, string> = {
  text: 'var(--color-muted)', code: '#60a5fa', vision: '#a78bfa',
  audio: '#fb923c', reasoning: '#fbbf24', math: '#34d399',
  embeddings: '#2dd4bf', multilingual: '#c084fc',
};
const CAP_ICON: Record<Cap, React.ReactNode> = {
  text: <FileText size={10} />, code: <Code2 size={10} />, vision: <Eye size={10} />,
  audio: <Mic size={10} />, reasoning: <Zap size={10} />, math: <span style={{ fontSize: 9, fontWeight: 700 }}>∑</span>,
  embeddings: <span style={{ fontSize: 9, fontWeight: 700 }}>vec</span>,
  multilingual: <span style={{ fontSize: 9 }}>🌍</span>,
};

function CapBadge({ cap }: { cap: Cap }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px',
      background: `${CAP_COLOR[cap]}22`, border: `1px solid ${CAP_COLOR[cap]}44`,
      borderRadius: 4, fontSize: 10.5, color: CAP_COLOR[cap], fontWeight: 600,
    }}>
      {CAP_ICON[cap]} {CAP_LABEL[cap]}
    </span>
  );
}

// ── popular model catalogue ───────────────────────────────────────────────────
interface PopModel {
  name: string; label: string; size: string; desc: string; tag: string;
  caps: Cap[]; ramGb: number;
}

const POPULAR_MODELS: PopModel[] = [
  { name: 'llama3.2:1b',      label: 'Llama 3.2 1B',     size: '~0.9 GB', desc: 'Sehr klein, sehr schnell',          tag: 'Meta',       caps: ['text', 'multilingual'],          ramGb: 1 },
  { name: 'llama3.2:3b',      label: 'Llama 3.2 3B',     size: '~1.9 GB', desc: 'Kompakt, einfache Aufgaben',       tag: 'Meta',       caps: ['text', 'multilingual'],          ramGb: 2.5 },
  { name: 'gemma2:2b',        label: 'Gemma 2 2B',       size: '~1.6 GB', desc: 'Google – sehr effizient',          tag: 'Google',     caps: ['text', 'multilingual'],          ramGb: 2 },
  { name: 'phi3:mini',        label: 'Phi-3 Mini',       size: '~2.3 GB', desc: 'Microsoft – Qualität für die Größe', tag: 'Microsoft',  caps: ['text', 'code'],                  ramGb: 3 },
  { name: 'mistral:7b',       label: 'Mistral 7B',       size: '~4.1 GB', desc: 'Ausgeglichen, stark für Text',     tag: 'Mistral AI', caps: ['text', 'multilingual'],          ramGb: 5 },
  { name: 'gemma2:9b',        label: 'Gemma 2 9B',       size: '~5.4 GB', desc: 'Google – höhere Qualität',         tag: 'Google',     caps: ['text', 'multilingual'],          ramGb: 7 },
  { name: 'qwen2.5:7b',       label: 'Qwen 2.5 7B',      size: '~4.7 GB', desc: 'Alibaba – Multisprachig',          tag: 'Alibaba',    caps: ['text', 'code', 'multilingual'],  ramGb: 6 },
  { name: 'deepseek-r1:7b',   label: 'DeepSeek R1 7B',  size: '~4.7 GB', desc: 'Starkes Reasoning-Modell',         tag: 'DeepSeek',   caps: ['text', 'reasoning'],             ramGb: 6 },
  { name: 'codellama:7b',     label: 'Code Llama 7B',   size: '~3.8 GB', desc: 'Optimiert für Quellcode',          tag: 'Meta',       caps: ['text', 'code'],                  ramGb: 5 },
  { name: 'llava:7b',         label: 'LLaVA 7B',        size: '~4.7 GB', desc: 'Bild + Text – multimodal',         tag: 'LLaVA',      caps: ['text', 'vision'],                ramGb: 6 },
  { name: 'qwen2.5-coder:7b', label: 'Qwen Coder 7B',  size: '~4.7 GB', desc: 'Code-Spezialist (Alibaba)',         tag: 'Alibaba',    caps: ['text', 'code'],                  ramGb: 6 },
  { name: 'nomic-embed-text', label: 'Nomic Embed',     size: '~274 MB', desc: 'Text-Embeddings für RAG/Suche',    tag: 'Embedding',  caps: ['embeddings'],                    ramGb: 1 },
];

// ── helper formatters ─────────────────────────────────────────────────────────
function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}
function fmtNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}
function fmtCtx(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M Token';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K Token';
  return n + ' Token';
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Nur den letzten Pfadteil anzeigen (hf.co/user/Modell:Q8_0 → Modell:Q8_0)
function shortName(name: string): string {
  return name.split('/').pop() || name;
}

// Wo liegt ein geladenes Modell? (RAM / GPU-VRAM / geteilt)
function placement(r: OllamaPsModel): { label: string; color: string } {
  if (!r.size || r.size_vram <= 0) return { label: 'RAM (CPU)', color: 'var(--color-muted)' };
  if (r.size_vram >= r.size) return { label: 'GPU (VRAM)', color: 'var(--color-success)' };
  const pct = Math.round((r.size_vram / r.size) * 100);
  return { label: `${pct}% GPU / ${100 - pct}% RAM`, color: 'var(--color-warning)' };
}

// "läuft ab in …" – Ollama setzt für keep_alive=-1 einen weit entfernten Zeitpunkt
function fmtExpires(iso: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMs = t - Date.now();
  if (diffMs > 365 * 24 * 3600 * 1000) return 'dauerhaft';
  if (diffMs <= 0) return 'läuft ab…';
  const min = Math.round(diffMs / 60000);
  if (min < 60) return `in ${min} Min`;
  const h = Math.floor(min / 60); const m = min % 60;
  return `in ${h} Std${m ? ` ${m} Min` : ''}`;
}

// ── Modal: Modell in den Speicher laden (Kontextlänge + keep_alive) ───────────
const CTX_PRESETS = [
  { label: 'Standard', value: 0 },
  { label: '2K', value: 2048 },
  { label: '4K', value: 4096 },
  { label: '8K', value: 8192 },
  { label: '16K', value: 16384 },
  { label: '32K', value: 32768 },
  { label: '64K', value: 65536 },
  { label: '128K', value: 131072 },
];
const KEEP_PRESETS = [
  { label: '5 Min', value: 300 },
  { label: '30 Min', value: 1800 },
  { label: '1 Std', value: 3600 },
  { label: 'Dauerhaft', value: -1 },
];

function LoadModal({
  model, open, onClose, onLoad, busy,
}: {
  model: OllamaModel | null;
  open: boolean;
  onClose: () => void;
  onLoad: (numCtx: number | undefined, keepAlive: number) => void;
  busy: boolean;
}) {
  const [ctx, setCtx] = useState(0);
  const [keep, setKeep] = useState(1800);
  useEffect(() => { if (open) { setCtx(0); setKeep(1800); } }, [open, model]);
  if (!model) return null;
  return (
    <Modal open={open} title={`In Speicher laden: ${shortName(model.name)}`} onClose={onClose} width={520}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn--sm btn--outline" onClick={onClose} disabled={busy}>{tt('Abbrechen')}</button>
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => onLoad(ctx > 0 ? ctx : undefined, keep)}>
            {busy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Play size={12} />} In Speicher laden
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.07em' }}>
            Kontextlänge (num_ctx)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CTX_PRESETS.map((p) => (
              <button key={p.value} className={`btn btn--sm ${ctx === p.value ? 'btn--primary' : 'btn--outline'}`}
                style={{ fontSize: 11 }} disabled={busy} onClick={() => setCtx(p.value)}>{p.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>{tt('Eigener Wert:')}</span>
            <input className="input" type="number" min={0} step={512} style={{ width: 130, fontSize: 12 }}
              value={ctx || ''} placeholder={tt('z.B. 8192')} disabled={busy}
              onChange={(e) => setCtx(Math.max(0, parseInt(e.target.value) || 0))} />
            <span style={{ fontSize: 11, color: 'var(--color-faint)' }}>{tt('Token')}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-faint)', marginTop: 6, lineHeight: 1.6 }}>
            Größerer Kontext = mehr Speicherbedarf. „Standard" nutzt den im Modell hinterlegten Wert.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.07em' }}>
            Im Speicher halten (keep_alive)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {KEEP_PRESETS.map((p) => (
              <button key={p.value} className={`btn btn--sm ${keep === p.value ? 'btn--primary' : 'btn--outline'}`}
                style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={busy} onClick={() => setKeep(p.value)}>
                {p.value === -1 && <Timer size={11} />}{p.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-faint)', marginTop: 6, lineHeight: 1.6 }}>
            Mehrere Modelle können gleichzeitig geladen bleiben (Ollama: bis zu 3 Modelle parallel im Speicher).
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Hardware card ─────────────────────────────────────────────────────────────
function HWCard({ hw }: { hw: KiHardware }) {
  const [explainOpen, setExplainOpen] = useState(false);
  const hasGpu = hw.gpus.length > 0;
  const color = hw.maxModelGb >= 10 ? 'var(--color-success)' : hw.maxModelGb >= 4 ? 'var(--color-warning)' : 'var(--color-error)';
  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: `3px solid ${color}` }}>
      <div className="card-body" style={{ padding: '12px 18px', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MemoryStick size={18} color={color} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{tt('System-RAM')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>{hw.totalRamGb} GB</div>
          </div>
        </div>
        {hasGpu && hw.gpus.map((g) => (
          <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={18} color={color} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                {g.name}
                {g.unified && <span style={{ fontSize: 10, color: 'var(--color-accent)', fontWeight: 700, marginLeft: 5 }}>UMA</span>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                {g.unified ? 'Unified Memory (geteilt)' : `${(g.vramMb / 1024).toFixed(0)} GB VRAM`}
              </div>
            </div>
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 11.5, color, fontWeight: 600 }}>{tt('Empfehlung')}</div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 2 }}>{hw.recommendation}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-faint)', flexShrink: 0 }}>
          Empf. max. Modellgröße: <strong style={{ color }}>{hw.maxModelGb} GB</strong>
        </div>
        <button
          onClick={() => setExplainOpen((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-faint)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}
        >
          <Info size={11} /> Berechnung {explainOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      </div>
      {explainOpen && hw.explanation && (
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 18px', fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.7 }}>
          {hw.explanation}
        </div>
      )}
    </div>
  );
}

// ── Model detail modal ────────────────────────────────────────────────────────
function ModelDetailModal({
  model, open, onClose, onDelete, deleting,
}: {
  model: OllamaModel | null;
  open: boolean;
  onClose: () => void;
  onDelete: (name: string) => void;
  deleting: string | null;
}) {
  const [info, setInfo] = useState<OllamaModelShow | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  useEffect(() => {
    if (!open || !model) { setInfo(null); return; }
    setLoadingInfo(true);
    api.ki.show(model.name)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoadingInfo(false));
  }, [open, model]);

  if (!model) return null;

  const details = info?.details ?? model.details;
  const caps = inferCaps(model.name, details?.family);

  // Extract context length from model_info
  const arch = info?.model_info?.['general.architecture'] as string | undefined;
  const ctxKey = arch ? `${arch}.context_length` : null;
  const ctxLen = ctxKey && info?.model_info ? (info.model_info[ctxKey] as number | undefined) : undefined;
  const embLen = arch && info?.model_info ? (info.model_info[`${arch}.embedding_length`] as number | undefined) : undefined;

  return (
    <Modal open={open} title={shortName(model.name)} onClose={onClose} width={600}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn--sm"
            style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)', border: '1px solid' }}
            disabled={deleting === model.name}
            onClick={() => { onDelete(model.name); onClose(); }}
          >
            {deleting === model.name ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={12} />} Löschen
          </button>
        </div>
      }
    >
      {loadingInfo && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <span className="spinner" style={{ width: 20, height: 20 }} />
        </div>
      )}

      {/* Capabilities */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{tt('Fähigkeiten')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {caps.map((c) => <CapBadge key={c} cap={c} />)}
        </div>
      </div>

      {/* Specs grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginTop: 4 }}>
        {[
          { label: 'Dateigröße', value: fmtBytes(model.size) },
          { label: 'Parameter', value: details?.parameter_size ?? '—' },
          { label: 'Quantisierung', value: details?.quantization_level ?? '—' },
          { label: 'Format', value: details?.format ?? '—' },
          { label: 'Familie', value: details?.family ?? '—' },
          { label: 'Architektur', value: arch ?? '—' },
          { label: 'Kontextfenster', value: ctxLen ? fmtCtx(ctxLen) : '—' },
          { label: 'Embedding-Dim.', value: embLen ? embLen.toLocaleString() : '—' },
          { label: 'Zuletzt aktualisiert', value: model.modified_at ? fmtDate(model.modified_at) : '—' },
          { label: 'Digest', value: model.digest ? model.digest.slice(0, 16) + '…' : '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--color-faint)', marginBottom: 1 }}>{label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Raw parameters if any */}
      {info?.parameters && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{tt('Parameter')}</div>
          <pre style={{ background: 'var(--color-surface-sunken)', borderRadius: 6, padding: '8px 12px', fontSize: 11, overflow: 'auto', maxHeight: 120, color: 'var(--color-muted)', margin: 0 }}>{info.parameters}</pre>
        </div>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function Ai() {
  const t = useT();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [running, setRunning] = useState<OllamaPsModel[]>([]);
  const [hardware, setHardware] = useState<KiHardware | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);

  // Search + HF
  const [search, setSearch] = useState('');
  const [hfResults, setHfResults] = useState<HFSearchResult[]>([]);
  const [hfLoading, setHfLoading] = useState(false);
  const hfTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custom model input
  const [customModel, setCustomModel] = useState('');

  // Ollama access control
  const [access, setAccessState] = useState<KiAccess | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);

  // GGUF quantization modal
  const [ggufModal, setGgufModal] = useState<{ id: string; files: HFGgufFile[] } | null>(null);
  const [ggufLoading, setGgufLoading] = useState<string | null>(null);

  // Detail modal
  const [detailModel, setDetailModel] = useState<OllamaModel | null>(null);

  // In-memory loading state
  const [loadTarget, setLoadTarget] = useState<OllamaModel | null>(null);  // open load modal
  const [loadingMem, setLoadingMem] = useState<string | null>(null);       // model being loaded
  const [unloading, setUnloading] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try { const m = await api.ki.models(); setModels(m.models ?? []); } catch { /* */ }
  }, []);

  const loadPs = useCallback(async () => {
    try { const p = await api.ki.ps(); setRunning(p.models ?? []); } catch { /* */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, m, hw, ac, ps] = await Promise.allSettled([
        api.ki.status(), api.ki.models(), api.ki.hardware(), api.ki.access(), api.ki.ps(),
      ]);
      if (s.status === 'fulfilled') setStatus(s.value);
      if (m.status === 'fulfilled') setModels(m.value.models ?? []);
      if (hw.status === 'fulfilled') setHardware(hw.value);
      if (ac.status === 'fulfilled') setAccessState(ac.value);
      if (ps.status === 'fulfilled') setRunning(ps.value.models ?? []);
    } catch { /* */ }
  }, []);

  const refresh = async () => { setLoading(true); try { await load(); } finally { setLoading(false); } };

  useEffect(() => { void refresh(); }, []);

  // Poll while downloading
  useEffect(() => {
    if (pulling.size === 0) return;
    const t = setInterval(loadModels, 5000);
    return () => clearInterval(t);
  }, [pulling, loadModels]);

  // Poll loaded models (RAM/VRAM) so expiry counts down live
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(loadPs, 6000);
    return () => clearInterval(t);
  }, [status?.running, loadPs]);

  // Remove from pulling set when model appears
  useEffect(() => {
    if (pulling.size === 0) return;
    const names = new Set(models.map((m) => m.name));
    pulling.forEach((n) => { if (names.has(n)) setPulling((s) => { const ns = new Set(s); ns.delete(n); return ns; }); });
  }, [models, pulling]);

  // Debounced HF search
  useEffect(() => {
    if (hfTimer.current) clearTimeout(hfTimer.current);
    if (search.trim().length < 2) { setHfResults([]); return; }
    hfTimer.current = setTimeout(async () => {
      setHfLoading(true);
      try { const r = await api.ki.hfSearch(search.trim()); setHfResults(r.models); }
      catch { setHfResults([]); }
      finally { setHfLoading(false); }
    }, 400);
    return () => { if (hfTimer.current) clearTimeout(hfTimer.current); };
  }, [search]);

  const control = async (on: boolean) => {
    setBusy(true);
    try { await api.ki.control(on ? 'start' : 'stop'); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const pull = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    setPulling((s) => new Set([...s, n]));
    setCustomModel('');
    setSearch('');
    try { await api.ki.pull(n); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler beim Starten des Downloads'); setPulling((s) => { const ns = new Set(s); ns.delete(n); return ns; }); }
  };

  const remove = async (name: string) => {
    if (!confirm(`Modell "${name}" wirklich löschen?`)) return;
    setDeleting(name);
    try { await api.ki.remove(name); await loadModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setDeleting(null); }
  };

  const loadIntoMemory = async (model: string, numCtx: number | undefined, keepAlive: number) => {
    setLoadingMem(model);
    try {
      await api.ki.load(model, numCtx, keepAlive);
      setLoadTarget(null);
      await loadPs();
    } catch (err) { alert(err instanceof Error ? err.message : 'Laden fehlgeschlagen'); }
    finally { setLoadingMem(null); }
  };

  const unloadFromMemory = async (model: string) => {
    setUnloading(model);
    try { await api.ki.unload(model); await loadPs(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Entladen fehlgeschlagen'); }
    finally { setUnloading(null); }
  };

  const changeAccess = async (mode: 'local' | 'lan') => {
    setAccessBusy(true);
    try {
      await api.ki.setAccess(mode);
      const ac = await api.ki.access();
      setAccessState(ac);
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler beim Ändern des Netzwerkzugangs'); }
    finally { setAccessBusy(false); }
  };

  const toggleHttps = async () => {
    setAccessBusy(true);
    try {
      if (access && access.httpsUrls.length > 0) {
        await api.ki.disableHttps();
      } else {
        await api.ki.enableHttps();
      }
      const ac = await api.ki.access();
      setAccessState(ac);
    } catch (err) { alert(err instanceof Error ? err.message : 'HTTPS konnte nicht geändert werden'); }
    finally { setAccessBusy(false); }
  };

  const openGguf = async (id: string) => {
    setGgufLoading(id);
    try {
      const r = await api.ki.hfFiles(id);
      setGgufModal({ id, files: r.files });
    } catch { alert(tt('GGUF-Dateien konnten nicht geladen werden')); }
    finally { setGgufLoading(null); }
  };

  const installedNames = new Set(models.map((m) => m.name));
  const runningNames = new Set(running.map((r) => r.name));
  const totalSize = models.reduce((s, m) => s + (m.size ?? 0), 0);

  // Filter popular models by search text
  const filteredPopular = search.trim().length < 2
    ? POPULAR_MODELS
    : POPULAR_MODELS.filter((m) =>
        m.name.includes(search.toLowerCase()) || m.label.toLowerCase().includes(search.toLowerCase()) || m.desc.toLowerCase().includes(search.toLowerCase())
      );

  if (!status) {
    return (
      <>
        <Topbar title={t('nav.ai')} />
        <main className="page"><div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div></main>
      </>
    );
  }

  if (!status.installed) {
    return (
      <>
        <Topbar title={t('nav.ai')} />
        <main className="page">
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <BrainCircuit size={48} strokeWidth={1.2} color="var(--color-faint)" style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{tt('Ollama nicht installiert')}</div>
              <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginBottom: 24 }}>
                Ollama ermöglicht lokale KI-Modelle ohne Cloud-Abhängigkeit.<br />
                Installiere es mit einem einzigen Befehl:
              </div>
              <code style={{ display: 'inline-block', background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '10px 20px', borderRadius: 6, fontSize: 12.5 }}>
                sudo bash install.sh --ki
              </code>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={t('nav.ai')}
        subtitle={t('page.ai.subtitle', { n: models.length, size: fmtBytes(totalSize) })}
        onRefresh={refresh}
        refreshing={loading}
      />
      <main className="page">

        {/* Hardware-Empfehlung */}
        {hardware && <HWCard hw={hardware} />}

        {/* Ollama Status */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', padding: '12px 18px' }}>
            <BrainCircuit size={24} color={status.running ? 'var(--color-success)' : 'var(--color-faint)'} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>Ollama{status.version ? ` v${status.version}` : ''}</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>Port {status.port}</div>
            </div>
            <span className={`badge badge--${status.running ? 'running' : 'stopped'}`}>
              <span className="badge__dot" />{status.running ? 'läuft' : 'gestoppt'}
            </span>
            <Switch checked={status.running} disabled={busy} onChange={control} />
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <HardDrive size={13} color="var(--color-muted)" />
              <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{fmtBytes(totalSize)} belegt</span>
            </div>
          </div>
          {/* Netzwerkzugang */}
          <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Globe size={14} color="var(--color-faint)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)' }}>{tt('Netzwerkzugang')}</span>
            <button
              className={`btn btn--sm ${access?.mode === 'local' ? 'btn--primary' : 'btn--outline'}`}
              disabled={accessBusy || (access?.httpsUrls.length ?? 0) > 0}
              title={(access?.httpsUrls.length ?? 0) > 0 ? 'Modus wird von HTTPS verwaltet' : undefined}
              onClick={() => void changeAccess('local')}
            >
              <WifiOff size={11} /> Nur lokal
            </button>
            <button
              className={`btn btn--sm ${access?.mode === 'lan' ? 'btn--primary' : 'btn--outline'}`}
              disabled={accessBusy || (access?.httpsUrls.length ?? 0) > 0}
              title={(access?.httpsUrls.length ?? 0) > 0 ? 'Modus wird von HTTPS verwaltet' : undefined}
              onClick={() => void changeAccess('lan')}
            >
              <Globe size={11} /> LAN
            </button>
            {access?.caddyAvailable && (
              <button
                className={`btn btn--sm ${access.httpsUrls.length > 0 ? 'btn--outline' : 'btn--ghost'}`}
                style={access.httpsUrls.length > 0 ? { color: 'var(--color-success)', borderColor: 'var(--color-success)' } : { color: 'var(--color-faint)' }}
                disabled={accessBusy}
                onClick={() => void toggleHttps()}
                title={access.httpsUrls.length > 0 ? 'HTTPS für Ollama deaktivieren' : 'HTTPS für Ollama via Caddy aktivieren'}
              >
                {access.httpsUrls.length > 0 ? <Lock size={11} /> : <LockOpen size={11} />}
                {access.httpsUrls.length > 0 ? 'HTTPS' : 'HTTPS ein'}
              </button>
            )}
            {access && (
              <>
                <div style={{ width: 1, height: 14, background: 'var(--color-border)', flexShrink: 0 }} />
                {access.httpsUrls.length > 0 ? (
                  access.httpsUrls.map((url) => <OllamaUrl key={url} href={url} https />)
                ) : access.mode === 'local' ? (
                  <>
                    <OllamaUrl href={`http://127.0.0.1:${access.port}`} />
                    <OllamaUrl href={`http://localhost:${access.port}`} />
                  </>
                ) : (
                  <>
                    {access.lanIps.slice(0, 2).map((ip) => (
                      <OllamaUrl key={ip} href={`http://${ip}:${access.port}`} />
                    ))}
                    {access.hostname && <OllamaUrl href={`http://${access.hostname}:${access.port}`} />}
                  </>
                )}
              </>
            )}
            {accessBusy && <span className="spinner" style={{ width: 13, height: 13 }} />}
          </div>
        </div>

        <SortablePanels storageKey="ai" items={[
          { id: 'loaded', node: (
        <Panel
          title={tt('Aktiv im Speicher')}
          icon={<MemoryStick size={15} />}
          subtitle={`${running.length} Modell${running.length !== 1 ? 'e' : ''} im RAM/VRAM · mehrere gleichzeitig möglich`}
          storageKey="ki-running"
        >
          {running.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 20px' }}>
              <div className="empty-state__icon"><MemoryStick size={32} strokeWidth={1.2} /></div>
              <div className="empty-state__title">{tt('Kein Modell aktiv im Speicher')}</div>
              <div className="empty-state__desc">Lade unten ein installiertes Modell in den RAM oder die GPU (Play-Symbol).</div>
            </div>
          ) : (
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{tt('Modell')}</th>
                    <th>{tt('Speicherort')}</th>
                    <th>{tt('Größe')}</th>
                    <th>{tt('Kontext')}</th>
                    <th>{tt('Läuft ab')}</th>
                    <th style={{ width: 110 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {running.map((r) => {
                    const place = placement(r);
                    return (
                      <tr key={r.name}>
                        <td style={{ fontWeight: 600, fontSize: 12.5, fontFamily: 'var(--font-mono)' }} title={r.name}>{shortName(r.name)}</td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px',
                            background: `${place.color}1f`, border: `1px solid ${place.color}55`,
                            borderRadius: 4, fontSize: 10.5, color: place.color, fontWeight: 600,
                          }}>
                            <MemoryStick size={10} /> {place.label}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {fmtBytes(r.size)}
                          {r.size_vram > 0 && r.size_vram < r.size && (
                            <span style={{ color: 'var(--color-faint)' }}> · {fmtBytes(r.size_vram)} VRAM</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>{r.context_length ? fmtCtx(r.context_length) : '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--color-faint)', whiteSpace: 'nowrap' }}>{fmtExpires(r.expires_at)}</td>
                        <td>
                          <button
                            className="btn btn--sm btn--outline"
                            style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)', fontSize: 11 }}
                            disabled={unloading === r.name}
                            onClick={() => unloadFromMemory(r.name)}
                            title={tt('Modell aus dem Speicher entladen')}
                          >
                            {unloading === r.name ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <Power size={11} />} Entladen
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
          ) },
          { id: 'models', node: (
        <Panel title={tt('Installierte Modelle')} icon={<Cpu size={15} />} subtitle={`${models.length} Modelle · Klicken für Details`} storageKey="ki-models">
          {models.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 20px' }}>
              <div className="empty-state__icon"><BrainCircuit size={36} strokeWidth={1.2} /></div>
              <div className="empty-state__title">{tt('Noch keine Modelle geladen')}</div>
              <div className="empty-state__desc">{tt('Wähle unten ein Modell aus oder suche auf HuggingFace.')}</div>
            </div>
          ) : (
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{tt('Modell')}</th>
                    <th>{tt('Fähigkeiten')}</th>
                    <th>{tt('Größe')}</th>
                    <th>{tt('Parameter')}</th>
                    <th>{tt('Quantisierung')}</th>
                    <th>{tt('Familie')}</th>
                    <th>{tt('Aktualisiert')}</th>
                    <th style={{ width: 84 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const caps = inferCaps(m.name, m.details?.family);
                    return (
                      <tr key={m.name} style={{ cursor: 'pointer' }} onClick={() => setDetailModel(m)}>
                        <td style={{ fontWeight: 600, fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={m.name}>
                            {shortName(m.name)}
                            {runningNames.has(m.name) && (
                              <MemoryStick size={11} style={{ color: 'var(--color-success)' }} aria-label="Aktiv im Speicher" />
                            )}
                            <ChevronRight size={12} style={{ color: 'var(--color-faint)' }} />
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {caps.slice(0, 3).map((c) => <CapBadge key={c} cap={c} />)}
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>{fmtBytes(m.size)}</td>
                        <td style={{ fontSize: 12 }}>{m.details?.parameter_size ?? '—'}</td>
                        <td style={{ fontSize: 12 }}>{m.details?.quantization_level ?? '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-muted)' }}>{m.details?.family ?? '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--color-faint)', whiteSpace: 'nowrap' }}>
                          {m.modified_at ? fmtDate(m.modified_at) : '—'}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                            {runningNames.has(m.name) ? (
                              <button
                                className="btn btn--ghost btn--icon btn--sm"
                                style={{ color: 'var(--color-error)' }}
                                disabled={unloading === m.name}
                                onClick={() => unloadFromMemory(m.name)}
                                title={tt('Aus Speicher entladen')}
                              >
                                {unloading === m.name ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Power size={12} />}
                              </button>
                            ) : (
                              <button
                                className="btn btn--ghost btn--icon btn--sm"
                                style={{ color: 'var(--color-accent)' }}
                                disabled={loadingMem === m.name}
                                onClick={() => setLoadTarget(m)}
                                title={tt('In Speicher laden (RAM/GPU)')}
                              >
                                {loadingMem === m.name ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Play size={12} />}
                              </button>
                            )}
                            <button
                              className="btn btn--ghost btn--icon btn--sm"
                              style={{ color: 'var(--color-error)' }}
                              disabled={deleting === m.name}
                              onClick={() => remove(m.name)}
                              title={tt('Löschen')}
                            >
                              {deleting === m.name ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
          ) },
          { id: 'pull', node: (
        <Panel title={tt('Modell laden')} icon={<Download size={15} />} subtitle={tt('Beliebte Modelle · HuggingFace-Suche')} storageKey="ki-pull">

          {/* Download progress */}
          {pulling.size > 0 && (
            <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid var(--color-accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="spinner" style={{ width: 13, height: 13, flexShrink: 0 }} />
              Lade {[...pulling].join(', ')} … (läuft im Hintergrund)
            </div>
          )}

          {/* Search bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--color-faint)', pointerEvents: 'none' }} />
              <input
                className="input"
                style={{ paddingLeft: 30, width: '100%', fontSize: 12.5 }}
                placeholder={tt('Suchen (lokal + HuggingFace GGUF-Modelle)…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {hfLoading && <span className="spinner" style={{ width: 16, height: 16, alignSelf: 'center', flexShrink: 0 }} />}
          </div>

          {/* Popular models grid – always shown first */}
          {filteredPopular.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-faint)', marginBottom: 8 }}>
                Beliebte Modelle
                {search.trim().length >= 2 && <span style={{ fontWeight: 400, marginLeft: 6 }}>({filteredPopular.length} gefunden)</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10, marginBottom: 18 }}>
                {filteredPopular.map((pm) => {
                  const installed = installedNames.has(pm.name);
                  const isLoading = pulling.has(pm.name);
                  const fits = hardware ? pm.ramGb <= hardware.maxModelGb : true;
                  return (
                    <div key={pm.name} style={{
                      background: 'var(--color-surface)',
                      border: `1px solid ${installed ? 'var(--color-success)' : fits ? 'var(--color-border)' : 'var(--color-border)'}`,
                      borderRadius: 8, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 4,
                      opacity: fits ? 1 : 0.55,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{pm.label}</span>
                        <span style={{ fontSize: 9.5, color: 'var(--color-faint)', background: 'var(--color-border)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
                          <Tag size={8} style={{ verticalAlign: 'middle' }} /> {pm.tag}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', flex: 1 }}>{pm.desc}</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', margin: '2px 0' }}>
                        {pm.caps.slice(0, 3).map((c) => <CapBadge key={c} cap={c} />)}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: fits ? 'var(--color-faint)' : 'var(--color-error)' }}>
                          {pm.size} {!fits && '· zu groß'}
                        </span>
                      </div>
                      <button
                        className={`btn btn--sm ${installed ? 'btn--outline' : 'btn--primary'}`}
                        style={{ fontSize: 11, marginTop: 4 }}
                        disabled={isLoading}
                        onClick={() => pull(pm.name)}
                      >
                        {isLoading
                          ? <><span className="spinner" style={{ width: 10, height: 10 }} /> {tt('Lädt…')}</>
                          : installed
                            ? <><RefreshCw size={10} /> {tt('Neu laden')}</>
                            : <><Download size={10} /> {tt('Laden')}</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* HuggingFace results – shown BELOW popular models */}
          {search.trim().length >= 2 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ borderTop: '1px solid var(--color-border)', margin: '6px 0 14px' }} />
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-faint)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                <ExternalLink size={11} /> HuggingFace GGUF-Modelle
                {hfResults.length > 0 && <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>({hfResults.length})</span>}
              </div>
              {hfResults.length === 0 && !hfLoading && (
                <div style={{ fontSize: 12, color: 'var(--color-faint)', padding: '8px 0' }}>Keine HuggingFace-Ergebnisse für „{search}"</div>
              )}
              {hfResults.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {hfResults.map((m) => (
                    <div key={m.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.id}>{m.id}</div>
                      <div style={{ display: 'flex', gap: 10, fontSize: 10.5, color: 'var(--color-faint)' }}>
                        <span>↓ {fmtNum(m.downloads)}</span>
                        <span>♥ {fmtNum(m.likes)}</span>
                        <span>{fmtDate(m.lastModified)}</span>
                      </div>
                      <button
                        className="btn btn--primary btn--sm"
                        style={{ fontSize: 11, marginTop: 4 }}
                        disabled={ggufLoading === m.id}
                        onClick={() => void openGguf(m.id)}
                      >
                        {ggufLoading === m.id
                          ? <><span className="spinner" style={{ width: 10, height: 10 }} /> {tt('Lädt…')}</>
                          : <><Download size={10} /> {tt('Quantisierung wählen')}</>}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Custom model name input */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8 }}>Beliebiger Modellname (ollama.com/library oder hf.co/…)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 12.5 }}
                placeholder={tt('z.B. llama3.1:70b · hf.co/bartowski/Llama-3-8B-GGUF')}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void pull(customModel)}
              />
              <button className="btn btn--primary" disabled={!customModel.trim()} onClick={() => void pull(customModel)}>
                <Download size={13} /> {tt('Laden')}
              </button>
            </div>
          </div>
        </Panel>
          ) },
          { id: 'aiext', node: <AiExtensionsPanel /> },
        ]} />
      </main>

      {/* Model detail modal */}
      <ModelDetailModal
        model={detailModel}
        open={!!detailModel}
        onClose={() => setDetailModel(null)}
        onDelete={remove}
        deleting={deleting}
      />

      {/* Load-into-memory modal */}
      <LoadModal
        model={loadTarget}
        open={!!loadTarget}
        onClose={() => setLoadTarget(null)}
        busy={!!loadTarget && loadingMem === loadTarget.name}
        onLoad={(numCtx, keepAlive) => { if (loadTarget) void loadIntoMemory(loadTarget.name, numCtx, keepAlive); }}
      />

      {/* GGUF quantization selection modal */}
      <Modal
        open={!!ggufModal}
        title={`Quantisierung wählen: ${ggufModal?.id ?? ''}`}
        onClose={() => setGgufModal(null)}
        width={560}
      >
        {ggufModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>
              Q4_K_M bietet den besten Kompromiss aus Qualität und Dateigröße. Größere Quantisierungen (Q8) sind qualitativ besser, brauchen aber mehr RAM.
            </div>
            {ggufModal.files.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-faint)', padding: 12 }}>{tt('Keine GGUF-Dateien gefunden.')}</div>
            ) : (
              ggufModal.files.map((f) => {
                const tag = `hf.co/${ggufModal.id}:${f.ollamaTag}`;
                const isLoading = pulling.has(tag);
                const isRecommended = f.quant === 'Q4_K_M';
                return (
                  <div key={f.filename} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    background: 'var(--color-surface)', borderRadius: 6,
                    border: `1px solid ${isRecommended ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {f.quant}
                        {isRecommended && <span style={{ fontSize: 10, color: 'var(--color-accent)', fontWeight: 600 }}>{tt('Empfohlen')}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</div>
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--color-muted)', flexShrink: 0 }}>
                      {f.size > 0 ? fmtBytes(f.size) : '?'}
                    </span>
                    <button
                      className="btn btn--primary btn--sm"
                      style={{ fontSize: 11, flexShrink: 0 }}
                      disabled={isLoading}
                      onClick={() => { void pull(tag); setGgufModal(null); }}
                    >
                      {isLoading
                        ? <><span className="spinner" style={{ width: 10, height: 10 }} /> {tt('Lädt…')}</>
                        : <><Download size={10} /> {tt('Laden')}</>}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
