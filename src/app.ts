import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";

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
import { leaderboardRoutes } from "./modules/leaderboard/leaderboard.routes";
import { notificationRoutes } from "./modules/notifications/notification.routes";
import { DiscordService } from "./modules/discord/discord.service";

export const buildServer = (discordService?: DiscordService) => {
  const app = Fastify({
    logger: loggerConfig,
    // Оптимизация для маломощного сервера
    bodyLimit: 1048576, // 1MB - ограничение размера тела запроса
    requestIdLogLabel: "reqId",
    requestIdHeader: "x-request-id",
    // Управление логированием запросов через переменную окружения
    // Установите ENABLE_REQUEST_LOGGING=true для включения логирования всех запросов
    disableRequestLogging: !env.ENABLE_REQUEST_LOGGING,
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
        {
          name: "leaderboard",
          description: "Лидерборд пользователей с очками",
        },
        {
          name: "notifications",
          description: "Система уведомлений в реальном времени",
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
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // Allowed HTTP methods
    credentials: true, // Allow cookies and authentication tokens
  });

  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  app.register(fastifyCookie, {
    secret: env.JWT_SECRET,
    hook: "onRequest",
  });

  // Поддержка multipart/form-data для загрузки файлов
  app.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB - соответствует лимиту в FileService
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

  app.decorate(
    "authenticateSSE",
    async function authenticateSSE(request, reply): Promise<void> {
      try {
        // Проверяем токен в куке accessToken
        const token = request.cookies.accessToken;

        if (!token) {
          // Для SSE закрываем соединение с ошибкой
          reply.code(401).send({ message: "Unauthorized: token missing" });
          return;
        }

        // Верифицируем токен
        const decoded = await app.jwt.verify(token);

        // Устанавливаем user в request для дальнейшего использования
        request.user = decoded as {
          sub: number;
          telegramId: string;
          roles: string[];
        };
      } catch (error) {
        // Защита от timing attacks: всегда выполняем одинаковое время для неверных токенов
        // Для SSE закрываем соединение с ошибкой
        reply.code(401).send({ message: "Unauthorized: invalid token" });
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
  app.register(leaderboardRoutes, { prefix: "/leaderboard" });
  app.register(notificationRoutes, {
    prefix: "/notifications",
  });

  return app;
};
