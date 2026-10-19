import { Queue } from "bullmq";

import config from "../../config";
import { isMailSetUp } from "../settings/live";
import logger from "../../libraries/logger";
import { sendEmail as sendWithSmtp } from "../../libraries/mailer";
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

/** Puts an email on the queue: for the API, where nobody should wait on SMTP. */
export const sendEmail: EmailSender = (email) => sender(email);

/**
 * Sends an email now, through SMTP, and throws if the provider does not take
 * it. Without SMTP credentials on a development machine, the email is
 * written to the log instead, so a developer can read a sign-in code there.
 */
const sendNow: EmailSender = async (email) => {
  if (!isMailSetUp()) {
    if (!config.isProduction) {
      logger.info({ to: email.to, subject: email.subject, text: email.text }, "Email (development: logged, not sent)");
      return;
    }
    throw new Error("Mail is not set up yet (staff area → settings → mail)");
  }
  const result = await sendWithSmtp({ ...email, html: email.html });
  if (!result.delivered) throw new Error(`The mail provider did not accept the email to ${email.to}`);
};

/**
 * Sends an email from the worker, where a failure must be known: a customer
 * email marked "sent" when SMTP refused it would mislead support, and an
 * alert must know whether it reached anyone. Tests that capture emails
 * capture these too.
 */
export const deliverEmail: EmailSender = (email) => (sender === queueSender ? sendNow(email) : sender(email));

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
