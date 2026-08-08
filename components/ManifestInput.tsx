"use client";

import { useState } from "react";
import { PRESET_MANIFESTS, PresetManifest } from "@/lib/presets";
import { Loader2, Play, Upload } from "lucide-react";

interface ManifestInputProps {
  onAnalyze: (content: string, fileName: string) => void;
  isLoading: boolean;
}

export default function ManifestInput({ onAnalyze, isLoading }: ManifestInputProps) {
  const [selected, setSelected] = useState<PresetManifest>(PRESET_MANIFESTS[0]);
  const [content, setContent]   = useState(PRESET_MANIFESTS[0].content);
  const [fileName, setFileName] = useState(PRESET_MANIFESTS[0].fileName);

  const pick = (p: PresetManifest) => { setSelected(p); setContent(p.content); setFileName(p.fileName); };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const r = new FileReader();
    r.onload = (ev) => { if (ev.target?.result) setContent(ev.target.result as string); };
    r.readAsText(f);
  };

  return (
    <div className="anim-up" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Preset row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span className="text-label" style={{ marginRight: 4 }}>Preset</span>
        {PRESET_MANIFESTS.map(p => (
          <button
            key={p.id}
            onClick={() => pick(p)}
            style={{
              padding: "4px 12px",
              borderRadius: "var(--r-sm)",
              fontSize: 12,
              fontWeight: selected.id === p.id ? 500 : 400,
              background: selected.id === p.id ? "var(--surface-bd)" : "transparent",
              color: selected.id === p.id ? "var(--t1)" : "var(--t3)",
              border: selected.id === p.id ? "1px solid var(--bd-hi)" : "1px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 140ms",
            }}
          >
            {p.name}
          </button>
        ))}

        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 12px",
            borderRadius: "var(--r-sm)",
            fontSize: 12,
            color: "var(--t3)",
            border: "1px solid var(--bd)",
            cursor: "pointer",
            transition: "all 140ms",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
        >
          <Upload size={10} />
          Upload
          <input type="file" accept=".json,.txt,.toml,.lock" onChange={handleUpload} style={{ display: "none" }} />
        </label>
      </div>

      {/* Editor */}
      <div className="surface" style={{ overflow: "hidden" }}>

        {/* Title bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 14px",
          borderBottom: "1px solid var(--bd)",
        }}>
          {/* Traffic lights */}
          {["#ff5f57", "#febc2e", "#28c840"].map(c => (
            <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.6 }} />
          ))}
          <span className="text-caption" style={{ marginLeft: 8 }}>{fileName}</span>
          <span className="text-caption" style={{ marginLeft: "auto" }}>{content.split("\n").length} lines</span>
        </div>

        {/* Code area */}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={10}
          className="code-area"
          placeholder="Paste package.json or requirements.txt…"
          spellCheck={false}
        />

        {/* Footer */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderTop: "1px solid var(--bd)",
        }}>
          <span className="text-caption">
            Bright Data Scraper Studio · {PRESET_MANIFESTS.length} ecosystems
          </span>
          <button
            className="btn btn-primary"
            onClick={() => onAnalyze(content, fileName)}
            disabled={isLoading || !content.trim()}
          >
            {isLoading
              ? <><Loader2 size={13} className="anim-spin" />Analyzing…</>
              : <><Play size={12} style={{ fill: "#0a0a0a" }} />Calculate Blast Radius</>
            }
          </button>
        </div>
      </div>

    </div>
  );
}
