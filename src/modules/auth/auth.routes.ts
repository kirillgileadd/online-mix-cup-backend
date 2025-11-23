import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { z } from "zod";

import { env } from "../../config/env";
import { errorResponseSchema, tokenPairSchema } from "../../docs/schemas";
import { parseWithValidation } from "../../utils/validation";
import { UserService } from "../users/user.service";
import { TelegramAuthService } from "./telegram-auth.service";
import { TokenService } from "./token.service";
import { RoleService } from "../roles/role.service";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;

const telegramLoginSchema = z.object({
  id: z.union([z.string(), z.number()]),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().url().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  const userService = new UserService();
  const telegramAuthService = new TelegramAuthService(userService);
  const tokenService = new TokenService();
  const roleService = new RoleService();

  const refreshCookieOptions = {
    httpOnly: true,
    sameSite: "none" as const,
    secure: true,
    path: "/",
  };

  const issueTokenPair = async (user: User) => {
    const roles = await roleService.getUserRoleNames(user.id);

    const accessToken = await app.jwt.sign(
      {
        sub: user.id,
        telegramId: user.telegramId,
        roles,
        username: user.username ?? null,
        photoUrl: user.photoUrl ?? null,
      },
      {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }
    );

    const refreshData = await tokenService.createRefreshToken(user.id);
    const refreshToken = refreshData.refreshToken;

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresAt: refreshData.expiresAt.toISOString(),
      roles,
      user: {
        username: user.username,
        photoUrl: user.photoUrl,
      },
    };
  };

  app.post(
    "/telegram/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Авторизация через Telegram Login Widget",
        body: {
          type: "object",
          required: ["id", "auth_date", "hash"],
          properties: {
            id: { type: ["string", "integer"] },
            first_name: { type: "string" },
            last_name: { type: "string" },
            username: { type: "string" },
            photo_url: { type: "string" },
            auth_date: { type: "integer" },
            hash: { type: "string" },
          },
        },
        response: {
          200: tokenPairSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const payload = parseWithValidation(telegramLoginSchema, request.body);
        const user = await telegramAuthService.authenticate(payload);

        const tokens = await issueTokenPair(user);
        reply
          .setCookie("refreshToken", tokens.refreshToken, {
            ...refreshCookieOptions,
            expires: new Date(tokens.refreshExpiresAt),
          })
          .send({
            accessToken: tokens.accessToken,
            tokenType: tokens.tokenType,
            expiresIn: tokens.expiresIn,
            roles: tokens.roles,
            user: tokens.user,
          });
      } catch (error) {
        reply.code(401).send({
          message:
            error instanceof Error ? error.message : "Telegram auth failed",
        });
      }
    }
  );

  app.post(
    "/refresh",
    {
      schema: {
        tags: ["auth"],
        summary: "Обновить пару токенов",
        body: { type: "null" },
        response: {
          200: tokenPairSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const refreshToken = request.cookies.refreshToken;
        if (!refreshToken) {
          throw new Error("Refresh token missing");
        }
        const stored = await tokenService.verifyRefreshToken(refreshToken);

        await tokenService.revokeToken(refreshToken);

        const user = await userService.findById(stored.userId);
        if (!user) {
          throw new Error("User not found");
        }

        const tokens = await issueTokenPair(user);
        reply
          .setCookie("refreshToken", tokens.refreshToken, {
            ...refreshCookieOptions,
            expires: new Date(tokens.refreshExpiresAt),
          })
          .send({
            accessToken: tokens.accessToken,
            tokenType: tokens.tokenType,
            expiresIn: tokens.expiresIn,
            roles: tokens.roles,
            user: tokens.user,
          });
      } catch (error) {
        reply.code(401).send({
          message:
            error instanceof Error ? error.message : "Invalid refresh token",
        });
      }
    }
  );

  app.post(
    "/logout",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["auth"],
        summary: "Выйти и отозвать все refresh токены",
        security: [{ bearerAuth: [] }],
        response: {
          204: { type: "null" },
        },
      },
    },
    async (request, reply) => {
      const userId = (request.user as { sub: number }).sub;
      await tokenService.revokeAllForUser(userId);
      reply
        .clearCookie("refreshToken", {
          path: refreshCookieOptions.path,
          sameSite: refreshCookieOptions.sameSite,
          secure: refreshCookieOptions.secure,
        })
        .code(204)
        .send();
    }
  );

  // Регистрируем dev/login только в dev режиме
  if (env.NODE_ENV !== "production" && env.ENABLE_DEV_LOGIN) {
    app.post(
      "/dev/login",
      {
        schema: {
          hide: true, // Скрываем из Swagger документации
          tags: ["auth"],
          summary: "Dev-авторизация без Telegram",
          description:
            "Создаёт admin пользователя (если его нет), присваивает ему админскую роль и выдаёт токены. Доступно только в dev режиме с ENABLE_DEV_LOGIN=true.",
          body: { type: "null" },
          response: {
            200: tokenPairSchema,
            403: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        // Дополнительная проверка на всякий случай
        if (env.NODE_ENV === "production" || !env.ENABLE_DEV_LOGIN) {
          return reply.code(403).send({ message: "Dev login disabled" });
        }

        const user = await userService.getOrCreate({
          telegramId: "admin",
          username: "admin",
          photoUrl: null,
          discordUsername: null,
        });

        await roleService.assignRoleToUser(user.id, "admin");

        const tokens = await issueTokenPair(user);
        reply
          .setCookie("refreshToken", tokens.refreshToken, {
            ...refreshCookieOptions,
            expires: new Date(tokens.refreshExpiresAt),
          })
          .send({
            accessToken: tokens.accessToken,
            tokenType: tokens.tokenType,
            expiresIn: tokens.expiresIn,
            roles: tokens.roles,
            user: tokens.user,
          });
      }
    );
  }
}
