import * as z from "zod";

/**
 * Every environment variable the app reads, validated once at startup.
 *
 * Nothing else in the codebase touches `import.meta.env`. A missing or
 * malformed value fails loudly here, at boot, instead of surfacing as
 * `undefined` inside a fetch call. The API URL used to be written out by hand
 * in thirty-four places, so pointing the app at a different server meant a
 * find-and-replace across the source.
 */
const createEnv = () => {
  const EnvSchema = z.object({
    // Empty in the production build: the API is on the same domain, under /api.
    API_URL: z.string().default("http://localhost:5000"),
    ENABLE_API_MOCKING: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    // Empty in the production build: links use the address the page is on.
    APP_URL: z.string().optional().default("http://localhost:5173"),
  });

  const envVars = Object.entries(import.meta.env).reduce<
    Record<string, string>
  >((accumulator, [key, value]) => {
    if (key.startsWith("VITE_APP_")) {
      accumulator[key.replace("VITE_APP_", "")] = value as string;
    }
    return accumulator;
  }, {});

  const parsed = EnvSchema.safeParse(envVars);

  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:
${Object.entries(parsed.error.flatten().fieldErrors)
  .map(([key, errors]) => `  - ${key}: ${errors?.join(", ")}`)
  .join("\n")}

Fix them in your .env file and restart the dev server.`,
    );
  }

  return parsed.data;
};

export const env = createEnv();
