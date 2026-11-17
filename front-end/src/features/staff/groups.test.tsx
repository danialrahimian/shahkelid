// @vitest-environment jsdom
import type { GroupHostsView, GroupView } from "@shah-kelid/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page's logic is what is tested here; the themed select is the browser's own for it.
vi.mock("@/components/ui/picker", () => ({
  Picker: ({ value, onChange, children, ...rest }: { value: string; onChange: (event: { target: { value: string } }) => void; children: React.ReactNode }) => (
    <select value={value} onChange={onChange} aria-label={(rest as { "aria-label"?: string })["aria-label"]}>
      <option value="">—</option>
      {children}
    </select>
  ),
}));

import "@/lib/i18n";
import { createTestStore } from "@/testing/test-store";

import { GroupsPage } from "./components/groups-page";

/**
 * The groups page: groups and hosts are put in order (the arrows send the
 * same request a drag does), hosts picked and renamed, and panel groups
 * added or switched to "all hosts", each saved at once.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group = (id: string, name: string, overrides: Partial<GroupView> = {}): GroupView => ({
  id,
  name,
  sortOrder: 0,
  sources: [{ panelId: "p1", panelName: "Panel 1", panelGroupId: 2, panelGroupName: "de", allHosts: false }],
  plans: [{ id: "plan-1", name: "Monthly" }],
  subscriptions: 3,
  ...overrides,
});

const host = (hostId: number, remark: string, overrides: Partial<GroupHostsView["hosts"][number]> = {}) => ({
  panelId: "p1",
  panelName: "Panel 1",
  hostId,
  remark,
  inboundTag: "vless-ws",
  protocol: "vless",
  port: null,
  disabledOnPanel: false,
  panelGroupIds: [2],
  selected: true,
  forced: false,
  name: null,
  ...overrides,
});

const sent: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace("/api/v1/staff", "");
    const body = request.method === "GET" ? undefined : await request.text().then((text) => (text ? JSON.parse(text) : undefined));
    sent.push({ method: request.method, path, body });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/panels") return json([{ id: "p1", name: "Panel 1" }]);
    if (path === "/panels/p1/groups") return json([{ id: 2, name: "de", inboundTags: [] }, { id: 7, name: "nl", inboundTags: [] }]);
    if (path === "/groups") return json([group("g1", "Germany"), group("g2", "Netherlands", { sources: [] })]);
    if (path === "/groups/g1/hosts")
      return json({
        hosts: [host(1, "DE-1"), host(2, "DE-2", { selected: false }), host(3, "DE-3", { name: "Fast", forced: true })],
        unreachable: [],
      });
    return json({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

const render = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Provider store={createTestStore()}>
        <GroupsPage />
      </Provider>,
    );
  });
  await flush();
  await flush();
  return root;
};

const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.getAttribute("aria-label") === label || each.textContent === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};

const lastSent = (method: string, path: string) => [...sent].reverse().find((each) => each.method === method && each.path === path);

describe("The groups page", () => {
  it("Shows the groups, the first one open with its panel groups and hosts", async () => {
    const root = await render();
    const rows = [...document.querySelectorAll('[data-testid="group-row"]')].map((row) => row.textContent);
    expect(rows[0]).toContain("Germany");
    expect(rows[1]).toContain("Netherlands");
    const hosts = [...document.querySelectorAll('[data-testid="group-host"]')];
    expect(hosts).toHaveLength(3);
    expect(document.querySelector('[data-testid="group-source"]')?.textContent).toContain("de");
    const forced = hosts[2]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(forced.disabled).toBe(true);
    act(() => root.unmount());
  });

  it("When a group is moved down, then the new order is saved", async () => {
    const root = await render();
    await act(async () => button("پایین‌تر: Germany").click());
    await flush();
    expect(lastSent("PUT", "/groups/order")?.body).toEqual({ ids: ["g2", "g1"] });
    expect([...document.querySelectorAll('[data-testid="group-row"]')][0]!.textContent).toContain("Netherlands");
    act(() => root.unmount());
  });

  it("When a host is moved up, then the group's host order is saved", async () => {
    const root = await render();
    await act(async () => button("بالاتر: Fast").click());
    await flush();
    expect(lastSent("PUT", "/groups/g1/hosts/order")?.body).toEqual({
      hosts: [
        { panelId: "p1", hostId: 1 },
        { panelId: "p1", hostId: 3 },
        { panelId: "p1", hostId: 2 },
      ],
    });
    act(() => root.unmount());
  });

  it("When a host is ticked or renamed, then that host is saved", async () => {
    const root = await render();
    const box = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((each) => each.getAttribute("aria-label") === "DE-2")!;
    await act(async () => box.click());
    await flush();
    expect(lastSent("PATCH", "/groups/g1/hosts/p1/2")?.body).toEqual({ selected: true });

    const field = [...document.querySelectorAll<HTMLInputElement>("input")].find((each) => each.placeholder === "DE-1")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(field, "Germany {DATA_LEFT}");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.focus();
      field.blur();
    });
    await flush();
    expect(lastSent("PATCH", "/groups/g1/hosts/p1/1")?.body).toEqual({ name: "Germany {DATA_LEFT}" });
    act(() => root.unmount());
  });

  it("When a panel group is added, or switched to all hosts, then the group's sources are saved", async () => {
    const root = await render();
    const [panelSelect, groupSelect] = [...document.querySelectorAll("select")];
    await act(async () => {
      panelSelect!.value = "p1";
      panelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      groupSelect!.value = "7";
      groupSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("افزودن").click());
    await flush();
    expect(lastSent("PUT", "/groups/g1/sources")?.body).toEqual({
      sources: [
        { panelId: "p1", panelGroupId: 2, allHosts: false },
        { panelId: "p1", panelGroupId: 7, allHosts: true },
      ],
    });

    const all = document.querySelector<HTMLInputElement>('[data-testid="group-source"] input[type="checkbox"]')!;
    await act(async () => all.click());
    await flush();
    expect(lastSent("PUT", "/groups/g1/sources")?.body).toEqual({ sources: [{ panelId: "p1", panelGroupId: 2, allHosts: true }] });
    act(() => root.unmount());
  });
});
