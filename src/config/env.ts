import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .or(z.string().startsWith("postgresql://"))
    .default("postgresql://postgres:postgres@localhost:5432/tournament_bot"),
  JWT_SECRET: z.string().min(8),
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET ?? "change-me",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
});
