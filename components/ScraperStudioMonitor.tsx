"use client";

import { FullBlastRadiusAnalysis } from "@/lib/types";
import { Terminal, ExternalLink, RefreshCw, CheckCircle2, Activity } from "lucide-react";

interface ScraperStudioMonitorProps {
  analysis: FullBlastRadiusAnalysis | null;
}

export default function ScraperStudioMonitor({ analysis }: ScraperStudioMonitorProps) {
  if (!analysis) {
    return (
      <div
        className="card animate-fade-up"
        style={{ padding: "64px 32px", textAlign: "center" }}
      >
        <Terminal size={28} color="var(--text-lo)" style={{ margin: "0 auto 16px" }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-hi)", marginBottom: 6 }}>
          No active scrapers
        </div>
        <div style={{ fontSize: 13, color: "var(--text-lo)", maxWidth: 400, margin: "0 auto" }}>
          Run an analysis from the Blast Dashboard to launch Bright Data collectors.
        </div>
      </div>
    );
  }

  const { reports, selfHealingSummary } = analysis;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Summary bar */}
      <div
        className="card animate-fade-up"
        style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", marginBottom: 2 }}>
            Bright Data Scraper Studio
          </div>
          <div style={{ fontSize: 11, color: "var(--text-lo)" }}>
            Self-healing collector deployment · Into the Scrape-Verse Hackathon
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 20, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text-hi)" }}>
              {selfHealingSummary.totalScrapersDeployed}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Deployed</div>
          </div>
          <div style={{ width: 1, height: 36, background: "var(--border)" }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 20, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--amber)" }}>
              {selfHealingSummary.healedScraperCount}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Self-Healed</div>
          </div>
        </div>
      </div>

      {/* Self-healing explanation — minimal callout */}
      <div
        className="animate-fade-up stagger-1"
        style={{
          padding: "14px 20px",
          borderRadius: 10,
          borderLeft: "2px solid var(--cyan)",
          background: "rgba(34,211,238,0.03)",
          fontSize: 12,
          color: "var(--text-mid)",
          lineHeight: 1.65,
        }}
      >
        <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>Why self-healing matters:</strong> Doc sites (GitHub Releases, Docusaurus, Sphinx) change HTML structure silently. Standard scrapers break quietly. Bright Data Scraper Studio detects selector failures, regenerates a schema envelope, and heals the collector in-place — zero manual maintenance.
      </div>

      {/* Collector grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        {reports.map((report, i) => {
          const { dependency, collectorStatus, scrapedReleases } = report;
          const release = scrapedReleases[0];
          const healed = collectorStatus.status === "healed";

          return (
            <div
              key={dependency.name}
              className="card animate-fade-up"
              style={{ padding: "18px 20px", animationDelay: `${i * 0.05}s` }}
            >
              {/* Collector header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", letterSpacing: "-0.02em" }}>
                    {dependency.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10,
                      color: "var(--text-lo)",
                      marginTop: 2,
                    }}
                  >
                    {dependency.ecosystem}
                  </div>
                </div>
                {healed ? (
                  <span className="pill pill-amber">
                    <RefreshCw size={9} />
                    Healed
                  </span>
                ) : (
                  <span className="pill pill-emerald">
                    <CheckCircle2 size={9} />
                    Healthy
                  </span>
                )}
              </div>

              {/* Details table */}
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {[
                  { key: "Collector ID",    val: collectorStatus.collectorId,   mono: true, accent: "var(--cyan)" },
                  { key: "Fields extracted", val: `${collectorStatus.fieldsExtracted} fields`, mono: true },
                ].map(({ key, val, mono, accent }) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{key}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: mono ? "var(--font-geist-mono), monospace" : undefined,
                        color: accent ?? "var(--text-mid)",
                        fontWeight: 500,
                      }}
                    >
                      {val}
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Target URL</span>
                  <a
                    href={collectorStatus.scrapedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 11,
                      fontFamily: "var(--font-geist-mono), monospace",
                      color: "var(--text-lo)",
                      textDecoration: "none",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cyan)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-lo)"; }}
                  >
                    {collectorStatus.scrapedUrl}
                    <ExternalLink size={9} style={{ flexShrink: 0 }} />
                  </a>
                </div>
              </div>

              {/* Heal envelope */}
              {release?.healEnvelope && (
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Activity size={11} color="var(--amber)" />
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Self-Heal Envelope
                    </span>
                  </div>
                  <p
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10.5,
                      color: "var(--text-mid)",
                      lineHeight: 1.6,
                      marginBottom: 10,
                    }}
                  >
                    "{release.healEnvelope.reason}"
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      { label: "Original schema", val: release.healEnvelope.originalSchema.join(", "), accent: "var(--text-lo)" },
                      { label: "Healed schema", val: release.healEnvelope.healedSchema.slice(3).join(", "), accent: "var(--cyan)" },
                    ].map(({ label, val, accent }) => (
                      <div
                        key={label}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 7,
                          background: "rgba(255,255,255,0.025)",
                        }}
                      >
                        <div style={{ fontSize: 9, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 10, fontFamily: "var(--font-geist-mono), monospace", color: accent, lineHeight: 1.5 }}>
                          {val}
                        </div>
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
