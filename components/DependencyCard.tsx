"use client";

import { DependencyRiskReport } from "@/lib/types";
import { ArrowRight, ExternalLink, ChevronRight } from "lucide-react";

interface DependencyCardProps {
  report: DependencyRiskReport;
  onOpenCitation: (report: DependencyRiskReport) => void;
  style?: React.CSSProperties;
}

const RISK_CONFIG = {
  CRITICAL: { label: "Critical", stripClass: "risk-strip-critical", pillClass: "pill-rose" },
  HIGH:     { label: "High",     stripClass: "risk-strip-high",     pillClass: "pill-amber" },
  MEDIUM:   { label: "Medium",   stripClass: "risk-strip-medium",   pillClass: "pill-amber" },
  LOW:      { label: "Low",      stripClass: "risk-strip-safe",     pillClass: "pill-cyan" },
  SAFE:     { label: "Safe",     stripClass: "risk-strip-safe",     pillClass: "pill-emerald" },
} as const;

export default function DependencyCard({ report, onOpenCitation, style }: DependencyCardProps) {
  const { dependency, overallRiskScore, riskLevel, breakingChanges, collectorStatus } = report;
  const risk = RISK_CONFIG[riskLevel as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.SAFE;

  return (
    <div
      className="card card-hover card-glow-cyan animate-fade-up"
      style={{ display: "flex", flexDirection: "column", overflow: "hidden", cursor: "default", ...style }}
    >
      {/* Risk color strip — top 2px bar */}
      <div className={risk.stripClass} style={{ height: 2, width: "100%", flexShrink: 0 }} />

      <div style={{ padding: "18px 20px 16px", display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {/* Name */}
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-hi)", letterSpacing: "-0.02em", marginBottom: 4 }}>
              {dependency.name}
            </div>
            {/* Version arrow */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--text-lo)",
                }}
              >
                v{dependency.currentVersion}
              </span>
              <ArrowRight size={10} color="var(--text-lo)" />
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--cyan)",
                  fontWeight: 600,
                }}
              >
                v{dependency.targetVersion}
              </span>
            </div>
          </div>

          {/* Risk pill */}
          <span className={`pill ${risk.pillClass}`} style={{ flexShrink: 0 }}>
            {risk.label}
          </span>
        </div>

        {/* Risk score bar */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 5,
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-lo)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Risk Score
            </span>
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                fontWeight: 700,
                color: overallRiskScore >= 70 ? "var(--rose)" : overallRiskScore >= 40 ? "var(--amber)" : "var(--emerald)",
              }}
            >
              {overallRiskScore}/100
            </span>
          </div>
          <div
            style={{
              height: 3,
              borderRadius: 99,
              background: "var(--bg-hover)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${overallRiskScore}%`,
                borderRadius: 99,
                background:
                  overallRiskScore >= 70 ? "var(--rose)" :
                  overallRiskScore >= 40 ? "var(--amber)" :
                  "var(--emerald)",
                transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
              }}
            />
          </div>
        </div>

        {/* Breaking changes preview */}
        <div style={{ flex: 1 }}>
          {breakingChanges.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-lo)", fontStyle: "italic" }}>
              No breaking changes detected.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {breakingChanges.slice(0, 2).map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.025)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--text-hi)",
                      marginBottom: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-mid)",
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.description}
                  </div>
                </div>
              ))}
              {breakingChanges.length > 2 && (
                <span style={{ fontSize: 11, color: "var(--text-lo)" }}>
                  +{breakingChanges.length - 2} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
            marginTop: "auto",
          }}
        >
          {/* Collector ID */}
          <a
            href={collectorStatus.scrapedUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              color: "var(--text-lo)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cyan)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-lo)"; }}
          >
            {collectorStatus.collectorId}
            <ExternalLink size={9} />
          </a>

          {/* View citations */}
          <button
            onClick={() => onOpenCitation(report)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--text-mid)",
              background: "none",
              border: "none",
              cursor: "pointer",
              transition: "color 0.15s",
              padding: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-hi)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-mid)"; }}
          >
            {breakingChanges.length} citations
            <ChevronRight size={12} />
          </button>
        </div>

      </div>
    </div>
  );
}
