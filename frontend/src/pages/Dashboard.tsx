import { useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { useInstalledPlugins } from '../lib/plugins';

export function Dashboard() {
  const navigate = useNavigate();
  const { plugins } = useInstalledPlugins();

  // Plugins, die ein Dashboard-Widget beisteuern (Contribution Point).
  const widgets = plugins.filter((p) => p.contributes?.dashboardWidget);

  return (
    <>
      <Topbar title={tt('Start')} subtitle={tt('Vault-Hub')} />
      <div className="page">
        {widgets.length === 0 ? (
          <div className="card empty-state" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
              <LayoutGrid size={26} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{tt('Noch keine Apps installiert')}</div>
            <div style={{ color: 'var(--color-subtle)', maxWidth: 420 }}>
              {tt('Vault-Hub startet leer. Öffne den Store, um Funktionen als Plugins hinzuzufügen — z. B. SSH, Reverse-Proxy oder Virenschutz.')}
            </div>
            <button className="btn btn--primary" style={{ marginTop: 8 }} onClick={() => navigate('/store')}>
              {tt('Zum Store')}
            </button>
          </div>
        ) : (
          <div className="stats-grid">
            {widgets.map((p) => (
              <div className="card" key={p.id} style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>
                  {p.contributes!.dashboardWidget!.label}
                </div>
                {p.contributes!.dashboardWidget!.ui?.startsWith('iframe:') && (
                  <iframe
                    title={p.name}
                    src={p.contributes!.dashboardWidget!.ui!.slice('iframe:'.length)}
                    style={{ width: '100%', height: 220, border: 0 }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
