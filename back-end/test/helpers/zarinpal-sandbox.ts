/**
 * Paying in Zarinpal's sandbox the way a person would: open the StartPay
 * page and press "پرداخت". The page's button is a plain link to
 * /pg/verify/…?status=OK (or NOK), which redirects to our callback with the
 * Authority and Status: that redirect is what this returns.
 */
export const payInSandbox = async (payUrl: string, outcome: "OK" | "NOK" = "OK") => {
  const button = new RegExp(`https?://sandbox\\.zarinpal\\.com/pg/verify/[^"']+status=${outcome}`);
  let link: string | undefined;
  let last = "";
  // The sandbox now and then answers with something else (a busy page, a
  // dropped connection); a person would reload, and so does this.
  for (let attempt = 0; attempt < 3 && !link; attempt += 1) {
    try {
      const response = await fetch(payUrl, { signal: AbortSignal.timeout(15_000) });
      const page = await response.text();
      last = `HTTP ${response.status}, ${page.length} bytes`;
      link = page.match(button)?.[0];
    } catch (error) {
      last = (error as Error).message;
    }
    if (!link) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!link) throw new Error(`No pay button on the sandbox payment page (${last})`);

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
