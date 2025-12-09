import type { FastifyServerOptions } from "fastify";

import { env } from "./env";

const isProduction = env.NODE_ENV === "production";

type LoggerConfig = NonNullable<FastifyServerOptions["logger"]>;

export const loggerConfig: LoggerConfig = isProduction
  ? {
      level: "info",
      // Оптимизация для продакшена: отключаем pretty print для экономии памяти
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
