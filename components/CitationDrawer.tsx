"use client";

import { useEffect } from "react";
import { DependencyRiskReport } from "@/lib/types";
import { X, ExternalLink, ArrowRight } from "lucide-react";

interface CitationDrawerProps {
  report: DependencyRiskReport | null;
  onClose: () => void;
}

export default function CitationDrawer({ report, onClose }: CitationDrawerProps) {
  useEffect(() => {
    if (!report) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [report, onClose]);

  if (!report) return null;
  const { dependency, breakingChanges, research } = report;

  return (
    <div
      className="anim-in"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0 0 0 / 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="anim-up"
        style={{
          width: "100%",
          maxWidth: 580,
          height: "100%",
          background: "var(--surface)",
          borderLeft: "1px solid var(--bd)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Sticky header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--bd)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}>
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>{dependency.ecosystem}</div>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--t1)", marginBottom: 8 }}>
              {dependency.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="text-mono" style={{ fontSize: 12, color: "var(--t3)" }}>v{dependency.currentVersion}</span>
              <ArrowRight size={11} color="var(--t3)" />
              <span className="text-mono" style={{ fontSize: 12, color: "var(--cyan)", fontWeight: 600 }}>v{dependency.targetVersion}</span>
              <a
                href={research.primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--t3)", textDecoration: "none", marginLeft: 8, transition: "color 140ms" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
              >
                Source <ExternalLink size={9} />
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: "var(--surface-hi)", border: "1px solid var(--bd)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t3)", flexShrink: 0, transition: "all 140ms" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t1)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Research info bar */}
        <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--bd)", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="text-label">Evidence</span>
          <span className="text-mono" style={{ fontSize: 11, color: "var(--cyan)" }}>
            {research.sourcesFetched} source{research.sourcesFetched === 1 ? "" : "s"} · {research.knowledgeExtracted} claims
          </span>
          {research.servedFromIndex && (
            <span className="badge badge-safe" style={{ marginLeft: "auto" }}>From index</span>
          )}
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          <div className="text-label" style={{ marginBottom: 16 }}>
            Breaking Changes · {breakingChanges.length}
          </div>

          {breakingChanges.length === 0 ? (
            <div style={{ padding: "18px", borderRadius: "var(--r-md)", background: "rgba(34 197 94 / 0.06)", border: "1px solid rgba(34 197 94 / 0.12)", fontSize: 13, color: "var(--green)" }}>
              ✓ No breaking changes in scraped release notes.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {breakingChanges.map((item, idx) => (
                <div key={item.id} className="anim-up" style={{ animationDelay: `${idx * 50}ms` }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span className="text-mono" style={{ fontSize: 10, color: "var(--t3)", flexShrink: 0 }}>
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--t1)" }}>
                        {item.title}
                      </span>
                    </div>
                    <span className={`badge ${item.severity === "CRITICAL" ? "badge-critical" : "badge-high"}`} style={{ flexShrink: 0 }}>
                      {item.severity}
                    </span>
                  </div>

                  <p style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.65, paddingLeft: 22, marginBottom: 12 }}>
                    {item.description}
                  </p>

                  {(item.beforeSnippet || item.afterSnippet) && (
                    <div style={{ paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                      {item.beforeSnippet && (
                        <div>
                          <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 5, fontWeight: 600 }}>
                            Before · v{dependency.currentVersion}
                          </div>
                          <pre className="code-block" style={{ color: "#fda4af", background: "rgba(244 63 94 / 0.03)", borderColor: "rgba(244 63 94 / 0.1)" }}>
                            {item.beforeSnippet}
                          </pre>
                        </div>
                      )}
                      {item.afterSnippet && (
                        <div>
                          <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--green)", marginBottom: 5, fontWeight: 600 }}>
                            After · v{dependency.targetVersion}
                          </div>
                          <pre className="code-block" style={{ color: "#86efac", background: "rgba(34 197 94 / 0.03)", borderColor: "rgba(34 197 94 / 0.1)" }}>
                            {item.afterSnippet}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Citation */}
                  <div style={{ paddingLeft: 22, paddingTop: 10, borderLeft: "2px solid var(--bd-hi)", marginLeft: 8 }}>
                    <p style={{ fontSize: 11, color: "var(--t3)", fontStyle: "italic", lineHeight: 1.6, marginBottom: 5 }}>
                      &ldquo;{item.citation.quotedText}&rdquo;
                    </p>
                    <a
                      href={item.citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-caption"
                      style={{ display: "flex", alignItems: "center", gap: 4, textDecoration: "none", transition: "color 140ms" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--t2)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)"; }}
                    >
                      {item.citation.title} <ExternalLink size={9} />
                    </a>
                  </div>

                  {idx < breakingChanges.length - 1 && (
                    <div className="divider" style={{ marginTop: 24 }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--bd)", display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Close · Esc</button>
        </div>
      </div>
    </div>
  );
}
