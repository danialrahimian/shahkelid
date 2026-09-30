/**
 * Which queue each outbox topic goes to.
 *
 * Every topic a module records must be listed here. An event with no route is
 * NOT dropped into a catch-all queue that nothing reads: the relay leaves it
 * in the outbox with the error "no queue for topic", where it shows up and
 * can be fixed, instead of disappearing.
 *
 * Routes are added by the milestone that introduces the topic.
 */

export const QUEUES = {
  provisioning: "provisioning",
  notifications: "notifications",
  billing: "billing",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type TopicRoutes = Readonly<Record<string, QueueName>>;

export const TOPIC_ROUTES: TopicRoutes = {
  // M3: put a subscription on its panel (src/modules/provisioning/worker.ts)
  "subscription.provision_requested": QUEUES.provisioning,
  // M6: apply a paid renewal to the panel (src/modules/subscriptions/renewal.ts)
  "order.renewal_paid": QUEUES.provisioning,
  // M4: tell owners and admins about trouble (src/modules/notifications/alerts.ts)
  "admin.alert": QUEUES.notifications,
  // M7: an email to a customer (src/modules/notifications/notify.ts)
  "customer.notify": QUEUES.notifications,
};
