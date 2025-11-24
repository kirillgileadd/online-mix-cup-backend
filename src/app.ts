import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import cors from "@fastify/cors";

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

export const buildServer = () => {
  const app = Fastify({
    logger: loggerConfig,
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

  app.setErrorHandler(errorHandler);

  app.decorate(
    "authenticate",
    async function authenticate(request, reply): Promise<void> {
      try {
        await request.jwtVerify();
      } catch (error) {
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
  app.register(lobbyRoutes, { prefix: "/lobbies" });

  return app;
};
