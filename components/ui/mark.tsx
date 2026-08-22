import * as React from "react";

import { SITE } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * The mark is the name: one disc, split down the middle, the two halves slipped
 * past each other. A version boundary with a gap you have to cross.
 */
export function Mark({ className, ...props }: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5", className)}
      {...props}
    >
      <path d="M11 2.4A8.6 8.6 0 0 0 11 19.6Z" />
      <path d="M13 4.4A8.6 8.6 0 0 1 13 21.6Z" opacity="0.42" />
    </svg>
  );
}

/** The same mark, with the halves drifting apart and back. Used once a page. */
export function MarkDrift({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-5", className)}
    >
      <path
        d="M11 2.4A8.6 8.6 0 0 0 11 19.6Z"
        className="animate-[drift_3.6s_cubic-bezier(0.22,1,0.36,1)_infinite]"
        style={{ "--drift": "-1.5px" } as React.CSSProperties}
      />
      <path
        d="M13 4.4A8.6 8.6 0 0 1 13 21.6Z"
        opacity="0.42"
        className="animate-[drift_3.6s_cubic-bezier(0.22,1,0.36,1)_infinite]"
        style={{ "--drift": "1.5px" } as React.CSSProperties}
      />
    </svg>
  );
}

/** Mark plus wordmark. Header, footer, and the analyzer nav all use this. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("group/logo inline-flex items-center gap-2.5", className)}>
      <Mark className="size-[18px] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/logo:rotate-180" />
      <span className="text-[15px] font-medium tracking-[-0.02em]">{SITE.name}</span>
    </span>
  );
}
