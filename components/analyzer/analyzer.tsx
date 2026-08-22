"use client";

import * as React from "react";

import { AnalyzerNav, type AnalyzerTab } from "@/components/analyzer/analyzer-nav";
import { BlastMatrix } from "@/components/analyzer/blast-matrix";
import { CitationDrawer } from "@/components/analyzer/citation-drawer";
import { ManifestInput, Spinner } from "@/components/analyzer/manifest-input";
import { ReportExporter } from "@/components/analyzer/report-exporter";
import { ResearchTrace } from "@/components/analyzer/research-trace";
import { Reveal } from "@/components/ui/reveal";
import { PRESET_MANIFESTS } from "@/lib/presets";
import { type DependencyRiskReport, type FullBlastRadiusAnalysis } from "@/lib/types";

export function Analyzer() {
  const [activeTab, setActiveTab] = React.useState<AnalyzerTab>("analysis");
  const [analysis, setAnalysis] = React.useState<FullBlastRadiusAnalysis | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [citation, setCitation] = React.useState<DependencyRiskReport | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const openCitation = React.useCallback((report: DependencyRiskReport) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);

    setCitation(report);
    setDrawerOpen(true);
  }, []);

  // The report is held past the close so the panel has something to slide out
  // with; 320ms matches the transition on the panel itself.
  const closeCitation = React.useCallback(() => {
    setDrawerOpen(false);
    closeTimer.current = setTimeout(() => setCitation(null), 320);
  }, []);

  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Stable identity so the mount effect below can depend on it honestly
  // rather than suppressing the dependency check.
  const run = React.useCallback(async (content: string, fileName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const parsed = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, fileName }),
      });
      const parseData = await parsed.json();

      if (!parsed.ok || !parseData.dependencies) throw new Error(parseData.error);

      const analyzed = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependencies: parseData.dependencies }),
      });
      const analyzeData = await analyzed.json();

      if (!analyzed.ok || !analyzeData.analysis) throw new Error(analyzeData.error);

      setAnalysis(analyzeData.analysis);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Research failed.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load the first preset once, so the dashboard has something to show.
  // Deferred by a tick because `run` sets loading state synchronously, which is
  // not allowed directly inside an effect body.
  React.useEffect(() => {
    const timer = setTimeout(
      () => run(PRESET_MANIFESTS[0].content, PRESET_MANIFESTS[0].fileName),
      0,
    );

    return () => clearTimeout(timer);
  }, [run]);

  return (
    <div className="flex grow flex-col">
      <AnalyzerNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sourceCount={analysis?.researchSummary.totalSourcesFetched ?? 0}
        totalBreakings={analysis?.totalBreakingChanges ?? 0}
      />

      <main id="top" className="mx-auto w-full max-w-6xl grow px-6 pb-24 pt-10">
        {activeTab === "analysis" ? (
          <div className="flex flex-col gap-10">
            <Reveal className="max-w-2xl">
              <h1 className="text-balance text-[clamp(1.75rem,3.4vw,2.4rem)] font-medium leading-[1.1] tracking-[-0.032em]">
                Know what breaks <span className="accent">before</span> you upgrade.
              </h1>
              <p className="mt-4 max-w-xl text-pretty text-[15px] leading-[1.65] text-muted-foreground">
                Paste a manifest. Every dependency is researched against its own changelogs,
                release notes, and migration guides — and every breaking change comes back
                with the sentence it was found in.
              </p>
            </Reveal>

            <ManifestInput onAnalyze={run} isLoading={isLoading} />

            {error ? (
              <p className="border border-critical/40 bg-panel px-5 py-4 text-[13.5px] text-critical">
                {error}
              </p>
            ) : null}

            {isLoading ? <Researching /> : null}

            {!isLoading && analysis ? (
              <BlastMatrix analysis={analysis} onOpenCitation={openCitation} />
            ) : null}
          </div>
        ) : null}

        {activeTab === "sources" ? <ResearchTrace analysis={analysis} /> : null}

        {activeTab === "report" ? <ReportExporter analysis={analysis} /> : null}
      </main>

      <CitationDrawer report={citation} open={drawerOpen} onClose={closeCitation} />
    </div>
  );
}

/** The wait is long enough that it needs to say what it is doing. */
function Researching() {
  const STAGES = [
    "Resolving target versions against the registry",
    "Planning sources by authority",
    "Reading release notes and migration guides",
    "Extracting quote-anchored claims",
  ];

  const [stage, setStage] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(
      () => setStage((prev) => Math.min(prev + 1, STAGES.length - 1)),
      2600,
    );

    return () => clearInterval(timer);
  }, [STAGES.length]);

  return (
    <div className="border border-border bg-panel px-6 py-10">
      <div className="flex items-center gap-3">
        <Spinner className="text-muted-foreground" />
        <p className="text-[15px] font-medium tracking-tight">Researching dependencies…</p>
      </div>

      <ol className="mt-6 space-y-2.5">
        {STAGES.map((label, i) => (
          <li
            key={label}
            className="flex items-center gap-3 font-mono text-[11.5px] transition-colors duration-500"
          >
            <span
              aria-hidden
              className={
                i < stage
                  ? "size-1.5 bg-mark"
                  : i === stage
                    ? "size-1.5 bg-foreground"
                    : "size-1.5 bg-foreground/25"
              }
            />
            <span className={i <= stage ? "text-muted-foreground" : "text-foreground/35"}>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
