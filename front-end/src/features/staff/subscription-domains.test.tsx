// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: () => undefined, error: () => undefined } }));

import "@/lib/i18n";
import { createTestStore } from "@/testing/test-store";

import { SubscriptionDomains } from "./components/subscription-domains";

/**
 * The shop's subscription domains, under Panels: listed with the primary
 * marked, and a domain typed (or a link pasted) is added as its domain.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent: { method: string; url: string; body: unknown }[] = [];
const view = {
  domains: [
    { domain: "sub.example.com", isPrimary: true, createdAt: "2026-11-22T00:00:00Z" },
    { domain: "old.example.com", isPrimary: false, createdAt: "2026-11-01T00:00:00Z" },
  ],
  linkBase: "https://sub.example.com",
};

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    sent.push({ method: request.method, url: request.url, body: text ? JSON.parse(text) : null });
    return new Response(JSON.stringify(view), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("Subscription domains", () => {
  it("Lists them with the primary marked, and adds a pasted link as its domain", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      createRoot(host).render(
        <Provider store={createTestStore()}>
          <SubscriptionDomains />
        </Provider>,
      );
    });
    await flush();

    expect(document.body.textContent).toContain("sub.example.com");
    expect(document.body.textContent).toContain("اصلی");
    expect(document.body.textContent).toContain("https://sub.example.com/s/…");
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "اصلی شود")).toHaveLength(1);

    const input = document.querySelector<HTMLInputElement>('input[placeholder="sub.example.com"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://Links.Example.com/s/x");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const add = [...document.querySelectorAll("button")].find((b) => b.textContent === "افزودن")!;
    await act(async () => add.click());
    await flush();

    const post = sent.find((request) => request.method === "POST");
    expect(post?.url).toMatch(/\/api\/v1\/staff\/subscription-domains$/);
    expect(post?.body).toEqual({ domain: "links.example.com" });
  });
});
