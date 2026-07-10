import { useState, type ReactNode } from 'react';
import { ChevronUp } from 'lucide-react';

interface PanelProps {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultCollapsed?: boolean;
  storageKey?: string;
}

export function Panel({
  title, icon, subtitle, actions, children, defaultCollapsed = false, storageKey,
}: PanelProps) {
  const initial = storageKey
    ? localStorage.getItem(`panel:${storageKey}`) === '1'
    : defaultCollapsed;
  const [collapsed, setCollapsed] = useState(initial);

  const toggle = () => {
    setCollapsed((c) => {
      if (storageKey) localStorage.setItem(`panel:${storageKey}`, c ? '0' : '1');
      return !c;
    });
  };

  return (
    <div className="panel">
      <div className="panel__header" onClick={toggle}>
        {icon && <span className="panel__icon">{icon}</span>}
        <div className="panel__titlewrap">
          <span className="panel__title">{title}</span>
          {subtitle && <span className="panel__subtitle">{subtitle}</span>}
        </div>
        <div className="panel__actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
        <button className="panel__toggle" onClick={(e) => { e.stopPropagation(); toggle(); }}>
          <ChevronUp size={15} style={{ transform: collapsed ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
        </button>
      </div>
      {!collapsed && <div className="panel__body">{children}</div>}
    </div>
  );
}
