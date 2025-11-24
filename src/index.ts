import { execSync } from "node:child_process";
import { env } from "./config/env";
import { buildServer } from "./app";

async function applyMigrations() {
  if (env.NODE_ENV === "development") {
    return;
  }

  try {
    const sanitizedDatabaseUrl = env.DATABASE_URL.replace(/^['"]+|['"]+$/g, "");
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: sanitizedDatabaseUrl,
      },
    });
  } catch (error) {
    console.error("Не удалось применить миграции", error);
    throw error;
  }
}

async function bootstrap() {
  await applyMigrations();

  const app = buildServer();

  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
    app.log.info(`Server listening on port ${env.PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error("Fatal error during bootstrap", error);
  process.exit(1);
});
