import { useEffect, useState, useCallback } from 'react';
import { Store as StoreIcon, Download, Trash2, RefreshCw, Plus, AlertCircle } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import {
  fetchStore, fetchInstalledPlugins, installPlugin, uninstallPlugin,
  type StoreItem, type PluginManifest,
} from '../lib/plugins';

export function Store() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [installed, setInstalled] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [customSource, setCustomSource] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [store, inst] = await Promise.all([fetchStore(), fetchInstalledPlugins()]);
    setItems(store.items);
    setError(store.error || '');
    setInstalled(inst);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const installedIds = new Set(installed.map((p) => p.id));

  const doInstall = async (id: string, source?: string) => {
    setBusy(id); setError('');
    try { await installPlugin(id, source); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(null); }
  };

  const doUninstall = async (id: string) => {
    setBusy(id); setError('');
    try { await uninstallPlugin(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(null); }
  };

  const addCustom = async () => {
    const src = customSource.trim();
    if (!src) return;
    // id aus der Quelle ableiten (letzter Pfadteil), Backend prüft/überschreibt.
    const id = src.replace(/\.git$/, '').split('/').filter(Boolean).pop() || 'custom';
    await doInstall(id, src);
    setCustomSource('');
  };

  return (
    <>
      <Topbar title={tt('Store')} subtitle={tt('Plugins installieren, aktualisieren, entfernen')}
        onRefresh={load} refreshing={loading} />
      <div className="page">
        {error && (
          <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--color-warning)', marginBottom: 12 }}>
            <AlertCircle size={16} /> <span>{error}</span>
          </div>
        )}

        {/* Eigenes Plugin hinzufügen (Git-URL / Store-Quelle) */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{tt('Eigenes Plugin hinzufügen')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input" style={{ flex: 1 }}
              placeholder="github:user/repo  oder  https://github.com/user/repo.git"
              value={customSource}
              onChange={(e) => setCustomSource(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addCustom(); }}
            />
            <button className="btn btn--primary" onClick={addCustom} disabled={!customSource.trim() || busy !== null}>
              <Plus size={15} /> {tt('Hinzufügen')}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}><span className="spinner" /></div>
        ) : items.length === 0 ? (
          <div className="card empty-state" style={{ textAlign: 'center', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
              <StoreIcon size={24} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{tt('Store ist leer')}</div>
            <div style={{ color: 'var(--color-subtle)', maxWidth: 440 }}>
              {tt('Es sind noch keine Apps im Store-Katalog. Füge oben ein eigenes Plugin per Git-URL hinzu.')}
            </div>
          </div>
        ) : (
          <div className="stats-grid">
            {items.map((item) => {
              const isInstalled = installedIds.has(item.id) || item.installed;
              const working = busy === item.id;
              return (
                <div className="card" key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
                      <StoreIcon size={18} />
                    </div>
                    <div style={{ lineHeight: 1.2 }}>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-faint)' }}>v{item.version}{item.type ? ` · ${item.type === 'extension' ? tt('System-Erweiterung') : tt('App')}` : ''}</div>
                    </div>
                  </div>
                  {item.description && <div style={{ fontSize: 13, color: 'var(--color-subtle)' }}>{item.description}</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    {isInstalled ? (
                      <>
                        {item.updateAvailable && (
                          <button className="btn btn--primary btn--sm" onClick={() => doInstall(item.id, item.source)} disabled={working}>
                            <RefreshCw size={14} /> {tt('Aktualisieren')}
                          </button>
                        )}
                        <button className="btn btn--danger btn--sm" onClick={() => doUninstall(item.id)} disabled={working}>
                          <Trash2 size={14} /> {tt('Deinstallieren')}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn--primary btn--sm" onClick={() => doInstall(item.id, item.source)} disabled={working}>
                        <Download size={14} /> {working ? tt('Installiere…') : tt('Installieren')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
