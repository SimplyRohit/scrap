"use client";

import * as React from "react";

type Options = {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
};

export function useInView<T extends HTMLElement>({
  threshold = 0.2,
  rootMargin = "0px 0px -10% 0px",
  once = true,
}: Options = {}) {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;

    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      // No observer to subscribe to, so reveal immediately rather than leaving
      // the content faded out. Deferred so it lands as an update rather than a
      // cascading render out of the effect body.
      const timer = setTimeout(() => setInView(true), 0);

      return () => clearTimeout(timer);
    }

    let fired = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        fired = true;

        if (entry.isIntersecting) {
          setInView(true);

          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(node);

    // Reveals start at opacity 0, so a observer that never reports would hide
    // content permanently. Show it anyway if nothing has come back by then.
    const fallback = setTimeout(() => {
      if (!fired) setInView(true);
    }, 1500);

    return () => {
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}
