"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { formatManifest, inspectManifest, type EditorStatus } from "@/lib/manifest-editor";
import { PRESET_MANIFESTS, type PresetManifest } from "@/lib/presets";
import { cn } from "@/lib/utils";

type ManifestInputProps = {
  onAnalyze: (content: string, fileName: string) => void;
  isLoading: boolean;
};

/** Two spaces, because every manifest this accepts is written with two. */
const INDENT = "  ";

export function ManifestInput({ onAnalyze, isLoading }: ManifestInputProps) {
  const [selected, setSelected] = React.useState<PresetManifest>(PRESET_MANIFESTS[0]);
  const [content, setContent] = React.useState(PRESET_MANIFESTS[0].content);
  const [fileName, setFileName] = React.useState(PRESET_MANIFESTS[0].fileName);
  const [copied, setCopied] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  const gutterRef = React.useRef<HTMLDivElement | null>(null);

  const status = React.useMemo(() => inspectManifest(content, fileName), [content, fileName]);
  const lines = React.useMemo(() => content.split("\n"), [content]);

  React.useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 1800);

    return () => clearTimeout(timer);
  }, [copied]);

  const pick = (preset: PresetManifest) => {
    setSelected(preset);
    setContent(preset.content);
    setFileName(preset.fileName);
  };

  const read = (file: File) => {
    setFileName(file.name);

    const reader = new FileReader();

    reader.onload = (loaded) => {
      if (loaded.target?.result) setContent(loaded.target.result as string);
    };

    reader.readAsText(file);
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) read(file);
  };

  const run = () => {
    if (!isLoading && content.trim()) onAnalyze(content, fileName);
  };

  /**
   * Tab indents rather than leaving the field.
   *
   * Trapping Tab in a text input is normally an accessibility mistake — it is
   * the key people use to get out. Escape then Tab still moves on, which is the
   * escape hatch the pattern requires.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      run();

      return;
    }

    if (event.key !== "Tab" || event.shiftKey) return;

    event.preventDefault();

    const field = event.currentTarget;
    const { selectionStart, selectionEnd } = field;

    setContent(`${content.slice(0, selectionStart)}${INDENT}${content.slice(selectionEnd)}`);

    // Restore the caret after React re-renders with the new value.
    requestAnimationFrame(() => {
      field.selectionStart = selectionStart + INDENT.length;
      field.selectionEnd = selectionStart + INDENT.length;
    });
  };

  const canFormat = status.kind === "valid" && formatManifest(content) !== content;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 label text-muted-foreground">Preset</span>

        {PRESET_MANIFESTS.map((preset) => {
          const active = selected.id === preset.id;

          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => pick(preset)}
              aria-pressed={active}
              title={preset.description}
              className={cn(
                "border px-2.5 py-1 text-[12.5px] transition-colors duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
                active
                  ? "border-foreground bg-panel text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/25 hover:bg-panel hover:text-muted-foreground",
              )}
            >
              {preset.badge}
            </button>
          );
        })}

        <label className="group/upload ml-auto inline-flex cursor-pointer items-center gap-2 border border-border px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors duration-250 hover:border-foreground/25 hover:bg-panel hover:text-muted-foreground">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="size-3 transition-transform duration-300 group-hover/upload:-translate-y-px"
          >
            <path d="M8 11V3M5 6l3-3 3 3M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" />
          </svg>
          Upload
          <input
            type="file"
            accept=".json,.txt,.toml,.lock"
            onChange={handleUpload}
            className="hidden"
          />
        </label>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);

          const file = event.dataTransfer.files?.[0];

          if (file) read(file);
        }}
        className={cn(
          "overflow-hidden border bg-panel transition-colors duration-200",
          dragging ? "border-mark" : "border-border",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-paper/60 px-5 py-2.5">
          <span className="font-mono text-[11.5px] text-foreground">{fileName}</span>

          <StatusMark status={status} />

          <div className="ml-auto flex items-center gap-1">
            <Action onClick={() => setContent(formatManifest(content))} disabled={!canFormat}>
              Format
            </Action>

            <Action
              onClick={() => {
                void navigator.clipboard.writeText(content);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Action>

            <Action
              onClick={() => pick(selected)}
              disabled={content === selected.content && fileName === selected.fileName}
            >
              Reset
            </Action>
          </div>
        </div>

        <div className="relative flex max-h-[22rem] overflow-hidden">
          {/* Line numbers, scrolled in step with the field beside them. Reading a
              parser error that names a line is the only reason they are here. */}
          <div
            ref={gutterRef}
            aria-hidden
            className="scroll-slim shrink-0 select-none overflow-hidden border-r border-border bg-paper/40 py-4 pl-4 pr-3 text-right font-mono text-[12.5px] leading-[1.75] text-foreground/25"
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={(event) => {
              if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            rows={12}
            spellCheck={false}
            wrap="off"
            placeholder="Paste a package.json, requirements.txt, or pyproject.toml…"
            aria-label="Manifest contents"
            aria-invalid={status.kind === "invalid"}
            className="scroll-slim w-full resize-none whitespace-pre bg-transparent px-4 py-4 font-mono text-[12.5px] leading-[1.75] text-muted-foreground outline-none placeholder:text-foreground/35"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <p className="font-mono text-[11px] text-muted-foreground">
            Sources planned by authority · index consulted before the network
          </p>

          <div className="flex items-center gap-3">
            <kbd className="label hidden border border-border px-1.5 py-1 text-foreground/35 sm:inline-block">
              ⌘ ↵
            </kbd>

            <Button
              variant="signal"
              onClick={run}
              disabled={isLoading || !content.trim() || status.kind === "invalid"}
            >
              {isLoading ? (
                <>
                  <Spinner />
                  Researching…
                </>
              ) : (
                <>
                  Calculate blast radius
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0.5"
                  >
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What the parser makes of what is currently in the field. */
function StatusMark({ status }: { status: EditorStatus }) {
  if (status.kind === "empty") return null;

  if (status.kind === "invalid") {
    return (
      <span className="label flex items-center gap-1.5 text-critical">
        <i aria-hidden className="size-1.5 bg-critical" />
        {status.message}
      </span>
    );
  }

  return (
    <span className="label flex items-center gap-1.5 text-muted-foreground">
      <i aria-hidden className="size-1.5 bg-mark" />
      {status.ecosystem} · {status.packages} package{status.packages === 1 ? "" : "s"}
    </span>
  );
}

function Action({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="label border border-transparent px-2 py-1 text-muted-foreground transition-colors duration-200 hover:border-border hover:bg-panel hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn("size-4 animate-spin", className)}
    >
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path
        d="M14.2 8A6.2 6.2 0 0 0 8 1.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
