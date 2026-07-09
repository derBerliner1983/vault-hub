import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Store, Settings, Moon, Sun, ChevronLeft, ChevronRight,
  LogOut, Puzzle, Shield, TerminalSquare, Bug, Network, HardDrive, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { tt } from '../../lib/i18n';
import { useInstalledPlugins } from '../../lib/plugins';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// lucide-Icon-Namen, die Plugins in ihrem Manifest referenzieren dürfen.
const ICONS: Record<string, LucideIcon> = {
  shield: Shield, terminal: TerminalSquare, bug: Bug, network: Network,
  harddrive: HardDrive, store: Store, puzzle: Puzzle,
};

export function Sidebar({ collapsed, onToggle, theme, onThemeToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { plugins } = useInstalledPlugins();

  useEffect(() => {
    fetch('/api/settings/version', { credentials: 'include' })
      .then((r) => r.json())
      .then((v) => { setVersion(v.current || ''); setUpdateAvailable(!!v.updateAvailable); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const handleNavClick = () => { if (onMobileClose) onMobileClose(); };

  // Dynamische Plugin-Navigation nach Abschnitt gruppieren (Typ B — echte Apps).
  const navPlugins = plugins.filter((p) => p.contributes?.nav);
  const sections = new Map<string, typeof navPlugins>();
  for (const p of navPlugins) {
    const sec = p.contributes!.nav!.section || 'APPS';
    if (!sections.has(sec)) sections.set(sec, []);
    sections.get(sec)!.push(p);
  }

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
        <div className="sidebar__section">
          <div className="sidebar__section-label">{tt('Übersicht')}</div>
          <NavLink to="/dashboard" className={itemClass} title={collapsed ? tt('Start') : undefined} onClick={handleNavClick}>
            <LayoutDashboard className="sidebar__item-icon" />
            <span className="sidebar__item-label">{tt('Start')}</span>
          </NavLink>
        </div>

        {/* Dynamische Plugin-Apps (Typ B) — vom Kern aus den Manifesten gerendert */}
        {[...sections.entries()].map(([section, items]) => (
          <div className="sidebar__section" key={section}>
            <div className="sidebar__section-label">{section}</div>
            {items.map((p) => {
              const nav = p.contributes!.nav!;
              const Icon = (nav.icon && ICONS[nav.icon.toLowerCase()]) || Puzzle;
              return (
                <NavLink key={p.id} to={nav.route} className={itemClass} title={collapsed ? nav.label : undefined} onClick={handleNavClick}>
                  <Icon className="sidebar__item-icon" />
                  <span className="sidebar__item-label">{nav.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}

        <div className="sidebar__section">
          <div className="sidebar__section-label">{tt('System')}</div>
          <NavLink to="/store" className={itemClass} title={collapsed ? tt('Store') : undefined} onClick={handleNavClick}>
            <Store className="sidebar__item-icon" />
            <span className="sidebar__item-label">{tt('Store')}</span>
          </NavLink>
          <NavLink to="/settings" className={itemClass} title={collapsed ? tt('Einstellungen') : undefined} onClick={handleNavClick}>
            <Settings className="sidebar__item-icon" />
            <span className="sidebar__item-label">{tt('Einstellungen')}</span>
          </NavLink>
        </div>
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
