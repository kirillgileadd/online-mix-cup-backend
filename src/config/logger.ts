import type { FastifyServerOptions } from "fastify";
import { join } from "path";
import { mkdirSync } from "fs";

import { env } from "./env";

const isProduction = env.NODE_ENV === "production";

type LoggerConfig = NonNullable<FastifyServerOptions["logger"]>;

// Путь к директории логов (можно настроить через переменную окружения для Docker volume)
// По умолчанию используем logs в рабочей директории (в Docker это будет /app/logs)
const logsDir = process.env.LOGS_DIR || join(process.cwd(), "logs");

// Уровень логирования в файл (настраивается через FILE_LOG_LEVEL: "info" - все логи, "warn" - только ошибки и предупреждения)
const fileLogLevel = env.FILE_LOG_LEVEL || "warn";
const logFileName = fileLogLevel === "info" ? "app.log" : "errors.log";

// Создаем директорию для логов, если её нет (только если не используется volume)
// Если volume смонтирован, директория уже будет существовать
if (isProduction) {
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch (error) {
    // Игнорируем ошибку, если директория уже существует (например, примонтирована через volume)
  }
}

export const loggerConfig: LoggerConfig = isProduction
  ? {
      level: "info",
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          ip: req.ip,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
      transport: {
        targets: [
          // Консольный вывод с pino-pretty для всех логов
          {
            target: "pino-pretty",
            level: "info",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss",
              ignore: "pid,hostname",
            },
          },
          // Файловый вывод (настраивается через FILE_LOG_LEVEL: "info" - все логи, "warn" - только ошибки и предупреждения)
          {
            target: "pino/file",
            level: fileLogLevel,
            options: {
              destination: join(logsDir, logFileName),
            },
          },
        ],
      },
    }
  : {
      level: "debug",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
        },
      },
    };
