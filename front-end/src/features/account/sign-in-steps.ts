import type { SessionView } from "@shah-kelid/contracts";

/**
 * The steps of signing in, and which one comes next.
 *
 * The server decides where a session stands; the screen only follows. After
 * every answer the next step is read from the session the server returned,
 * so the screen cannot skip the authenticator code or the setup that the
 * server still expects.
 */
export type SignInStep =
  | { kind: "email" }
  | { kind: "password" }
  | { kind: "code"; email: string }
  | { kind: "second-factor" }
  | { kind: "setup" }
  | { kind: "done" };

export const stepAfter = (session: SessionView): SignInStep => {
  switch (session.status) {
    case "signed_out":
      return { kind: "email" };
    case "two_factor_pending":
      return { kind: "second-factor" };
    case "two_factor_setup_required":
      return { kind: "setup" };
    case "signed_in":
      return { kind: "done" };
  }
};

/**
 * Where to go after signing in. Only a path on this site is accepted:
 * "//evil.example" starts with "/" too, and a browser reads it as another
 * site, which would make the sign-in page a doorway to a phishing page.
 */
export const safeRedirect = (value: string | null | undefined, fallback: string) =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : fallback;

/** Seconds between two sign-in codes; the server enforces the same. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * A left-to-right value (an email address) inside a Persian sentence.
 * Without isolation the "@" and "." are laid out by the sentence's
 * direction and the address reads scrambled: "com.example@ali".
 */
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068);
const POP_DIRECTIONAL_ISOLATE = String.fromCodePoint(0x2069);

export const isolated = (value: string) =>
  `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
