/**
 * Paying in Zarinpal's sandbox the way a person would: open the StartPay
 * page and press "پرداخت". The page's button is a plain link to
 * /pg/verify/…?status=OK (or NOK), which redirects to our callback with the
 * Authority and Status: that redirect is what this returns.
 */
export const payInSandbox = async (payUrl: string, outcome: "OK" | "NOK" = "OK") => {
  const page = await (await fetch(payUrl)).text();
  const link = page.match(new RegExp(`https?://sandbox\\.zarinpal\\.com/pg/verify/[^"']+status=${outcome}`))?.[0];
  if (!link) throw new Error("The sandbox payment page has changed: no pay button found");

  const response = await fetch(link.replace(/^http:/, "https:"), { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) throw new Error(`The sandbox did not send us back (HTTP ${response.status})`);
  const callback = new URL(location);
  return {
    authority: callback.searchParams.get("Authority")!,
    status: callback.searchParams.get("Status")!,
    callback,
  };
};
