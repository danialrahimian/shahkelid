import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePersian } from "./persian.ts";

describe("Persian letters", () => {
  it("When a word is typed with Arabic yeh and kaf, then it equals the Persian spelling", () => {
    // "کلید" typed on an Arabic-layout keyboard.
    assert.equal(normalizePersian("كليد"), "کلید");
  });

  it("When alef maksura stands in for yeh, then it is folded too", () => {
    assert.equal(normalizePersian("موسى"), "موسی");
  });

  it("When text is already Persian, then it is left exactly as it was", () => {
    assert.equal(normalizePersian("شاه‌کلید"), "شاه‌کلید");
  });
});
