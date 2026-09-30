import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { notifications } from "../src/modules/notifications/schema";
import { deliverTicketAlert, resolveQuietTickets } from "../src/modules/support/service";
import { tickets } from "../src/modules/support/schema";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Support tickets: a customer opens one, staff answer it (or leave a note
 * only staff see), and the ticket always says who it is waiting on.
 */

const SUPPORT = "/api/v1/support";
const STAFF = "/api/v1/staff";
const DAY = 86_400_000;
let emails: ReturnType<typeof captureEmails>;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

// ----------------------------------------------------------------- arrange

type Person = Awaited<ReturnType<typeof signedInCustomer>>;

const aScreenshot = () =>
  new Blob([
    Buffer.concat([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      randomBytes(8),
    ]),
  ]);

const form = (fields: Record<string, string>, files: Blob[] = []) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  files.forEach((file, index) => body.append("attachments", file, `shot-${index}.png`));
  return body;
};

const firstCategory = async (customer: Person) => {
  const categories = await customer.client.get(`${SUPPORT}/categories`);
  assert.ok(categories.data.length >= 4, "a new installation has its default categories");
  return categories.data[0].id as string;
};

const openTicket = async (customer: Person, fields: Record<string, string> = {}, files: Blob[] = []) => {
  const response = await customer.client.post(
    `${SUPPORT}/tickets`,
    form(
      {
        subject: "اتصال برقرار نمی‌شود",
        categoryId: await firstCategory(customer),
        body: "از دیشب وصل نمی‌شود.",
        ...fields,
      },
      files,
    ),
  );
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
};

const staffForm = (body: string, internal = false) => form({ body, internal: String(internal) });

// ----------------------------------------------------------------- tickets

