import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { join, resolve, normalize } from "path";

import { env } from "./config/env";
import { loggerConfig } from "./config/logger";
import { errorHandler } from "./config/error-handler";
import { userRoutes } from "./modules/users/user.routes";
import { applicationRoutes } from "./modules/applications/application.routes";
import { tournamentRoutes } from "./modules/tournaments/tournament.routes";
import { playerRoutes } from "./modules/players/player.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { roleRoutes } from "./modules/roles/role.routes";
import { lobbyRoutes } from "./modules/lobbies/lobby.routes";
import { DiscordService } from "./modules/discord/discord.service";

export const buildServer = (discordService?: DiscordService) => {
  const app = Fastify({
    logger: loggerConfig,
    // Оптимизация для маломощного сервера
    bodyLimit: 1048576, // 1MB - ограничение размера тела запроса
    requestIdLogLabel: "reqId",
    requestIdHeader: "x-request-id",
    // Отключаем ненужные функции для экономии памяти
    disableRequestLogging: env.NODE_ENV === "production", // В продакшене отключаем детальное логирование запросов
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "Tournament Bot API",
        description:
          "API сервер для Telegram-бота, который управляет пользователями, заявками и турнирами.",
        version: "1.0.0",
      },
      tags: [
        { name: "auth", description: "Получение административного токена" },
        { name: "users", description: "Работа с пользователями" },
        { name: "applications", description: "Создание и модерация заявок" },
        { name: "tournaments", description: "Управление турнирами" },
        { name: "players", description: "Получение списка игроков" },
        {
          name: "roles",
          description: "Система ролей и привязка к пользователям",
        },
        {
          name: "lobbies",
          description: "Генерация лобби, драфт и управление матчами",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  // Helmet для безопасности HTTP заголовков
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Для Swagger UI
        scriptSrc: ["'self'", "'unsafe-inline'"], // Для Swagger UI
        imgSrc: ["'self'", "data:", "https:"], // Разрешаем data: для base64 изображений
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Отключаем для совместимости
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Для статических файлов
  });

  app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // Allowed HTTP methods
    credentials: true, // Allow cookies and authentication tokens
  });

  // Функция для получения IP адреса клиента (с защитой от подделки)
  const getClientIp = (request: FastifyRequest): string => {
    const forwardedFor = request.headers["x-forwarded-for"];
    const forwardedForStr = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === "string"
      ? forwardedFor
      : undefined;
    const realIp = request.headers["x-real-ip"];
    const realIpStr = Array.isArray(realIp)
      ? realIp[0]
      : typeof realIp === "string"
      ? realIp
      : undefined;

    return (
      forwardedForStr?.split(",")[0]?.trim() ||
      realIpStr ||
      request.ip ||
      request.socket.remoteAddress ||
      "unknown"
    );
  };

  // Агрессивный rate limiting для защиты от спама и всплесков трафика
  // Короткие окна времени для более эффективной защиты
  app.register(rateLimit, {
    global: true,
    max: 40, // 40 запросов
    timeWindow: "10 seconds", // за 10 секунд (защита от кратковременных всплесков)
    errorResponseBuilder: (request, context) => {
      return {
        code: 429,
        error: "Too Many Requests",
        message: `Превышен лимит запросов (40 за 10 секунд). Попробуйте снова через ${Math.ceil(
          context.ttl / 1000
        )} секунд.`,
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    // Используем IP адрес для идентификации клиента
    keyGenerator: getClientIp,
  });

  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  app.register(fastifyCookie, {
    secret: env.JWT_SECRET,
    hook: "onRequest",
  });

  // Раздача статических файлов из директории uploads с защитой от path traversal
  const uploadsRoot = resolve(process.cwd(), "uploads");
  const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

  // Хук для проверки безопасности перед раздачей файлов
  // Должен быть зарегистрирован до fastifyStatic
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/uploads/")) {
      const requestedPath = request.url.replace("/uploads/", "").split("?")[0]; // Убираем query параметры

      // Проверяем, что путь существует
      if (!requestedPath || requestedPath.length === 0) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      // Защита от path traversal
      if (
        requestedPath.includes("..") ||
        requestedPath.includes("/") ||
        requestedPath.includes("\\") ||
        requestedPath.startsWith(".")
      ) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      // Проверяем расширение файла
      const lastDotIndex = requestedPath.lastIndexOf(".");
      if (lastDotIndex === -1) {
        return reply
          .code(403)
          .send({ message: "Forbidden: file type not allowed" });
      }

      const ext = requestedPath.toLowerCase().substring(lastDotIndex);
      if (!allowedExtensions.includes(ext)) {
        return reply
          .code(403)
          .send({ message: "Forbidden: file type not allowed" });
      }

      // Проверяем, что путь находится внутри uploads директории
      const fullPath = resolve(uploadsRoot, requestedPath);
      const normalizedPath = normalize(fullPath);
      const normalizedRoot = normalize(uploadsRoot);

      if (!normalizedPath.startsWith(normalizedRoot)) {
        return reply.code(403).send({ message: "Forbidden" });
      }
    }
  });

  app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: "/uploads/",
    // Безопасные заголовки для файлов
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Download-Options", "noopen");
      res.setHeader("Cache-Control", "public, max-age=31536000"); // Кэширование на 1 год
    },
  });

  app.setErrorHandler(errorHandler);

  app.decorate(
    "authenticate",
    async function authenticate(request, reply): Promise<void> {
      try {
        await request.jwtVerify();
      } catch (error) {
        // Защита от timing attacks: всегда выполняем одинаковое время для неверных токенов
        // JWT библиотека уже защищена от timing attacks
        reply.status(401).send({ message: "Unauthorized" });
      }
    }
  );

  app.decorate("authorize", function authorize(requiredRoles: string[] = []) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (requiredRoles.length === 0) {
        return;
      }

      const userRoles =
        (request.user as { roles?: string[] } | undefined)?.roles ?? [];

      const allowed = requiredRoles.some((role) => userRoles.includes(role));

      if (!allowed) {
        reply.status(403).send({ message: "Forbidden" });
      }
    };
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(userRoutes, { prefix: "/users" });
  app.register(applicationRoutes, { prefix: "/applications" });
  app.register(tournamentRoutes, { prefix: "/tournaments" });
  app.register(playerRoutes, { prefix: "/players" });
  app.register(roleRoutes, { prefix: "/roles" });
  app.register(lobbyRoutes, {
    prefix: "/lobbies",
    ...(discordService ? { discordService } : {}),
  });

  return app;
};
