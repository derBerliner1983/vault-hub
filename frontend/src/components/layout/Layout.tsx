import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { LayoutContext } from '../../lib/layoutContext';

type Theme = 'light' | 'dark';

function getStoredTheme(): Theme {
  const stored = localStorage.getItem('theme') as Theme | null;
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function isMobile() {
  return window.innerWidth < 768;
}

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  // Close mobile sidebar on route changes / resize to desktop
  useEffect(() => {
    const onResize = () => { if (!isMobile()) setMobileOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const toggleSidebar = () => {
    if (isMobile()) {
      setMobileOpen((o) => !o);
    } else {
      setCollapsed((c) => {
        localStorage.setItem('sidebar', c ? '0' : '1');
        return !c;
      });
    }
  };
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobileMenu = useCallback(() => setMobileOpen(true), []);
  const ctx = useMemo(() => ({ openMobileMenu }), [openMobileMenu]);

  return (
    <LayoutContext.Provider value={ctx}>
      <div className="app-shell">
        {mobileOpen && <div className="sidebar-backdrop" onClick={closeMobile} />}
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          theme={theme}
          onThemeToggle={toggleTheme}
          mobileOpen={mobileOpen}
          onMobileClose={closeMobile}
        />
        <div className="main-area">{children}</div>
      </div>
    </LayoutContext.Provider>
  );
}
