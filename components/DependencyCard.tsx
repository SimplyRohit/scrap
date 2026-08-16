"use client";

import { DependencyRiskReport } from "@/lib/types";
import { ArrowRight, ExternalLink, ChevronRight } from "lucide-react";

interface DependencyCardProps {
  report: DependencyRiskReport;
  onOpenCitation: (r: DependencyRiskReport) => void;
  style?: React.CSSProperties;
}

const RISK: Record<string, { strip: string; badge: string; label: string; scoreColor: string }> = {
  CRITICAL: { strip: "strip-critical", badge: "badge-critical", label: "Critical", scoreColor: "var(--rose)" },
  HIGH:     { strip: "strip-high",     badge: "badge-high",     label: "High",     scoreColor: "var(--amber)" },
  MEDIUM:   { strip: "strip-medium",   badge: "badge-medium",   label: "Medium",   scoreColor: "#eab308" },
  LOW:      { strip: "strip-safe",     badge: "badge-cyan",     label: "Low",      scoreColor: "var(--cyan)" },
  SAFE:     { strip: "strip-safe",     badge: "badge-safe",     label: "Safe",     scoreColor: "var(--green)" },
};

export default function DependencyCard({ report, onOpenCitation, style }: DependencyCardProps) {
  const { dependency, overallRiskScore, riskLevel, breakingChanges, research } = report;
  const r = RISK[riskLevel] ?? RISK.SAFE;

  return (
    <div
      className="surface surface-hover anim-up"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden", ...style }}
    >
      {/* 1px top risk strip */}
      <div className={`strip ${r.strip}`} />

      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--t1)", marginBottom: 5 }}>
              {dependency.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="text-mono" style={{ fontSize: 11, color: "var(--t3)" }}>v{dependency.currentVersion}</span>
              <ArrowRight size={10} color="var(--t3)" />
              <span className="text-mono" style={{ fontSize: 11, color: "var(--cyan)", fontWeight: 600 }}>v{dependency.targetVersion}</span>
            </div>
          </div>
          <span className={`badge ${r.badge}`}>{r.label}</span>
        </div>

        {/* Score bar */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span className="text-label">Risk Score</span>
            <span className="text-mono" style={{ fontSize: 11, fontWeight: 700, color: r.scoreColor }}>
              {overallRiskScore}/100
            </span>
          </div>
          <div className="score-track">
            <div
              className="score-fill"
              style={{ width: `${overallRiskScore}%`, background: r.scoreColor }}
            />
          </div>
        </div>

        {/* Breaking changes preview */}
        <div style={{ flex: 1 }}>
          {breakingChanges.length === 0 ? (
            <p className="text-body" style={{ color: "var(--t3)", fontStyle: "italic", fontSize: 12 }}>
              No breaking changes detected.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {breakingChanges.slice(0, 2).map(item => (
                <div key={item.id}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--t1)", marginBottom: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.5,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {item.description}
                  </div>
                </div>
              ))}
              {breakingChanges.length > 2 && (
                <span style={{ fontSize: 11, color: "var(--t3)" }}>+{breakingChanges.length - 2} more</span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--bd)" }}>
          <a
            href={research.primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-caption"
            style={{ display: "flex", alignItems: "center", gap: 3, textDecoration: "none", transition: "color 140ms" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
          >
            {research.primaryUrl} <ExternalLink size={9} />
          </a>
          <button
            onClick={() => onOpenCitation(report)}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--t3)",
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, transition: "color 140ms" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t1)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
          >
            {breakingChanges.length} citations <ChevronRight size={12} />
          </button>
        </div>

      </div>
    </div>
  );
}
