import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { PrefsProvider } from './lib/prefs';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Store } from './pages/Store';
import { Settings } from './pages/Settings';
import { PluginApp } from './pages/PluginApp';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/store" element={<Protected><Store /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      {/* Dynamische Plugin-Apps (Typ B) — vom Kern gehostet */}
      <Route path="/app/:id" element={<Protected><PluginApp /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <PrefsProvider>
            <AppRoutes />
          </PrefsProvider>
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  );
}
