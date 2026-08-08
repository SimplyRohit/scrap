"use client";

import { DependencyRiskReport } from "@/lib/types";
import { X, ExternalLink, ArrowRight, ChevronDown } from "lucide-react";
import { useEffect } from "react";

interface CitationDrawerProps {
  report: DependencyRiskReport | null;
  onClose: () => void;
}

export default function CitationDrawer({ report, onClose }: CitationDrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!report) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [report, onClose]);

  if (!report) return null;

  const { dependency, breakingChanges, collectorStatus } = report;

  return (
    <div
      className="animate-fade-in"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        justifyContent: "flex-end",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Drawer panel */}
      <div
        className="animate-fade-up"
        style={{
          width: "100%",
          maxWidth: 600,
          height: "100%",
          background: "var(--bg-card)",
          borderLeft: "1px solid var(--border)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "24px 28px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            position: "sticky",
            top: 0,
            background: "var(--bg-card)",
            zIndex: 1,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--text-lo)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {dependency.ecosystem}
              </span>
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "-0.03em",
                color: "var(--text-hi)",
                marginBottom: 6,
              }}
            >
              {dependency.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, color: "var(--text-lo)" }}>
                v{dependency.currentVersion}
              </span>
              <ArrowRight size={11} color="var(--text-lo)" />
              <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, color: "var(--cyan)", fontWeight: 600 }}>
                v{dependency.targetVersion}
              </span>
              <a
                href={collectorStatus.scrapedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 11,
                  color: "var(--text-lo)",
                  textDecoration: "none",
                  marginLeft: 8,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cyan)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-lo)"; }}
              >
                Source
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-mid)",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-hi)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-mid)"; }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Collector info */}
        <div
          style={{
            padding: "14px 28px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span style={{ fontSize: 10, color: "var(--text-lo)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Bright Data Collector
          </span>
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--cyan)",
              fontWeight: 600,
            }}
          >
            {collectorStatus.collectorId}
          </span>
          {collectorStatus.status === "healed" && (
            <span className="pill pill-amber" style={{ marginLeft: "auto" }}>⚡ Self-Healed</span>
          )}
        </div>

        {/* Breaking changes */}
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "var(--text-lo)",
            }}
          >
            Breaking Changes · {breakingChanges.length}
          </div>

          {breakingChanges.length === 0 ? (
            <div
              style={{
                padding: "20px",
                borderRadius: 12,
                background: "var(--emerald-dim)",
                border: "1px solid rgba(52,211,153,0.15)",
                fontSize: 13,
                color: "var(--emerald)",
              }}
            >
              ✓ No breaking API changes detected in scraped release notes.
            </div>
          ) : (
            breakingChanges.map((item, idx) => (
              <div
                key={item.id}
                className="animate-fade-up"
                style={{ animationDelay: `${idx * 0.06}s`, display: "flex", flexDirection: "column", gap: 12 }}
              >
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        color: "var(--text-lo)",
                        marginTop: 2,
                        flexShrink: 0,
                      }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", letterSpacing: "-0.015em" }}>
                      {item.title}
                    </span>
                  </div>
                  <span
                    className={`pill ${item.severity === "CRITICAL" ? "pill-rose" : "pill-amber"}`}
                    style={{ flexShrink: 0 }}
                  >
                    {item.severity}
                  </span>
                </div>

                {/* Description */}
                <p style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.65, paddingLeft: 28 }}>
                  {item.description}
                </p>

                {/* Code migration */}
                {(item.beforeSnippet || item.afterSnippet) && (
                  <div style={{ paddingLeft: 28, display: "flex", flexDirection: "column", gap: 8 }}>
                    {item.beforeSnippet && (
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 5, fontWeight: 600 }}>
                          Before · v{dependency.currentVersion}
                        </div>
                        <pre className="code-block" style={{ color: "var(--rose)", background: "rgba(251,113,133,0.04)", borderColor: "rgba(251,113,133,0.12)" }}>
                          {item.beforeSnippet}
                        </pre>
                      </div>
                    )}
                    {item.afterSnippet && (
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--emerald)", marginBottom: 5, fontWeight: 600 }}>
                          After · v{dependency.targetVersion}
                        </div>
                        <pre className="code-block" style={{ color: "var(--emerald)", background: "rgba(52,211,153,0.04)", borderColor: "rgba(52,211,153,0.12)" }}>
                          {item.afterSnippet}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Citation */}
                <div
                  style={{
                    paddingLeft: 28,
                    padding: "10px 12px 10px 28px",
                    borderLeft: "2px solid var(--border-hi)",
                    marginLeft: 0,
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--text-lo)", fontStyle: "italic", lineHeight: 1.6, marginBottom: 4 }}>
                    "{item.citation.quotedText}"
                  </div>
                  <a
                    href={item.citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 10,
                      color: "var(--text-lo)",
                      textDecoration: "none",
                      transition: "color 0.15s",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cyan)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-lo)"; }}
                  >
                    {item.citation.title}
                    <ExternalLink size={9} />
                  </a>
                </div>

                {/* Divider between items */}
                {idx < breakingChanges.length - 1 && (
                  <div style={{ height: 1, background: "var(--border)", marginTop: 4 }} />
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 28px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "auto",
          }}
        >
          <button className="btn-secondary" onClick={onClose}>
            Close · Esc
          </button>
        </div>
      </div>
    </div>
  );
}
