import * as z from "zod";

/**
 * What the server accepts as an uploaded image.
 *
 * Mirrors the multer filter and size limit in the API's middlewares, so a form
 * refuses a file for the same reason the server would, before the upload
 * rather than after it. Shared by every form that takes an image; two copies
 * of a size limit is how one of them ends up saying 5MB while the other says
 * 2MB.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** The `accept` attribute for a file input, from the same list. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

/**
 * An optional image field. Optional because an edit may keep the image it
 * already has; a form that needs one on create checks that at submit.
 */
export const imageFileSchema = z
  .instanceof(File)
  .refine((file) => file.size <= MAX_IMAGE_BYTES, "The image must be under 5MB")
  .refine(
    (file) => ACCEPTED_IMAGE_TYPES.includes(file.type),
    "Only PNG, JPEG, WEBP or GIF images are allowed",
  )
  .nullable()
  .optional();
