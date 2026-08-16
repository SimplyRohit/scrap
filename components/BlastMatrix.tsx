"use client";

import { useState } from "react";
import { DependencyRiskReport, FullBlastRadiusAnalysis } from "@/lib/types";
import DependencyCard from "./DependencyCard";

interface BlastMatrixProps {
  analysis: FullBlastRadiusAnalysis;
  onOpenCitation: (r: DependencyRiskReport) => void;
}

type Filter = "ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "SAFE";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL",      label: "All" },
  { key: "CRITICAL", label: "Critical" },
  { key: "HIGH",     label: "High" },
  { key: "MEDIUM",   label: "Medium" },
  { key: "SAFE",     label: "Safe" },
];

const SAFETY_COLOR: Record<string, string> = {
  HIGH_RISK:     "var(--rose)",
  MODERATE_RISK: "var(--amber)",
  LOW_RISK:      "var(--cyan)",
  SAFE:          "var(--green)",
};
const SAFETY_LABEL: Record<string, string> = {
  HIGH_RISK:     "High Risk",
  MODERATE_RISK: "Moderate",
  LOW_RISK:      "Low Risk",
  SAFE:          "Safe",
};

export default function BlastMatrix({ analysis, onOpenCitation }: BlastMatrixProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const filtered = analysis.reports.filter(r => filter === "ALL" || r.riskLevel === filter);
  const safetyColor = SAFETY_COLOR[analysis.overallSafetyRating] ?? "var(--green)";
  const safetyLabel = SAFETY_LABEL[analysis.overallSafetyRating] ?? "Safe";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--bd)", borderRadius: "var(--r-xl)", overflow: "hidden" }}>
        {[
          { label: "Safety", value: safetyLabel, sub: `${analysis.totalDependencies} deps`, color: safetyColor },
          { label: "Breaking Changes", value: analysis.totalBreakingChanges, sub: `${analysis.criticalCount} critical · ${analysis.highCount} high`, color: analysis.totalBreakingChanges > 0 ? "var(--rose)" : "var(--t1)" },
          { label: "Sources Read", value: analysis.researchSummary.totalSourcesFetched, sub: `${analysis.researchSummary.unlockedSourceCount} via unlocker`, color: "var(--amber)" },
          { label: "Ecosystem", value: analysis.ecosystem.toUpperCase(), sub: "Live scraping", color: "var(--cyan)" },
        ].map(({ label, value, sub, color }, i) => (
          <div key={label} className={`anim-up d-${i + 1}`}
            style={{ background: "var(--surface)", padding: "20px 22px" }}>
            <div className="text-label" style={{ marginBottom: 10 }}>{label}</div>
            <div className="text-mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.04em", color, lineHeight: 1, marginBottom: 5 }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: "var(--t3)" }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Filter row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="text-label" style={{ marginRight: 8 }}>Filter</span>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)}
              style={{
                padding: "4px 12px",
                borderRadius: "var(--r-sm)",
                fontSize: 12,
                fontWeight: active ? 500 : 400,
                background: active ? "var(--surface-bd)" : "transparent",
                color: active ? "var(--t1)" : "var(--t3)",
                border: active ? "1px solid var(--bd-hi)" : "1px solid transparent",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 140ms",
              }}
            >
              {label}
            </button>
          );
        })}
        <span className="text-caption" style={{ marginLeft: "auto" }}>{filtered.length} packages</span>
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
        {filtered.map((report, i) => (
          <DependencyCard
            key={report.dependency.name}
            report={report}
            onOpenCitation={onOpenCitation}
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>

    </div>
  );
}
