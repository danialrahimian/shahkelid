/**
 * Which queue each outbox topic goes to.
 *
 * Every topic a module records must be listed here. An event with no route is
 * NOT dropped into a catch-all queue that nothing reads: the relay leaves it
 * in the outbox with the error "no queue for topic", where it shows up and
 * can be fixed, instead of disappearing.
 *
 * Routes are added by the milestone that introduces the topic; the first is
 * `subscription.provision` in M4.
 */

export const QUEUES = {
  provisioning: "provisioning",
  notifications: "notifications",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type TopicRoutes = Readonly<Record<string, QueueName>>;

export const TOPIC_ROUTES: TopicRoutes = {};
