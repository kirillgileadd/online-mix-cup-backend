import { execSync } from "node:child_process";
import pino from "pino";
import { env } from "./config/env";
import { buildServer } from "./app";
import { DiscordService } from "./modules/discord/discord.service";

// Простой логгер для использования до создания Fastify приложения
const bootstrapLogger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
});

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
    bootstrapLogger.error({ error }, "Не удалось применить миграции");
    throw error;
  }
}

async function bootstrap() {
  await applyMigrations();

  // Инициализация Discord сервиса
  const discordService = new DiscordService();
  try {
    await discordService.initialize();
  } catch (error) {
    bootstrapLogger.warn(
      { error },
      "Ошибка инициализации Discord сервиса, продолжаем работу"
    );
    // Продолжаем работу даже если Discord не инициализирован
  }

  const app = buildServer(discordService);

  // Обработка завершения работы
  const shutdown = async () => {
    app.log.info("Завершение работы сервера...");
    await discordService.destroy().catch((err) => {
      app.log.error(err, "Ошибка при закрытии Discord соединения");
    });
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
    app.log.info(`Server listening on port ${env.PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start server");
    await discordService.destroy().catch(() => {});
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  bootstrapLogger.fatal({ error }, "Fatal error during bootstrap");
  process.exit(1);
});
