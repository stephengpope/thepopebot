'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { KeyIcon, CheckIcon, PlusIcon, TrashIcon } from './icons.js';
import { SecretRow, StatusBadge, Dialog, EmptyState, formatDate, timeAgo } from './settings-shared.js';
import {
  getChatSettings,
  updateProviderCredential,
  addCustomProvider,
  updateCustomProvider,
  removeCustomProvider,
  setActiveLlm,
  createOAuthToken,
  getOAuthTokens,
  deleteOAuthToken,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper LLM page (auto-save)
//
// Picks the provider + model used for short background generations: chat
// titles, agent-job titles, and agent-job summaries. Independent of the
// coding agent. Credentials live at /admin/event-handler/llms.
// ─────────────────────────────────────────────────────────────────────────────

export function HelperLlmPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = async () => {
    try {
      const result = await getChatSettings();
      setSettings(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveActive = async (provider, model, maxTokens) => {
    const result = await setActiveLlm(provider, model, maxTokens);
    if (result?.success) await loadSettings();
    return result;
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (settings?.error) {
    return <p className="text-sm text-destructive">{settings.error}</p>;
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Helper LLM</h2>
        <p className="text-sm text-muted-foreground">Used for chat titles, agent-job titles, and agent-job summaries. Independent of your coding agent. Only providers with configured API keys appear in the dropdown — set keys at <a href="/admin/event-handler/llms" className="underline hover:text-foreground">Providers</a>.</p>
      </div>
      <ActiveConfig settings={settings} onSave={handleSaveActive} />
    </div>
  );
}

// Backwards-compat alias — kept so route files importing the old name keep working
// during the route move.
export const ChatConfigPage = HelperLlmPage;

function ActiveConfig({ settings, onSave }) {
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [modelText, setModelText] = useState('');
  const [maxTokens, setMaxTokens] = useState('4096');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const initialized = useRef(false);
  const saveTimer = useRef(null);

  const availableProviders = [];
  if (settings?.builtinProviders && settings?.credentialStatuses) {
    const statusMap = new Map(settings.credentialStatuses.map((s) => [s.key, s.isSet]));
    for (const [slug, prov] of Object.entries(settings.builtinProviders)) {
      const hasKey = prov.credentials.some((c) => statusMap.get(c.key));
      if (hasKey) {
        availableProviders.push({ slug, name: prov.name, models: prov.models });
      }
    }
  }
  if (settings?.customProviders) {
    for (const cp of settings.customProviders) {
      availableProviders.push({ slug: cp.key, name: cp.name, models: cp.models.map((m) => ({ id: m, name: m })) });
    }
  }

  useEffect(() => {
    if (settings?.active) {
      const prov = settings.active.provider || '';
      const resolved = availableProviders.find((p) => p.slug === prov);
      const models = resolved?.models || [];
      const def = models.find((m) => m.default);
      setProvider(prov);
      setModel(settings.active.model || def?.id || models[0]?.id || '');
      setModelText(settings.active.model || def?.id || models[0]?.id || '');
      setMaxTokens(settings.active.maxTokens || '4096');
      setTimeout(() => { initialized.current = true; }, 100);
    }
  }, [settings]);

  const doSave = useCallback(async (p, m, mt, ws) => {
    setSaving(true);
    const result = await onSave(p, m, mt, ws);
    setSaving(false);
    if (result?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [onSave]);

  const scheduleAutoSave = useCallback((p, m, mt, ws) => {
    if (!initialized.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(p, m, mt, ws), 800);
  }, [doSave]);

  const selectedProvider = availableProviders.find((p) => p.slug === provider);

  const handleProviderChange = (slug) => {
    setProvider(slug);
    const prov = availableProviders.find((p) => p.slug === slug);
    const models = prov?.models || [];
    const def = models.find((m) => m.default);
    const newModel = def?.id || models[0]?.id || '';
    setModel(newModel);
    setModelText(newModel);
    if (models.length > 0) {
      scheduleAutoSave(slug, newModel, maxTokens);
    }
  };

  const handleModelChange = (m) => {
    setModel(m);
    scheduleAutoSave(provider, m, maxTokens);
  };

  const handleModelTextSave = () => {
    setModel(modelText);
    doSave(provider, modelText, maxTokens);
  };

  // Track whether form has unsaved changes (text-input mode only)
  const savedModel = settings?.active?.model || '';
  const savedMaxTokens = settings?.active?.maxTokens || '4096';
  const hasUnsavedChanges = modelText !== savedModel || maxTokens !== savedMaxTokens;

  const hasModels = (selectedProvider?.models || []).length > 0;

  const handleMaxTokensChange = (mt) => {
    setMaxTokens(mt);
    if (hasModels) {
      scheduleAutoSave(provider, model, mt);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between py-3 first:pt-0">
          <label className="text-sm font-medium shrink-0">Provider</label>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
            {saved && <span className="text-xs text-green-500 inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span>}
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            >
              {!provider && availableProviders.length > 0 && (
                <option value="">Select Provider</option>
              )}
              {availableProviders.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
              {availableProviders.length === 0 && (
                <option value="" disabled>No providers configured</option>
              )}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between py-3">
          <label className="text-sm font-medium shrink-0">Model</label>
          {(selectedProvider?.models || []).length > 0 ? (
            <select
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            >
              {(selectedProvider?.models || []).filter((m) => m.chat !== false).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={modelText}
              onChange={(e) => setModelText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleModelTextSave()}
              placeholder="Model name"
              className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            />
          )}
        </div>

        <div className="flex items-center justify-between py-3 last:pb-0">
          <label className="text-sm font-medium shrink-0">Max Tokens</label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => handleMaxTokensChange(e.target.value)}
            className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>
      </div>
      {!hasModels && (
        <div className="flex justify-end mt-4">
          <button onClick={handleModelTextSave} disabled={!hasUnsavedChanges || saving}
            className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Providers sub-tab
// ─────────────────────────────────────────────────────────────────────────────

export function ChatProvidersPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);

  const loadSettings = async () => {
    try {
      const result = await getChatSettings();
      setSettings(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleUpdateCredential = async (credKey, value) => {
    await updateProviderCredential(credKey, value);
    await loadSettings();
  };

  const handleAddCustom = async (config) => {
    await addCustomProvider(config);
    setShowDialog(false);
    await loadSettings();
  };

  const handleEditCustom = async (config) => {
    if (editingProvider) {
      await updateCustomProvider(editingProvider.key, config);
      setEditingProvider(null);
      setShowDialog(false);
      await loadSettings();
    }
  };

  const handleRemoveCustom = async (key) => {
    await removeCustomProvider(key);
    await loadSettings();
  };

  const openAdd = () => {
    setEditingProvider(null);
    setShowDialog(true);
  };

  const openEdit = (provider) => {
    setEditingProvider(provider);
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingProvider(null);
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (settings?.error) {
    return <p className="text-sm text-destructive">{settings.error}</p>;
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Providers</h2>
        <p className="text-sm text-muted-foreground">Configure API keys and credentials for each LLM provider. Set a key to make it available in the Configuration tab.</p>
      </div>

      {/* Built-in providers */}
      {settings?.builtinProviders && (
        <div className="mb-6">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Built-in</h4>
          <div className="space-y-8">
            {Object.entries(settings.builtinProviders).map(([slug, prov]) => (
              <ProviderCard
                key={slug}
                slug={slug}
                name={prov.name}
                credentials={prov.credentials}
                credentialStatuses={settings.credentialStatuses || []}
                onUpdateCredential={handleUpdateCredential}
              />
            ))}
          </div>
        </div>
      )}

      {/* Custom providers */}
      <div className="space-y-8">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom (OpenAI Compatible API)</h4>

        {settings?.customProviders?.map((cp) => (
          <CustomProviderCard
            key={cp.key}
            provider={cp}
            onEdit={openEdit}
            onRemove={handleRemoveCustom}
          />
        ))}

        <button
          onClick={openAdd}
          className="w-full rounded-lg border border-dashed p-4 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors flex items-center justify-center gap-2"
        >
          <PlusIcon size={14} />
          Add OpenAI Compatible API
        </button>
      </div>

      <CustomProviderDialog
        open={showDialog}
        initial={editingProvider}
        onSave={editingProvider ? handleEditCustom : handleAddCustom}
        onCancel={closeDialog}
      />
    </div>
  );
}

function ProviderCard({ name, slug, credentials, credentialStatuses, onUpdateCredential }) {
  const [saving, setSaving] = useState(null);
  const statusMap = new Map(credentialStatuses.map((s) => [s.key, s.isSet]));

  const handleSave = async (credKey, value) => {
    setSaving(credKey);
    await onUpdateCredential(credKey, value);
    setSaving(null);
  };

  const credentialRows = credentials.map((cred) => (
    <SecretRow
      key={cred.key}
      label={cred.label}
      description={cred.description}
      isSet={statusMap.get(cred.key) || false}
      saving={saving === cred.key}
      onSave={(value) => handleSave(cred.key, value)}
    />
  ));

  // OAuth token sections per provider
  const oauthSections = {
    anthropic: { tokenType: 'claudeCode', description: 'For Claude Code CLI containers (Pro/Max subscription)' },
    openai: { tokenType: 'codex', description: 'For Codex CLI containers (ChatGPT Plus/Pro auth.json)' },
  };
  const oauth = oauthSections[slug];

  if (oauth) {
    return (
      <div>
        <h3 className="text-sm font-medium mb-2">{name}</h3>
        <div className="rounded-lg border bg-card p-4 space-y-4">
          {credentials.length > 0 && (
            <div className="divide-y divide-border">
              {credentialRows}
            </div>
          )}
          <div className="h-px bg-border" />
          <OAuthTokenList tokenType={oauth.tokenType} description={oauth.description} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-medium mb-2">{name}</h3>
      {credentials.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="divide-y divide-border">
            {credentialRows}
          </div>
        </div>
      )}
    </div>
  );
}

function OAuthTokenList({ tokenType = 'claudeCode', description = 'For Claude Code CLI containers (Pro/Max subscription)' }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState(null);

  const loadTokens = async () => {
    try {
      const result = await getOAuthTokens(tokenType);
      setTokens(Array.isArray(result) ? result : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
  }, []);

  const handleCreate = async () => {
    if (creating || !newName.trim() || !newToken.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createOAuthToken(tokenType, newName.trim(), newToken.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setNewName('');
        setNewToken('');
        setShowDialog(false);
        await loadTokens();
      }
    } catch {
      setError('Failed to create OAuth token');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    try {
      await deleteOAuthToken(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
      setConfirmDelete(null);
    } catch {
      // ignore
    }
  };

  const closeDialog = () => {
    setShowDialog(false);
    setNewName('');
    setNewToken('');
    setError(null);
  };

  const isCodex = tokenType === 'codex';
  const tokenLabel = isCodex ? 'Auth JSON' : 'Token';
  const tokenPlaceholder = isCodex ? 'Paste ~/.codex/auth.json contents...' : 'Paste OAuth token...';

  if (loading) {
    return <div className="h-16 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-medium">OAuth Tokens</span>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 transition-colors"
        >
          <PlusIcon size={14} />
          Add token
        </button>
      </div>

      {showDialog && (
        <Dialog open onClose={closeDialog} title="Add OAuth Token">
          {error && <p className="text-sm text-destructive mb-3">{error}</p>}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Account 1, Pro subscription..."
                autoFocus
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{tokenLabel}</label>
              {isCodex ? (
                <textarea
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder={tokenPlaceholder}
                  rows={5}
                  spellCheck={false}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground resize-y"
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && handleCreate()}
                />
              ) : (
                <input
                  type="password"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder={tokenPlaceholder}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              )}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={closeDialog}
              className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || !newToken.trim() || creating}
              className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Adding...' : 'Add'}
            </button>
          </div>
        </Dialog>
      )}

      {tokens.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <div className="divide-y divide-border">
            {tokens.map((t) => (
              <div key={t.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4">
                <div className="flex items-center gap-2">
                  <KeyIcon size={14} className="text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatDate(t.createdAt)}
                      <span> · {t.lastUsedAt ? `Last used ${timeAgo(t.lastUsedAt)}` : 'Never used'}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(t.id)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border shrink-0 self-start sm:self-auto transition-colors ${
                    confirmDelete === t.id
                      ? 'border-destructive text-destructive hover:bg-destructive/10'
                      : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
                  }`}
                >
                  <TrashIcon size={12} />
                  {confirmDelete === t.id ? 'Confirm' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          message="No OAuth tokens configured"
          actionLabel="Add OAuth token"
          onAction={() => setShowDialog(true)}
        />
      )}
    </div>
  );
}

function CustomProviderCard({ provider, onEdit, onRemove }) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleRemove = () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    onRemove(provider.key);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">{provider.name}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(provider)}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Edit
          </button>
          <button
            onClick={handleRemove}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
              confirmRemove
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <TrashIcon size={12} />
              {confirmRemove ? 'Confirm' : 'Remove'}
            </span>
          </button>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="divide-y divide-border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-3">
            <div className="flex items-center gap-2">
              <KeyIcon size={14} className="text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">API Key</span>
            </div>
            <StatusBadge isSet={provider.hasApiKey} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Models</span>
            </div>
            <code className="text-xs font-mono text-muted-foreground">{provider.models.join(', ')}</code>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Base URL</span>
            </div>
            <code className="text-xs font-mono text-muted-foreground">{provider.baseUrl}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomProviderDialog({ open, initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(initial?.models?.length ? initial.models : ['']);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name || '');
      setBaseUrl(initial?.baseUrl || '');
      setApiKey('');
      setModels(initial?.models?.length ? [...initial.models] : ['']);
      setSaving(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open, initial]);

  const handleSubmit = async () => {
    setSaving(true);
    const filteredModels = models.filter((m) => m.trim());
    const config = { name, baseUrl, models: filteredModels };
    if (apiKey) config.apiKey = apiKey;
    else if (initial?.hasApiKey) config.apiKey = '__keep__';
    await onSave(config);
    setSaving(false);
  };

  const updateModel = (index, value) => {
    const next = [...models];
    next[index] = value;
    setModels(next);
  };

  const removeModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const addModel = () => {
    setModels([...models, '']);
  };

  const hasValidModels = models.some((m) => m.trim());

  return (
    <Dialog open={open} onClose={onCancel} title={initial ? 'Edit Provider' : 'Add OpenAI Compatible API'}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Name</label>
          <input ref={nameRef} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ollama (model)"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground" />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Base URL</label>
          <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.together.xyz/v1"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground" />
          <p className="text-xs text-muted-foreground mt-1">For local Docker services use <span className="font-mono">http://host.docker.internal:PORT/v1</span></p>
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">API Key <span className="text-muted-foreground font-normal">(optional)</span></label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={initial?.hasApiKey ? '••••••••' : 'sk-...'}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground" />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Models</label>
          <div className="space-y-2">
            {models.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="text" value={m} onChange={(e) => updateModel(i, e.target.value)} placeholder="qwen2.5-coder:3b"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground" />
                {models.length > 1 && (
                  <button type="button" onClick={() => removeModel(i)}
                    className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors">
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addModel}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              + Add model
            </button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Ollama</p>
          <p>Name: <span className="font-mono">Ollama (qwen2.5-coder:3b)</span></p>
          <p>URL: <span className="font-mono">http://host.docker.internal:11434/v1</span></p>
          <p>API Key: any value (e.g. <span className="font-mono">ollama</span>)</p>
          <p>Models: exact names from <span className="font-mono">ollama list</span></p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button onClick={handleSubmit} disabled={!name || !baseUrl || !hasValidModels || saving}
          className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : initial ? 'Save' : 'Add'}
        </button>
      </div>
    </Dialog>
  );
}

// Backwards compat
export function SettingsChatPage() {
  return <HelperLlmPage />;
}
