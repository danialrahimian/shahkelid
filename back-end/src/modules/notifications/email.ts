import { Queue } from "bullmq";

import { QUEUES } from "../../platform/queue/routes";
import { createRequestConnection } from "../../platform/redis";

/**
 * Sending an email, from anywhere in the API.
 *
 * The request does not wait on the mail server: the email becomes a job on
 * the notifications queue and the worker sends it, retrying if the provider
 * is briefly down. A sign-in code therefore goes out in about the time it
 * takes the worker to pick it up, whatever SMTP is doing.
 *
 * Why a queue job rather than an outbox event: an email carrying a sign-in
 * code must not be written to PostgreSQL, where it would outlive the code by
 * years. The job lives in Redis and is deleted once sent. If Redis is down,
 * sending fails and the person is told to try again, which is right for a
 * code: they would ask for a fresh one anyway.
 */

export type Email = {
  to: string;
  subject: string;
  text: string;
  /** The same message laid out for mail apps (right to left for Persian). */
  html?: string;
};

export type EmailSender = (email: Email) => Promise<void>;

let queue: Queue | undefined;
let connection: ReturnType<typeof createRequestConnection> | undefined;

const queueSender: EmailSender = async (email) => {
  if (!queue) {
    connection = createRequestConnection();
    queue = new Queue(QUEUES.notifications, { connection, skipWaitingForReady: true });
  }
  await queue.add("email.send", email, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    // The body may hold a sign-in code: gone as soon as it is sent.
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 },
  });
};

let sender: EmailSender = queueSender;

export const sendEmail: EmailSender = (email) => sender(email);

/** Test seam: capture emails instead of queueing them. */
export const setEmailSender = (replacement: EmailSender | null) => {
  sender = replacement ?? queueSender;
};

export const closeEmailQueue = async () => {
  const current = queue;
  const currentConnection = connection;
  queue = undefined;
  connection = undefined;
  await current?.close();
  // Created for this queue alone, so closed with it.
  currentConnection?.disconnect();
};
