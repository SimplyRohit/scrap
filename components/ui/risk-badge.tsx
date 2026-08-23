import * as React from "react";

import { cn } from "@/lib/utils";

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SAFE";

/** Outline and text only — the surface never takes a state colour. */
const TONE: Record<RiskLevel, string> = {
  CRITICAL: "border-critical/50 text-critical",
  HIGH: "border-high/50 text-high",
  MEDIUM: "border-medium/50 text-medium",
  LOW: "border-border text-muted-foreground",
  SAFE: "border-safe/50 text-safe",
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span
      className={cn(
        "label inline-flex items-center border px-1.5 py-0.5 text-[9.5px]",
        TONE[level],
        className,
      )}
    >
      {level}
    </span>
  );
}

export const RISK_BAR: Record<RiskLevel, string> = {
  CRITICAL: "bg-critical",
  HIGH: "bg-high",
  MEDIUM: "bg-medium",
  LOW: "bg-foreground/25",
  SAFE: "bg-safe",
};
