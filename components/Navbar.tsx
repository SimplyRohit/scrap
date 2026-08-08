"use client";

import { ShieldAlert, Activity } from "lucide-react";

type Tab = "analysis" | "scraper-monitor" | "report";

interface NavbarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  healedCount: number;
  totalBreakings: number;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "analysis",        label: "Blast Dashboard" },
  { id: "scraper-monitor", label: "Scraper Monitor" },
  { id: "report",          label: "Upgrade Report"  },
];

export default function Navbar({ activeTab, setActiveTab, healedCount, totalBreakings }: NavbarProps) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(8,8,8,0.88)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--cyan-dim)",
              border: "1px solid rgba(34,211,238,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <ShieldAlert size={14} color="var(--cyan)" />
            <span className="live-dot" style={{ position: "absolute", top: -3, right: -3 }} />
          </div>
          <div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--text-hi)",
                letterSpacing: "-0.025em",
                lineHeight: 1,
              }}
            >
              Blast Radius
            </span>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-lo)",
                fontFamily: "var(--font-geist-mono), monospace",
                marginTop: 2,
              }}
            >
              Bright Data · Into the Scrape-Verse
            </div>
          </div>
        </div>

        {/* Center Tabs */}
        <nav className="tab-root" style={{ flex: "0 0 auto" }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-item ${activeTab === tab.id ? "tab-item-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right status pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {totalBreakings > 0 && (
            <span className="pill pill-rose animate-fade-in">
              <ShieldAlert size={10} />
              {totalBreakings} breaks
            </span>
          )}
          {healedCount > 0 && (
            <span className="pill pill-amber animate-fade-in">
              <Activity size={10} />
              {healedCount} healed
            </span>
          )}
          <span className="pill pill-emerald">
            <span className="live-dot" style={{ width: 5, height: 5 }} />
            Live
          </span>
        </div>
      </div>
    </header>
  );
}
