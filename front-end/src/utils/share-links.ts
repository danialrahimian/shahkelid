import { env } from "@/config/env";
import { paths } from "@/config/paths";

/**
 * Building the links a post is shared through.
 *
 * Kept apart from the button so the part that can actually go wrong -- the
 * encoding -- is plain functions with no browser in the way. A title with a
 * "&" or a Persian word in it has to survive every one of these intact, and
 * a half-encoded share link is one that opens on the wrong text or nothing.
 */

/**
 * The public address of a post.
 *
 * Built from the configured `APP_URL` when there is one, so a link copied
 * from a staging tab does not send the reader somewhere they cannot reach.
 * The production build leaves it empty (one build serves every domain), and
 * then the address the page was opened on is used.
 */
export const postUrl = (slug: string) =>
  new URL(paths.post.getHref(slug), env.APP_URL || window.location.origin).toString();

export type ShareNetwork =
  | "telegram"
  | "whatsapp"
  | "x"
  | "linkedin"
  | "email";

type ShareInput = { url: string; title: string };

/**
 * Each network's own "share this" address.
 *
 * These are the intent endpoints the networks publish for exactly this, so
 * nothing here needs an API key, an SDK or a script from a third party loaded
 * into the page.
 */
export const shareHref = (
  network: ShareNetwork,
  { url, title }: ShareInput,
): string => {
  // Percent-encoded by hand rather than through URLSearchParams, which writes
  // a space as "+". Not every one of these endpoints decodes that, and the
  // ones that do not show the reader a title full of plus signs.
  const query = (params: Record<string, string>) =>
    Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");

  // Networks that take one text field get the link appended to the title.
  const titleAndLink = `${title} ${url}`;

  switch (network) {
    case "telegram":
      return `https://t.me/share/url?${query({ url, text: title })}`;
    case "whatsapp":
      // WhatsApp takes a single text field, so the link rides along in it.
      return `https://wa.me/?${query({ text: titleAndLink })}`;
    case "x":
      return `https://x.com/intent/post?${query({ url, text: title })}`;
    case "linkedin":
      // LinkedIn reads the title and image from the page itself.
      return `https://www.linkedin.com/sharing/share-offsite/?${query({ url })}`;
    case "email":
      return `mailto:?${query({ subject: title, body: titleAndLink })}`;
  }
};
