import "dotenv/config";
import { z } from "zod";

const stripQuotes = (value?: string | null) =>
  value?.trim().replace(/^['"]+|['"]+$/g, "") || undefined;

const nodeEnv = (process.env.NODE_ENV || "development") as
  | "development"
  | "test"
  | "production";
const isProduction = nodeEnv === "production";

const envSchema = z
  .object({
    DATABASE_URL: isProduction
      ? z.string().min(1, "DATABASE_URL is required in production")
      : z
          .string()
          .min(1, "DATABASE_URL is required")
          .default(
            "postgresql://postgres:postgres@localhost:5432/tournament_bot"
          ),
    JWT_SECRET: isProduction
      ? z.string().min(8, "JWT_SECRET is required in production")
      : z.string().min(8).default("test-jwt-secret-key-for-testing-only"),
    TELEGRAM_BOT_TOKEN: isProduction
      ? z.string().min(10, "TELEGRAM_BOT_TOKEN is required in production")
      : z.string().min(10).default("1234567890:test-token-for-testing"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    ENABLE_DEV_LOGIN: z
      .string()
      .transform((val) => val === "true")
      .optional()
      .default(false),
    CORS_ORIGINS: isProduction
      ? z
          .string()
          .min(1, "CORS_ORIGINS is required in production")
          .transform((val) =>
            val
              .split(",")
              .map((origin) => origin.trim())
              .filter(Boolean)
          )
      : z
          .string()
          .default("http://localhost:5173")
          .transform((val) =>
            val
              ? val
                  .split(",")
                  .map((origin) => origin.trim())
                  .filter(Boolean)
              : ["http://localhost:5173"]
          ),
  })
  .superRefine((data, ctx) => {
    if (isProduction) {
      if (data.DATABASE_URL.includes("localhost")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "DATABASE_URL cannot use localhost in production",
          path: ["DATABASE_URL"],
        });
      }
      if (
        data.JWT_SECRET === "test-jwt-secret-key-for-testing-only" ||
        data.JWT_SECRET === "change-me"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "JWT_SECRET must be set to a secure value in production",
          path: ["JWT_SECRET"],
        });
      }
      if (data.TELEGRAM_BOT_TOKEN === "1234567890:test-token-for-testing") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "TELEGRAM_BOT_TOKEN must be set to a real token in production",
          path: ["TELEGRAM_BOT_TOKEN"],
        });
      }
      if (data.CORS_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "CORS_ORIGINS must contain at least one origin in production",
          path: ["CORS_ORIGINS"],
        });
      }
      if (data.CORS_ORIGINS.some((origin) => origin.includes("localhost"))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CORS_ORIGINS cannot include localhost in production",
          path: ["CORS_ORIGINS"],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse({
  DATABASE_URL: stripQuotes(process.env.DATABASE_URL),
  JWT_SECRET: process.env.JWT_SECRET,
  TELEGRAM_BOT_TOKEN: stripQuotes(process.env.TELEGRAM_BOT_TOKEN),
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  ENABLE_DEV_LOGIN: process.env.ENABLE_DEV_LOGIN,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
});
