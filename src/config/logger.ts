import type { FastifyServerOptions } from "fastify";

import { env } from "./env";

const isProduction = env.NODE_ENV === "production";

type LoggerConfig = NonNullable<FastifyServerOptions["logger"]>;

export const loggerConfig: LoggerConfig = isProduction
  ? { level: "info" }
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

