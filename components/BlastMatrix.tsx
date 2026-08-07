"use client";

import { useState } from "react";
import { DependencyRiskReport, FullBlastRadiusAnalysis } from "@/lib/types";
import DependencyCard from "./DependencyCard";
import { AlertTriangle, CheckCircle, ShieldAlert, Sparkles, Filter, Activity, BarChart2 } from "lucide-react";

interface BlastMatrixProps {
  analysis: FullBlastRadiusAnalysis;
  onOpenCitation: (report: DependencyRiskReport) => void;
}

export default function BlastMatrix({ analysis, onOpenCitation }: BlastMatrixProps) {
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "SAFE">("ALL");

  const filteredReports = analysis.reports.filter((r) => {
    if (filter === "ALL") return true;
    if (filter === "CRITICAL") return r.riskLevel === "CRITICAL";
    if (filter === "HIGH") return r.riskLevel === "HIGH";
    if (filter === "MEDIUM") return r.riskLevel === "MEDIUM";
    if (filter === "SAFE") return r.riskLevel === "SAFE";
    return true;
  });

  const getSafetyRatingBadge = () => {
    switch (analysis.overallSafetyRating) {
      case "HIGH_RISK":
        return { bg: "bg-rose-500/20 text-rose-300 border-rose-500/40", label: "HIGH BREAK RISK", icon: ShieldAlert };
      case "MODERATE_RISK":
        return { bg: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "MODERATE RISK", icon: AlertTriangle };
      case "LOW_RISK":
        return { bg: "bg-blue-500/20 text-blue-300 border-blue-500/40", label: "LOW RISK", icon: AlertTriangle };
      default:
        return { bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "SAFE TO UPGRADE", icon: CheckCircle };
    }
  };

  const safety = getSafetyRatingBadge();
  const SafetyIcon = safety.icon;

  return (
    <div className="space-y-6">
      
      {/* Top Impact Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Overall Safety Rating Card */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Upgrade Safety Rating
            </span>
            <SafetyIcon className="w-5 h-5 text-slate-300" />
          </div>
          <div className="mt-3">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-bold border ${safety.bg}`}>
              <SafetyIcon className="w-4 h-4" />
              <span>{safety.label}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Based on {analysis.totalDependencies} parsed dependencies
            </p>
          </div>
        </div>

        {/* Total Breaking Changes */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Breaking Changes</span>
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold text-white flex items-baseline gap-2">
              <span>{analysis.totalBreakingChanges}</span>
              <span className="text-xs font-medium text-slate-400">total items</span>
            </div>
            <p className="text-xs text-rose-400/90 mt-1 font-mono">
              {analysis.criticalCount} Critical • {analysis.highCount} High
            </p>
          </div>
        </div>

        {/* Bright Data Self-Healing Scrapers */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Bright Data Scrapers</span>
            <Sparkles className="w-5 h-5 text-amber-400" />
          </div>
          <div className="mt-3">
            <div className="text-3xl font-extrabold text-white flex items-baseline gap-2">
              <span>{analysis.selfHealingSummary.healedScraperCount}</span>
              <span className="text-xs font-medium text-amber-400">Self-Healed</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Out of {analysis.selfHealingSummary.totalScrapersDeployed} collectors deployed
            </p>
          </div>
        </div>

        {/* Parsing Ecosystem */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Target Ecosystem</span>
            <BarChart2 className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="mt-3">
            <span className="text-xl font-bold text-cyan-300 uppercase tracking-wider">
              {analysis.ecosystem}
            </span>
            <p className="text-xs text-slate-400 mt-1">
              Live Release Scraping Active
            </p>
          </div>
        </div>

      </div>

      {/* Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold px-2">
          <Filter className="w-4 h-4 text-cyan-400" />
          <span>Filter Dependencies ({analysis.reports.length})</span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "SAFE"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filter === f
                  ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                  : "bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              {f === "ALL" ? "All Packages" : f}
            </button>
          ))}
        </div>
      </div>

      {/* Dependency Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredReports.map((report) => (
          <DependencyCard
            key={report.dependency.name}
            report={report}
            onOpenCitation={onOpenCitation}
          />
        ))}
      </div>

    </div>
  );
}
