import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { tt } from '../lib/i18n';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'dark'
  );

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(username, password, totpRequired ? otp : undefined);
      if (res.totpRequired) {
        setTotpRequired(true);
        setError('');
      } else {
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <button
        className="icon-btn"
        onClick={toggleTheme}
        style={{ position: 'fixed', top: 16, right: 16 }}
        title={tt('Theme wechseln')}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <div className="login-card">
        <div className="login-logo">⬡</div>
        <h1 className="login-title">{tt('Vault-Hub')}</h1>
        <p className="login-subtitle">{tt('Linux Server Management')}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="username">{tt('Benutzername')}</label>
            <input
              id="username"
              className="input"
              type="text"
              placeholder={tt('admin')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">{tt('Passwort')}</label>
            <input
              id="password"
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={totpRequired}
            />
          </div>

          {totpRequired && (
            <div className="form-group">
              <label className="form-label" htmlFor="otp">2FA-Code (Authenticator-App)</label>
              <input
                id="otp"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                style={{ letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--font-mono)' }}
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary btn--md"
            style={{ width: '100%', marginTop: 4, justifyContent: 'center' }}
            disabled={loading}
          >
            {loading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : null}
            {loading ? 'Anmelden…' : totpRequired ? 'Code bestätigen' : 'Anmelden'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--color-faint)' }}>
          Standard: admin / admin — bitte nach erstem Login ändern
        </p>
      </div>
    </div>
  );
}
