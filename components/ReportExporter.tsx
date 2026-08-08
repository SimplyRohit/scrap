"use client";

import { useState } from "react";
import { FullBlastRadiusAnalysis } from "@/lib/types";
import { Download, Copy, Check } from "lucide-react";
import confetti from "canvas-confetti";

export default function ReportExporter({ analysis }: { analysis: FullBlastRadiusAnalysis | null }) {
  const [copied, setCopied] = useState(false);

  if (!analysis) {
    return (
      <div className="surface anim-up" style={{ padding: "64px 32px", textAlign: "center" }}>
        <div className="text-title" style={{ marginBottom: 5 }}>No report yet</div>
        <div className="text-body" style={{ maxWidth: 360, margin: "0 auto" }}>
          Run an analysis to generate a full Markdown upgrade safety report with citations.
        </div>
      </div>
    );
  }

  const generateReport = (): string => {
    let md = `# 💥 Dependency Blast Radius Upgrade Safety Report\n\n`;
    md += `**Generated**: ${new Date(analysis.createdAt).toLocaleString()}\n`;
    md += `**Ecosystem**: ${analysis.ecosystem.toUpperCase()}\n`;
    md += `**Safety Rating**: ${analysis.overallSafetyRating.replace(/_/g, " ")}\n`;
    md += `**Dependencies**: ${analysis.totalDependencies}\n`;
    md += `**Breaking Changes**: ${analysis.totalBreakingChanges} (Critical: ${analysis.criticalCount}, High: ${analysis.highCount}, Medium: ${analysis.mediumCount})\n`;
    md += `**Self-Healed Scrapers**: ${analysis.selfHealingSummary.healedScraperCount} / ${analysis.selfHealingSummary.totalScrapersDeployed}\n\n---\n\n`;
    for (const r of analysis.reports) {
      const { dependency, riskLevel, overallRiskScore, breakingChanges, collectorStatus } = r;
      md += `## \`${dependency.name}\` v${dependency.currentVersion} → v${dependency.targetVersion}\n\n`;
      md += `- **Risk**: ${overallRiskScore}/100 (${riskLevel})\n`;
      md += `- **Collector**: \`${collectorStatus.collectorId}\` · ${collectorStatus.status}\n`;
      md += `- **Scraped**: [${collectorStatus.scrapedUrl}](${collectorStatus.scrapedUrl})\n\n`;
      if (breakingChanges.length === 0) {
        md += `> ✅ No breaking API changes detected.\n\n`;
      } else {
        for (const b of breakingChanges) {
          md += `### [${b.severity}] ${b.title}\n\n${b.description}\n\n`;
          if (b.beforeSnippet && b.afterSnippet) {
            md += `\`\`\`diff\n// BEFORE\n${b.beforeSnippet}\n\n// AFTER\n${b.afterSnippet}\n\`\`\`\n\n`;
          }
          md += `> 📌 "${b.citation.quotedText}"\n> Source: [${b.citation.title}](${b.citation.url})\n\n`;
        }
      }
      md += `---\n\n`;
    }
    md += `*Generated via Bright Data Scraper Studio · Into the Scrape-Verse Hackathon*\n`;
    return md;
  };

  const md = generateReport();

  const handleCopy = () => {
    navigator.clipboard.writeText(md);
    setCopied(true);
    confetti({ particleCount: 40, spread: 55, origin: { y: 0.8 } });
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blast-radius-${analysis.ecosystem}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header row */}
      <div className="anim-up" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="text-title" style={{ marginBottom: 2 }}>Upgrade Safety Report</div>
          <div className="text-body" style={{ fontSize: 12 }}>GitHub Flavored Markdown · full citations · diff snippets</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={handleCopy} style={{ gap: 6 }}>
            {copied ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button className="btn btn-primary" onClick={handleDownload}>
            <Download size={12} /> Download .md
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="surface anim-up d-1" style={{ overflow: "hidden" }}>
        {/* Chrome */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderBottom: "1px solid var(--bd)" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map(c => (
            <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.6 }} />
          ))}
          <span className="text-caption" style={{ marginLeft: 8 }}>blast-radius-{analysis.ecosystem}.md</span>
          <span className="text-caption" style={{ marginLeft: "auto", color: "var(--green)" }}>GFM</span>
        </div>
        <pre style={{ padding: "18px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11.5, lineHeight: 1.7, color: "var(--t2)", overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: 540, overflowY: "auto", margin: 0 }}>
          {md}
        </pre>
      </div>

    </div>
  );
}
