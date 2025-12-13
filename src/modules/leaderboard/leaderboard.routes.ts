import type { FastifyInstance } from "fastify";

import { leaderboardSchema, errorResponseSchema } from "../../docs/schemas";
import { parseWithValidation } from "../../utils/validation";
import {
  createLeaderboardSchema,
  updateLeaderboardSchema,
  addPointsSchema,
} from "./leaderboard.schema";
import { LeaderboardService } from "./leaderboard.service";

const integerSchema = {
  type: "integer",
};

const leaderboardIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const userIdParamsSchema = {
  type: "object",
  required: ["userId"],
  properties: {
    userId: { type: "integer" },
  },
};

const leaderboardQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
  },
};

export async function leaderboardRoutes(app: FastifyInstance) {
  const service = new LeaderboardService();
  const adminPreHandler = [app.authenticate, app.authorize(["admin"])];

  // POST /leaderboard - Создать запись в лидерборде
  app.post(
    "/",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Создать запись в лидерборде",
        body: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "integer" },
            points: { type: "integer", minimum: 0 },
          },
        },
        response: {
          201: leaderboardSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(
        createLeaderboardSchema,
        request.body
      );
      const leaderboard = await service.createLeaderboard(payload);
      reply.code(201).send(leaderboard);
    }
  );

  // GET /leaderboard - Получить список лидерборда
  app.get(
    "/",
    {
      schema: {
        tags: ["leaderboard"],
        summary: "Получить список лидерборда",
        querystring: leaderboardQuerySchema,
        response: {
          200: {
            type: "array",
            items: leaderboardSchema,
          },
        },
      },
    },
    async (request) => {
      const query = request.query as { limit?: number; offset?: number };
      const limit = query.limit ? Number(query.limit) : undefined;
      const offset = query.offset ? Number(query.offset) : undefined;
      return service.listLeaderboard(limit, offset);
    }
  );

  // GET /leaderboard/:id - Получить запись по ID
  app.get(
    "/:id",
    {
      schema: {
        tags: ["leaderboard"],
        summary: "Получить запись лидерборда по ID",
        params: leaderboardIdParamsSchema,
        response: {
          200: leaderboardSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const leaderboardId = Number(id);
      const leaderboard = await service.getById(leaderboardId);
      if (!leaderboard) {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
      return leaderboard;
    }
  );

  // GET /leaderboard/user/:userId - Получить запись по userId
  app.get(
    "/user/:userId",
    {
      schema: {
        tags: ["leaderboard"],
        summary: "Получить запись лидерборда по userId",
        params: userIdParamsSchema,
        response: {
          200: leaderboardSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string | number };
      const userIdNum = Number(userId);
      const leaderboard = await service.getByUserId(userIdNum);
      if (!leaderboard) {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
      return leaderboard;
    }
  );

  // GET /leaderboard/user/:userId/rank - Получить позицию пользователя в лидерборде
  app.get(
    "/user/:userId/rank",
    {
      schema: {
        tags: ["leaderboard"],
        summary: "Получить позицию пользователя в лидерборде",
        params: userIdParamsSchema,
        response: {
          200: {
            type: "object",
            properties: {
              rank: { type: ["integer", "null"] },
            },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string | number };
      const userIdNum = Number(userId);
      const rank = await service.getUserRank(userIdNum);
      if (rank === null) {
        return reply
          .code(404)
          .send({ message: "User not found in leaderboard" });
      }
      return { rank };
    }
  );

  // PUT /leaderboard/:id - Обновить запись
  app.put(
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Обновить запись лидерборда",
        params: leaderboardIdParamsSchema,
        body: {
          type: "object",
          properties: {
            points: { type: "integer", minimum: 0 },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        response: {
          200: leaderboardSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const leaderboardId = Number(id);
      const payload = parseWithValidation(
        updateLeaderboardSchema,
        request.body
      );

      try {
        const leaderboard = await service.updateLeaderboard(
          leaderboardId,
          payload
        );
        return leaderboard;
      } catch {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
    }
  );

  // PATCH /leaderboard/:id - Частично обновить запись
  app.patch(
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Частично обновить запись лидерборда",
        params: leaderboardIdParamsSchema,
        body: {
          type: "object",
          properties: {
            points: { type: "integer", minimum: 0 },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        response: {
          200: leaderboardSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const leaderboardId = Number(id);
      const payload = parseWithValidation(
        updateLeaderboardSchema,
        request.body
      );

      try {
        const leaderboard = await service.updateLeaderboard(
          leaderboardId,
          payload
        );
        return leaderboard;
      } catch {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
    }
  );

  // PUT /leaderboard/user/:userId - Обновить запись по userId
  app.put(
    "/user/:userId",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Обновить запись лидерборда по userId",
        params: userIdParamsSchema,
        body: {
          type: "object",
          properties: {
            points: { type: "integer", minimum: 0 },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        response: {
          200: leaderboardSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string | number };
      const userIdNum = Number(userId);
      const payload = parseWithValidation(
        updateLeaderboardSchema,
        request.body
      );

      try {
        const leaderboard = await service.updateLeaderboardByUserId(
          userIdNum,
          payload
        );
        return leaderboard;
      } catch {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
    }
  );

  // POST /leaderboard/user/:userId/add-points - Добавить очки пользователю
  app.post(
    "/user/:userId/add-points",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Добавить очки пользователю",
        params: userIdParamsSchema,
        body: {
          type: "object",
          required: ["points"],
          properties: {
            points: { type: "integer" },
          },
        },
        response: {
          200: leaderboardSchema,
        },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string | number };
      const userIdNum = Number(userId);
      const payload = parseWithValidation(addPointsSchema, request.body);
      return service.addPoints(userIdNum, payload);
    }
  );

  // DELETE /leaderboard/:id - Удалить запись
  app.delete(
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Удалить запись из лидерборда",
        params: leaderboardIdParamsSchema,
        response: {
          204: { type: "null" },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const leaderboardId = Number(id);

      try {
        await service.deleteLeaderboard(leaderboardId);
        reply.code(204).send();
      } catch {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
    }
  );

  // DELETE /leaderboard/user/:userId - Удалить запись по userId
  app.delete(
    "/user/:userId",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Удалить запись из лидерборда по userId",
        params: userIdParamsSchema,
        response: {
          204: { type: "null" },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string | number };
      const userIdNum = Number(userId);

      try {
        await service.deleteLeaderboardByUserId(userIdNum);
        reply.code(204).send();
      } catch {
        return reply.code(404).send({ message: "Leaderboard entry not found" });
      }
    }
  );

  // POST /leaderboard/recalculate-ranks - Пересчитать ранги для всех записей
  app.post(
    "/recalculate-ranks",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["leaderboard"],
        summary: "Пересчитать ранги для всех записей в лидерборде",
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      await service.recalculateRanks();
      return { message: "Ranks recalculated successfully" };
    }
  );

  // GET /leaderboard/history/user/:userId - Получить историю изменений очков для пользователя
  app.get(
    "/history/user/:userId",
    {
      schema: {
        tags: ["leaderboard"],
        summary: "Получить историю изменений очков для пользователя",
        params: userIdParamsSchema,
        querystring: leaderboardQuerySchema,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              required: [
                "id",
                "leaderboardId",
                "userId",
                "points",
                "createdAt",
              ],
              properties: {
                id: integerSchema,
                leaderboardId: integerSchema,
                userId: integerSchema,
                points: { type: "integer" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string | number };
      const userIdNum = Number(userId);
      const query = request.query as { limit?: number; offset?: number };
      const limit = query.limit ? Number(query.limit) : undefined;
      const offset = query.offset ? Number(query.offset) : undefined;
      return service.getHistoryByUserId(userIdNum, limit, offset);
    }
  );

  // GET /leaderboard/history/:id - Получить историю изменений очков для записи лидерборда
  app.get(
    "/history/:id",
    {
      schema: {
        tags: ["leaderboard"],
        summary: "Получить историю изменений очков для записи лидерборда",
        params: leaderboardIdParamsSchema,
        querystring: leaderboardQuerySchema,
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              required: [
                "id",
                "leaderboardId",
                "userId",
                "points",
                "createdAt",
              ],
              properties: {
                id: integerSchema,
                leaderboardId: integerSchema,
                userId: integerSchema,
                points: { type: "integer" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string | number };
      const leaderboardId = Number(id);
      const query = request.query as { limit?: number; offset?: number };
      const limit = query.limit ? Number(query.limit) : undefined;
      const offset = query.offset ? Number(query.offset) : undefined;
      return service.getHistoryByLeaderboardId(leaderboardId, limit, offset);
    }
  );
}
