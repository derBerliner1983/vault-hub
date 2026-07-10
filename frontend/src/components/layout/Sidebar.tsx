import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Store, Settings, Moon, Sun, ChevronLeft, ChevronRight,
  LogOut, Puzzle, Shield, TerminalSquare, Bug, Network, HardDrive, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { tt } from '../../lib/i18n';
import { usePrefs } from '../../lib/prefs';
import { useInstalledPlugins } from '../../lib/plugins';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const ICONS: Record<string, LucideIcon> = {
  shield: Shield, terminal: TerminalSquare, bug: Bug, network: Network,
  harddrive: HardDrive, store: Store, puzzle: Puzzle,
};

interface NavItem { route: string; label: string; icon?: string; lucide?: LucideIcon }

// Feste Abschnitts-Reihenfolge wie in Core-Hub; unbekannte Plugin-Abschnitte
// werden hinten angehängt.
const SECTION_ORDER = ['ÜBERSICHT', 'WORKLOADS', 'SYSTEM', 'KI', 'APPS'];

function NavIcon({ item }: { item: NavItem }) {
  if (item.lucide) { const L = item.lucide; return <L className="sidebar__item-icon" />; }
  if (item.icon && item.icon.trim().startsWith('<svg')) {
    return <span className="sidebar__item-icon" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: item.icon }} />;
  }
  const L = (item.icon && ICONS[item.icon.toLowerCase()]) || Puzzle;
  return <L className="sidebar__item-icon" />;
}

export function Sidebar({ collapsed, onToggle, theme, onThemeToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { plugins } = useInstalledPlugins();
  const { prefs, setPref } = usePrefs();
  const order = (prefs.sidebarOrder as Record<string, string[]>) || {};
  const [drag, setDrag] = useState<{ section: string; route: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/version', { credentials: 'include' })
      .then((r) => r.json())
      .then((v) => { setVersion(v.current || ''); setUpdateAvailable(!!v.updateAvailable); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const handleNavClick = () => { if (onMobileClose) onMobileClose(); };

  // ── Einheitliches Nav-Modell aufbauen (Kern + Plugins in eine Nav) ──
  const sections = new Map<string, NavItem[]>();
  const add = (section: string, item: NavItem) => {
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(item);
  };
  add('ÜBERSICHT', { route: '/dashboard', label: tt('Start'), lucide: LayoutDashboard });
  for (const p of plugins) {
    const nav = p.contributes?.nav;
    if (nav) add((nav.section || 'APPS').toUpperCase(), { route: nav.route, label: tt(nav.label), icon: nav.icon });
  }
  add('SYSTEM', { route: '/store', label: tt('Store'), lucide: Store });
  add('SYSTEM', { route: '/settings', label: tt('Einstellungen'), lucide: Settings });

  const sectionKeys = [...sections.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  const ordered = (items: NavItem[], saved?: string[]): NavItem[] => {
    if (!saved || !saved.length) return items;
    const rank = new Map(saved.map((r, i) => [r, i]));
    return [...items].sort((a, b) => (rank.has(a.route) ? rank.get(a.route)! : 999) - (rank.has(b.route) ? rank.get(b.route)! : 999));
  };

  const onDrop = (section: string, items: NavItem[], targetRoute: string) => {
    if (!drag || drag.section !== section || drag.route === targetRoute) { setDrag(null); setDragOver(null); return; }
    const cur = ordered(items, order[section]).map((i) => i.route);
    const from = cur.indexOf(drag.route), to = cur.indexOf(targetRoute);
    if (from < 0 || to < 0) { setDrag(null); setDragOver(null); return; }
    cur.splice(to, 0, cur.splice(from, 1)[0]);
    setPref('sidebarOrder', { ...order, [section]: cur });
    setDrag(null); setDragOver(null);
  };

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar__item${isActive ? ' sidebar__item--active' : ''}`;

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__logo">⬡</div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span className="sidebar__title">{tt('Vault-Hub')}</span>
            {version && (
              <NavLink to="/settings" style={{ fontSize: 10.5, color: updateAvailable ? 'var(--color-warning)' : 'var(--color-faint)', textDecoration: 'none' }}>
                v{version}{updateAvailable ? ' · Update ▲' : ''}
              </NavLink>
            )}
          </div>
        )}
        <button className="sidebar__collapse" onClick={onToggle} title={collapsed ? tt('Aufklappen') : tt('Einklappen')}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="sidebar__nav">
        {sectionKeys.map((section) => {
          const items = ordered(sections.get(section)!, order[section]);
          return (
            <div className="sidebar__section" key={section}>
              <div className="sidebar__section-label">{section}</div>
              {items.map((item) => {
                const isDragging = drag?.route === item.route;
                const isOver = dragOver === item.route && drag?.section === section && drag?.route !== item.route;
                return (
                  <NavLink
                    key={item.route}
                    to={item.route}
                    draggable
                    onDragStart={(e) => { setDrag({ section, route: item.route }); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDrag(null); setDragOver(null); }}
                    onDragOver={(e) => { if (drag?.section === section) { e.preventDefault(); setDragOver(item.route); } }}
                    onDrop={(e) => { e.preventDefault(); onDrop(section, items, item.route); }}
                    className={itemClass}
                    style={{ opacity: isDragging ? 0.4 : 1, ...(isOver ? { boxShadow: 'inset 0 2px 0 var(--color-accent)' } : {}) }}
                    title={collapsed ? item.label : undefined}
                    onClick={handleNavClick}
                  >
                    <NavIcon item={item} />
                    <span className="sidebar__item-label">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__avatar">{user?.username.charAt(0).toUpperCase()}</div>
        {!collapsed && <span className="sidebar__username">{user?.username}</span>}
        <button className="icon-btn" onClick={onThemeToggle} title={tt('Theme wechseln')}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className="icon-btn" onClick={handleLogout} title={tt('Abmelden')}>
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
