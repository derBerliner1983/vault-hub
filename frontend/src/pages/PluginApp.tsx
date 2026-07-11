import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { useInstalledPlugins } from '../lib/plugins';
import { pluginPages } from '../plugin-pages';

// Host für Plugin-Seiten. Bevorzugt eine NATIVE React-Seite (aus Core-Hub
// portiert, pixelgleich) wenn für die Plugin-ID registriert; sonst bettet es die
// Plugin-UI per iframe unter /app/<id>/ ein (?theme= durchgereicht).
export function PluginApp() {
  const { id } = useParams<{ id: string }>();
  const { plugins, loading } = useInstalledPlugins();
  const plugin = plugins.find((p) => p.id === id);
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><span className="spinner" /></div>;
  }

  // Native Seite bevorzugen (nur wenn das Plugin installiert ist → Store schaltet frei).
  const Native = id ? pluginPages[id] : undefined;
  if (plugin && Native) {
    return (
      <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><span className="spinner" /></div>}>
        <Native />
      </Suspense>
    );
  }

  if (!plugin) {
    return (
      <>
        <Topbar title={tt('App')} />
        <div className="page">
          <div className="card empty-state" style={{ textAlign: 'center', padding: 40 }}>
            {tt('Plugin nicht gefunden oder nicht installiert.')}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title={plugin.name} subtitle={`v${plugin.version}`} />
      <div className="page" style={{ padding: 0, height: 'calc(100% - var(--topbar-height))' }}>
        <iframe
          title={plugin.name}
          src={`/app/${plugin.id}/?theme=${theme}`}
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      </div>
    </>
  );
}
