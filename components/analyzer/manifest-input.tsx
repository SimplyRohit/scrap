"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { PRESET_MANIFESTS, type PresetManifest } from "@/lib/presets";
import { cn } from "@/lib/utils";

type ManifestInputProps = {
  onAnalyze: (content: string, fileName: string) => void;
  isLoading: boolean;
};

export function ManifestInput({ onAnalyze, isLoading }: ManifestInputProps) {
  const [selected, setSelected] = React.useState<PresetManifest>(PRESET_MANIFESTS[0]);
  const [content, setContent] = React.useState(PRESET_MANIFESTS[0].content);
  const [fileName, setFileName] = React.useState(PRESET_MANIFESTS[0].fileName);

  const pick = (preset: PresetManifest) => {
    setSelected(preset);
    setContent(preset.content);
    setFileName(preset.fileName);
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();

    reader.onload = (loaded) => {
      if (loaded.target?.result) setContent(loaded.target.result as string);
    };

    reader.readAsText(file);
  };

  const lines = content.split("\n").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 label text-muted-foreground">
          Preset
        </span>

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

      <div className="overflow-hidden border border-border bg-panel">
        <div className="flex items-center gap-3 border-b border-border bg-paper/60 px-5 py-3">
          <span className="font-mono text-[11.5px] text-foreground">{fileName}</span>
          <span className="ml-auto label text-foreground/35">
            {lines} line{lines === 1 ? "" : "s"}
          </span>
        </div>

        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          spellCheck={false}
          placeholder="Paste a package.json, requirements.txt, or pyproject.toml…"
          aria-label="Manifest contents"
          className="w-full resize-none bg-transparent px-5 py-4 font-mono text-[12.5px] leading-[1.75] text-muted-foreground outline-none placeholder:text-foreground/35"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <p className="font-mono text-[11px] text-muted-foreground">
            Sources planned by authority · index consulted before the network
          </p>

          <Button
            variant="signal"
            onClick={() => onAnalyze(content, fileName)}
            disabled={isLoading || !content.trim()}
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
