import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  KICK_CLIENT_ID: z.string().min(1, "KICK_CLIENT_ID is required"),
  KICK_CLIENT_SECRET: z.string().min(1, "KICK_CLIENT_SECRET is required"),
  KICK_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/auth/kick/callback"),
  KICK_WEBHOOK_URL: z.string().url("KICK_WEBHOOK_URL must be a valid URL"),
  KICK_WEBHOOK_SECRET: z.string().min(1, "KICK_WEBHOOK_SECRET is required"),
  TWITCH_CLIENT_ID: z.string().min(1, "TWITCH_CLIENT_ID is required"),
  TWITCH_CLIENT_SECRET: z.string().min(1, "TWITCH_CLIENT_SECRET is required"),
  TWITCH_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3000/auth/twitch/callback"),
  YOUTUBE_CLIENT_ID: z.string().min(1, "YOUTUBE_CLIENT_ID is required"),
  YOUTUBE_CLIENT_SECRET: z.string().min(1, "YOUTUBE_CLIENT_SECRET is required"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("[config] Invalid environment variables:");
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;
