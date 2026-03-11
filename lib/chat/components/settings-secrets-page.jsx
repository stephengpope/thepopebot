'use client';

import { useState, useEffect, useRef } from 'react';
import { KeyIcon, CopyIcon, CheckIcon, TrashIcon } from './icons.js';
import { createNewApiKey, getApiKeys, deleteApiKey } from '../actions.js';

function timeAgo(ts) {
  if (!ts) return 'Never';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper — reusable for each secrets section
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, description, children }) {
  return (
    <div className="pb-8 mb-8 border-b border-border last:border-b-0 last:pb-0 last:mb-0">
      <h2 className="text-base font-medium mb-1">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// API Keys section
// ─────────────────────────────────────────────────────────────────────────────

function ApiKeySection() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const confirmTimerRef = useRef(null);
  const nameInputRef = useRef(null);

  const loadKeys = async () => {
    try {
      const result = await getApiKeys();
      setKeys(Array.isArray(result) ? result : []);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  // Auto-focus name input when form opens
  useEffect(() => {
    if (showForm && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [showForm]);

  const handleOpenForm = () => {
    setShowForm(true);
    setNameInput('');
    setFormError(null);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setNameInput('');
    setFormError(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (creating) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setFormError('Name is required');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const result = await createNewApiKey(trimmed);
      if (result.error) {
        setFormError(result.error);
      } else {
        setNewKey(result.key);
        setShowForm(false);
        setNameInput('');
        await loadKeys();
      }
    } catch {
      setFormError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (confirmDeleteId !== id) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDeleteId(id);
      confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      if (newKey && keys.find((k) => k.id === id)) {
        setNewKey(null);
      }
    } catch {
      // ignore
    }
  };

  if (loading) {
    return <div className="h-14 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div>
      {/* Header row: section action button */}
      <div className="flex justify-end mb-3">
        <button
          onClick={handleOpenForm}
          disabled={showForm}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
        >
          + Add API key
        </button>
      </div>

      {/* Inline create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg border bg-card p-4 mb-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1">
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. production"
                maxLength={64}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {formError && (
                <p className="mt-1.5 text-xs text-destructive">{formError}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={creating || !nameInput.trim()}
                className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:pointer-events-none"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={handleCancelForm}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* New key banner */}
      {newKey && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              API key created — copy it now. You won't be able to see it again.
            </p>
            <button
              onClick={() => setNewKey(null)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              Dismiss
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all">
              {newKey}
            </code>
            <CopyButton text={newKey} />
          </div>
        </div>
      )}

      {/* Key list */}
      {keys.length > 0 ? (
        <div className="rounded-lg border bg-card divide-y divide-border">
          {keys.map((apiKey) => (
            <div
              key={apiKey.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="shrink-0 rounded-md bg-muted p-2">
                  <KeyIcon size={16} />
                </div>
                <div>
                  <p className="text-sm font-medium">{apiKey.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                    <code className="text-xs font-mono text-muted-foreground truncate max-w-[160px]">
                      {apiKey.keyPrefix}...
                    </code>
                    <span className="text-xs text-muted-foreground">
                      Created {formatDate(apiKey.createdAt)}
                      {apiKey.lastUsedAt
                        ? ` · Last used ${timeAgo(apiKey.lastUsedAt)}`
                        : ' · Never used'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDelete(apiKey.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border min-h-[32px] min-w-[64px] shrink-0 ${
                  confirmDeleteId === apiKey.id
                    ? 'border-destructive text-destructive hover:bg-destructive/10'
                    : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
                }`}
              >
                <TrashIcon size={12} />
                {confirmDeleteId === apiKey.id ? 'Confirm delete' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-card p-6 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">No API keys — add one above</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsSecretsPage() {
  return (
    <div>
      <Section
        title="API Keys"
        description="Authenticates external requests to /api endpoints. Pass via the x-api-key header."
      >
        <ApiKeySection />
      </Section>

      {/* Future sections go here, e.g.:
      <Section title="GitHub Token" description="...">
        <GitHubTokenSection />
      </Section>
      */}
    </div>
  );
}
