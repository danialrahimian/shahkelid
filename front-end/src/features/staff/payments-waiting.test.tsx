// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { createTestStore } from "@/testing/test-store";

import { PaymentsPage } from "./components/payments-page";

/**
 * Paid orders without a service, on the payments page: listed with the
 * button that makes the service, and, when it still cannot be made, the
 * server's own reason in the toast.
 */

const toasts = vi.hoisted(() => ({ error: [] as { title: unknown; description: unknown }[], success: [] as unknown[] }));
vi.mock("sonner", () => ({
  toast: {
    success: (title: unknown) => toasts.success.push(title),
    error: (title: unknown, options?: { description?: unknown }) => toasts.error.push({ title, description: options?.description }),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const paidOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 100003,
  kind: "new",
  status: "paid",
  totalToman: 1_000_000,
  plan: { id: "p", slug: "test", name: "test", description: "", dataLimitBytes: null, durationDays: 30, deviceLimit: null, priceToman: 1_000_000 },
  createdAt: "2026-11-16T10:00:00Z",
  expiresAt: "2026-11-16T11:00:00Z",
  paidAt: "2026-11-16T10:18:58Z",
  payment: { method: "card_transfer", status: "succeeded", refId: "6104", failureReason: null, crypto: null },
  subscription: null,
  invoiceNumber: 100001,
  customer: { id: "22222222-2222-4222-8222-222222222222", email: "buyer@example.com" },
};

let fulfilAnswer: { status: number; body: unknown };
const asked: { method: string; url: URL }[] = [];

beforeEach(() => {
  asked.length = 0;
  toasts.error.length = 0;
  toasts.success.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    asked.push({ method: request.method, url });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (request.method === "POST" && url.pathname.endsWith("/fulfil")) return json(fulfilAnswer.status, fulfilAnswer.body);
    if (url.pathname.endsWith("/staff/orders")) return json(200, [paidOrder]);
    return json(200, []);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

const render = async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Provider store={createTestStore()}>
        <MemoryRouter>
          <PaymentsPage canReview={false} canManageCards={false} canSeeOrders canFulfil />
        </MemoryRouter>
      </Provider>,
    );
  });
  await flush();
  return root;
};

const pressMake = async () => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === "ساخت اشتراک")!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
  await flush();
};

describe("Paid orders without a service", () => {
  it("Are listed with their customer, asked for by status=paid", async () => {
    const root = await render();

    expect(asked.some(({ url }) => url.pathname.endsWith("/staff/orders") && url.searchParams.get("status") === "paid")).toBe(true);
    expect(document.body.textContent).toContain("پرداخت‌شده، بدون سرویس");
    expect(document.body.textContent).toContain("buyer@example.com");
    act(() => root.unmount());
  });

  it("When the service still cannot be made, then the toast gives the server's exact reason", async () => {
    fulfilAnswer = {
      status: 409,
      body: { error: { code: "NO_SERVER_AVAILABLE", message: "The plan's panel is switched off. Turn it on under Panels." } },
    };
    const root = await render();

    await pressMake();

    expect(toasts.error).toHaveLength(1);
    expect(renderToStaticMarkup(toasts.error[0]!.description as React.ReactElement)).toContain("The plan&#x27;s panel is switched off");
    act(() => root.unmount());
  });

  it("When it is made, then it says so", async () => {
    fulfilAnswer = { status: 200, body: { ...paidOrder, status: "fulfilled" } };
    const root = await render();

    await pressMake();

    expect(asked.some(({ method, url }) => method === "POST" && url.pathname.endsWith(`/orders/${paidOrder.id}/fulfil`))).toBe(true);
    expect(toasts.success).toEqual(["اشتراک ساخته شد."]);
    act(() => root.unmount());
  });
});
