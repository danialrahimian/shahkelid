import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a media query.
 *
 * Uses useSyncExternalStore rather than an effect that calls setState: the
 * match is read during render, so the first paint is already correct instead of
 * rendering the `false` branch and then re-rendering.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = globalThis.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => globalThis.matchMedia(query).matches,
    [query],
  );

  // No DOM while server-rendering or pre-rendering: report "not matching".
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
