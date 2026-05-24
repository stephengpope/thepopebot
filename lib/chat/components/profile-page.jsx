'use client';

import { useState, useEffect } from 'react';
import { PageLayout } from './page-layout.js';
import { KeyIcon, SendIcon, CopyIcon, CheckIcon, UserIcon, SlackIcon, TeamsIcon } from './icons.js';
import { updateProfile, updateProfileInfo } from '../../auth/actions.js';
import {
  issueTelegramCode,
  unlinkTelegramChannel,
  setTelegramSystemMessages,
  issueSlackCode,
  unlinkSlackChannel,
  setSlackSystemMessages,
  issueTeamsCode,
  unlinkTeamsChannel,
  setTeamsSystemMessages,
} from '../actions.js';

const TABS = [
  { id: 'profile', label: 'Profile', href: '/profile', icon: UserIcon },
  { id: 'login', label: 'Login', href: '/profile/login', icon: KeyIcon },
  { id: 'telegram', label: 'Telegram', href: '/profile/telegram', icon: SendIcon },
  { id: 'slack', label: 'Slack', href: '/profile/slack', icon: SlackIcon },
  { id: 'teams', label: 'Teams', href: '/profile/teams', icon: TeamsIcon },
];

export function ProfileLayout({ session, children }) {
  const [activePath, setActivePath] = useState('');

  useEffect(() => {
    setActivePath(window.location.pathname);
  }, []);

  return (
    <PageLayout session={session}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Profile</h1>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = tab.href === '/profile'
            ? activePath === '/profile'
            : activePath === tab.href || activePath.startsWith(tab.href + '/');
          const Icon = tab.icon;
          return (
            <a
              key={tab.id}
              href={tab.href}
              className={`inline-flex items-center gap-2 px-3 py-2 min-h-[44px] shrink-0 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </a>
          );
        })}
      </div>

      {/* Tab content */}
      {children}
    </PageLayout>
  );
}

function FormBanner({ message }) {
  if (!message) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${
      message.type === 'error'
        ? 'border-destructive/30 bg-destructive/5 text-destructive'
        : 'border-green-500/30 bg-green-500/5 text-green-500'
    }`}>
      {message.text}
    </div>
  );
}

function ProfileInfoForm({ profile }) {
  const [firstName, setFirstName] = useState(profile?.firstName || '');
  const [lastName, setLastName] = useState(profile?.lastName || '');
  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateProfileInfo({ firstName, lastName, nickname });
      if (result.error) {
        setMessage({ type: 'error', text: result.error });
      } else {
        setMessage({ type: 'success', text: 'Profile saved.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save profile.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Used by agents to address you and route DMs (e.g. &quot;send X to Steve&quot;).
        </p>
      </div>

      <FormBanner message={message} />

      <div className="space-y-2">
        <label className="text-sm font-medium">First name</label>
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Last name</label>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Nickname</label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g. Steve"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md px-4 py-2 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save profile'}
      </button>
    </form>
  );
}

function FieldLabel({ children }) {
  return (
    <label className="text-sm font-medium flex items-center gap-1">
      {children}
      <span className="text-destructive" aria-hidden>*</span>
    </label>
  );
}

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground';

function EmailForm({ session }) {
  const currentEmail = session?.user?.email || '';
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const trimmed = newEmail.trim();
  const changed = trimmed && trimmed !== currentEmail;
  const canSubmit = changed && currentPassword && !saving;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateProfile({ email: trimmed, currentPassword });
      if (result.error) {
        setMessage({ type: 'error', text: result.error });
      } else {
        setMessage({ type: 'success', text: 'Email updated. Sign in again with your new email next time.' });
        setNewEmail('');
        setCurrentPassword('');
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to update email.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Email</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Currently <code className="text-foreground">{currentEmail}</code>. All fields required to change.
        </p>
      </div>

      <FormBanner message={message} />

      <div className="space-y-2">
        <FieldLabel>New email</FieldLabel>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={currentEmail}
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>Current password</FieldLabel>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md px-4 py-2 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Updating...' : 'Update email'}
      </button>
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const canSubmit =
    currentPassword && newPassword && confirmPassword && !mismatch && !tooShort && !saving;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateProfile({ currentPassword, newPassword });
      if (result.error) {
        setMessage({ type: 'error', text: result.error });
      } else {
        setMessage({ type: 'success', text: 'Password updated. Use your new password next sign-in.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to update password.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Password</h2>
        <p className="text-sm text-muted-foreground mt-1">
          All fields required. Minimum 8 characters.
        </p>
      </div>

      <FormBanner message={message} />

      <div className="space-y-2">
        <FieldLabel>Current password</FieldLabel>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>New password</FieldLabel>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
        {tooShort && <p className="text-xs text-destructive">Must be at least 8 characters.</p>}
      </div>

      <div className="space-y-2">
        <FieldLabel>Confirm new password</FieldLabel>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
        {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md px-4 py-2 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Updating...' : 'Update password'}
      </button>
    </form>
  );
}

export function ProfileInfoPage({ profile }) {
  return (
    <div className="max-w-md">
      <ProfileInfoForm profile={profile} />
    </div>
  );
}

export function ProfileLoginPage({ session }) {
  return (
    <div className="max-w-md space-y-10">
      <EmailForm session={session} />
      <div className="border-t border-border" />
      <PasswordForm />
    </div>
  );
}

function formatCountdown(ms) {
  if (ms <= 0) return 'expired';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Telegram linking UI. Initial state is server-rendered (passed via `initial`);
 * mutations use server actions, which return the new state.
 */
export function ProfileTelegramPage({ initial }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.status !== 'pending') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const handleIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await issueTelegramCode();
      if (result.error) {
        setError(result.error);
      } else {
        setState({
          status: 'pending',
          code: result.code,
          expiresAt: result.expiresAt,
          botUsername: result.botUsername ?? state.botUsername,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkTelegramChannel();
      setState({ status: 'unlinked', botUsername: state.botUsername });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(`/verify ${state.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const botLink = state.botUsername
    ? `https://t.me/${state.botUsername}`
    : null;

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h2 className="text-base font-medium">Telegram</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Link a Telegram chat to your account to talk to the bot from your phone.
        </p>
      </div>

      {!state.botUsername && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-500">
          Telegram bot token is not configured. An admin needs to set
          <code className="mx-1 px-1 rounded bg-muted text-foreground">TELEGRAM_BOT_TOKEN</code>
          before users can link their chat.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {state.status === 'unlinked' && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Not linked</span>
          </div>
          <button
            type="button"
            onClick={handleIssue}
            disabled={busy || !state.botUsername}
            className="rounded-md px-3 py-1.5 text-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Generating...' : 'Generate code'}
          </button>
        </div>
      )}

      {state.status === 'pending' && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-muted-foreground">
              Waiting for verification — expires in {formatCountdown(state.expiresAt - now)}
            </span>
          </div>

          <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
            <li>
              Open{' '}
              {botLink ? (
                <a className="text-foreground underline" href={botLink} target="_blank" rel="noreferrer">
                  @{state.botUsername}
                </a>
              ) : (
                <span className="text-foreground">the bot</span>
              )}{' '}
              on Telegram.
            </li>
            <li>
              Send this message:
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs text-foreground font-mono">
                  /verify {state.code}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
              </div>
            </li>
          </ol>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleIssue}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              {busy ? 'Regenerating...' : 'Regenerate'}
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.status === 'verified' && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">
              Linked to Telegram chat <code className="text-foreground">{state.channelChatId}</code>
            </span>
          </div>

          <SystemMessagesToggle
            enabled={state.systemMessagesEnabled !== false}
            onChange={async (next) => {
              setState((s) => ({ ...s, systemMessagesEnabled: next }));
              try {
                await setTelegramSystemMessages(next);
              } catch {
                setState((s) => ({ ...s, systemMessagesEnabled: !next }));
                setError('Failed to update preference.');
              }
            }}
          />

          <button
            type="button"
            onClick={handleUnlink}
            disabled={busy}
            className="rounded-md border border-destructive px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Unlinking...' : 'Unlink'}
          </button>
        </div>
      )}
    </div>
  );
}

function SystemMessagesToggle({ enabled, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3 pt-2 border-t border-border">
      <div className="text-sm">
        <div className="font-medium">System notifications</div>
        <p className="text-xs text-muted-foreground mt-0.5">
          GitHub webhook events and other system messages. Always saved to your inbox.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          enabled ? 'bg-foreground' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Slack linking UI. Mirrors the Telegram flow — issue a code, paste it as a DM
 * to the bot in Slack. The bot must be installed in the user's workspace first.
 */
export function ProfileSlackPage({ initial }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.status !== 'pending') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const handleIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await issueSlackCode();
      if (result.error) {
        setError(result.error);
      } else {
        setState({
          status: 'pending',
          code: result.code,
          expiresAt: result.expiresAt,
          botUsername: result.botUsername ?? state.botUsername,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkSlackChannel();
      setState({ status: 'unlinked', botUsername: state.botUsername });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(`/verify ${state.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h2 className="text-base font-medium">Slack</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Link your Slack workspace to talk to the bot from any channel or DM.
        </p>
      </div>

      {!state.botUsername && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-500">
          Slack bot credentials are not configured. An admin needs to set
          <code className="mx-1 px-1 rounded bg-muted text-foreground">SLACK_BOT_TOKEN</code>
          and
          <code className="mx-1 px-1 rounded bg-muted text-foreground">SLACK_SIGNING_SECRET</code>
          before users can link their workspace.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {state.status === 'unlinked' && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Not linked</span>
          </div>
          <button
            type="button"
            onClick={handleIssue}
            disabled={busy || !state.botUsername}
            className="rounded-md px-3 py-1.5 text-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Generating...' : 'Generate code'}
          </button>
        </div>
      )}

      {state.status === 'pending' && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-muted-foreground">
              Waiting for verification — expires in {formatCountdown(state.expiresAt - now)}
            </span>
          </div>

          <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
            <li>
              Open a DM with{' '}
              <span className="text-foreground">@{state.botUsername || 'the bot'}</span>{' '}
              in Slack.
            </li>
            <li>
              Send this message:
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs text-foreground font-mono">
                  /verify {state.code}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
              </div>
            </li>
          </ol>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleIssue}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              {busy ? 'Regenerating...' : 'Regenerate'}
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.status === 'verified' && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">
              Linked to Slack channel <code className="text-foreground">{state.channelChatId}</code>
            </span>
          </div>

          <SystemMessagesToggle
            enabled={state.systemMessagesEnabled !== false}
            onChange={async (next) => {
              setState((s) => ({ ...s, systemMessagesEnabled: next }));
              try {
                await setSlackSystemMessages(next);
              } catch {
                setState((s) => ({ ...s, systemMessagesEnabled: !next }));
                setError('Failed to update preference.');
              }
            }}
          />

          <button
            type="button"
            onClick={handleUnlink}
            disabled={busy}
            className="rounded-md border border-destructive px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Unlinking...' : 'Unlink'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Teams linking UI. Mirrors the Telegram flow — issue a code, paste it as a
 * message to the bot in Teams. The Teams app manifest must be sideloaded in
 * the user's tenant first.
 */
export function ProfileTeamsPage({ initial }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.status !== 'pending') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const handleIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await issueTeamsCode();
      if (result.error) {
        setError(result.error);
      } else {
        setState({
          status: 'pending',
          code: result.code,
          expiresAt: result.expiresAt,
          configured: state.configured,
          appId: state.appId,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlinkTeamsChannel();
      setState({ status: 'unlinked', configured: state.configured, appId: state.appId });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!state.code) return;
    try {
      await navigator.clipboard.writeText(`/verify ${state.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h2 className="text-base font-medium">Microsoft Teams</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Link a Teams chat to your account to talk to the bot from Teams.
        </p>
      </div>

      {!state.configured && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-500">
          Teams bot credentials are not configured. An admin needs to set
          <code className="mx-1 px-1 rounded bg-muted text-foreground">TEAMS_APP_ID</code>
          and
          <code className="mx-1 px-1 rounded bg-muted text-foreground">TEAMS_APP_PASSWORD</code>
          before users can link their chat.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {state.status === 'unlinked' && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Not linked</span>
          </div>
          <button
            type="button"
            onClick={handleIssue}
            disabled={busy || !state.configured}
            className="rounded-md px-3 py-1.5 text-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Generating...' : 'Generate code'}
          </button>
        </div>
      )}

      {state.status === 'pending' && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-muted-foreground">
              Waiting for verification — expires in {formatCountdown(state.expiresAt - now)}
            </span>
          </div>

          <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
            <li>
              Find the bot in Microsoft Teams (your admin must have sideloaded
              the bot manifest first).
            </li>
            <li>
              Send this message:
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs text-foreground font-mono">
                  /verify {state.code}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {copied ? <><CheckIcon size={12} /> Copied</> : <><CopyIcon size={12} /> Copy</>}
                </button>
              </div>
            </li>
          </ol>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleIssue}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              {busy ? 'Regenerating...' : 'Regenerate'}
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.status === 'verified' && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">
              Linked to Teams conversation <code className="text-foreground">{state.channelChatId}</code>
            </span>
          </div>

          <SystemMessagesToggle
            enabled={state.systemMessagesEnabled !== false}
            onChange={async (next) => {
              setState((s) => ({ ...s, systemMessagesEnabled: next }));
              try {
                await setTeamsSystemMessages(next);
              } catch {
                setState((s) => ({ ...s, systemMessagesEnabled: !next }));
                setError('Failed to update preference.');
              }
            }}
          />

          <button
            type="button"
            onClick={handleUnlink}
            disabled={busy}
            className="rounded-md border border-destructive px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Unlinking...' : 'Unlink'}
          </button>
        </div>
      )}
    </div>
  );
}
