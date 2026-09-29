import * as React from "react";

/**
 * Seconds left until a moment, ticking once a second, and a way to start
 * over. Used for "send the code again in 42 seconds".
 */
export const useCountdown = (seconds: number) => {
  const [until, setUntil] = React.useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = React.useState(() => Date.now());

  const running = now < until;
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const restart = React.useCallback(
    (from = seconds) => {
      const start = Date.now();
      setNow(start);
      setUntil(start + from * 1000);
    },
    [seconds],
  );

  return { remaining: Math.max(0, Math.ceil((until - now) / 1000)), restart };
};
