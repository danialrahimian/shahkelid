import { describe, expect, it } from "vitest";

import { env } from "@/config/env";
import { postUrl, shareHref, type ShareNetwork } from "@/utils/share-links";

/**
 * Share links.
 *
 * A broken one fails silently: the network opens, shows the wrong text or no
 * link at all, and nobody reports it because the reader just gives up. These
 * cases are the inputs that break a naive string join -- an ampersand that
 * ends the parameter early, a Persian title, spaces that turn into "+".
 */

const TITLE = "AES & WireGuard: امنیت در عمل";

/** Reads a parameter back the way the receiving site would. */
const param = (href: string, name: string) =>
  new URL(href).searchParams.get(name);

describe("The public address of a post", () => {
  it("When a post is shared, then the link points at the configured site, not the open tab", () => {
    expect(postUrl("dns-leaks")).toBe(
      new URL("/posts/dns-leaks", env.APP_URL).toString(),
    );
  });
});

describe("The network links", () => {
  const url = postUrl("dns-leaks");

  it("When the title has an ampersand, then it arrives whole rather than cut in two", () => {
    const href = shareHref("telegram", { url, title: TITLE });

    expect(param(href, "text")).toBe(TITLE);
    expect(param(href, "url")).toBe(url);
  });

  it("When the title has spaces, then none of them turn into plus signs", () => {
    // WhatsApp shows a literal "+" for a form-encoded space.
    const href = shareHref("whatsapp", { url, title: TITLE });

    expect(href).not.toContain("+");
    expect(param(href, "text")).toBe(`${TITLE} ${url}`);
  });

  it("When shared to X, then both the link and the title travel", () => {
    const href = shareHref("x", { url, title: TITLE });

    expect(href.startsWith("https://x.com/intent/post?")).toBe(true);
    expect(param(href, "url")).toBe(url);
    expect(param(href, "text")).toBe(TITLE);
  });

  it("When shared to LinkedIn, then only the link is sent", () => {
    // LinkedIn reads the title from the page and ignores anything else.
    const href = shareHref("linkedin", { url, title: TITLE });

    expect(param(href, "url")).toBe(url);
  });

  it("When shared by email, then the subject and body decode to the title and link", () => {
    const href = shareHref("email", { url, title: TITLE });
    const query = new URLSearchParams(href.slice("mailto:?".length));

    expect(href).not.toContain("+");
    expect(query.get("subject")).toBe(TITLE);
    expect(query.get("body")).toContain(url);
  });

  it("When any network is used, then the post's address is in the link", () => {
    const networks: ShareNetwork[] = [
      "telegram",
      "whatsapp",
      "x",
      "linkedin",
      "email",
    ];

    for (const network of networks) {
      const href = shareHref(network, { url, title: TITLE });
      expect(decodeURIComponent(href)).toContain(url);
    }
  });
});
