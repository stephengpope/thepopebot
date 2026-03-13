"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  SendIcon,
  StopIcon,
  PaperclipIcon,
  XIcon,
  FileTextIcon,
  MicIcon,
} from "./icons.js";
import { useVoiceInput } from "../../voice/use-voice-input.js";
import { getVoiceToken } from "../../voice/actions.js";
import { VoiceBars } from "./voice-bars.jsx";
import { cn } from "../utils.js";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/x-python",
  "text/x-typescript",
  "application/json",
];

const MAX_FILES = 5;

function isAcceptedType(file) {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  // Fall back to extension for files with generic MIME types
  const ext = file.name?.split(".").pop()?.toLowerCase();
  const textExts = [
    "txt",
    "md",
    "csv",
    "json",
    "js",
    "ts",
    "jsx",
    "tsx",
    "py",
    "html",
    "css",
    "yml",
    "yaml",
    "xml",
    "sh",
    "bash",
    "rb",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
  ];
  return textExts.includes(ext);
}

function getEffectiveType(file) {
  if (ACCEPTED_TYPES.includes(file.type) && file.type !== "") return file.type;
  const ext = file.name?.split(".").pop()?.toLowerCase();
  const extMap = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    js: "text/javascript",
    ts: "text/x-typescript",
    jsx: "text/javascript",
    tsx: "text/x-typescript",
    py: "text/x-python",
    html: "text/html",
    css: "text/css",
    yml: "text/plain",
    yaml: "text/plain",
    xml: "text/plain",
    sh: "text/plain",
    bash: "text/plain",
    rb: "text/plain",
    go: "text/plain",
    rs: "text/plain",
    java: "text/plain",
    c: "text/plain",
    cpp: "text/plain",
    h: "text/plain",
    hpp: "text/plain",
  };
  return extMap[ext] || file.type || "text/plain";
}

export function ChatInput({
  input,
  setInput,
  onSubmit,
  status,
  stop,
  files,
  setFiles,
  disabled = false,
  placeholder = "Send a message...",
  canSendOverride,
  bare = false,
  className,
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const isStreaming = status === "streaming" || status === "submitted";
  const volumeRef = useRef(0);

  const {
    voiceAvailable,
    isConnecting,
    isRecording,
    startRecording,
    stopRecording,
  } = useVoiceInput({
    getToken: getVoiceToken,
    onVolumeChange: (rms) => {
      volumeRef.current = rms;
    },
    onTranscript: (text) => {
      setInput((prev) => {
        const needsSpace = prev && !prev.endsWith(" ");
        return prev + (needsSpace ? " " : "") + text;
      });
    },
    onError: (err) => console.error("[voice]", err),
  });

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  // Focus textarea on mount and after streaming completes
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isStreaming && !disabled) {
      // Delay to ensure focus isn't stolen by scrollIntoView or re-renders
      const timer = setTimeout(() => textareaRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, disabled]);

  const handleFiles = useCallback(
    (fileList) => {
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
    },
    [setFiles],
  );

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (disabled || (!input.trim() && files.length === 0) || isStreaming)
      return;
    if (canSendOverride !== undefined && !canSendOverride) return;
    onSubmit();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

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

  const canSend =
    canSendOverride !== undefined
      ? canSendOverride && (input.trim() || files.length > 0)
      : input.trim() || files.length > 0;

  // Disabled state — show locked message
  if (disabled && !isStreaming) {
    const disabledContent = (
      <div
        className={cn(
          "flex flex-col rounded-xl border border-border bg-muted p-2",
          className,
        )}
      >
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
          "flex flex-col rounded-xl border bg-muted p-2 transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border",
          className,
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* File preview strip */}
        {files.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto px-1 py-1">
            {files.map((f, i) => {
              const isImage = f.file.type.startsWith("image/");
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          autoFocus
          className={cn(
            "w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground",
            "placeholder:text-muted-foreground focus:outline-none",
            "max-h-[200px]",
          )}
          disabled={isStreaming}
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

            {voiceAvailable && (
              <VoiceBars volumeRef={volumeRef} isRecording={isRecording} />
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,application/json,.md,.csv,.json,.js,.ts,.jsx,.tsx,.py,.html,.css,.yml,.yaml,.xml,.sh,.rb,.go,.rs,.java,.c,.cpp,.h"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex items-center gap-1">
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
                  "inline-flex items-center justify-center rounded-lg p-2.5",
                  canSend
                    ? "bg-foreground text-background hover:opacity-80"
                    : "bg-muted-foreground/20 text-muted-foreground cursor-not-allowed",
                )}
                aria-label="Send message"
              >
                <SendIcon size={16} />
              </button>
            )}
            {voiceAvailable && !isStreaming && (
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isConnecting}
                className={cn(
                  "inline-flex items-center justify-center rounded-lg p-2.5",
                  isConnecting
                    ? "bg-muted-foreground/20 text-muted-foreground cursor-wait animate-pulse"
                    : isRecording
                      ? "bg-red-500 text-white hover:opacity-80"
                      : "bg-foreground text-background hover:opacity-80",
                )}
                aria-label={
                  isConnecting
                    ? "Connecting..."
                    : isRecording
                      ? "Stop recording"
                      : "Start voice input"
                }
              >
                <MicIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );

  if (bare) return formContent;
  return (
    <div className="mx-auto w-full max-w-4xl px-1.5 pb-[max(1rem,var(--safe-area-bottom))] md:px-6">
      {formContent}
    </div>
  );
}
