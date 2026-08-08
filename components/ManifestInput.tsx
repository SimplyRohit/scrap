"use client";

import { useState } from "react";
import { PRESET_MANIFESTS, PresetManifest } from "@/lib/presets";
import { Play, Upload, Loader2 } from "lucide-react";

interface ManifestInputProps {
  onAnalyze: (content: string, fileName: string) => void;
  isLoading: boolean;
}

export default function ManifestInput({ onAnalyze, isLoading }: ManifestInputProps) {
  const [selected, setSelected] = useState<PresetManifest>(PRESET_MANIFESTS[0]);
  const [content, setContent]   = useState<string>(PRESET_MANIFESTS[0].content);
  const [fileName, setFileName] = useState<string>(PRESET_MANIFESTS[0].fileName);

  const handleSelectPreset = (preset: PresetManifest) => {
    setSelected(preset);
    setContent(preset.content);
    setFileName(preset.fileName);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) setContent(evt.target.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Ecosystem preset pills row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-lo)",
            marginRight: 4,
          }}
        >
          Preset
        </span>
        {PRESET_MANIFESTS.map((preset) => {
          const active = selected.id === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => handleSelectPreset(preset)}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                background: active ? "var(--cyan-dim)" : "transparent",
                color: active ? "var(--cyan)" : "var(--text-mid)",
                border: active ? "1px solid rgba(34,211,238,0.25)" : "1px solid var(--border)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {preset.name}
            </button>
          );
        })}

        {/* Upload */}
        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 12,
            color: "var(--text-mid)",
            border: "1px solid var(--border)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-hi)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-hi)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-mid)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
          }}
        >
          <Upload size={11} />
          Upload
          <input
            type="file"
            accept=".json,.txt,.toml,.lock"
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {/* Code editor card */}
      <div
        className="card"
        style={{ overflow: "hidden" }}
      >
        {/* Editor header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Traffic lights */}
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.7 }} />
            ))}
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--text-lo)",
                marginLeft: 6,
              }}
            >
              {fileName}
            </span>
          </div>
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10,
              color: "var(--text-lo)",
            }}
          >
            {content.split("\n").length} lines
          </span>
        </div>

        {/* Textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className="code-textarea"
          placeholder="Paste package.json or requirements.txt here..."
        />

        {/* Footer with CTA */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-lo)" }}>
            Bright Data Scraper Studio · {PRESET_MANIFESTS.length} ecosystems
          </span>

          <button
            onClick={() => onAnalyze(content, fileName)}
            disabled={isLoading || !content.trim()}
            className="btn-primary"
          >
            {isLoading ? (
              <>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                <span>Analyzing…</span>
              </>
            ) : (
              <>
                <Play size={14} style={{ fill: "#080808" }} />
                <span>Calculate Blast Radius</span>
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  );
}
