import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";

import { Queue } from "bullmq";

import { closeEmailQueue, sendEmail, setEmailSender } from "../src/modules/notifications/email";
import { QUEUES } from "../src/platform/queue/routes";
import { createConsumerConnection } from "../src/platform/redis";

/**
 * Queueing an email for real, against Redis (database 1 in tests, so no
 * development worker picks the job up). The other tests capture emails
 * instead, which is why they could not see the problem below.
 */

after(async () => {
  await closeEmailQueue();
});

describe("Queueing an email", () => {
  it("When the first email goes out right after start, then it is queued, not refused while Redis connects", async () => {
    setEmailSender(null);
    await closeEmailQueue(); // a fresh start: no connection yet
    const to = `first.${randomBytes(4).toString("hex")}@example.com`;

    await sendEmail({ to, subject: "code", text: "123456" });

    const connection = createConsumerConnection();
    const queue = new Queue(QUEUES.notifications, { connection });
    try {
      const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"]);
      const ours = jobs.find((job) => job?.data?.to === to);
      assert.ok(ours, "the email is on the queue");
      await ours.remove();
    } finally {
      await queue.close();
      connection.disconnect();
    }
  });
});
