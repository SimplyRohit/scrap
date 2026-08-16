"use client";

import { FullBlastRadiusAnalysis, SourceTransport } from "@/lib/types";
import { Terminal, ExternalLink, Database, Globe, Shield, AlertTriangle } from "lucide-react";

const TRANSPORT_LABEL: Record<SourceTransport, { label: string; color: string; icon: typeof Globe }> = {
  brightdata: { label: "Unlocker", color: "var(--amber)", icon: Shield },
  direct:     { label: "Direct",   color: "var(--cyan)",  icon: Globe },
  cache:      { label: "Cache",    color: "var(--green)", icon: Database },
};

export default function ScraperStudioMonitor({ analysis }: { analysis: FullBlastRadiusAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="surface anim-up" style={{ padding: "64px 32px", textAlign: "center" }}>
        <Terminal size={24} color="var(--t3)" style={{ margin: "0 auto 14px" }} />
        <div className="text-title" style={{ marginBottom: 5 }}>No research yet</div>
        <div className="text-body" style={{ maxWidth: 360, margin: "0 auto" }}>
          Run an analysis from the Dashboard to see which sources were read and what was extracted from each.
        </div>
      </div>
    );
  }

  const { reports, researchSummary } = analysis;

  const stats: [string, number, string][] = [
    ["Sources read", researchSummary.totalSourcesFetched, "var(--t1)"],
    ["Via unlocker", researchSummary.unlockedSourceCount, "var(--amber)"],
    ["From cache", researchSummary.cacheHits, "var(--green)"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Summary */}
      <div className="surface anim-up" style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="text-title" style={{ marginBottom: 3 }}>Research trace</div>
          <div className="text-body" style={{ fontSize: 12 }}>
            Sources planned by authority · fetched via Bright Data or directly · normalized into claims
          </div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {stats.map(([label, value, color], i) => (
            <div key={label} style={{ display: "flex", gap: 24 }}>
              {i > 0 && <div style={{ width: 1, background: "var(--bd)" }} />}
              <div style={{ textAlign: "right" }}>
                <div className="text-mono" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", color, lineHeight: 1 }}>
                  {value}
                </div>
                <div className="text-label" style={{ marginTop: 4 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Explanation */}
      <div className="anim-up d-1" style={{ paddingLeft: 14, borderLeft: "2px solid var(--bd-hi)" }}>
        <p className="text-body" style={{ fontSize: 12 }}>
          <strong style={{ color: "var(--t1)" }}>How sources are chosen:</strong> the engine ranks candidates by
          authority — official migration guides and changelogs before release notes, registries before community
          posts — and reads them in that order until the document budget is spent. Documentation hosts that block
          automated requests are retrieved through the Bright Data unlocker; registries and APIs are fetched
          directly. A fresh cached copy is reused rather than re-fetched.
        </p>
      </div>

      {/* Per-package source cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
        {reports.map((report, i) => {
          const { dependency, research, sources } = report;

          return (
            <div key={dependency.name} className={`surface anim-up d-${Math.min(i + 1, 8)}`} style={{ padding: "18px 20px" }}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--t1)", marginBottom: 2 }}>
                    {dependency.name}
                  </div>
                  <div className="text-caption">{dependency.ecosystem}</div>
                </div>
                {research.servedFromIndex
                  ? <span className="badge badge-safe"><Database size={9} /> Indexed</span>
                  : <span className="badge badge-safe">{research.sourcesFetched} source{research.sourcesFetched === 1 ? "" : "s"}</span>
                }
              </div>

              {/* Counts */}
              <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
                <Row label="Claims indexed" value={`${research.knowledgeExtracted}`} />
                {research.failures > 0 && (
                  <Row label="Fetch failures" value={`${research.failures}`} color="var(--amber)" />
                )}
                {research.primaryUrl && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span className="text-label">Primary</span>
                    <a
                      href={research.primaryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-caption"
                      style={{ display: "flex", alignItems: "center", gap: 3, textDecoration: "none", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 140ms" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
                    >
                      {research.primaryUrl} <ExternalLink size={9} style={{ flexShrink: 0 }} />
                    </a>
                  </div>
                )}
              </div>

              {/* Sources read */}
              {sources.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 8 }}>
                  {sources.slice(0, 4).map(source => {
                    const t = TRANSPORT_LABEL[source.transport];
                    const Icon = t.icon;
                    return (
                      <div key={source.sourceUrl}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                          <Icon size={10} color={t.color} style={{ flexShrink: 0 }} />
                          <span className="text-label" style={{ color: t.color }}>{t.label}</span>
                          <span className="text-caption" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {source.sourceType}
                          </span>
                          <span className="text-caption" style={{ marginLeft: "auto", flexShrink: 0 }}>
                            {source.extractedClaims.length} claim{source.extractedClaims.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {source.extractedClaims.length === 0 && (
                          <p className="text-caption" style={{ paddingLeft: 15, display: "flex", alignItems: "center", gap: 4 }}>
                            <AlertTriangle size={9} /> read, but nothing extractable
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {sources.length > 4 && (
                    <span className="text-caption">+{sources.length - 4} more</span>
                  )}
                </div>
              )}

              {sources.length === 0 && !research.servedFromIndex && (
                <p className="text-caption" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--bd)", display: "flex", alignItems: "center", gap: 5 }}>
                  <AlertTriangle size={10} color="var(--amber)" />
                  No sources retrieved — findings are unverified, not absent.
                </p>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span className="text-label">{label}</span>
      <span className="text-mono" style={{ fontSize: 11, color: color ?? "var(--t2)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
