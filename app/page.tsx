"use client";

import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/Navbar";
import ManifestInput from "@/components/ManifestInput";
import BlastMatrix from "@/components/BlastMatrix";
import CitationDrawer from "@/components/CitationDrawer";
import ScraperStudioMonitor from "@/components/ScraperStudioMonitor";
import ReportExporter from "@/components/ReportExporter";
import { DependencyRiskReport, FullBlastRadiusAnalysis } from "@/lib/types";
import { PRESET_MANIFESTS } from "@/lib/presets";
import { Loader2 } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"analysis" | "scraper-monitor" | "report">("analysis");
  const [analysis, setAnalysis]   = useState<FullBlastRadiusAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [citation, setCitation]   = useState<DependencyRiskReport | null>(null);

  // Stable identity so the mount effect below can depend on it honestly
  // rather than suppressing the dependency check.
  const run = useCallback(async (content: string, fileName: string) => {
    setIsLoading(true);
    try {
      const pr = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, fileName }) });
      const pd = await pr.json();
      if (!pr.ok || !pd.dependencies) throw new Error(pd.error);

      const ar = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dependencies: pd.dependencies }) });
      const ad = await ar.json();
      if (!ar.ok || !ad.analysis) throw new Error(ad.error);

      setAnalysis(ad.analysis);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load the first preset once, so the dashboard has something to show.
  // Deferred by a tick because `run` sets loading state synchronously, which is
  // not allowed directly inside an effect body.
  useEffect(() => {
    const timer = setTimeout(() => run(PRESET_MANIFESTS[0].content, PRESET_MANIFESTS[0].fileName), 0);
    return () => clearTimeout(timer);
  }, [run]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sourceCount={analysis?.researchSummary.totalSourcesFetched ?? 0}
        totalBreakings={analysis?.totalBreakingChanges ?? 0}
      />

      <main style={{ flex: 1, maxWidth: 1120, width: "100%", margin: "0 auto", padding: "48px 24px 80px" }}>

        {activeTab === "analysis" && (
          <div className="anim-up" style={{ display: "flex", flexDirection: "column", gap: 36 }}>

            {/* Hero */}
            <div style={{ maxWidth: 560 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "rgba(6 182 212 / 0.08)", border: "1px solid rgba(6 182 212 / 0.15)", fontSize: 11, color: "var(--cyan)", fontWeight: 500, marginBottom: 18, letterSpacing: "0.03em" }}>
                <span className="dot-live" />
                Into the Scrape-Verse Hackathon
              </div>

              <h1 style={{ fontSize: "clamp(30px, 5vw, 48px)", fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1.05, color: "var(--t1)", marginBottom: 16 }}>
                Know what breaks<br />
                <span style={{ color: "var(--cyan)" }}>before you upgrade.</span>
              </h1>

              <p className="text-body" style={{ fontSize: 14, lineHeight: 1.7, maxWidth: 460 }}>
                Point at any <code className="code-inline">package.json</code> or{" "}
                <code className="code-inline">requirements.txt</code>. Every dependency is researched against its official changelogs, release notes, and migration guides — and every breaking change comes back with the sentence it was found in.
              </p>
            </div>

            {/* Input */}
            <ManifestInput onAnalyze={run} isLoading={isLoading} />

            {/* Loading */}
            {isLoading && (
              <div className="surface" style={{ padding: "48px 32px", textAlign: "center" }}>
                <Loader2 size={22} color="var(--cyan)" style={{ margin: "0 auto 14px", animation: "spin 1s linear infinite" }} />
                <div className="text-title" style={{ marginBottom: 5 }}>Researching dependencies…</div>
                <div className="text-body" style={{ fontSize: 12 }}>
                  Resolving versions from the registry, then reading release notes, changelogs, and migration
                  guides in order of authority.
                </div>
              </div>
            )}

            {/* Results */}
            {!isLoading && analysis && (
              <BlastMatrix analysis={analysis} onOpenCitation={setCitation} />
            )}

          </div>
        )}

        {activeTab === "scraper-monitor" && (
          <div className="anim-in">
            <ScraperStudioMonitor analysis={analysis} />
          </div>
        )}

        {activeTab === "report" && (
          <div className="anim-in">
            <ReportExporter analysis={analysis} />
          </div>
        )}

      </main>

      <CitationDrawer report={citation} onClose={() => setCitation(null)} />
    </div>
  );
}
