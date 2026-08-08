"use client";

import { useState } from "react";
import { FullBlastRadiusAnalysis } from "@/lib/types";
import { Download, Copy, Check, FileText } from "lucide-react";
import confetti from "canvas-confetti";

interface ReportExporterProps {
  analysis: FullBlastRadiusAnalysis | null;
}

export default function ReportExporter({ analysis }: ReportExporterProps) {
  const [copied, setCopied] = useState(false);

  if (!analysis) {
    return (
      <div className="card animate-fade-up" style={{ padding: "64px 32px", textAlign: "center" }}>
        <FileText size={28} color="var(--text-lo)" style={{ margin: "0 auto 16px" }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-hi)", marginBottom: 6 }}>
          No report yet
        </div>
        <div style={{ fontSize: 13, color: "var(--text-lo)", maxWidth: 360, margin: "0 auto" }}>
          Run an analysis to generate a full Markdown upgrade safety report with citations.
        </div>
      </div>
    );
  }

  const generateMarkdownReport = (): string => {
    let md = `# 💥 Dependency Blast Radius Upgrade Safety Report\n\n`;
    md += `**Generated**: ${new Date(analysis.createdAt).toLocaleString()}\n`;
    md += `**Ecosystem**: ${analysis.ecosystem.toUpperCase()}\n`;
    md += `**Safety Rating**: ${analysis.overallSafetyRating.replace(/_/g, " ")}\n`;
    md += `**Dependencies**: ${analysis.totalDependencies}\n`;
    md += `**Breaking Changes**: ${analysis.totalBreakingChanges} (Critical: ${analysis.criticalCount}, High: ${analysis.highCount}, Medium: ${analysis.mediumCount})\n`;
    md += `**Bright Data Self-Healed**: ${analysis.selfHealingSummary.healedScraperCount} / ${analysis.selfHealingSummary.totalScrapersDeployed}\n\n---\n\n`;

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

  const markdownText = generateMarkdownReport();

  const handleCopy = () => {
    navigator.clipboard.writeText(markdownText);
    setCopied(true);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
    const blob = new Blob([markdownText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blast-radius-${analysis.ecosystem}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Actions row */}
      <div
        className="animate-fade-up"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 2 }}>
            Upgrade Safety Report
          </div>
          <div style={{ fontSize: 11, color: "var(--text-lo)" }}>
            GitHub Flavored Markdown · full citations · diff snippets
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={handleCopy} style={{ gap: 6 }}>
            {copied ? <Check size={13} color="var(--emerald)" /> : <Copy size={13} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button className="btn-primary" onClick={handleDownload}>
            <Download size={13} />
            Download .md
          </button>
        </div>
      </div>

      {/* Preview */}
      <div className="card animate-fade-up stagger-1" style={{ overflow: "hidden" }}>
        {/* Editor chrome */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.7 }} />
          ))}
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--text-lo)",
              marginLeft: 8,
            }}
          >
            blast-radius-{analysis.ecosystem}.md
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: "var(--emerald)",
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            GFM
          </span>
        </div>
        <pre
          style={{
            padding: "20px 20px",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "var(--text-mid)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            maxHeight: 560,
            overflowY: "auto",
            margin: 0,
          }}
        >
          {markdownText}
        </pre>
      </div>

    </div>
  );
}
