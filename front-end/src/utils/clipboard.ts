/**
 * Puts text on the clipboard, and says whether it worked.
 *
 * The Clipboard API only exists on a secure page -- HTTPS or localhost -- so a
 * site served over plain HTTP on a LAN address has `navigator.clipboard`
 * undefined. The fallback is the older selection-and-copy route, which works
 * there. If both fail the caller is told, so it can show the text instead of
 * claiming a copy that never happened.
 */
export const copyText = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused, e.g. the document lost focus. Try the older route.
    }
  }

  const field = document.createElement("textarea");
  field.value = text;
  // Kept on screen but invisible: some browsers refuse to copy from an
  // element positioned off the page.
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();

  try {
    // Deprecated, but it is the only route left on an insecure page.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
};