describe("Opening a ticket", () => {
  it("When a customer opens a ticket with a screenshot, then it waits for staff and the agents are told", async () => {
    const customer = await signedInCustomer(emails);
    const agent = await signedInStaff(["support"]);

    const ticket = await openTicket(customer, {}, [aScreenshot()]);

    assert.equal(ticket.status, "awaiting_staff");
    assert.ok(ticket.number >= 1001);
    assert.equal(ticket.messages.length, 1);
    assert.equal(ticket.messages[0].attachments.length, 1);

    const [event] = await database()
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.topic, "support.ticket_alert"), eq(outboxEvents.aggregateId, ticket.id)));
    assert.ok(event, "an alert is recorded with the ticket");
    await deliverTicketAlert(database(), { ticketId: ticket.id, what: "new" });
    assert.ok(emails.sent.some((email) => email.to === agent.email && email.subject.includes(String(ticket.number))));

    const file = await customer.client.get(`${SUPPORT}/files/${ticket.messages[0].attachments[0].id}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "image/png");
  });

  it("When the attachment is not an image, then the ticket is refused and nothing is saved", async () => {
    const customer = await signedInCustomer(emails);
    const response = await customer.client.post(
      `${SUPPORT}/tickets`,
      form(
        { subject: "یک موضوع", categoryId: await firstCategory(customer), body: "متن" },
        [new Blob([Buffer.from("%PDF-1.7 not a picture")])],
      ),
    );
    assert.equal(response.status, 400);
    assert.equal(response.data.error.code, "ATTACHMENT_INVALID");
    assert.equal((await customer.client.get(`${SUPPORT}/tickets`)).data.length, 0);
  });

  it("When a customer asks for an 'urgent' ticket, then it is refused: urgency is staff's call", async () => {
    const customer = await signedInCustomer(emails);
    const response = await customer.client.post(
      `${SUPPORT}/tickets`,
      form({ subject: "فوری", categoryId: await firstCategory(customer), body: "متن", priority: "urgent" }),
    );
    assert.equal(response.status, 400);
  });

  it("When someone asks for another customer's ticket or its file, then it is not found", async () => {
    const customer = await signedInCustomer(emails);
    const stranger = await signedInCustomer(emails);
    const ticket = await openTicket(customer, {}, [aScreenshot()]);

    assert.equal((await stranger.client.get(`${SUPPORT}/tickets/${ticket.id}`)).status, 404);
    assert.equal((await stranger.client.get(`${SUPPORT}/files/${ticket.messages[0].attachments[0].id}`)).status, 404);
    assert.equal((await stranger.client.post(`${SUPPORT}/tickets/${ticket.id}/messages`, form({ body: "x" }))).status, 404);
  });
});

describe("Answering", () => {
  it("[acceptance] An internal note is never shown to the customer; a staff reply waits for the customer and emails them", async () => {
    const customer = await signedInCustomer(emails);
    const agent = await signedInStaff(["support"]);
    const ticket = await openTicket(customer);

    const note = await agent.client.post(
      `${STAFF}/tickets/${ticket.id}/messages`,
      form({ body: "یادداشت داخلی: سرور آلمان مشکل دارد", internal: "true" }, [aScreenshot()]),
    );
    assert.equal(note.status, 201, JSON.stringify(note.data));
    assert.equal(note.data.status, "awaiting_staff", "a note moves nothing");
    assert.equal(note.data.assignedTo, null);

    const reply = await agent.client.post(`${STAFF}/tickets/${ticket.id}/messages`, staffForm("سرور را عوض کردیم، دوباره امتحان کنید."));
    assert.equal(reply.data.status, "awaiting_customer");
    assert.equal(reply.data.assignedTo.email, agent.email, "whoever answers it has it");
    assert.equal(reply.data.messages.length, 3, "staff see everything");

    const seen = (await customer.client.get(`${SUPPORT}/tickets/${ticket.id}`)).data;
    assert.equal(seen.status, "awaiting_customer");
    assert.equal(seen.messages.length, 2);
    assert.ok(seen.messages.every((message: { isInternal: boolean }) => !message.isInternal));
    assert.ok(!JSON.stringify(seen).includes("یادداشت داخلی"), "not a word of the note");
    assert.ok(!JSON.stringify(seen).includes(agent.email), "staff are shown as support, not by address");

    const noteFile = note.data.messages.find((m: { isInternal: boolean }) => m.isInternal).attachments[0].id;
    assert.equal((await customer.client.get(`${SUPPORT}/files/${noteFile}`)).status, 404, "nor its screenshot");

    const [email] = await database()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, customer.id), eq(notifications.templateKey, "ticket_reply")));
    assert.ok(email, "the customer is emailed");
    assert.equal((email!.payload as Record<string, string>).ticket_subject, ticket.subject);
  });

  it("When the customer replies to a resolved ticket, then it goes back to staff", async () => {
    const customer = await signedInCustomer(emails);
    const agent = await signedInStaff(["support"]);
    const ticket = await openTicket(customer);
    await agent.client.patch(`${STAFF}/tickets/${ticket.id}`, { status: "resolved" });

    const reply = await customer.client.post(`${SUPPORT}/tickets/${ticket.id}/messages`, form({ body: "هنوز مشکل هست" }));
    assert.equal(reply.status, 201);
    assert.equal(reply.data.status, "awaiting_staff");
  });

  it("When the customer closes a ticket, then it cannot be replied to", async () => {
    const customer = await signedInCustomer(emails);
    const ticket = await openTicket(customer);
    const closed = await customer.client.post(`${SUPPORT}/tickets/${ticket.id}/close`);
    assert.equal(closed.data.status, "closed");

    const reply = await customer.client.post(`${SUPPORT}/tickets/${ticket.id}/messages`, form({ body: "ببخشید" }));
    assert.equal(reply.status, 409);
    assert.equal(reply.data.error.code, "TICKET_CLOSED");
  });

  it("When a customer leaves an answered ticket for a week, then it is marked resolved with a note", async () => {
    const customer = await signedInCustomer(emails);
    const agent = await signedInStaff(["support"]);
    const ticket = await openTicket(customer);
    await agent.client.post(`${STAFF}/tickets/${ticket.id}/messages`, staffForm("درست شد؟"));

    await resolveQuietTickets(database(), new Date(Date.now() + 6 * DAY));
    assert.equal((await customer.client.get(`${SUPPORT}/tickets/${ticket.id}`)).data.status, "awaiting_customer");

    await resolveQuietTickets(database(), new Date(Date.now() + 8 * DAY));
    const seen = (await customer.client.get(`${SUPPORT}/tickets/${ticket.id}`)).data;
    assert.equal(seen.status, "resolved");
    assert.equal(seen.messages.at(-1).authorKind, "system");
  });
});

describe("The queue", () => {
  it("Waiting tickets come most urgent first, then oldest first; 'mine' is what I was given", async () => {
    const customer = await signedInCustomer(emails);
    const agent = await signedInStaff(["support"]);
    const older = await openTicket(customer, { subject: "قدیمی‌تر" });
    const newer = await openTicket(customer, { subject: "تازه‌تر" });
    const urgent = await openTicket(customer, { subject: "فوری شد" });
    await agent.client.patch(`${STAFF}/tickets/${urgent.id}`, { priority: "urgent" });
    // Pin the times, so the order does not depend on how fast the test ran.
    await database().update(tickets).set({ lastMessageAt: new Date(Date.now() - 2 * DAY) }).where(eq(tickets.id, older.id));
    await database().update(tickets).set({ lastMessageAt: new Date(Date.now() - DAY) }).where(eq(tickets.id, newer.id));

    const queue = (await agent.client.get(`${STAFF}/tickets?status=awaiting_staff`)).data as { id: string }[];
    const ours = queue.filter((row) => [older.id, newer.id, urgent.id].includes(row.id)).map((row) => row.id);
    assert.deepEqual(ours, [urgent.id, older.id, newer.id]);

    const given = await agent.client.patch(`${STAFF}/tickets/${newer.id}`, { assignedToUserId: agent.id });
    assert.equal(given.status, 200, JSON.stringify(given.data));
    const mine = (await agent.client.get(`${STAFF}/tickets?assignee=me`)).data as { id: string }[];
    assert.deepEqual(
      mine.map((row) => row.id),
      [newer.id],
    );
  });

  it("A ticket cannot be given to someone who cannot answer tickets", async () => {
    const customer = await signedInCustomer(emails);
    const agent = await signedInStaff(["support"]);
    const ticket = await openTicket(customer);
    const response = await agent.client.patch(`${STAFF}/tickets/${ticket.id}`, { assignedToUserId: customer.id });
    assert.equal(response.status, 400);
  });

  it("Staff without tickets:reply cannot read the queue", async () => {
    const accountant = await signedInStaff(["accountant"]);
    assert.equal((await accountant.client.get(`${STAFF}/tickets`)).status, 403);
  });

  it("Staff with settings:manage add a category; a switched-off one is not offered to customers", async () => {
    const admin = await signedInStaff(["admin"]);
    const customer = await signedInCustomer(emails);
    const made = await admin.client.post(`${STAFF}/ticket-categories`, { nameFa: "همکاری", nameEn: "Partnership", isActive: false });
    assert.equal(made.status, 201, JSON.stringify(made.data));

    const offered = (await customer.client.get(`${SUPPORT}/categories`)).data as { id: string }[];
    assert.ok(!offered.some((category) => category.id === made.data.id));

    const response = await customer.client.post(
      `${SUPPORT}/tickets`,
      form({ subject: "همکاری", categoryId: made.data.id, body: "سلام" }),
    );
    assert.equal(response.status, 404);
  });
});
