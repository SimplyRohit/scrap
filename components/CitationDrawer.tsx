"use client";

import { DependencyRiskReport } from "@/lib/types";
import { X, ExternalLink, ShieldAlert, Sparkles, FileText, Code2, ArrowRight, CheckCircle2, Quote } from "lucide-react";

interface CitationDrawerProps {
  report: DependencyRiskReport | null;
  onClose: () => void;
}

export default function CitationDrawer({ report, onClose }: CitationDrawerProps) {
  if (!report) return null;

  const { dependency, breakingChanges, scrapedReleases, collectorStatus } = report;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex justify-end transition-opacity animate-in fade-in">
      <div className="w-full max-w-2xl bg-slate-950 border-l border-slate-800 h-full overflow-y-auto p-6 md:p-8 flex flex-col justify-between shadow-2xl relative">
        
        <div>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 pb-6 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                  {dependency.ecosystem}
                </span>
                <h2 className="text-xl font-bold text-white">
                  {dependency.name}
                </h2>
              </div>

              <div className="flex items-center gap-2 mt-2 text-xs font-mono text-slate-400">
                <span>Current: v{dependency.currentVersion}</span>
                <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-cyan-300 font-bold">Target: v{dependency.targetVersion}</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Collector & Source Citation Info */}
          <div className="my-6 p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Bright Data Collector ID:
              </span>
              <span className="font-mono text-cyan-300 font-bold">{collectorStatus.collectorId}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Target Scraped URL:</span>
              <a
                href={collectorStatus.scrapedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
              >
                <span>{collectorStatus.scrapedUrl}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {collectorStatus.status === "healed" && (
              <div className="mt-2 text-[11px] text-amber-300 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                ⚡ <strong>Self-Healed:</strong> Collector schema automatically updated fields to adapt to target page redesign.
              </div>
            )}
          </div>

          {/* Breaking Changes List */}
          <div className="space-y-6">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Extracted Breaking Changes ({breakingChanges.length})</span>
            </h3>

            {breakingChanges.length === 0 ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>No breaking API modifications detected in scraped documentation.</span>
              </div>
            ) : (
              breakingChanges.map((item, idx) => (
                <div key={item.id} className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                  
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold font-mono">
                        {idx + 1}
                      </span>
                      <h4 className="text-sm font-bold text-white">
                        {item.title}
                      </h4>
                    </div>

                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      item.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                      {item.severity}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {item.description}
                  </p>

                  {/* Code Migration Snippets */}
                  {(item.beforeSnippet || item.afterSnippet) && (
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                        <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                        Code Transformation Migration:
                      </span>
                      
                      <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                        {item.beforeSnippet && (
                          <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/20 text-rose-200">
                            <span className="text-[10px] text-rose-400 block mb-1 font-sans font-bold">BEFORE (v{dependency.currentVersion})</span>
                            <pre className="whitespace-pre-wrap">{item.beforeSnippet}</pre>
                          </div>
                        )}
                        {item.afterSnippet && (
                          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/20 text-emerald-200">
                            <span className="text-[10px] text-emerald-400 block mb-1 font-sans font-bold">AFTER (v{dependency.targetVersion})</span>
                            <pre className="whitespace-pre-wrap">{item.afterSnippet}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Direct Citation Box */}
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-semibold text-cyan-400 flex items-center gap-1 text-[11px]">
                        <Quote className="w-3 h-3 text-cyan-400" />
                        Direct Scraped Citation:
                      </span>
                      <a
                        href={item.citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 font-mono"
                      >
                        <span>{item.citation.title}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-[11px] text-slate-300 italic bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      "{item.citation.quotedText}"
                    </p>
                  </div>

                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-6 border-t border-slate-800 mt-8 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors"
          >
            Close Drawer
          </button>
        </div>

      </div>
    </div>
  );
}
