import { useParams } from 'react-router-dom';
import { Topbar } from '../components/layout/Topbar';
import { tt } from '../lib/i18n';
import { useInstalledPlugins } from '../lib/plugins';

// Generischer Host für Typ-B-Apps: bettet die Plugin-UI per iframe unter
// /app/<id>/ ein. Das gemeinsame Design-Kit (tokens.css) wird vom Plugin
// eingebunden, damit es sich nahtlos einfügt; das Theme wird als Query
// (?theme=) durchgereicht.
export function PluginApp() {
  const { id } = useParams<{ id: string }>();
  const { plugins, loading } = useInstalledPlugins();
  const plugin = plugins.find((p) => p.id === id);
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><span className="spinner" /></div>;
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
