// @vitest-environment jsdom
import type { LogEntryView } from "@shah-kelid/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page's logic is what is tested here; the themed select is the browser's own for it.
vi.mock("@/components/ui/picker", () => ({
  Picker: ({ value, onChange, children, ...rest }: { value: string; onChange: (event: { target: { value: string } }) => void; children: React.ReactNode }) => (
    <select value={value} onChange={onChange} aria-label={(rest as { "aria-label"?: string })["aria-label"]}>
      {children}
    </select>
  ),
}));

import "@/lib/i18n";
import { createTestStore } from "@/testing/test-store";

import { LogsPage } from "./components/logs-page";

/**
 * The owner's log page: entries from every section, the problems marked,
 * older pages on request, and filters that ask the API again.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (key: string, overrides: Partial<LogEntryView> = {}): LogEntryView => ({
  key,
  at: "2026-11-16T10:18:58.551Z",
  source: "order",
  kind: "order.paid",
  actor: "buyer@example.com",
  entity: { type: "order", id: "o-1" },
  summary: "Order 100002 paid · 1000000 toman · new",
  details: {},
  problem: false,
  ...overrides,
});

const asked: URL[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    asked.push(url);
    const page = url.searchParams.get("beforeKey")
      ? { entries: [entry("older", { summary: "Account created: buyer" , source: "account", kind: "account.created" })], next: null }
      : {
          entries: [
            entry("alert", {
              source: "alert",
              kind: "admin.alert",
              actor: "system",
              summary: "Order paid, but its service was not made",
              problem: true,
            }),
            entry("paid"),
          ],
          next: { beforeAt: "2026-11-16T10:18:00.000000Z", beforeKey: "paid" },
        };
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("The owner's log page", () => {
  it("Lists entries from every section, marks the problems, and loads older ones on request", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Provider store={createTestStore()}>
          <LogsPage />
        </Provider>,
      );
    });
    await flush();

    const text = document.body.textContent ?? "";
    expect(text).toContain("Order paid, but its service was not made");
    expect(text).toContain("هشدارها");
    expect(text).toContain("سفارش‌ها");
    const alertRow = [...document.querySelectorAll("tr")].find((row) => row.textContent?.includes("service was not made"));
    expect(alertRow?.className).toContain("bg-destructive");

    const more = [...document.querySelectorAll("button")].find((button) => button.textContent === "قدیمی‌ترها")!;
    await act(async () => more.click());
    await flush();
    expect(asked.at(-1)?.searchParams.get("beforeKey")).toBe("paid");
    expect(document.body.textContent).toContain("Account created: buyer");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "قدیمی‌ترها")).toBe(false);

    act(() => root.unmount());
  });

  it("Asks the API again, from the top, when a section or 'problems only' is chosen", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Provider store={createTestStore()}>
          <LogsPage />
        </Provider>,
      );
    });
    await flush();

    const select = document.querySelector("select")!;
    await act(async () => {
      select.value = "payment";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(asked.at(-1)?.searchParams.get("source")).toBe("payment");
    expect(asked.at(-1)?.searchParams.get("beforeKey")).toBeNull();

    const problems = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => problems.click());
    await flush();
    expect(asked.at(-1)?.searchParams.get("problems")).toBe("1");

    act(() => root.unmount());
  });
});
