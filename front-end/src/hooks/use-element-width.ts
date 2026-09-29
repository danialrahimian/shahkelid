import * as React from "react";

/**
 * The rendered width of an element, kept current as it resizes.
 *
 * SVG charts need real pixel coordinates: scaling a viewBox to fit instead
 * would stretch the strokes and the type along with the plot. Measuring gives
 * a chart that reflows properly on a phone rather than one that is merely
 * squashed.
 */
export const useElementWidth = <T extends HTMLElement>(fallback = 640) => {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(fallback);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    setWidth(element.clientWidth || fallback);

    // Guarded: jsdom and older Safari have no ResizeObserver, and a chart that
    // cannot measure itself should still render at the fallback width.
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      const measured = entry.contentRect.width;
      if (measured > 0) setWidth(measured);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [fallback]);

  return [ref, width] as const;
};
