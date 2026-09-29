import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Whether the viewport is phone-sized.
 *
 * Adapted from the shadcn version, which read the width in an effect: the
 * first render always answered "desktop", so on a phone the sidebar mounted
 * as a desktop sidebar and then swapped itself for a sheet. Reading the media
 * query as an external store answers correctly on the first render, and
 * answers "desktop" on the server, where there is no window to measure.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
