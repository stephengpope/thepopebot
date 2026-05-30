'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { SendIcon, StopIcon, PaperclipIcon, XIcon, FileTextIcon, MicIcon, KeyIcon } from './icons.js';
import { useVoiceInput } from '../../voice/use-voice-input.js';
const getVoiceTokenFetch = () =>
  fetch('/chat/voice-token').then(r => r.json()).catch(() => ({ error: 'Failed to get voice token' }));
import { VoiceBars } from './voice-bars.jsx';
import { Dialog } from './settings-shared.js';
import { JobSecretsManager } from './settings-jobs-page.js';
import { cn } from '../utils.js';

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css',
  'text/javascript', 'text/x-python', 'text/x-typescript',
  'application/json',
];

const MAX_FILES = 5;

function isAcceptedType(file) {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  // Fall back to extension for files with generic MIME types
  const ext = file.name?.split('.').pop()?.toLowerCase();
  const textExts = ['txt', 'md', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'yml', 'yaml', 'xml', 'sh', 'bash', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp'];
  return textExts.includes(ext);
}

function getEffectiveType(file) {
  if (ACCEPTED_TYPES.includes(file.type) && file.type !== '') return file.type;
  const ext = file.name?.split('.').pop()?.toLowerCase();
  const extMap = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    json: 'application/json', js: 'text/javascript', ts: 'text/x-typescript',
    jsx: 'text/javascript', tsx: 'text/x-typescript', py: 'text/x-python',
    html: 'text/html', css: 'text/css', yml: 'text/plain', yaml: 'text/plain',
    xml: 'text/plain', sh: 'text/plain', bash: 'text/plain', rb: 'text/plain',
    go: 'text/plain', rs: 'text/plain', java: 'text/plain', c: 'text/plain',
    cpp: 'text/plain', h: 'text/plain', hpp: 'text/plain',
  };
  return extMap[ext] || file.type || 'text/plain';
}

