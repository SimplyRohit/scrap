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
import { Loader2 } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"analysis" | "scraper-monitor" | "report">("analysis");
  const [analysis, setAnalysis] = useState<FullBlastRadiusAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedCitationReport, setSelectedCitationReport] = useState<DependencyRiskReport | null>(null);

  useEffect(() => {
    handleRunAnalysis(PRESET_MANIFESTS[0].content, PRESET_MANIFESTS[0].fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunAnalysis = async (content: string, fileName: string) => {
    setIsLoading(true);
    try {
      const parseRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, fileName }),
      });
      const parsedData = await parseRes.json();
      if (!parseRes.ok || !parsedData.dependencies) {
        throw new Error(parsedData.error || "Failed to parse manifest");
      }

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

  const healedCount    = analysis?.selfHealingSummary.healedScraperCount || 0;
  const totalBreakings = analysis?.totalBreakingChanges || 0;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        healedCount={healedCount}
        totalBreakings={totalBreakings}
      />

      <main
        style={{
          flex: 1,
          maxWidth: 1200,
          width: "100%",
          margin: "0 auto",
          padding: "40px 24px 64px",
        }}
      >

        {activeTab === "analysis" && (
          <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 32 }}>

            {/* Hero headline */}
            <div style={{ maxWidth: 600 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: "var(--cyan-dim)",
                  border: "1px solid rgba(34,211,238,0.2)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--cyan)",
                  marginBottom: 16,
                  letterSpacing: "0.03em",
                }}
              >
                <span className="live-dot" style={{ width: 5, height: 5 }} />
                Into the Scrape-Verse Hackathon
              </div>
              <h1
                style={{
                  fontSize: "clamp(26px, 4vw, 40px)",
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                  lineHeight: 1.1,
                  color: "var(--text-hi)",
                  marginBottom: 14,
                }}
              >
                Know what breaks
                <br />
                <span className="text-gradient-cyan">before you upgrade.</span>
              </h1>
              <p style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.7, maxWidth: 480 }}>
                Point it at any{" "}
                <code className="code-tag">package.json</code> or{" "}
                <code className="code-tag">requirements.txt</code>. Bright Data Scraper Studio scrapes release notes and changelogs across self-healing layouts — then maps every breaking change to your code.
              </p>
            </div>

            {/* Manifest input */}
            <ManifestInput onAnalyze={handleRunAnalysis} isLoading={isLoading} />

            {/* Loading state */}
            {isLoading && (
              <div
                className="card animate-fade-up"
                style={{ padding: "48px 32px", textAlign: "center" }}
              >
                <Loader2
                  size={24}
                  color="var(--cyan)"
                  style={{ margin: "0 auto 14px", animation: "spin 1s linear infinite" }}
                />
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 6 }}>
                  Deploying Bright Data Collectors…
                </div>
                <div style={{ fontSize: 12, color: "var(--text-lo)" }}>
                  Scraping GitHub Releases, PyPI, and custom doc sites. Self-healing schema envelopes active.
                </div>
              </div>
            )}

            {/* Results */}
            {!isLoading && analysis && (
              <BlastMatrix
                analysis={analysis}
                onOpenCitation={(report) => setSelectedCitationReport(report)}
              />
            )}
          </div>
        )}

        {activeTab === "scraper-monitor" && (
          <div className="animate-fade-in">
            <ScraperStudioMonitor analysis={analysis} />
          </div>
        )}

        {activeTab === "report" && (
          <div className="animate-fade-in">
            <ReportExporter analysis={analysis} />
          </div>
        )}

      </main>

      <CitationDrawer
        report={selectedCitationReport}
        onClose={() => setSelectedCitationReport(null)}
      />

    </div>
  );
}
