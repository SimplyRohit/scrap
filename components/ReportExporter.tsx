"use client";

import { useState } from "react";
import { FullBlastRadiusAnalysis } from "@/lib/types";
import { Download, Copy, Check, FileText, Database, ShieldAlert, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";

interface ReportExporterProps {
  analysis: FullBlastRadiusAnalysis | null;
}

export default function ReportExporter({ analysis }: ReportExporterProps) {
  const [copied, setCopied] = useState(false);

  if (!analysis) {
    return (
      <div className="glass-panel rounded-2xl p-12 text-center border border-slate-800">
        <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-white mb-1">No Upgrade Report Generated</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Run an analysis on your manifest to generate a Markdown Upgrade Blast Radius report with full citations.
        </p>
      </div>
    );
  }

  const generateMarkdownReport = (): string => {
    let md = `# 💥 Dependency Blast Radius Upgrade Safety Report\n\n`;
    md += `**Generated At**: ${new Date(analysis.createdAt).toLocaleString()}\n`;
    md += `**Target Ecosystem**: ${analysis.ecosystem.toUpperCase()}\n`;
    md += `**Overall Safety Rating**: **${analysis.overallSafetyRating.replace(/_/g, " ")}**\n`;
    md += `**Total Dependencies Analyzed**: ${analysis.totalDependencies}\n`;
    md += `**Total Breaking Changes**: ${analysis.totalBreakingChanges} (Critical: ${analysis.criticalCount}, High: ${analysis.highCount}, Medium: ${analysis.mediumCount})\n`;
    md += `**Bright Data Self-Healed Scrapers**: ${analysis.selfHealingSummary.healedScraperCount} / ${analysis.selfHealingSummary.totalScrapersDeployed}\n\n`;

    md += `---\n\n## 📊 Dependency Break Breakdown & Scraped Citations\n\n`;

    for (const r of analysis.reports) {
      const { dependency, riskLevel, overallRiskScore, breakingChanges, collectorStatus } = r;
      md += `### 📦 \`${dependency.name}\` (v${dependency.currentVersion} ➔ v${dependency.targetVersion})\n`;
      md += `- **Risk Score**: ${overallRiskScore}/100 (${riskLevel})\n`;
      md += `- **Bright Data Collector**: \`${collectorStatus.collectorId}\` (Status: ${collectorStatus.status})\n`;
      md += `- **Scraped Release Docs**: [${collectorStatus.scrapedUrl}](${collectorStatus.scrapedUrl})\n\n`;

      if (breakingChanges.length === 0) {
        md += `> ✅ **No breaking API changes detected in scraped release notes.**\n\n`;
      } else {
        md += `#### Breaking Changes & Code Migrations:\n\n`;
        for (const b of breakingChanges) {
          md += `##### 🚨 [${b.severity}] ${b.title}\n`;
          md += `${b.description}\n\n`;
          if (b.beforeSnippet && b.afterSnippet) {
            md += `\`\`\`diff\n// BEFORE (v${dependency.currentVersion})\n${b.beforeSnippet}\n\n// AFTER (v${dependency.targetVersion})\n${b.afterSnippet}\n\`\`\`\n\n`;
          }
          md += `> 📌 **Scraped Citation**: "${b.citation.quotedText}"\n`;
          md += `> 🔗 Source: [${b.citation.title}](${b.citation.url})\n\n`;
        }
      }
      md += `---\n\n`;
    }

    md += `\n*Report synthesized via Bright Data Scraper Studio & AI Blast Radius Analyzer for Into the Scrape-Verse Hackathon.*\n`;
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
    a.download = `dependency-blast-radius-report-${analysis.ecosystem}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Action Header */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Exportable Blast Radius Safety Report
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Complete GitHub Flavored Markdown report with breaking change diffs and direct URL citations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold transition-all"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-cyan-400" />}
            <span>{copied ? "Copied Report!" : "Copy Markdown"}</span>
          </button>

          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:opacity-95 text-white text-xs font-bold transition-all shadow-lg shadow-cyan-500/20"
          >
            <Download className="w-4 h-4" />
            <span>Download .md File</span>
          </button>
        </div>
      </div>

      {/* Markdown Preview Terminal */}
      <div className="glass-panel rounded-2xl border border-slate-800 bg-slate-950/90 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-slate-900/80 border-b border-slate-800 text-xs font-mono text-slate-400">
          <span className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            dependency-blast-radius-report.md
          </span>
          <span className="text-[11px] text-emerald-400 font-semibold">GFM Formatted</span>
        </div>

        <pre className="p-6 text-xs font-mono text-slate-300 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[600px] overflow-y-auto">
          {markdownText}
        </pre>
      </div>

    </div>
  );
}
