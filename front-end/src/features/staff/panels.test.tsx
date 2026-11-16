// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ error: [] as { title: unknown; description: unknown }[] }));
vi.mock("sonner", () => ({
  toast: {
    success: () => undefined,
    error: (title: unknown, options?: { description?: unknown }) => {
      toasts.error.push({ title, description: options?.description });
    },
  },
}));

import "@/lib/i18n";
import { createTestStore } from "@/testing/test-store";

import { renderToStaticMarkup } from "react-dom/server";
import type { PanelView } from "@shah-kelid/contracts";

import { PanelFormDialog } from "./components/panels-page";

/**
 * Adding a PasarGuard panel, the way the owner does it: type the address and
 * the account, press Save. The request must go out, with the driver the form
 * never asks about.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent: { url: string; body: unknown }[] = [];

beforeEach(() => {
  sent.length = 0;
  toasts.error.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    sent.push({ url: request.url, body: text ? JSON.parse(text) : null });
    return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Types into an input the way React notices: the native setter, then an input event. */
const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const field = (label: string) => {
  const element = [...document.querySelectorAll("label")].find((node) => node.textContent?.startsWith(label));
  const id = element?.getAttribute("for");
  return document.getElementById(id ?? "") as HTMLInputElement;
};

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

const open = async (panel?: PanelView) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <Provider store={createTestStore()}>
        <PanelFormDialog panel={panel} open onOpenChange={onOpenChange} />
      </Provider>,
    );
  });
  const save = async () => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent === "ذخیره")!;
    await act(async () => button.click());
    await flush();
  };
  return { root, onOpenChange, save };
};

describe("Adding a panel", () => {
  it("Sends it when Save is pressed", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <Provider store={createTestStore()}>
          <PanelFormDialog open onOpenChange={onOpenChange} />
        </Provider>,
      );
    });

    await act(async () => {
      type(field("نام"), "Main panel");
      type(field("نشانی پنل"), "https://panel.example.com/");
      type(field("نام کاربری پنل"), "admin");
      type(field("رمز پنل"), "secret-password");
    });
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "ذخیره")!;
    await act(async () => save.click());
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/panels$/);
    expect(sent[0].body).toMatchObject({
      name: "Main panel",
      driver: "pasarguard",
      baseUrl: "https://panel.example.com",
      credentials: { kind: "password", username: "admin", password: "secret-password" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toasts.error).toHaveLength(0);
    act(() => root.unmount());
  });

  it("Says in a toast what is missing, instead of doing nothing", async () => {
    const { root, onOpenChange, save } = await open();
    await save();

    expect(sent).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toasts.error).toHaveLength(1);
    expect(toasts.error[0].title).toBe("ذخیره نشد. این موارد را درست کنید:");
    expect(renderToStaticMarkup(toasts.error[0].description as React.ReactElement)).toContain("<li>");
    act(() => root.unmount());
  });

  it("Shows the server's objection in a toast as well as under the field", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "VALIDATION_FAILED", message: "bad", fields: [{ path: "baseUrl", code: "URL_INVALID" }] },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const { root, onOpenChange, save } = await open();
    await act(async () => {
      type(field("نام"), "Main panel");
      type(field("نشانی پنل"), "https://panel.example.com");
      type(field("نام کاربری پنل"), "admin");
      type(field("رمز پنل"), "secret-password");
    });
    await save();

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toasts.error).toHaveLength(1);
    expect(document.body.textContent).toContain("یک نشانی کامل با https:// وارد کنید.");
    expect(renderToStaticMarkup(toasts.error[0].description as React.ReactElement)).toContain("یک نشانی کامل");
    act(() => root.unmount());
  });
});

describe("Editing a panel", () => {
  const panel = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Main panel",
    driver: "pasarguard",
    baseUrl: "https://panel.example.com",
    subscriptionBaseUrl: null,
    isActive: true,
    version: "1.0.0",
    lastOkAt: null,
    lastError: null,
  } as unknown as PanelView;

  it("Keeps the saved account when it is not replaced", async () => {
    const { root, onOpenChange, save } = await open(panel);
    await save();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/panels\/22222222-2222-4222-8222-222222222222$/);
    expect(sent[0].body).toMatchObject({ name: "Main panel", driver: "pasarguard" });
    expect(sent[0].body).not.toHaveProperty("credentials");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    act(() => root.unmount());
  });
});
