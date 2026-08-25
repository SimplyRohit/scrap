"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AnalyzerNav, type AnalyzerTab } from "@/components/analyzer/analyzer-nav";
import { BlastMatrix } from "@/components/analyzer/blast-matrix";
import { CitationDrawer } from "@/components/analyzer/citation-drawer";
import { ManifestInput, Spinner } from "@/components/analyzer/manifest-input";
import { ReportExporter } from "@/components/analyzer/report-exporter";
import { ResearchTrace } from "@/components/analyzer/research-trace";
import { Reveal } from "@/components/ui/reveal";
import { type DependencyRiskReport } from "@/lib/types";

export function Analyzer() {
  const [activeTab, setActiveTab] = React.useState<AnalyzerTab>("analysis");
  const [analysisId, setAnalysisId] = React.useState<Id<"analyses"> | null>(null);
  const [isStarting, setIsStarting] = React.useState(false);
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

  const parseManifest = useAction(api.manifests.parse);
  const startAnalysis = useMutation(api.analyses.start);

  // Two subscriptions rather than a poll: `progress` moves as each package is
  // claimed and finished, and `analysis` is the report, which is rebuilt from
  // whatever has landed. Neither is a request the browser has to hold open —
  // research outlives an HTTP connection, which is why this used to be a
  // five-minute fetch that returned everything or nothing.
  const progress = useQuery(api.analyses.get, analysisId ? { analysisId } : "skip");
  const analysis = useQuery(api.analyses.blastRadius, analysisId ? { analysisId } : "skip") ?? null;

  const isResearching =
    progress != null && progress.status !== "complete" && progress.status !== "failed";
  const isLoading = isStarting || isResearching;

  const run = React.useCallback(
    async (content: string, fileName: string) => {
      setIsStarting(true);
      setError(null);
      setAnalysisId(null);

      try {
        // Parsing resolves target versions against the registries, so it is an
        // action; the analysis it starts is scheduled work we then watch.
        const parsed = await parseManifest({ content, fileName });

        setAnalysisId(
          await startAnalysis({
            ecosystem: parsed.ecosystem,
            fileName: parsed.fileName,
            packages: parsed.packages,
            warnings: parsed.warnings,
          }),
        );
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : "Research failed.");
      } finally {
        setIsStarting(false);
      }
    },
    [parseManifest, startAnalysis],
  );

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

            {!error && progress?.error ? (
              <p className="border border-critical/40 bg-panel px-5 py-4 text-[13.5px] text-critical">
                {progress.error}
              </p>
            ) : null}

            {error ? (
              <p className="border border-critical/40 bg-panel px-5 py-4 text-[13.5px] text-critical">
                {error}
              </p>
            ) : null}

            {isLoading ? <Researching progress={progress ?? null} /> : null}

            {/* Rendered while research is still running: every package that
                lands is a row that can be read now. */}
            {analysis && analysis.reports.length > 0 ? (
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

/**
 * The wait is long enough that it needs to say what it is doing.
 *
 * It used to say it on a timer — four stages, 2.6 seconds each, unrelated to
 * anything actually happening. The backend now reports per-package status, so
 * this reads it instead of miming it.
 */
function Researching({ progress }: { progress: AnalysisProgress | null }) {
  const packages = progress?.packages ?? [];
  const done = progress?.completed ?? 0;
  const total = progress?.requested ?? 0;

  return (
    <div className="border border-border bg-panel px-6 py-10">
      <div className="flex items-center gap-3">
        <Spinner className="text-muted-foreground" />
        <p className="text-[15px] font-medium tracking-tight">
          {total > 0 ? `Researching ${total} dependencies — ${done} done` : "Reading the manifest…"}
        </p>
      </div>

      <p className="mt-3 max-w-xl text-[13px] leading-[1.6] text-muted-foreground">
        Target versions come from the registry, then sources are read in order of authority.
        Hosts that block automated requests are retrieved through the{" "}
        <a
          href="https://brightdata.com/products/web-unlocker"
          target="_blank"
          rel="noreferrer noopener"
          className="link-underline text-foreground"
        >
          Bright Data
        </a>{" "}
        unlocker, so a 403 is not the end of the trail.
      </p>

      {packages.length > 0 ? (
        <ol className="mt-6 grid gap-2 sm:grid-cols-2">
          {packages.map((entry) => (
            <li key={entry.package} className="flex items-center gap-3 font-mono text-[11.5px]">
              <span
                aria-hidden
                className={
                  entry.status === "done"
                    ? "size-1.5 bg-mark"
                    : entry.status === "failed"
                      ? "size-1.5 bg-critical"
                      : entry.status === "researching"
                        ? "size-1.5 animate-pulse bg-foreground"
                        : "size-1.5 bg-foreground/25"
                }
              />
              <span
                className={
                  entry.status === "pending" ? "text-foreground/35" : "text-muted-foreground"
                }
              >
                {entry.package}
              </span>
              {entry.status === "done" ? (
                <span className="text-foreground/35">
                  {entry.knowledgeCount} claim{entry.knowledgeCount === 1 ? "" : "s"}
                  {entry.servedFromIndex ? " · indexed" : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Exactly what `analyses.get` returns, minus the null. */
type AnalysisProgress = NonNullable<(typeof api.analyses.get)["_returnType"]>;
