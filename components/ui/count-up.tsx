"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

type CountUpProps = {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
};

const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

/** A number that counts to itself once, when it first comes into view. */
export function CountUp({ value, decimals = 0, duration = 900, className }: CountUpProps) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const reduced = useReducedMotion();

  const [shown, setShown] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;

    let frame = 0;
    const began = performance.now();
    // Zero duration makes the first tick land on 1, which is the whole
    // animation for anyone who asked not to have one.
    const total = reduced ? 0 : duration;

    const tick = (now: number) => {
      const progress = total > 0 ? Math.min((now - began) / total, 1) : 1;

      setShown(value * easeOutQuint(progress));

      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value, duration]);

  return (
    <span ref={ref} className={cn("tally", className)}>
      {shown.toFixed(decimals)}
    </span>
  );
}
