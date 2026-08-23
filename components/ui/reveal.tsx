"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { cn } from "@/lib/utils";

type RevealTag = "div" | "li" | "figure" | "section" | "span" | "p";

type RevealProps = Omit<React.HTMLAttributes<HTMLElement>, "ref"> & {
  delay?: number;
  as?: RevealTag;
};

export function Reveal({
  delay = 0,
  className,
  style,
  as: Tag = "div",
  ...props
}: RevealProps) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-shown={inView}
      className={cn("reveal", className)}
      style={{ ...style, "--reveal-delay": `${delay}ms` } as React.CSSProperties}
      {...props}
    />
  );
}
