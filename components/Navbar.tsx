"use client";

import { Activity, ShieldAlert, Sparkles, Terminal, Database, Cpu } from "lucide-react";

interface NavbarProps {
  activeTab: "analysis" | "scraper-monitor" | "report";
  setActiveTab: (tab: "analysis" | "scraper-monitor" | "report") => void;
  healedCount: number;
  totalBreakings: number;
}

export default function Navbar({ activeTab, setActiveTab, healedCount, totalBreakings }: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-800/80 px-4 lg:px-8 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="relative p-2.5 rounded-xl bg-gradient-to-tr from-blue-600 via-cyan-500 to-indigo-600 shadow-lg shadow-cyan-500/20">
            <ShieldAlert className="w-6 h-6 text-white" />
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Dependency Blast Radius
              </h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Hackathon Prototype
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>Powered by</span>
              <span className="font-semibold text-slate-200 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-400 fill-amber-400" />
                Bright Data Scraper Studio
              </span>
              <span>•</span>
              <span className="text-slate-400">Into the Scrape-Verse</span>
            </p>
          </div>
        </div>

        {/* Live Scraper Status Indicators */}
        <div className="flex items-center gap-2 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800/80">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>CLI Engine Active</span>
          </div>

          {healedCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Activity className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>{healedCount} Self-Healed Scrapers</span>
            </div>
          )}

          {totalBreakings > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>{totalBreakings} Breaks Detected</span>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("analysis")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "analysis"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Blast Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab("scraper-monitor")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "scraper-monitor"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Scraper Control Room</span>
          </button>

          <button
            onClick={() => setActiveTab("report")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "report"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Upgrade Report</span>
          </button>
        </nav>

      </div>
    </header>
  );
}
