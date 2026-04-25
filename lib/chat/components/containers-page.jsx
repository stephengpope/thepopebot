'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PageLayout } from './page-layout.js';
import { SpinnerIcon, RefreshIcon, StopIcon, PlayIcon, TrashIcon, XIcon } from './icons.js';
import { ConfirmDialog } from './ui/confirm-dialog.js';
import { CodeLogView } from './code-log-view.js';
import {
  getRunnersStatus,
  stopDockerContainer,
  startDockerContainer,
  removeDockerContainer,
  listSavedContainerLogs,
  getSavedContainerLogs,
  deleteSavedContainerLogs,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
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

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-border/50" />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// State badge
// ─────────────────────────────────────────────────────────────────────────────

const stateBadgeStyles = {
  running: 'bg-green-500',
  paused: 'bg-yellow-500',
  exited: 'bg-muted-foreground',
  dead: 'bg-destructive',
  created: 'bg-yellow-500',
  restarting: 'bg-yellow-500',
};

const stateTextStyles = {
  running: 'text-green-500',
  paused: 'text-yellow-500',
  exited: 'text-muted-foreground',
  dead: 'text-destructive',
  created: 'text-yellow-500',
  restarting: 'text-yellow-500',
};

function StateBadge({ state }) {
  const dotClass = stateBadgeStyles[state] || 'bg-muted-foreground';
  const textClass = stateTextStyles[state] || 'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium capitalize ${textClass}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass} ${state === 'running' ? 'animate-pulse' : ''}`} />
      {state}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Container Logs Dialog
// ─────────────────────────────────────────────────────────────────────────────

function ContainerLogsDialog({ containerName, savedMode, onClose }) {
  const [logs, setLogs] = useState([]);
  const [rawLogs, setRawLogs] = useState(null);
  const [exitCode, setExitCode] = useState(null);
  const [streaming, setStreaming] = useState(!savedMode);
  const [capturedAt, setCapturedAt] = useState(null);
  const outputRef = useRef(null);

  useEffect(() => {
    if (savedMode) {
      getSavedContainerLogs(containerName).then((data) => {
        if (data) {
          setRawLogs(data.logs || '');
          setCapturedAt(data.capturedAt);
        } else {
          setRawLogs('');
        }
        setStreaming(false);
      });
      return;
    }

    const es = new EventSource(`/stream/containers/logs?name=${encodeURIComponent(containerName)}`);

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        setLogs((prev) => [...prev, data]);
      } catch {}
    });

    es.addEventListener('exit', (e) => {
      try {
        const { exitCode: code } = JSON.parse(e.data);
        setExitCode(code);
      } catch {}
      setStreaming(false);
      es.close();
    });

    es.addEventListener('error', () => {
      setStreaming(false);
      es.close();
    });

    return () => es.close();
  }, [containerName, savedMode]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs.length, rawLogs]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-lg w-full max-w-3xl mx-4 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">{containerName}</span>
            {streaming && (
              <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
            )}
            {capturedAt && (
              <span className="text-xs text-muted-foreground shrink-0">Captured {timeAgo(capturedAt)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div ref={outputRef} className="flex-1 overflow-auto p-4 min-h-[120px] font-mono text-xs">
          {savedMode ? (
            rawLogs !== null ? (
              rawLogs ? (
                <pre className="whitespace-pre-wrap break-words text-foreground">{rawLogs}</pre>
              ) : (
                <span className="text-sm text-muted-foreground">No output</span>
              )
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SpinnerIcon size={14} className="animate-spin" />
                Loading logs...
              </div>
            )
          ) : logs.length > 0 ? (
            <CodeLogView logs={logs} />
          ) : streaming ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerIcon size={14} className="animate-spin" />
              Loading logs...
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No output</span>
          )}
        </div>

        {/* Footer */}
        {!streaming && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className={`text-xs font-medium ${exitCode === 0 ? 'text-green-500' : exitCode !== null ? 'text-destructive' : 'text-muted-foreground'}`}>
              {savedMode ? 'Saved logs' : exitCode !== null ? (exitCode === 0 ? 'Completed' : `Exited with code ${exitCode}`) : 'Stream ended'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker Container Table Row
// ─────────────────────────────────────────────────────────────────────────────

function ContainerRow({ container, onRequestStop, onShowLogs, isStopping, isStarting }) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removingContainer, setRemovingContainer] = useState(false);
  const confirmTimer = useRef(null);

  useEffect(() => {
    return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); };
  }, []);

  async function handleAction(action) {
    if (action === 'remove' && !confirmingRemove) {
      setConfirmingRemove(true);
      confirmTimer.current = setTimeout(() => setConfirmingRemove(false), 3000);
      return;
    }
    setConfirmingRemove(false);
    if (action === 'remove') {
      setRemovingContainer(true);
      try { await removeDockerContainer(container.name); } catch {}
    }
  }

  const isRunning = container.state === 'running';
  const isStopped = container.state === 'exited' || container.state === 'dead' || container.state === 'created';
  const imageName = container.image.includes('/') ? container.image.split('/').pop() : container.image;

  return (
    <tr className="border-t border-border">
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <StateBadge state={container.state} />
      </td>
      <td className="py-2.5 pr-3 min-w-0 whitespace-nowrap">
        <div className="text-sm font-medium truncate" title={imageName}>{container.name}</div>
      </td>
      <td className="py-2.5 pr-3 text-xs text-right hidden md:table-cell whitespace-nowrap">
        {isRunning && container.stats ? (
          <span>{container.stats.cpu.toFixed(1)}%</span>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-xs text-right hidden md:table-cell whitespace-nowrap">
        {isRunning && container.stats ? (
          <span>{formatBytes(container.stats.memUsage)}</span>
        ) : (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
        {container.status}
      </td>
      <td className="py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          {isRunning && (
            isStopping ? (
              <button
                disabled
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                <SpinnerIcon size={12} />
                Stopping...
              </button>
            ) : (
              <button
                onClick={() => onRequestStop(container.name)}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <StopIcon size={12} />
                Stop
              </button>
            )
          )}
          {isStopped && (
            isStarting ? (
              <button
                disabled
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                <SpinnerIcon size={12} />
                Starting...
              </button>
            ) : (
              <button
                onClick={() => onRequestStop(container.name, 'start')}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <PlayIcon size={12} />
                Start
              </button>
            )
          )}
          <button
            onClick={() => onShowLogs(container.name)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Logs
          </button>
          <button
            onClick={() => handleAction('remove')}
            disabled={removingContainer}
            title={confirmingRemove ? 'Click to confirm' : 'Remove'}
            className={`inline-flex items-center justify-center rounded-md p-1.5 text-xs font-medium border transition-colors disabled:opacity-50 disabled:pointer-events-none ${
              confirmingRemove
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {removingContainer ? <SpinnerIcon size={12} /> : <TrashIcon size={12} />}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Container Row (for Removed tab)
// ─────────────────────────────────────────────────────────────────────────────

function SavedContainerRow({ entry, onShowLogs, onDelete }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmTimer = useRef(null);

  useEffect(() => {
    return () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); };
  }, []);

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    setConfirmingDelete(false);
    setDeleting(true);
    try { await onDelete(entry.containerName); } catch {}
  }

  return (
    <tr className="border-t border-border">
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/50" />
          removed
        </span>
      </td>
      <td className="py-2.5 pr-3 min-w-0 whitespace-nowrap">
        <div className="text-sm font-medium truncate">{entry.containerName}</div>
      </td>
      <td className="py-2.5 pr-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
        {entry.capturedAt ? timeAgo(entry.capturedAt) : '—'}
      </td>
      <td className="py-2.5 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          <button
            onClick={() => onShowLogs(entry.containerName)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Logs
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50 disabled:pointer-events-none ${
              confirmingDelete
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {deleting ? <SpinnerIcon size={12} /> : <TrashIcon size={12} />}
            {confirmingDelete ? 'Confirm' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Container Tab Pills
// ─────────────────────────────────────────────────────────────────────────────

function ContainerTabs({ activeTab, onTabChange, counts }) {
  const tabs = [
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'exited', label: 'Exited', count: counts.exited },
    { id: 'removed', label: 'Removed', count: counts.removed },
  ];

  return (
    <div className="flex gap-1.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`rounded-full px-3 py-1.5 min-h-[36px] inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
            activeTab === tab.id
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className={`text-[10px] ${activeTab === tab.id ? 'opacity-70' : 'opacity-50'}`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker Containers Section
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_STATES = new Set(['running', 'paused', 'restarting']);
const EXITED_STATES = new Set(['exited', 'dead', 'created']);

function DockerContainersSection({ containers, savedLogs, loading, onRequestStop, onShowLogs, onShowSavedLogs, onDeleteSavedLogs, pendingStop, pendingStart }) {
  const [tab, setTab] = useState('active');

  const activeContainers = containers.filter((c) => ACTIVE_STATES.has(c.state));
  const exitedContainers = containers.filter((c) => EXITED_STATES.has(c.state));

  const counts = {
    active: activeContainers.length,
    exited: exitedContainers.length,
    removed: savedLogs.length,
  };

  const displayContainers = tab === 'active' ? activeContainers : tab === 'exited' ? exitedContainers : [];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Docker Containers</h2>
        </div>
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-border/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Docker Containers</h2>
        <ContainerTabs activeTab={tab} onTabChange={setTab} counts={counts} />
      </div>

      {tab === 'removed' ? (
        savedLogs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No saved container logs.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">State</th>
                  <th className="pb-2 pr-3 font-medium">Container</th>
                  <th className="pb-2 pr-3 font-medium hidden lg:table-cell">Captured</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedLogs.map((entry) => (
                  <SavedContainerRow
                    key={entry.containerName}
                    entry={entry}
                    onShowLogs={onShowSavedLogs}
                    onDelete={onDeleteSavedLogs}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : displayContainers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {tab === 'active' ? 'No active containers.' : 'No exited containers.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">State</th>
                <th className="pb-2 pr-3 font-medium">Container</th>
                <th className="pb-2 pr-3 font-medium text-right hidden md:table-cell">CPU</th>
                <th className="pb-2 pr-3 font-medium text-right hidden md:table-cell">Memory</th>
                <th className="pb-2 pr-3 font-medium hidden lg:table-cell">Status</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayContainers.map((c) => (
                <ContainerRow
                  key={c.id}
                  container={c}
                  onRequestStop={onRequestStop}
                  onShowLogs={onShowLogs}
                  isStopping={pendingStop === c.name}
                  isStarting={pendingStart === c.name}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Runners Workflow List
// ─────────────────────────────────────────────────────────────────────────────

const conclusionBadgeStyles = {
  success: 'bg-green-500/10 text-green-500',
  failure: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-yellow-500/10 text-yellow-500',
  skipped: 'bg-muted text-muted-foreground',
};

function RunnersWorkflowList({ runs }) {
  if (!runs || runs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No workflow runs.
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {runs.map((run) => {
        const isActive = run.status === 'in_progress' || run.status === 'queued';
        const isRunning = run.status === 'in_progress';
        const isQueued = run.status === 'queued';

        return (
          <a
            key={run.run_id}
            href={run.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-md hover:bg-accent transition-colors no-underline text-inherit"
          >
            {isRunning && (
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-green-500 animate-pulse" />
            )}
            {isQueued && (
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-500" />
            )}
            {!isActive && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 ${
                  conclusionBadgeStyles[run.conclusion] || 'bg-muted text-muted-foreground'
                }`}
              >
                {run.conclusion || 'unknown'}
              </span>
            )}

            <span className="text-sm font-medium truncate">
              {run.workflow_name || run.branch}
            </span>

            <span className="text-xs text-muted-foreground shrink-0">
              {isActive
                ? formatDuration(run.duration_seconds)
                : timeAgo(run.updated_at || run.started_at)}
            </span>

            <div className="flex-1" />

            <span className="text-xs text-blue-500 shrink-0">
              View
            </span>
          </a>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function ContainersPage({ session }) {
  const [containers, setContainers] = useState([]);
  const [containersLoading, setContainersLoading] = useState(true);
  const [runs, setRuns] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [maxPage, setMaxPage] = useState(1);
  const [runnersLoading, setRunnersLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stoppingContainer, setStoppingContainer] = useState(null);
  const [pendingStop, setPendingStop] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);
  const [logsContainer, setLogsContainer] = useState(null);
  const [logsContainerSaved, setLogsContainerSaved] = useState(false);
  const [savedLogs, setSavedLogs] = useState([]);
  const esRef = useRef(null);

  const PAGE_SIZE = 10; // matches perPage in getRunnersStatus

  // ── Docker containers via SSE ──

  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;
    let reconnectTimer = null;

    function connect() {
      if (cancelled) return;
      const es = new EventSource('/stream/containers');
      esRef.current = es;

      es.addEventListener('containers', (e) => {
        try {
          const data = JSON.parse(e.data);
          setContainers(data);
          setContainersLoading(false);

          // Clear pending stop/start when state actually changes
          const stateMap = {};
          for (const c of data) stateMap[c.name] = c.state;

          setPendingStop((name) => {
            if (name && stateMap[name] !== 'running') return null;
            return name;
          });
          setPendingStart((name) => {
            if (name && stateMap[name] === 'running') return null;
            return name;
          });
        } catch {}
      });

      es.addEventListener('ping', () => {});

      es.onopen = () => { backoff = 1000; };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (esRef.current) esRef.current.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  // ── GitHub runners (server action polling — GitHub API, not Docker) ──

  const loadRunners = useCallback(async () => {
    try {
      const data = await getRunnersStatus(1);
      setRuns(data.runs || []);
      setHasMore(data.hasMore || false);
      setMaxPage(1);
    } catch (err) {
      console.error('Failed to fetch runners status:', err);
    } finally {
      setRunnersLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const nextPage = maxPage + 1;
      const data = await getRunnersStatus(nextPage);
      const newRuns = data.runs || [];
      setRuns((prev) => {
        const existingIds = new Set(prev.map((r) => r.run_id));
        return [...prev, ...newRuns.filter((r) => !existingIds.has(r.run_id))];
      });
      setHasMore(data.hasMore || false);
      setMaxPage(nextPage);
    } catch (err) {
      console.error('Failed to load more runners:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [maxPage]);

  const autoRefreshRunners = useCallback(async () => {
    try {
      const data = await getRunnersStatus(1);
      const freshRuns = data.runs || [];
      setRuns((prev) => {
        const freshIds = new Set(freshRuns.map((r) => r.run_id));
        const olderRuns = prev.slice(PAGE_SIZE).filter((r) => !freshIds.has(r.run_id));
        return [...freshRuns, ...olderRuns];
      });
      if (maxPage === 1) setHasMore(data.hasMore || false);
    } catch (err) {
      console.error('Failed to auto-refresh runners:', err);
    }
  }, [maxPage]);

  // Initial runners load
  useEffect(() => { loadRunners(); }, [loadRunners]);

  // Auto-refresh runners every 10s
  useEffect(() => {
    const interval = setInterval(autoRefreshRunners, 10000);
    return () => clearInterval(interval);
  }, [autoRefreshRunners]);

  // ── Saved container logs ──

  const loadSavedLogs = useCallback(async () => {
    try {
      const data = await listSavedContainerLogs();
      setSavedLogs(data || []);
    } catch {}
  }, []);

  useEffect(() => { loadSavedLogs(); }, [loadSavedLogs]);

  function refreshAll() {
    setRefreshing(true);
    loadRunners();
    loadSavedLogs();
  }

  function handleShowSavedLogs(containerName) {
    setLogsContainerSaved(true);
    setLogsContainer(containerName);
  }

  async function handleDeleteSavedLogs(containerName) {
    await deleteSavedContainerLogs(containerName);
    setSavedLogs((prev) => prev.filter((e) => e.containerName !== containerName));
  }

  // ── Container actions ──

  function handleRequestAction(containerName, action) {
    if (action === 'start') {
      setPendingStart(containerName);
      startDockerContainer(containerName).catch(() => setPendingStart(null));
    } else {
      setStoppingContainer(containerName);
    }
  }

  function handleConfirmStop() {
    if (!stoppingContainer) return;
    setPendingStop(stoppingContainer);
    setStoppingContainer(null);
    stopDockerContainer(stoppingContainer).catch(() => setPendingStop(null));
  }

  const loading = containersLoading && runnersLoading;

  return (
    <PageLayout session={session}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Containers</h1>
      </div>

      <div className="space-y-8">
        {/* Docker Containers */}
        <DockerContainersSection
          containers={containers}
          savedLogs={savedLogs}
          loading={containersLoading}
          onRequestStop={handleRequestAction}
          onShowLogs={(name) => { setLogsContainerSaved(false); setLogsContainer(name); }}
          onShowSavedLogs={handleShowSavedLogs}
          onDeleteSavedLogs={handleDeleteSavedLogs}
          pendingStop={pendingStop}
          pendingStart={pendingStart}
        />

        {/* GitHub Runners */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">GitHub Runners</h2>
            {!runnersLoading && (
              <button
                onClick={refreshAll}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                {refreshing ? (
                  <>
                    <SpinnerIcon size={14} />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <RefreshIcon size={14} />
                    Refresh
                  </>
                )}
              </button>
            )}
          </div>
          {runnersLoading ? (
            <LoadingSkeleton />
          ) : (
            <div>
              <RunnersWorkflowList runs={runs} />
              {hasMore && (
                <div className="flex justify-center mt-4 pt-4 border-t border-border">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 min-h-[44px] text-sm font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
                  >
                    {loadingMore ? (
                      <>
                        <SpinnerIcon size={14} />
                        Loading...
                      </>
                    ) : (
                      'Show more'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Container logs dialog */}
      {logsContainer && (
        <ContainerLogsDialog
          containerName={logsContainer}
          savedMode={logsContainerSaved}
          onClose={() => { setLogsContainer(null); setLogsContainerSaved(false); }}
        />
      )}

      {/* Stop confirmation dialog */}
      <ConfirmDialog
        open={!!stoppingContainer}
        onCancel={() => setStoppingContainer(null)}
        onConfirm={handleConfirmStop}
        title={`Stop ${stoppingContainer}?`}
        description="This will stop the running container. You can restart it later."
        confirmLabel="Stop"
        variant="destructive"
      />
    </PageLayout>
  );
}
