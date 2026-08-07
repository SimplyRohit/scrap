"use client";

import { FullBlastRadiusAnalysis } from "@/lib/types";
import { Terminal, Sparkles, CheckCircle2, Shield, RefreshCw, Cpu, ExternalLink, Activity } from "lucide-react";

interface ScraperStudioMonitorProps {
  analysis: FullBlastRadiusAnalysis | null;
}

export default function ScraperStudioMonitor({ analysis }: ScraperStudioMonitorProps) {
  if (!analysis) {
    return (
      <div className="glass-panel rounded-2xl p-12 text-center border border-slate-800">
        <Terminal className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
        <h3 className="text-lg font-bold text-white mb-1">Scraper Control Room Inactive</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Run an analysis from the Blast Dashboard to launch Bright Data Scraper Studio collectors and observe self-healing events in real time.
        </p>
      </div>
    );
  }

  const { reports, selfHealingSummary } = analysis;

  return (
    <div className="space-y-6">
      
      {/* Top Monitor Header */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Bright Data Scraper Studio Control Room
              </h2>
              <p className="text-xs text-slate-400">
                Live deployment status, collector schema envelopes, and self-healing layout adaptation stream.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-mono">Collectors Deployed</span>
            <span className="text-base font-bold text-white">{selfHealingSummary.totalScrapersDeployed}</span>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 px-4 py-2 rounded-xl text-xs">
            <span className="text-amber-400 block text-[10px] uppercase font-mono">Self-Healed</span>
            <span className="text-base font-bold text-amber-300">{selfHealingSummary.healedScraperCount} Schema Heals</span>
          </div>
        </div>
      </div>

      {/* Self-Healing Architecture Explanation Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-blue-500/20 bg-blue-950/20 relative overflow-hidden">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 space-y-1">
            <h4 className="font-bold text-white flex items-center gap-2">
              Why Self-Healing Scraping is Crucial for Changelogs
            </h4>
            <p className="text-slate-300 leading-relaxed">
              Developer documentation sites (GitHub Releases, Docusaurus, MkDocs, Sphinx, custom blogs) change HTML class names and layout structures constantly. Standard static scrapers break quietly. 
              <strong> Bright Data Scraper Studio</strong> detects selector failures, generates a new schema envelope, and heals the collector in place — ensuring continuous breaking change monitoring without manual maintenance.
            </p>
          </div>
        </div>
      </div>

      {/* Scraper Collector Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {reports.map((report) => {
          const { dependency, collectorStatus, scrapedReleases } = report;
          const release = scrapedReleases[0];

          return (
            <div
              key={dependency.name}
              className="glass-panel rounded-2xl p-5 border border-slate-800/90 space-y-4 font-mono text-xs"
            >
              
              {/* Collector Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2 font-sans">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-white text-sm">{dependency.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                    {dependency.ecosystem}
                  </span>
                </div>

                {collectorStatus.status === "healed" ? (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold font-sans bg-amber-500/10 text-amber-300 border border-amber-500/30">
                    <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                    SELF-HEALED
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold font-sans bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    HEALTHY
                  </span>
                )}
              </div>

              {/* Collector Details */}
              <div className="space-y-1.5 text-slate-300">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Collector ID:</span>
                  <span className="text-cyan-300 font-bold">{collectorStatus.collectorId}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Target Doc URL:</span>
                  <a
                    href={collectorStatus.scrapedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-cyan-400 flex items-center gap-1 text-[11px] truncate max-w-[240px]"
                  >
                    <span>{collectorStatus.scrapedUrl}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Extracted Fields:</span>
                  <span className="text-emerald-400 font-bold">{collectorStatus.fieldsExtracted} fields</span>
                </div>
              </div>

              {/* Self-Healing Envelope Details (If Healed) */}
              {release?.healEnvelope && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2 font-sans">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-amber-400 flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-amber-400" />
                      Self-Heal Approval Envelope
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">STATUS: DONE</span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed font-mono bg-slate-900/80 p-2 rounded border border-slate-800">
                    "{release.healEnvelope.reason}"
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1">
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block mb-1">ORIGINAL SCHEMA</span>
                      <span className="text-slate-300">{release.healEnvelope.originalSchema.join(", ")}</span>
                    </div>
                    <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/30">
                      <span className="text-cyan-300 block mb-1">HEALED EXPANDED SCHEMA</span>
                      <span className="text-cyan-200">{release.healEnvelope.healedSchema.slice(3).join(", ")}</span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          );
        })}
      </div>

    </div>
  );
}
