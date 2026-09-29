import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { locationInput, panelInput, planInput } from "./catalog.ts";
import { API_ERROR_CODES, isApiErrorCode } from "./errors.ts";

/** The rules staff forms and the API share for panels, locations and plans. */

const codeOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? undefined : result.error!.issues[0]!.message;

const aPanel = {
  name: "Main",
  driver: "pasarguard",
  baseUrl: "https://panel.example.com/",
  credentials: { kind: "password", username: "operator", password: "secret" },
};

describe("Panels", () => {
  it("When the address ends in a slash, then it is dropped, so paths can be appended", () => {
    assert.equal(panelInput.parse(aPanel).baseUrl, "https://panel.example.com");
  });

  it("When the address is not http(s), then it is refused with URL_INVALID", () => {
    assert.equal(codeOf(panelInput.safeParse({ ...aPanel, baseUrl: "ftp://panel.example.com" })), "URL_INVALID");
  });

  it("When no subscription domain is given, then it is null (the API's own address is used)", () => {
    assert.equal(panelInput.parse({ ...aPanel, subscriptionBaseUrl: "" }).subscriptionBaseUrl, null);
  });

  it("When an API key is chosen but empty, then it is refused", () => {
    const result = panelInput.safeParse({ ...aPanel, credentials: { kind: "api_key", apiKey: "" } });
    assert.equal(codeOf(result), "REQUIRED");
  });
});

describe("Locations", () => {
  it("When a code is typed in lowercase, then it is stored in capitals", () => {
    assert.equal(locationInput.parse({ code: "de-fra", nameFa: "آلمان", nameEn: "Germany" }).code, "DE-FRA");
  });

  it("When a code is not a country code, then it is refused", () => {
    const result = locationInput.safeParse({ code: "Germany", nameFa: "آلمان", nameEn: "Germany" });
    assert.equal(codeOf(result), "LOCATION_CODE_INVALID");
  });
});

describe("Plans", () => {
  const aPlan = {
    slug: "monthly-50",
    name: "ماهانه",
    dataLimitGb: 50,
    durationDays: 30,
    deviceLimit: 2,
    priceToman: 150_000,
    panels: [{ panelId: "0190a0b4-0000-7000-8000-000000000000", groupIds: [] }],
  };

  it("When volume and device limit are null, then the plan is unlimited in both", () => {
    const plan = planInput.parse({ ...aPlan, dataLimitGb: null, deviceLimit: null });
    assert.equal(plan.dataLimitGb, null);
    assert.equal(plan.deviceLimit, null);
  });

  it("When a plan is sold on no panel, then it is refused", () => {
    assert.equal(codeOf(planInput.safeParse({ ...aPlan, panels: [] })), "GROUPS_REQUIRED");
  });

  it("When the duration is zero, then it is out of range", () => {
    assert.equal(codeOf(planInput.safeParse({ ...aPlan, durationDays: 0 })), "NUMBER_OUT_OF_RANGE");
  });

  it("When the slug has spaces or capitals, then capitals are lowered but spaces are refused", () => {
    assert.equal(planInput.parse({ ...aPlan, slug: "Monthly-50" }).slug, "monthly-50");
    assert.equal(codeOf(planInput.safeParse({ ...aPlan, slug: "monthly 50" })), "SLUG_INVALID");
  });
});

describe("Error codes", () => {
  it("When a schema fails, then its message is one of the API's codes, so clients can translate it", () => {
    for (const code of ["URL_INVALID", "REQUIRED", "GROUPS_REQUIRED", "NUMBER_OUT_OF_RANGE"]) {
      assert.ok(isApiErrorCode(code), code);
    }
    assert.equal(new Set(API_ERROR_CODES).size, API_ERROR_CODES.length, "no code listed twice");
  });
});
