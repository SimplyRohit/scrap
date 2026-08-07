"use client";

import { useState } from "react";
import { PRESET_MANIFESTS, PresetManifest } from "@/lib/presets";
import { Play, Upload, Code, Sparkles, Layers, Box, Cpu, CheckCircle2 } from "lucide-react";

interface ManifestInputProps {
  onAnalyze: (content: string, fileName: string) => void;
  isLoading: boolean;
}

export default function ManifestInput({ onAnalyze, isLoading }: ManifestInputProps) {
  const [selectedPreset, setSelectedPreset] = useState<PresetManifest>(PRESET_MANIFESTS[0]);
  const [content, setContent] = useState<string>(PRESET_MANIFESTS[0].content);
  const [fileName, setFileName] = useState<string>(PRESET_MANIFESTS[0].fileName);

  const handleSelectPreset = (preset: PresetManifest) => {
    setSelectedPreset(preset);
    setContent(preset.content);
    setFileName(preset.fileName);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        setContent(evt.target.result as string);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800/80 shadow-2xl relative overflow-hidden">
      
      {/* Background Accent */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Code className="w-5 h-5 text-cyan-400" />
            Dependency Manifest Input
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Upload your project manifest or select one of the 5 real-world ecosystem presets below.
          </p>
        </div>

        {/* Upload File Button */}
        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition-all shadow-sm">
          <Upload className="w-4 h-4 text-cyan-400" />
          <span>Upload File (package.json / requirements.txt)</span>
          <input
            type="file"
            accept=".json,.txt,.toml,.lock"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* Preset Selector Grid */}
      <div className="mb-6">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5 block flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span>Select Target Ecosystem Upgrade Preset</span>
        </label>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {PRESET_MANIFESTS.map((preset) => {
            const isSelected = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset)}
                className={`flex flex-col text-left p-3.5 rounded-xl border transition-all text-xs relative ${
                  isSelected
                    ? "bg-slate-900/90 border-cyan-500 shadow-lg shadow-cyan-500/10 text-white"
                    : "bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-900/50 hover:text-slate-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`px-2 py-0.5 rounded-md font-semibold text-[10px] uppercase tracking-wider ${
                    isSelected ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "bg-slate-800 text-slate-400"
                  }`}>
                    {preset.badge}
                  </span>
                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />}
                </div>

                <span className="font-bold text-slate-200 line-clamp-1 mb-1">
                  {preset.name}
                </span>

                <span className="text-[11px] text-slate-400 line-clamp-2 leading-tight">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Code Textarea Editor */}
      <div className="relative rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-800 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <Box className="w-3.5 h-3.5 text-cyan-400" />
            <span>{fileName}</span>
          </div>
          <span className="text-[11px] text-slate-400">{content.split("\n").length} lines</span>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={10}
          className="w-full bg-transparent p-4 text-xs font-mono text-slate-200 focus:outline-none focus:ring-0 leading-relaxed resize-y"
          placeholder="Paste package.json or requirements.txt content here..."
        />
      </div>

      {/* Primary Action Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Cpu className="w-4 h-4 text-amber-400" />
          <span>Scraper Studio self-healing pipeline ready for 5 ecosystems</span>
        </div>

        <button
          onClick={() => onAnalyze(content, fileName)}
          disabled={isLoading || !content.trim()}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-xl ${
            isLoading
              ? "bg-slate-800 text-slate-500 cursor-not-allowed"
              : "bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600 text-white hover:opacity-95 shadow-cyan-500/25 active:scale-95"
          }`}
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              <span>Deploying Bright Data Scrapers...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              <span>Deploy Scrapers & Calculate Blast Radius</span>
            </>
          )}
        </button>
      </div>

    </div>
  );
}
