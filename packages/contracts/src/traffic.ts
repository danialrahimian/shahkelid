/**
 * Traffic volume: stored in bytes, sold in gigabytes.
 *
 * The gigabyte here is the binary one (1024³ bytes), because that is what the
 * VPN panel counts in: PasarGuard's own example for one gigabyte is
 * 1,073,741,824 bytes. Using the decimal gigabyte on our side would give every
 * customer about 7% less than the plan they bought says, and the difference
 * would surface as "my 50 GB ran out at 46".
 */

export const BYTES_PER_GIGABYTE = 1024 ** 3;

export const gigabytesToBytes = (gigabytes: number): number => {
  if (!Number.isFinite(gigabytes) || gigabytes < 0) {
    throw new RangeError(`gigabytes must be a non-negative number, got ${gigabytes}`);
  }
  // Rounded so a fractional plan (0.5 GB) still lands on a whole byte count.
  const bytes = Math.round(gigabytes * BYTES_PER_GIGABYTE);
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError(`${gigabytes} GB is too large to count in bytes exactly`);
  }
  return bytes;
};

/** For display. Rounded to two decimals, so 1.999999 GB reads as 2. */
export const bytesToGigabytes = (bytes: number): number =>
  Math.round((bytes / BYTES_PER_GIGABYTE) * 100) / 100;
