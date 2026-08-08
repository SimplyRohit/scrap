"use client";

import { useState } from "react";
import { DependencyRiskReport, FullBlastRadiusAnalysis } from "@/lib/types";
import DependencyCard from "./DependencyCard";
import { ShieldAlert, CheckCircle, AlertTriangle, Zap, Database, Activity } from "lucide-react";

interface BlastMatrixProps {
  analysis: FullBlastRadiusAnalysis;
  onOpenCitation: (report: DependencyRiskReport) => void;
}

type FilterKey = "ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "SAFE";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL",      label: "All" },
  { key: "CRITICAL", label: "Critical" },
  { key: "HIGH",     label: "High" },
  { key: "MEDIUM",   label: "Medium" },
  { key: "SAFE",     label: "Safe" },
];

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div
      className="card animate-fade-up"
      style={{ padding: "20px 22px" }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-lo)", marginBottom: 8 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          color: accent ?? "var(--text-hi)",
          lineHeight: 1,
          fontFamily: "var(--font-geist-mono), monospace",
          marginBottom: sub ? 4 : 0,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

export default function BlastMatrix({ analysis, onOpenCitation }: BlastMatrixProps) {
  const [filter, setFilter] = useState<FilterKey>("ALL");

  const filtered = analysis.reports.filter((r) =>
    filter === "ALL" ? true : r.riskLevel === filter
  );

  const safetyLabel =
    analysis.overallSafetyRating === "HIGH_RISK"      ? "High Risk"   :
    analysis.overallSafetyRating === "MODERATE_RISK"  ? "Moderate"    :
    analysis.overallSafetyRating === "LOW_RISK"       ? "Low Risk"    :
    "Safe";

  const safetyColor =
    analysis.overallSafetyRating === "HIGH_RISK"      ? "var(--rose)"    :
    analysis.overallSafetyRating === "MODERATE_RISK"  ? "var(--amber)"   :
    analysis.overallSafetyRating === "LOW_RISK"       ? "var(--cyan)"    :
    "var(--emerald)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Stat row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <StatCard
          label="Overall Safety"
          value={safetyLabel}
          sub={`${analysis.totalDependencies} dependencies`}
          accent={safetyColor}
        />
        <StatCard
          label="Breaking Changes"
          value={analysis.totalBreakingChanges}
          sub={`${analysis.criticalCount} critical · ${analysis.highCount} high`}
          accent={analysis.totalBreakingChanges > 0 ? "var(--rose)" : undefined}
        />
        <StatCard
          label="Self-Healed"
          value={analysis.selfHealingSummary.healedScraperCount}
          sub={`of ${analysis.selfHealingSummary.totalScrapersDeployed} scrapers`}
          accent="var(--amber)"
        />
        <StatCard
          label="Ecosystem"
          value={analysis.ecosystem.toUpperCase()}
          sub="Live scraping active"
          accent="var(--cyan)"
        />
      </div>

      {/* Filter row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-lo)", marginRight: 4 }}>
          Filter
        </span>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                background: active ? "var(--cyan-dim)" : "transparent",
                color: active ? "var(--cyan)" : "var(--text-mid)",
                border: active ? "1px solid rgba(34,211,238,0.25)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {label}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-lo)", fontFamily: "var(--font-geist-mono), monospace" }}>
          {filtered.length} packages
        </span>
      </div>

      {/* Cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {filtered.map((report, i) => (
          <DependencyCard
            key={report.dependency.name}
            report={report}
            onOpenCitation={onOpenCitation}
            style={{ animationDelay: `${i * 0.05}s` }}
          />
        ))}
      </div>

    </div>
  );
}
