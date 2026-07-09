import { tt } from '../lib/i18n';
import { Topbar } from '../components/layout/Topbar';

export function Placeholder({ title, icon = '🚧' }: { title: string; icon?: string }) {
  return (
    <>
      <Topbar title={title} />
      <main className="page">
        <div className="empty-state">
          <div className="empty-state__icon">{icon}</div>
          <div className="empty-state__title">{title}</div>
          <div className="empty-state__desc">{tt('Dieses Modul ist in der nächsten Phase geplant.')}</div>
        </div>
      </main>
    </>
  );
}
