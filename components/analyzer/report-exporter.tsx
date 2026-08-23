"use client";

import confetti from "canvas-confetti";
import * as React from "react";

import { MarkdownPreview } from "@/components/analyzer/markdown-preview";
import { Button } from "@/components/ui/button";
import { type FullBlastRadiusAnalysis } from "@/lib/types";
import { SITE } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "preview", label: "Preview" },
  { id: "source", label: "Source" },
] as const;

export function ReportExporter({ analysis }: { analysis: FullBlastRadiusAnalysis | null }) {
  const [copied, setCopied] = React.useState(false);
  const [view, setView] = React.useState<(typeof VIEWS)[number]["id"]>("preview");

  React.useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 2200);

    return () => clearTimeout(timer);
  }, [copied]);

  const markdown = React.useMemo(
    () => (analysis ? renderReport(analysis) : ""),
    [analysis],
  );

  if (!analysis) {
    return (
      <div className="border border-border bg-panel px-6 py-20 text-center">
        <p className="text-[16px] font-medium tracking-tight">No report yet</p>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-[1.65] text-muted-foreground">
          Run an analysis to generate a Markdown upgrade report — every finding carrying the
          quote and the link it came from.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      confetti({ particleCount: 40, spread: 55, origin: { y: 0.8 }, disableForReducedMotion: true });
    } catch {
      // Clipboard unavailable — the report is still selectable in the preview.
    }
  };

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `rift-${analysis.ecosystem}.md`;
    anchor.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-medium tracking-[-0.025em]">Upgrade report</h2>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            GitHub-flavoured Markdown · full citations · diff snippets
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? "Copied" : "Copy Markdown"}
          </Button>
          <Button variant="signal" size="sm" onClick={download}>
            Download .md
          </Button>
        </div>
      </div>

      <div className="overflow-hidden border border-border bg-panel">
        <div className="flex items-stretch border-b border-border bg-paper/60">
          <span className="flex items-center px-5 font-mono text-[11.5px] text-foreground">
            rift-{analysis.ecosystem}.md
          </span>

          <div role="tablist" aria-label="Report view" className="ml-auto flex items-stretch">
            {VIEWS.map((item) => {
              const selected = view === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setView(item.id)}
                  className={cn(
                    "label relative border-l border-border px-4 py-3 transition-colors duration-200",
                    selected
                      ? "bg-panel text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-x-0 bottom-0 h-px origin-left bg-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      selected ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="scroll-slim max-h-[34rem] overflow-auto">
          {view === "preview" ? (
            <MarkdownPreview markdown={markdown} />
          ) : (
            <pre className="whitespace-pre-wrap px-5 py-4 font-mono text-[11.5px] leading-[1.75] text-muted-foreground">
              {markdown}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-paper/60 px-5 py-2.5">
          <span className="label text-foreground/35">
            {view === "preview" ? "rendered" : "source"}
          </span>
          <span className="label text-foreground/35">
            {markdown.split("\n").length} lines
          </span>
        </div>
      </div>
    </div>
  );
}

function renderReport(analysis: FullBlastRadiusAnalysis): string {
  const { researchSummary } = analysis;

  let md = `# ${SITE.name} — upgrade report\n\n`;

  md += `- **Generated**: ${new Date(analysis.createdAt).toLocaleString()}\n`;
  md += `- **Ecosystem**: ${analysis.ecosystem.toUpperCase()}\n`;
  md += `- **Verdict**: ${analysis.overallSafetyRating.replace(/_/g, " ")}\n`;
  md += `- **Dependencies**: ${analysis.totalDependencies}\n`;
  md += `- **Breaking changes**: ${analysis.totalBreakingChanges} (critical ${analysis.criticalCount}, high ${analysis.highCount}, medium ${analysis.mediumCount})\n`;
  md += `- **Sources read**: ${researchSummary.totalSourcesFetched} (${researchSummary.unlockedSourceCount} via unlocker, ${researchSummary.cacheHits} cached)\n\n---\n\n`;

  for (const report of analysis.reports) {
    const { dependency, riskLevel, overallRiskScore, breakingChanges, research, sources } =
      report;

    md += `## \`${dependency.name}\` ${dependency.currentVersion} → ${dependency.targetVersion}\n\n`;
    md += `- **Risk**: ${overallRiskScore}/100 (${riskLevel})\n`;
    md += `- **Research**: ${research.sourcesFetched} source(s) read · ${research.knowledgeExtracted} claim(s) indexed${research.servedFromIndex ? " · served from index" : ""}\n`;

    for (const source of sources) {
      md += `  - [${source.sourceType}] [${source.title}](${source.sourceUrl}) — ${source.extractedClaims.length} claim(s), via ${source.transport}\n`;
    }

    md += `\n`;

    if (breakingChanges.length === 0) {
      // Absence of evidence is reported as such — never as safety.
      md +=
        research.sourcesFetched === 0
          ? `> No sources could be read for this package. This is **not** evidence that the upgrade is safe.\n\n`
          : `> No breaking changes found in the ${research.sourcesFetched} source(s) read.\n\n`;
    } else {
      for (const change of breakingChanges) {
        md += `### [${change.severity}] ${change.title}\n\n${change.description}\n\n`;

        if (change.beforeSnippet && change.afterSnippet) {
          md += `\`\`\`diff\n// BEFORE\n${change.beforeSnippet}\n\n// AFTER\n${change.afterSnippet}\n\`\`\`\n\n`;
        }

        md += `> "${change.citation.quotedText}"\n> — [${change.citation.title}](${change.citation.url})\n\n`;
      }
    }

    md += `---\n\n`;
  }

  md += `*Generated by ${SITE.name}. Every finding above is quoted from the source it links to.*\n`;

  return md;
}
