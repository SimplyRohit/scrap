import * as React from "react";

import { cn } from "@/lib/utils";

type DiagramFrameProps = {
  children: React.ReactNode;
  minWidth: number;
  caption?: string;
  className?: string;
};

/** Horizontal scroll on small screens rather than a squashed diagram. */
export function DiagramFrame({
  children,
  minWidth,
  caption,
  className,
}: DiagramFrameProps) {
  return (
    <figure className={cn("group", className)}>
      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <div style={{ minWidth }}>{children}</div>
      </div>

      {caption ? (
        <figcaption className="mt-4 label text-[10.5px] text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
