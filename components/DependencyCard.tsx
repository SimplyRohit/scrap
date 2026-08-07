"use client";

import { DependencyRiskReport } from "@/lib/types";
import { AlertTriangle, ArrowRight, CheckCircle, ExternalLink, ShieldAlert, Sparkles, FileText, ChevronRight } from "lucide-react";

interface DependencyCardProps {
  report: DependencyRiskReport;
  onOpenCitation: (report: DependencyRiskReport) => void;
}

export default function DependencyCard({ report, onOpenCitation }: DependencyCardProps) {
  const { dependency, overallRiskScore, riskLevel, breakingChanges, collectorStatus } = report;

  const getRiskBadge = () => {
    switch (riskLevel) {
      case "CRITICAL":
        return { bg: "bg-rose-500/10 text-rose-400 border-rose-500/30", icon: ShieldAlert, label: "Critical Risk" };
      case "HIGH":
        return { bg: "bg-amber-500/10 text-amber-400 border-amber-500/30", icon: AlertTriangle, label: "High Risk" };
      case "MEDIUM":
        return { bg: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", icon: AlertTriangle, label: "Medium Risk" };
      case "LOW":
        return { bg: "bg-blue-500/10 text-blue-400 border-blue-500/30", icon: AlertTriangle, label: "Low Risk" };
      default:
        return { bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle, label: "Safe Upgrade" };
    }
  };

  const badge = getRiskBadge();
  const BadgeIcon = badge.icon;

  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-5 border border-slate-800/90 flex flex-col justify-between relative overflow-hidden group">
      
      {/* Risk Gauge Bar */}
      <div 
        className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r"
        style={{
          backgroundImage: overallRiskScore >= 80 
            ? "linear-gradient(to right, #f43f5e, #e11d48)" 
            : overallRiskScore >= 60 
            ? "linear-gradient(to right, #f59e0b, #d97706)"
            : overallRiskScore >= 40
            ? "linear-gradient(to right, #eab308, #ca8a04)"
            : "linear-gradient(to right, #10b981, #059669)"
        }}
      />

      <div>
        {/* Card Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white group-hover:text-cyan-400 transition-colors">
                {dependency.name}
              </h3>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                {dependency.ecosystem}
              </span>
            </div>

            {/* Version Upgrade Banner */}
            <div className="flex items-center gap-2 mt-1 text-xs font-mono text-slate-400">
              <span className="bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
                v{dependency.currentVersion}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30 font-bold text-cyan-300">
                v{dependency.targetVersion}
              </span>
            </div>
          </div>

          {/* Risk Level Badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold border ${badge.bg}`}>
            <BadgeIcon className="w-3.5 h-3.5" />
            <span>{badge.label}</span>
          </div>
        </div>

        {/* Scraper Status Pill */}
        <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs mb-4">
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className="font-mono text-[11px] text-slate-400">{collectorStatus.collectorId}</span>
            {collectorStatus.status === "healed" && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                <Sparkles className="w-2.5 h-2.5" />
                Self-Healed
              </span>
            )}
          </div>
          <a
            href={collectorStatus.scrapedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-cyan-400 flex items-center gap-1 text-[11px] font-mono transition-colors"
          >
            <span>Source</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Breaking Changes Summary List */}
        <div className="space-y-2 mb-4">
          {breakingChanges.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-2 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              No breaking API changes detected in scraped release notes.
            </p>
          ) : (
            breakingChanges.slice(0, 2).map((item) => (
              <div key={item.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-200 line-clamp-1">
                    {item.title}
                  </span>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    item.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {item.severity}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))
          )}
          {breakingChanges.length > 2 && (
            <p className="text-[11px] text-slate-400 text-right font-medium">
              +{breakingChanges.length - 2} more breaking changes
            </p>
          )}
        </div>
      </div>

      {/* Footer Action */}
      <button
        onClick={() => onOpenCitation(report)}
        className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-200 flex items-center justify-between transition-all group-hover:border-cyan-500/40"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-cyan-400" />
          <span>View {breakingChanges.length} Scraped Citations</span>
        </span>
        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
      </button>

    </div>
  );
}
