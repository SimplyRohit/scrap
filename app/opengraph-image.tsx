import { ImageResponse } from "next/og";

import { SITE } from "@/lib/marketing/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#e9e7e2";
const INK = "#0c0c0b";
const RULE = "#c3bfb6";
const GRAPHITE = "#56544e";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: "72px 80px",
          position: "relative",
        }}
      >
        {/* The mark, blown up and bled off the right edge. */}
        <svg
          width="560"
          height="560"
          viewBox="0 0 24 24"
          fill={RULE}
          style={{ position: "absolute", right: -120, top: 40 }}
        >
          <path d="M10.8 3.6A8 8 0 0 0 10.8 19.6Z" />
          <path d="M13.2 4.4A8 8 0 0 1 13.2 20.4Z" opacity="0.5" />
        </svg>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill={INK}>
            <path d="M10.8 3.6A8 8 0 0 0 10.8 19.6Z" />
            <path d="M13.2 4.4A8 8 0 0 1 13.2 20.4Z" opacity="0.45" />
          </svg>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {SITE.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 820 }}>
          <div
            style={{
              fontSize: 82,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
            }}
          >
            Know what breaks before you upgrade.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 28,
              lineHeight: 1.45,
              color: GRAPHITE,
              letterSpacing: "-0.01em",
            }}
          >
            Every dependency researched against its own changelogs — and every breaking
            change quoted from the sentence it was found in.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            borderTop: `1px solid ${RULE}`,
            paddingTop: 28,
            fontSize: 22,
            color: GRAPHITE,
          }}
        >
          <span>{SITE.install}</span>
        </div>
      </div>
    ),
    size,
  );
}
