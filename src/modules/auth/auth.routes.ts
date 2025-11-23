import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { z } from "zod";

import { env } from "../../config/env";
import { errorResponseSchema, tokenPairSchema } from "../../docs/schemas";
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

const devLoginSchema = z.object({
  telegramId: z.string().min(1).default("dev-admin"),
  username: z.string().optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  discordUsername: z.string().optional().nullable(),
  role: z.string().min(1).default("admin"),
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
        const payload = telegramLoginSchema.parse(request.body);
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

  app.post(
    "/dev/login",
    {
      schema: {
        hide: env.NODE_ENV === "production",
        tags: ["auth"],
        summary: "Dev-авторизация без Telegram",
        description:
          "Создаёт (или обновляет) пользователя и выдаёт токены. Доступно только вне production.",
        body: {
          type: "object",
          properties: {
            telegramId: { type: "string" },
            username: { type: ["string", "null"] },
            photoUrl: { type: ["string", "null"] },
            discordUsername: { type: ["string", "null"] },
            role: { type: "string" },
          },
        },
        response: {
          200: tokenPairSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (env.NODE_ENV === "production") {
        return reply.code(403).send({ message: "Dev login disabled" });
      }
      const payload = devLoginSchema.parse(request.body ?? {});
      const user = await userService.getOrCreate({
        telegramId: payload.telegramId,
        username: payload.username ?? undefined,
        photoUrl: payload.photoUrl ?? undefined,
        discordUsername: payload.discordUsername ?? undefined,
      });
      await roleService.assignRoleToUser(user.id, payload.role);

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
