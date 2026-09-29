import { env } from "@/config/env";

/**
 * Turns a stored upload path into a URL the browser can load.
 *
 * The API stores images as "/uploads/<name>" and serves them from its own
 * origin, not the app's. Every component used to paste the host in front by
 * hand, which is why the server address appeared in dozens of files.
 */
export const assetUrl = (path: string | null | undefined): string | null => {
  if (!path) return null;

  // Already absolute: an external image, or a data URI from a file preview.
  if (/^(https?:|data:|blob:)/.test(path)) return path;

  return `${env.API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
};
