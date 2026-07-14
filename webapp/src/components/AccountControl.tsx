import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CircleUserRound, LogOut, FolderOpen, Trash2, RefreshCw } from 'lucide-react';
import {
  SUITE_AUTH_URL,
  SuiteSession,
  isSuiteAuthConfigured,
  restoreSession,
  signIn,
  signOut,
} from '../utils/suiteAuth';
import { SavedPlanApi, deleteSavedPlan, listSavedPlans } from '../utils/savedPlansApi';
import { logger } from '../utils/logger';
import './AccountControl.css';

interface AccountControlProps {
  /** Lifts the session to App so the analysis panel can offer "Save plan". */
  onSessionChange: (session: SuiteSession | null) => void;
  /** Load a saved plan (encoded payload) into the map. */
  onLoadPlan: (plan: SavedPlanApi) => void;
  /** Bump to refresh the plan list after an external save. */
  plansVersion?: number;
  /** Bump to open the sign-in panel from elsewhere (e.g. an anonymous gate). */
  openSignal?: number;
}

/**
 * Header account control for the Bushie Tools suite sign-in.
 *
 * Signed-out: a "Sign in" button opening a Station Manager credentials form.
 * Signed-in: the username opens a panel with the user's saved plans
 * (load/delete) and sign-out. Hidden entirely when VITE_SUITE_AUTH_URL is not
 * configured — the calculator stays a fully anonymous public tool.
 */
export const AccountControl: React.FC<AccountControlProps> = ({
  onSessionChange,
  onLoadPlan,
  plansVersion = 0,
  openSignal = 0,
}) => {
  const [session, setSession] = useState<SuiteSession | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<SavedPlanApi[] | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const updateSession = useCallback(
    (next: SuiteSession | null) => {
      setSession(next);
      onSessionChange(next);
    },
    [onSessionChange]
  );

  // Restore a previous sign-in once on mount.
  useEffect(() => {
    if (!isSuiteAuthConfigured()) return;
    let cancelled = false;
    restoreSession()
      .then(restored => {
        if (!cancelled && restored) updateSession(restored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [updateSession]);

  // Open the panel when an external gate asks for sign-in (openSignal bumps).
  useEffect(() => {
    if (openSignal > 0 && !session) setIsOpen(true);
  }, [openSignal, session]);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const refreshPlans = useCallback(async () => {
    if (!session || !session.fireBreakEnabled) return;
    setPlansError(null);
    try {
      setPlans(await listSavedPlans(session.token));
    } catch (err) {
      logger.warn('Failed to list saved plans', err);
      setPlans(null);
      setPlansError(err instanceof Error ? err.message : 'Could not load saved plans');
    }
  }, [session]);

  // Refresh the list when the panel opens or after an external save.
  useEffect(() => {
    if (isOpen && session?.fireBreakEnabled) void refreshPlans();
  }, [isOpen, session, plansVersion, refreshPlans]);

  if (!isSuiteAuthConfigured()) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await signIn(username.trim(), password);
      updateSession(next);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    signOut();
    updateSession(null);
    setPlans(null);
    setIsOpen(false);
  };

  const handleDelete = async (plan: SavedPlanApi) => {
    if (!session) return;
    if (!window.confirm(`Delete saved plan "${plan.name}"?`)) return;
    try {
      await deleteSavedPlan(session.token, plan.id);
      setPlans(prev => (prev ? prev.filter(p => p.id !== plan.id) : prev));
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="account-control" ref={rootRef}>
      <button
        type="button"
        className="account-toggle"
        onClick={() => setIsOpen(v => !v)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={session ? `Signed in as ${session.username}` : 'Sign in with your Station Manager account'}
      >
        <CircleUserRound size={20} strokeWidth={2} aria-hidden />
        <span className="account-label">{session ? session.username : 'Sign in'}</span>
      </button>

      {isOpen && (
        <div className="account-panel" role="dialog" aria-label="Account">
          {!session ? (
            <form className="account-signin" onSubmit={handleSignIn}>
              <h4>Sign in</h4>
              <p className="account-hint">
                Use your Station Manager (Bushie Tools) account to save and restore plans across
                devices.
              </p>
              <label>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {error && <div className="account-error" role="alert">{error}</div>}
              <button type="submit" className="account-primary" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <p className="account-hint">
                No account?{' '}
                <a href={`${SUITE_AUTH_URL}/signup`} target="_blank" rel="noopener noreferrer">
                  Create one in Station Manager
                </a>
              </p>
            </form>
          ) : (
            <div className="account-signed-in">
              <div className="account-identity">
                <strong>{session.username}</strong>
                {session.organizationName && <span>{session.organizationName}</span>}
                {session.planCode && <span className="account-plan-badge">{session.planCode}</span>}
              </div>

              {session.fireBreakEnabled ? (
                <div className="account-plans">
                  <div className="account-plans-header">
                    <h4>Saved plans</h4>
                    <button
                      type="button"
                      className="account-icon-btn"
                      onClick={() => void refreshPlans()}
                      title="Refresh saved plans"
                      aria-label="Refresh saved plans"
                    >
                      <RefreshCw size={16} aria-hidden />
                    </button>
                  </div>
                  {plansError && <div className="account-error" role="alert">{plansError}</div>}
                  {plans === null && !plansError && <div className="account-hint">Loading…</div>}
                  {plans !== null && plans.length === 0 && (
                    <div className="account-hint">
                      Nothing saved yet. Draw a line, then use “Save plan” in the analysis panel.
                    </div>
                  )}
                  {plans !== null && plans.length > 0 && (
                    <ul className="account-plan-list">
                      {plans.map(plan => (
                        <li key={plan.id}>
                          <div className="account-plan-meta">
                            <span className="account-plan-name">{plan.name}</span>
                            <span className="account-plan-date">
                              {new Date(plan.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="account-plan-actions">
                            <button
                              type="button"
                              className="account-icon-btn"
                              onClick={() => {
                                setIsOpen(false);
                                onLoadPlan(plan);
                              }}
                              title={`Load "${plan.name}"`}
                              aria-label={`Load plan ${plan.name}`}
                            >
                              <FolderOpen size={16} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="account-icon-btn account-danger"
                              onClick={() => void handleDelete(plan)}
                              title={`Delete "${plan.name}"`}
                              aria-label={`Delete plan ${plan.name}`}
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="account-upgrade">
                  <p>
                    Your current plan doesn’t include Fire Break Calculator cloud plans. Upgrade to
                    Basic or AI Pro in{' '}
                    <a href={SUITE_AUTH_URL} target="_blank" rel="noopener noreferrer">
                      Station Manager
                    </a>{' '}
                    to save and restore plans.
                  </p>
                </div>
              )}

              <button type="button" className="account-signout" onClick={handleSignOut}>
                <LogOut size={16} aria-hidden /> Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AccountControl;
