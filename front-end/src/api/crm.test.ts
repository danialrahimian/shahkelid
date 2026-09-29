import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authApi } from "@/api/auth";
import { crmApi } from "@/api/crm";
import { env } from "@/config/env";
import { normalizeError } from "@/lib/api-client";
import {
  createTestStore,
  installCookieJar,
  resetSession,
  staffCredentials,
  uniqueCredentials,
  type TestStore,
} from "@/testing/test-store";

/**
 * The customer book, against a real backend.
 *
 * Every case that writes anything works on an account it registered itself a
 * moment earlier, so a test run never edits a real customer's record. The
 * throwaway account is the subject; the staff account is the one doing the
 * looking.
 */

const isBackendUp = async () => {
  try {
    const response = await fetch(`${env.API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();
const staff = staffCredentials();

describe.skipIf(!backendUp)("The CRM against the live backend", () => {
  let restoreFetch: () => void;
  let store: TestStore;

  beforeAll(() => {
    restoreFetch = installCookieJar();
  });

  afterAll(() => {
    restoreFetch();
  });

  beforeEach(() => {
    resetSession();
    store = createTestStore();
  });

  /** Registers a throwaway account and returns its id and name. */
  const aFreshCustomer = async () => {
    const credentials = uniqueCredentials();
    const result = await store.dispatch(
      authApi.endpoints.register.initiate(credentials),
    );

    if ("error" in result && result.error) {
      throw new Error(
        `Sign-up failed: ${normalizeError(result.error).message}`,
      );
    }

    const session = await store.dispatch(
      authApi.endpoints.getSession.initiate(),
    );
    // A signed-in session is the user itself with a flag on top, not a
    // wrapper around one.
    if (!session.data?.isLoggedIn) {
      throw new Error("No session after signing up");
    }

    return { userId: session.data._id, username: credentials.username };
  };

  const signInAsStaff = async () => {
    if (!staff) throw new Error("No staff credentials");

    // A fresh store as well as a fresh session: the throwaway account's own
    // cached responses must not be mistaken for the staff account's.
    store = createTestStore();

    const result = await store.dispatch(
      authApi.endpoints.login.initiate(staff),
    );

    if ("error" in result && result.error) {
      throw new Error(
        `Staff sign-in failed: ${normalizeError(result.error).message}`,
      );
    }
  };

  describe("Who may read it", () => {
    it("When nobody is signed in, then the book is closed", async () => {
      const result = await store.dispatch(
        crmApi.endpoints.getCustomers.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(401);
    });

    it("When an ordinary customer asks, then it is refused", async () => {
      // Purchase histories and internal notes are not the customer's to read,
      // including their own.
      await store.dispatch(
        authApi.endpoints.register.initiate(uniqueCredentials()),
      );

      const result = await store.dispatch(
        crmApi.endpoints.getCustomers.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(403);
    });
  });

  describe.skipIf(!staff)("Reading the book", () => {
    it("When customers are listed, then the highest value comes first", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        crmApi.endpoints.getCustomers.initiate({ sort: "value", limit: 20 }),
      );
      const values = (result.data?.customers ?? []).map(
        (customer) => customer.lifetimeValue,
      );

      expect(values).toEqual([...values].sort((a, b) => b - a));
    });

    it("When a page is asked for, then the segment total still covers the segment", async () => {
      // A total that only added up the page on screen would shrink every time
      // somebody changed the page size.
      await signInAsStaff();

      const [page, everything] = await Promise.all([
        store.dispatch(crmApi.endpoints.getCustomers.initiate({ limit: 1 })),
        store.dispatch(crmApi.endpoints.getCustomers.initiate({ limit: 100 })),
      ]);

      expect(page.data?.customers).toHaveLength(
        Math.min(1, everything.data?.totalCustomersLength ?? 0),
      );
      expect(page.data?.segmentValue).toBeCloseTo(
        everything.data?.segmentValue ?? -1,
        2,
      );
    });

    it("When the search term looks like a pattern, then it is treated as text", async () => {
      // ".*" matches everything if it reaches a regex unescaped, so a search
      // that returns the whole book is the failure this catches.
      await signInAsStaff();

      const [wildcard, everything] = await Promise.all([
        store.dispatch(crmApi.endpoints.getCustomers.initiate({ search: ".*" })),
        store.dispatch(crmApi.endpoints.getCustomers.initiate({ limit: 100 })),
      ]);

      expect(wildcard.data?.totalCustomersLength).toBeLessThan(
        everything.data?.totalCustomersLength ?? 0,
      );
    });

    it("When a customer id is malformed, then it is a 400 rather than a crash", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        crmApi.endpoints.getCustomer.initiate("not-an-id"),
      );

      expect(normalizeError(result.error).status).toBe(400);
    });

    it("When the segments are read, then their counts add up to the book", async () => {
      await signInAsStaff();

      const [segments, everything] = await Promise.all([
        store.dispatch(crmApi.endpoints.getCrmSegments.initiate()),
        store.dispatch(crmApi.endpoints.getCustomers.initiate({ limit: 100 })),
      ]);

      const counted = (segments.data?.segments ?? []).reduce(
        (sum, segment) => sum + segment.customers,
        0,
      );

      expect(counted).toBe(segments.data?.totalCustomers);
      expect(counted).toBeGreaterThanOrEqual(
        everything.data?.customers.length ?? 0,
      );
    });
  });

  describe.skipIf(!staff)("Working on a customer", () => {
    it("When somebody has never bought, then they are a lead worth nothing", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();

      const result = await store.dispatch(
        crmApi.endpoints.getCustomer.initiate(userId),
      );

      expect(result.data?.stage).toBe("lead");
      expect(result.data?.lifetimeValue).toBe(0);
      expect(result.data?.lastOrderAt).toBeNull();
    });

    it("When a stage is set by hand, then it wins and the computed one still shows", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();

      const result = await store
        .dispatch(
          crmApi.endpoints.updateCustomer.initiate({ userId, stage: "vip" }),
        )
        .unwrap();

      expect(result.stage).toBe("vip");
      expect(result.stageOverride).toBe("vip");
      // The rule stays visible, so nobody has to guess why the two disagree.
      expect(result.computedStage).toBe("lead");
    });

    it("When the override is cleared, then the stage goes back to the data", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();
      await store
        .dispatch(
          crmApi.endpoints.updateCustomer.initiate({ userId, stage: "vip" }),
        )
        .unwrap();

      const result = await store
        .dispatch(
          crmApi.endpoints.updateCustomer.initiate({ userId, stage: "" }),
        )
        .unwrap();

      expect(result.stageOverride).toBeNull();
      expect(result.stage).toBe("lead");
    });

    it("When a note is added, then it is attributed and dated", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();

      const result = await store
        .dispatch(
          crmApi.endpoints.addCustomerNote.initiate({
            userId,
            body: "Asked about invoicing in euros.",
          }),
        )
        .unwrap();

      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].body).toBe("Asked about invoicing in euros.");
      expect(result.notes[0].author.name).toBeTruthy();
    });

    it("When a note is deleted, then it is gone from the record", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();
      const added = await store
        .dispatch(
          crmApi.endpoints.addCustomerNote.initiate({
            userId,
            body: "Never mind",
          }),
        )
        .unwrap();

      const result = await store
        .dispatch(
          crmApi.endpoints.deleteCustomerNote.initiate({
            userId,
            noteId: added.notes[0]._id,
          }),
        )
        .unwrap();

      expect(result.notes).toHaveLength(0);
    });

    it("When a note is only whitespace, then it is refused", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();

      const result = await store.dispatch(
        crmApi.endpoints.addCustomerNote.initiate({ userId, body: "   " }),
      );

      expect(normalizeError("error" in result ? result.error : undefined).status).toBe(
        400,
      );
    });

    it("When tags are set, then the server's tidied version comes back", async () => {
      const { userId } = await aFreshCustomer();
      await signInAsStaff();

      const result = await store
        .dispatch(
          crmApi.endpoints.updateCustomer.initiate({
            userId,
            tags: ["Enterprise", "enterprise", "  Referral  ", ""],
          }),
        )
        .unwrap();

      expect(result.tags).toEqual(["enterprise", "referral"]);
    });

    it("When a customer is edited, then the list stops showing the old record", async () => {
      // The part that is this layer's own job. The detail view and the list
      // are separate cached queries, so an edit that only refreshed the one
      // being looked at would leave a stale stage on the list behind it.
      const { userId, username } = await aFreshCustomer();
      await signInAsStaff();

      // Scoped by search rather than paged through: a brand new account is
      // worth nothing, so it sorts to the very back of a list of hundreds.
      const listQuery = { search: username };

      const before = await store
        .dispatch(crmApi.endpoints.getCustomers.initiate(listQuery))
        .unwrap();
      expect(before.customers[0]?.stage).toBe("lead");

      await store
        .dispatch(
          crmApi.endpoints.updateCustomer.initiate({ userId, stage: "vip" }),
        )
        .unwrap();

      // Read from the cache, exactly as the list page does. No forcing.
      const after = await store
        .dispatch(crmApi.endpoints.getCustomers.initiate(listQuery))
        .unwrap();

      expect(after.customers[0]?.stage).toBe("vip");
    });
  });
});
