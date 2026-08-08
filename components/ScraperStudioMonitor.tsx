"use client";

import { FullBlastRadiusAnalysis } from "@/lib/types";
import { Terminal, ExternalLink, RefreshCw, CheckCircle2, Activity } from "lucide-react";

export default function ScraperStudioMonitor({ analysis }: { analysis: FullBlastRadiusAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="surface anim-up" style={{ padding: "64px 32px", textAlign: "center" }}>
        <Terminal size={24} color="var(--t3)" style={{ margin: "0 auto 14px" }} />
        <div className="text-title" style={{ marginBottom: 5 }}>No active scrapers</div>
        <div className="text-body" style={{ maxWidth: 360, margin: "0 auto" }}>
          Run an analysis from the Dashboard to launch Bright Data collectors.
        </div>
      </div>
    );
  }

  const { reports, selfHealingSummary } = analysis;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Summary */}
      <div className="surface anim-up" style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div className="text-title" style={{ marginBottom: 3 }}>Bright Data Scraper Studio</div>
          <div className="text-body" style={{ fontSize: 12 }}>Self-healing collector deployment · Into the Scrape-Verse</div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ textAlign: "right" }}>
            <div className="text-mono" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--t1)", lineHeight: 1 }}>
              {selfHealingSummary.totalScrapersDeployed}
            </div>
            <div className="text-label" style={{ marginTop: 4 }}>Deployed</div>
          </div>
          <div style={{ width: 1, background: "var(--bd)" }} />
          <div style={{ textAlign: "right" }}>
            <div className="text-mono" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--amber)", lineHeight: 1 }}>
              {selfHealingSummary.healedScraperCount}
            </div>
            <div className="text-label" style={{ marginTop: 4 }}>Self-Healed</div>
          </div>
        </div>
      </div>

      {/* Explanation */}
      <div className="anim-up d-1" style={{ paddingLeft: 14, borderLeft: "2px solid var(--bd-hi)" }}>
        <p className="text-body" style={{ fontSize: 12 }}>
          <strong style={{ color: "var(--t1)" }}>Why self-healing matters:</strong> Doc sites change HTML structure silently. Static scrapers break quietly. Bright Data Scraper Studio detects selector failures, regenerates a schema envelope, and heals in-place — zero manual maintenance.
        </p>
      </div>

      {/* Collector grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
        {reports.map((report, i) => {
          const { dependency, collectorStatus, scrapedReleases } = report;
          const release = scrapedReleases[0];
          const healed = collectorStatus.status === "healed";

          return (
            <div key={dependency.name} className={`surface anim-up d-${Math.min(i + 1, 8)}`} style={{ padding: "18px 20px" }}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--t1)", marginBottom: 2 }}>
                    {dependency.name}
                  </div>
                  <div className="text-caption">{dependency.ecosystem}</div>
                </div>
                {healed
                  ? <span className="badge badge-high"><RefreshCw size={9} /> Healed</span>
                  : <span className="badge badge-safe"><CheckCircle2 size={9} /> Healthy</span>
                }
              </div>

              {/* Details */}
              <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
                {[
                  ["Collector ID", collectorStatus.collectorId, "var(--cyan)"],
                  ["Fields", `${collectorStatus.fieldsExtracted} extracted`, null],
                ].map(([k, v, color]) => (
                  <div key={k as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="text-label">{k}</span>
                    <span className="text-mono" style={{ fontSize: 11, color: (color as string) ?? "var(--t2)", fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="text-label">URL</span>
                  <a
                    href={collectorStatus.scrapedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-caption"
                    style={{ display: "flex", alignItems: "center", gap: 3, textDecoration: "none", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 140ms" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
                  >
                    {collectorStatus.scrapedUrl} <ExternalLink size={9} style={{ flexShrink: 0 }} />
                  </a>
                </div>
              </div>

              {/* Heal envelope */}
              {release?.healEnvelope && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--bd)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                    <Activity size={11} color="var(--amber)" />
                    <span className="text-label" style={{ color: "var(--amber)" }}>Self-Heal Envelope</span>
                  </div>
                  <p className="text-mono" style={{ fontSize: 11, color: "var(--t2)", lineHeight: 1.6, marginBottom: 10 }}>
                    "{release.healEnvelope.reason}"
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      ["Original", release.healEnvelope.originalSchema.join(", "), "var(--t3)"],
                      ["Healed", release.healEnvelope.healedSchema.slice(3).join(", "), "var(--cyan)"],
                    ].map(([label, val, color]) => (
                      <div key={label as string} style={{ padding: "8px 10px", borderRadius: "var(--r-sm)", background: "rgba(255 255 255 / 0.03)" }}>
                        <div className="text-label" style={{ marginBottom: 4 }}>{label}</div>
                        <div className="text-mono" style={{ fontSize: 10, color: color as string, lineHeight: 1.5 }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
