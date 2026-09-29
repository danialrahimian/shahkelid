import { describe, expect, it } from "vitest";

import { postInputSchema, splitTags } from "@/api/posts";

/**
 * The post form's rules.
 *
 * The server tidies tags the same way, so what the form previews under the
 * field is what ends up stored. If the two ever disagree, a writer sees one
 * set of tags while publishing and finds another in the journal.
 */

const valid = {
  title: "Why DNS leaks matter",
  excerpt: "A short summary of the article.",
  content:
    "A body long enough to pass the minimum, which stops a one-line article.",
  tags: "privacy, dns",
  cover: null,
};

describe("Tags as typed", () => {
  it("When tags are typed with commas, then they become a tidy list", () => {
    expect(splitTags(" Privacy, dns ,  Public Wi-Fi ,, ")).toEqual([
      "privacy",
      "dns",
      "public-wi-fi",
    ]);
  });

  it("When a tag is repeated in different cases, then it is kept once", () => {
    expect(splitTags("DNS, dns, Dns")).toEqual(["dns"]);
  });

  it("When the field is empty, then there are no tags rather than one blank", () => {
    expect(splitTags("")).toEqual([]);
  });
});

describe("The post form", () => {
  it("When everything is filled in properly, then it is accepted", () => {
    expect(postInputSchema.safeParse(valid).success).toBe(true);
  });

  it("When there are more than eight tags, then it is refused", () => {
    const tags = Array.from({ length: 9 }, (_, i) => `tag${i}`).join(", ");

    expect(postInputSchema.safeParse({ ...valid, tags }).success).toBe(false);
  });

  it("When the same tag is typed nine times, then it counts once", () => {
    // Counted after tidying, the same way the server counts them.
    const tags = Array.from({ length: 9 }, () => "dns").join(", ");

    expect(postInputSchema.safeParse({ ...valid, tags }).success).toBe(true);
  });

  it("When the article is a single line, then it is refused", () => {
    expect(
      postInputSchema.safeParse({ ...valid, content: "Too short." }).success,
    ).toBe(false);
  });

  it("When the title is only spaces, then it is refused", () => {
    expect(postInputSchema.safeParse({ ...valid, title: "     " }).success).toBe(
      false,
    );
  });
});
