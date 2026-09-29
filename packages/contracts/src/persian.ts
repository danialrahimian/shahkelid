/**
 * Persian text that looks the same should compare the same.
 *
 * Keyboards disagree about two letters. Many Arabic-layout keyboards, and
 * text pasted from Arabic sources, type ي (U+064A) or ى (U+0649) for ی
 * (U+06CC), and ك (U+0643) for ک (U+06A9). On screen they are identical, so
 * someone who set their password on a laptop and types it on a phone can be
 * told "wrong password" for the password they did type.
 *
 * Unicode normalisation (NFKC) does not fold these: they are different
 * letters to Unicode, only the same one to a Persian reader. So they are
 * folded here, after NFKC.
 */
const LETTER_FOLDS: Record<string, string> = {
  "ي": "ی", // ي Arabic yeh        → ی Persian yeh
  "ى": "ی", // ى alef maksura      → ی Persian yeh
  "ك": "ک", // ك Arabic kaf        → ک Persian keheh
};

export const normalizePersian = (text: string): string =>
  text.normalize("NFKC").replace(/[يىك]/g, (letter) => LETTER_FOLDS[letter]!);
