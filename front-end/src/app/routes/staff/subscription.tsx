import { useParams } from "react-router";

import { SubscriptionPage } from "@/features/staff/components/subscriptions-page";

/** /staff/subscriptions/:subscriptionId */
const SubscriptionRoute = () => {
  const { subscriptionId = "" } = useParams();
  return <SubscriptionPage key={subscriptionId} subscriptionId={subscriptionId} />;
};

export default SubscriptionRoute;
