import { useParams } from "react-router";

import { CustomerPage } from "@/features/staff/components/customers-page";

/** /staff/customers/:customerId */
const CustomerRoute = () => {
  const { customerId = "" } = useParams();
  return <CustomerPage key={customerId} customerId={customerId} />;
};

export default CustomerRoute;
