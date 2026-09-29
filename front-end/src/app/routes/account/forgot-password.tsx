import { useNavigate } from "react-router";

import { paths } from "@/config/paths";
import { ForgotPasswordFlow } from "@/features/account/components/forgot-password-flow";

/** /account/forgot-password */
const ForgotPasswordRoute = () => {
  const navigate = useNavigate();
  return <ForgotPasswordFlow onDone={() => navigate(paths.accountSignIn.getHref())} />;
};

export default ForgotPasswordRoute;
