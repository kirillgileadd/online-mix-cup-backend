import type { FastifyInstance } from "fastify";

import {
  userSchema,
  errorResponseSchema,
  applicationWithTournamentSchema,
} from "../../docs/schemas";
import {
  updateUserSchema,
  userPayloadSchema,
  userRegistrationSchema,
} from "./user.schema";
import { UserRegistrationService } from "./user.registration.service";
import { UserService, type UserWithRoles } from "./user.service";
import { parseWithValidation } from "../../utils/validation";
import { RoleService } from "../roles/role.service";

const createOrUpdateBodySchema = {
  type: "object",
  required: ["telegramId"],
  properties: {
    telegramId: { type: "string" },
    username: { type: ["string", "null"] },
    photoUrl: { type: ["string", "null"] },
    discordUsername: { type: ["string", "null"] },
    roles: {
      type: "array",
      items: { type: "string" },
    },
  },
};

const userIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const telegramParamsSchema = {
  type: "object",
  required: ["telegramId"],
  properties: {
    telegramId: { type: "string" },
  },
};

type BasicUserShape = {
  id: number;
  telegramId: string;
  username: string | null;
  photoUrl: string | null;
  discordUsername: string | null;
  createdAt: Date;
};

const serializeBasicUser = (user: BasicUserShape, roles: string[] = []) => ({
  id: user.id,
  telegramId: user.telegramId,
  username: user.username,
  photoUrl: user.photoUrl,
  discordUsername: user.discordUsername,
  createdAt: user.createdAt,
  roles,
});

const serializeUser = (user: UserWithRoles) =>
  serializeBasicUser(
    user,
    user.roles.map((relation) => relation.role.name)
  );

export async function userRoutes(app: FastifyInstance) {
  const service = new UserService();
  const registrationService = new UserRegistrationService();
  const adminPreHandler = [app.authenticate, app.authorize(["admin"])];

  app.get(
    "/",
    {
      schema: {
        tags: ["users"],
        summary: "Список пользователей",
        response: {
          200: {
            type: "array",
            items: userSchema,
          },
        },
      },
    },
    async () => {
      const users = await service.listUsersWithRoles();
      return users.map(serializeUser);
    }
  );

  app.post(
    "/",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["users"],
        summary: "Создать или получить пользователя",
        body: createOrUpdateBodySchema,
        response: {
          201: userSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(userPayloadSchema, request.body);
      const user = await service.getOrCreate(payload);
      const fullUser = await service.findByIdWithRoles(user.id);
      reply
        .code(201)
        .send(fullUser ? serializeUser(fullUser) : serializeBasicUser(user));
    }
  );

  app.get(
    "/id/:id",
    {
      schema: {
        tags: ["users"],
        summary: "Получить пользователя по ID",
        params: userIdParamsSchema,
        response: {
          200: userSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const userId = Number(id);
      const user = await service.findByIdWithRoles(userId);
      if (!user) {
        return reply.code(404).send({ message: "User not found" });
      }
      return serializeUser(user);
    }
  );

  app.get(
    "/telegram/:telegramId",
    {
      schema: {
        tags: ["users"],
        summary: "Найти пользователя по telegramId",
        params: telegramParamsSchema,
        response: {
          200: userSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { telegramId } = request.params as { telegramId: string };
      const user = await service.findByTelegramIdWithRoles(telegramId);
      if (!user) {
        return reply.code(404).send({ message: "User not found" });
      }
      return serializeUser(user);
    }
  );

  app.patch(
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["users"],
        summary: "Обновить пользователя",
        params: userIdParamsSchema,
        body: {
          type: "object",
          properties: {
            username: { type: ["string", "null"] },
            photoUrl: { type: ["string", "null"] },
            discordUsername: { type: ["string", "null"] },
            roles: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        response: {
          200: userSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const userId = Number(id);
      const body = parseWithValidation(updateUserSchema, request.body ?? {});

      try {
        // Обновляем роли, если они переданы
        if (body.roles !== undefined) {
          const roleService = new RoleService();
          await roleService.updateUserRoles(userId, body.roles);
        }

        // Обновляем данные пользователя (исключая roles)
        const { roles, ...userData } = body;
        const user = await service.updateUser(userId, userData);
        const full = await service.findByIdWithRoles(user.id);
        return full ? serializeUser(full) : serializeBasicUser(user);
      } catch {
        return reply.code(404).send({ message: "User not found" });
      }
    }
  );

  app.delete(
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["users"],
        summary: "Удалить пользователя",
        params: userIdParamsSchema,
        response: {
          204: { type: "null" },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      console.log(id, "userIdof delete");
      const userId = Number(id);
      console.log(userId, "userId");
      try {
        await service.deleteUser(userId);
        reply.code(204).send();
      } catch {
        reply.code(404).send({ message: "User not found" });
      }
    }
  );

  app.post(
    "/register",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["users", "applications"],
        summary: "Регистрация пользователя на турнир",
        description:
          "Метод объединяет шаги 1–2 из жизненного цикла: создаёт (или находит) пользователя и подаёт заявку в выбранный турнир.",
        body: {
          type: "object",
          required: ["telegramId", "tournamentId", "mmr", "gameRoles"],
          properties: {
            telegramId: { type: "string" },
            username: { type: ["string", "null"] },
            discordUsername: { type: ["string", "null"] },
            tournamentId: { type: "integer" },
            mmr: { type: "integer", minimum: 0 },
            gameRoles: { type: "string" },
            nickname: { type: "string" },
          },
        },
        response: {
          201: applicationWithTournamentSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(userRegistrationSchema, request.body);
      const application = await registrationService.registerForTournament(
        payload
      );
      reply.code(201).send(application);
    }
  );
}