export function ChatInput({ input, setInput, onSubmit, status, stop, files, setFiles, disabled = false, placeholder = 'Send a message...', canSendOverride, bare = false, className, codeMode = false, codeModeSettings }) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [partialText, setPartialText] = useState('');
  const [secretsOpen, setSecretsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const agentPickerRef = useRef(null);
  const isStreaming = status === 'streaming' || status === 'submitted';
  const volumeRef = useRef(0);

  const { voiceAvailable, isConnecting, isRecording, startRecording, stopRecording } = useVoiceInput({
    getToken: getVoiceTokenFetch,
    onVolumeChange: (rms) => { volumeRef.current = rms; },
    onTranscript: (text) => {
      setInput((prev) => {
        const needsSpace = prev && !prev.endsWith(' ');
        return prev + (needsSpace ? ' ' : '') + text;
      });
    },
    onPartialTranscript: (text) => setPartialText(text),
    onError: (err) => console.error('[voice]', err),
  });

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.scrollTop = textarea.scrollHeight;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Refocus textarea when streaming ends so the user can immediately type the next message
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      textareaRef.current?.focus();
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!modeDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modeDropdownOpen]);

  // Close agent picker on outside click or Escape
  useEffect(() => {
    if (!agentPickerOpen) return;
    const handleClickOutside = (e) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target)) {
        setAgentPickerOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setAgentPickerOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [agentPickerOpen]);

  const handleFiles = useCallback((fileList) => {
    const newFiles = Array.from(fileList).filter(isAcceptedType);
    if (newFiles.length === 0) return;

    // Read files outside state updater to avoid React strict mode double-invocation
    newFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setFiles((current) => {
          if (current.length >= MAX_FILES) return current;
          return [...current, { file, previewUrl: reader.result }];
        });
      };
      reader.readAsDataURL(file);
    });
  }, [setFiles]);

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (disabled || (!input.trim() && !partialText.trim() && files.length === 0) || isStreaming) return;
    if (canSendOverride !== undefined && !canSendOverride) return;
    if (isRecording) stopRecording();
    if (partialText) {
      const needsSpace = input && !input.endsWith(' ');
      setInput(input + (needsSpace ? ' ' : '') + partialText);
    }
    setPartialText('');
    onSubmit();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = useCallback((e) => {
    if (!e.clipboardData?.items) return;
    const imageItems = Array.from(e.clipboardData.items).filter(
      (item) => item.type.startsWith('image/')
    );
    if (imageItems.length === 0) return;
    e.preventDefault();
    const imageFiles = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    if (imageFiles.length > 0) {
      handleFiles(imageFiles);
    }
  }, [handleFiles]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const canSend = canSendOverride !== undefined
    ? canSendOverride && (input.trim() || files.length > 0)
    : (input.trim() || files.length > 0);

  // Disabled state — show locked message
  if (disabled && !isStreaming) {
    const disabledContent = (
      <div className={cn("flex flex-col rounded-xl border border-border bg-muted p-2", className)}>
        <div className="flex items-center px-2 py-1.5">
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        </div>
      </div>
    );
    if (bare) return disabledContent;
    return (
      <div className="mx-auto w-full max-w-4xl px-1.5 pb-[max(1rem,var(--safe-area-bottom))] md:px-6">
        {disabledContent}
      </div>
    );
  }

  const formContent = (
    <form onSubmit={handleSubmit} className="relative">
      <div
          className={cn(
            'flex flex-col rounded-xl border bg-muted p-2 transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-border',
            className
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* File preview strip */}
          {files.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto px-1 py-1">
              {files.map((f, i) => {
                const isImage = f.file.type.startsWith('image/');
                return (
                  <div key={i} className="group relative flex-shrink-0">
                    {isImage ? (
                      <img
                        src={f.previewUrl}
                        alt={f.file.name}
                        className="h-16 w-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-16 items-center gap-1.5 rounded-lg bg-foreground/10 px-3">
                        <FileTextIcon size={14} />
                        <span className="max-w-[100px] truncate text-xs">
                          {f.file.name}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-foreground p-0.5 text-background group-hover:flex items-center justify-center"
                      aria-label={`Remove ${f.file.name}`}
                    >
                      <XIcon size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input + (partialText ? (input && !input.endsWith(' ') ? ' ' : '') + partialText : '')}
            onChange={(e) => { setInput(e.target.value); setPartialText(''); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground',
              'placeholder:text-muted-foreground focus:outline-none',
              'min-h-[84px] md:min-h-0 max-h-[40vh] md:max-h-[200px]'
            )}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center rounded-lg p-2.5 text-muted-foreground hover:text-foreground"
                aria-label="Attach files"
                disabled={isStreaming}
              >
                <PaperclipIcon size={16} />
              </button>

              {!codeMode && (
                <button
                  type="button"
                  onClick={() => setSecretsOpen(true)}
                  className="inline-flex items-center justify-center rounded-lg p-2.5 text-muted-foreground hover:text-foreground"
                  aria-label="Manage agent job secrets"
                  title="Manage agent job secrets"
                  disabled={isStreaming}
                >
                  <KeyIcon size={16} />
                </button>
              )}

              {/* Plan/Code dropdown */}
              {codeModeSettings && (
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setModeDropdownOpen(prev => !prev)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                      codeModeSettings.mode === 'code'
                        ? 'bg-green-500/15 text-green-500 hover:bg-green-500/25'
                        : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    )}
                  >
                    {codeModeSettings.mode === 'code' ? 'Code' : 'Plan'} &#9662;
                  </button>
                  {modeDropdownOpen && (
                    <div className="absolute bottom-full left-0 mb-1 rounded-lg border border-border bg-background shadow-lg py-1 min-w-[100px] z-50">
                      <button
                        type="button"
                        onClick={() => { codeModeSettings.onModeChange('plan'); setModeDropdownOpen(false); }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                          codeModeSettings.mode === 'plan' ? 'text-destructive font-medium' : 'text-foreground'
                        )}
                      >
                        Plan
                      </button>
                      <button
                        type="button"
                        onClick={() => { codeModeSettings.onModeChange('code'); setModeDropdownOpen(false); }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                          codeModeSettings.mode === 'code' ? 'text-green-500 font-medium' : 'text-foreground'
                        )}
                      >
                        Code
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Interactive toggle — left-click to launch with default agent,
                  right-click to pick a specific agent (when multiple are available) */}
              {codeModeSettings && !codeModeSettings.isInteractiveActive && (
                <div className="relative" ref={agentPickerRef}>
                  {/* Agent picker popup — appears above the toggle on right-click */}
                  {agentPickerOpen && codeModeSettings.availableAgents?.length > 1 && (
                    <div className="absolute bottom-full left-0 mb-1.5 z-50 min-w-[140px] rounded-md border border-border bg-background shadow-md py-1 overflow-hidden">
                      <p className="px-3 pt-0.5 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Launch with</p>
                      {codeModeSettings.availableAgents.map(agent => (
                        <button
                          key={agent.value}
                          type="button"
                          onClick={() => {
                            setAgentPickerOpen(false);
                            codeModeSettings.onInteractiveToggle(agent.value);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                        >
                          {agent.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => codeModeSettings.onInteractiveToggle()}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!codeModeSettings.togglingMode && codeModeSettings.availableAgents?.length > 1 && codeModeSettings.hasMessages) {
                        setAgentPickerOpen(prev => !prev);
                      }
                    }}
                    disabled={codeModeSettings.togglingMode || codeModeSettings.isInteractiveActive}
                    title={codeModeSettings.availableAgents?.length > 1 && codeModeSettings.hasMessages ? 'Left-click to launch · Right-click to pick agent' : undefined}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {codeModeSettings.togglingMode && (
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    <span
                      className={cn(
                        'relative inline-flex h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200',
                        codeModeSettings.isInteractiveActive ? 'bg-primary' : 'bg-muted-foreground/30'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform duration-200',
                          codeModeSettings.isInteractiveActive && 'translate-x-2.5'
                        )}
                      />
                    </span>
                    {codeModeSettings.togglingMode ? 'Launching...' : 'Interactive'}
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,text/*,application/json,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.html,.css,.yml,.yaml,.xml,.sh,.rb,.go,.rs,.java,.c,.cpp,.h"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>

            <div className="flex items-center gap-1">
              {voiceAvailable && !isStreaming && (
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isConnecting}
                  className={cn(
                    'inline-flex items-center justify-center rounded-lg p-2.5',
                    isConnecting
                      ? 'bg-muted-foreground/20 text-muted-foreground cursor-wait animate-pulse'
                      : isRecording
                        ? 'bg-destructive text-white hover:opacity-80'
                        : 'bg-background text-foreground border border-border hover:bg-muted'
                  )}
                  aria-label={isConnecting ? 'Connecting...' : isRecording ? 'Stop recording' : 'Start voice input'}
                >
                  {isRecording ? <VoiceBars volumeRef={volumeRef} isRecording={isRecording} /> : <MicIcon size={16} />}
                </button>
              )}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center justify-center rounded-lg bg-foreground p-2.5 text-background hover:opacity-80"
                  aria-label="Stop generating"
                >
                  <StopIcon size={16} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  className={cn(
                    'inline-flex items-center justify-center rounded-lg p-2.5',
                    canSend
                      ? 'bg-foreground text-background hover:opacity-80'
                      : 'bg-muted-foreground/20 text-muted-foreground cursor-not-allowed'
                  )}
                  aria-label="Send message"
                >
                  <SendIcon size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
    </form>
  );

  const secretsDialog = !codeMode ? (
    <Dialog
      open={secretsOpen}
      onClose={() => setSecretsOpen(false)}
      title="Agent Job Secrets"
      maxWidth="max-w-2xl"
    >
      <JobSecretsManager showHeader={false} />
    </Dialog>
  ) : null;

  if (bare) return <>{formContent}{secretsDialog}</>;
  return (
    <div className="mx-auto w-full max-w-4xl px-1.5 pb-[max(1rem,var(--safe-area-bottom))] md:px-6">
      {formContent}
      {secretsDialog}
    </div>
  );
}
