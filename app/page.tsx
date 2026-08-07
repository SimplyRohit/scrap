"use client";

import { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import ManifestInput from "@/components/ManifestInput";
import BlastMatrix from "@/components/BlastMatrix";
import CitationDrawer from "@/components/CitationDrawer";
import ScraperStudioMonitor from "@/components/ScraperStudioMonitor";
import ReportExporter from "@/components/ReportExporter";
import { DependencyRiskReport, FullBlastRadiusAnalysis } from "@/lib/types";
import { PRESET_MANIFESTS } from "@/lib/presets";
import { Sparkles, Terminal, ShieldAlert, Cpu } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"analysis" | "scraper-monitor" | "report">("analysis");
  const [analysis, setAnalysis] = useState<FullBlastRadiusAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedCitationReport, setSelectedCitationReport] = useState<DependencyRiskReport | null>(null);

  // Auto-run default preset analysis on initial load
  useEffect(() => {
    handleRunAnalysis(PRESET_MANIFESTS[0].content, PRESET_MANIFESTS[0].fileName);
  }, []);

  const handleRunAnalysis = async (content: string, fileName: string) => {
    setIsLoading(true);
    try {
      // Step 1: Parse manifest
      const parseRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, fileName }),
      });
      const parsedData = await parseRes.json();

      if (!parseRes.ok || !parsedData.dependencies) {
        throw new Error(parsedData.error || "Failed to parse manifest");
      }

      // Step 2: Run Scraper Studio & Blast Radius Engine
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependencies: parsedData.dependencies }),
      });
      const analyzeData = await analyzeRes.json();

      if (!analyzeRes.ok || !analyzeData.analysis) {
        throw new Error(analyzeData.error || "Failed to analyze dependencies");
      }

      setAnalysis(analyzeData.analysis);
    } catch (err: any) {
      console.error("Analysis Error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const healedCount = analysis?.selfHealingSummary.healedScraperCount || 0;
  const totalBreakings = analysis?.totalBreakingChanges || 0;

  return (
    <div className="min-h-screen flex flex-col pb-16">
      
      {/* Top Header Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        healedCount={healedCount}
        totalBreakings={totalBreakings}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 pt-8 space-y-8">
        
        {/* Tab 1: Analysis Dashboard */}
        {activeTab === "analysis" && (
          <div className="space-y-8 animate-in fade-in duration-300">
            
            {/* Hero / Intro Banner */}
            <div className="glass-panel rounded-2xl p-6 md:p-8 border border-slate-800/90 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="max-w-3xl space-y-2 relative">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Bright Data Hackathon Project</span>
                </div>

                <h1 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight">
                  Discover What Breaks <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400">Before You Upgrade</span>
                </h1>

                <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
                  Point it at any <code className="font-mono text-cyan-300 bg-slate-900 px-1.5 py-0.5 rounded">package.json</code> or <code className="font-mono text-cyan-300 bg-slate-900 px-1.5 py-0.5 rounded">requirements.txt</code>. 
                  Bright Data Scraper Studio automatically harvests release notes, changelogs, and migration guides across unpredictable web layouts — self-healing in real time when sites redesign.
                </p>
              </div>
            </div>

            {/* Manifest Input Component */}
            <ManifestInput
              onAnalyze={handleRunAnalysis}
              isLoading={isLoading}
            />

            {/* Loading Indicator */}
            {isLoading && (
              <div className="glass-panel rounded-2xl p-12 text-center border border-cyan-500/30 animate-pulse space-y-3">
                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
                <h3 className="text-base font-bold text-white">Deploying Bright Data Collectors...</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Scraping GitHub Releases, PyPI, and custom doc sites. Self-healing schema envelopes active.
                </p>
              </div>
            )}

            {/* Blast Risk Matrix */}
            {!isLoading && analysis && (
              <BlastMatrix
                analysis={analysis}
                onOpenCitation={(report) => setSelectedCitationReport(report)}
              />
            )}

          </div>
        )}

        {/* Tab 2: Bright Data Scraper Studio Control Room */}
        {activeTab === "scraper-monitor" && (
          <div className="animate-in fade-in duration-300">
            <ScraperStudioMonitor analysis={analysis} />
          </div>
        )}

        {/* Tab 3: Upgrade Safety Report Exporter */}
        {activeTab === "report" && (
          <div className="animate-in fade-in duration-300">
            <ReportExporter analysis={analysis} />
          </div>
        )}

      </main>

      {/* Citation Drawer Modal */}
      <CitationDrawer
        report={selectedCitationReport}
        onClose={() => setSelectedCitationReport(null)}
      />

    </div>
  );
}
