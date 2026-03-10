import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Full-page login form styled to match the app's dark/light theme.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Login failed. Check your credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h2 style={styles.title}>Log File Analyzer</h2>
        <p style={styles.subtitle}>Sign in to continue</p>

        {error && <div style={styles.error}>{error}</div>}

        <label style={styles.label}>
          Username
          <input
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={styles.input}
            disabled={loading}
          />
        </label>

        <label style={styles.label}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            disabled={loading}
          />
        </label>

        <button type="submit" style={styles.button} disabled={loading || !username.trim() || !password}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    fontFamily: "'Segoe UI', Arial, sans-serif",
  },
  card: {
    background: 'var(--bg-alt)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '40px 36px 32px',
    minWidth: 340,
    maxWidth: 400,
    width: '100%',
    boxShadow: 'var(--shadow)',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: 'var(--text)',
    textAlign: 'center',
  },
  subtitle: {
    margin: 0,
    fontSize: '0.85rem',
    color: 'var(--text-soft)',
    textAlign: 'center',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '0.85rem',
    color: 'var(--text-soft)',
  },
  input: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  button: {
    marginTop: 8,
    padding: '12px 0',
    borderRadius: 8,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  error: {
    background: 'rgba(229, 83, 83, 0.12)',
    color: 'var(--danger)',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: '0.85rem',
    textAlign: 'center',
  },
};
