"use client";

type Tab = "analysis" | "scraper-monitor" | "report";

interface NavbarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  healedCount: number;
  totalBreakings: number;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "analysis",        label: "Dashboard" },
  { id: "scraper-monitor", label: "Scrapers" },
  { id: "report",          label: "Report" },
];

export default function Navbar({ activeTab, setActiveTab, healedCount, totalBreakings }: NavbarProps) {
  return (
    <header style={{
      position: "sticky",
      top: 0,
      zIndex: 40,
      height: 52,
      borderBottom: "1px solid var(--bd)",
      background: "rgba(10,10,10,0.9)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
    }}>
      <div style={{
        maxWidth: 1120,
        width: "100%",
        margin: "0 auto",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 32,
      }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="var(--bd-hi)" strokeWidth="1" />
            <path d="M7 10L9.5 12.5L13 7.5" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--t1)" }}>
            Blast Radius
          </span>
        </div>

        {/* Tabs — center */}
        <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`nav-tab${activeTab === t.id ? " active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {totalBreakings > 0 && (
            <span style={{ fontSize: 12, color: "var(--rose)", fontWeight: 500 }}>
              {totalBreakings} breaks
            </span>
          )}
          {healedCount > 0 && (
            <span style={{ fontSize: 12, color: "var(--t3)" }}>
              {healedCount} healed
            </span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span className="dot-live" />
            <span style={{ fontSize: 12, color: "var(--t3)" }}>Live</span>
          </div>
        </div>

      </div>
    </header>
  );
}
