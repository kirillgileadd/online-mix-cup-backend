import type { FastifyInstance } from "fastify";

import { errorResponseSchema, lobbySchema } from "../../docs/schemas";
import { parseWithValidation } from "../../utils/validation";
import {
  generateLobbiesSchema,
  draftPickSchema,
  finishLobbySchema,
} from "./lobby.schema";
import { LobbyService } from "./lobby.service";

const lobbyIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const tournamentIdParamsSchema = {
  type: "object",
  required: ["tournamentId"],
  properties: {
    tournamentId: { type: "integer" },
  },
};

const longPollQuerySchema = {
  type: "object",
  properties: {
    since: { type: "string", format: "date-time" },
    timeoutMs: { type: "integer", minimum: 1000, maximum: 60000 },
  },
};

const LONG_POLL_INTERVAL_MS = 1000;
const LONG_POLL_DEFAULT_TIMEOUT_MS = 30000;
const LONG_POLL_MAX_TIMEOUT_MS = 60000;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export async function lobbyRoutes(app: FastifyInstance) {
  const service = new LobbyService();
  const adminPreHandler = [app.authenticate, app.authorize(["admin"])];

  app.post(
    "/generate-lobbies",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Генерация лобби для турнира",
        description:
          "Создаёт лобби по алгоритму: сортирует игроков по chillPriority и mmr, формирует группы по 10 человек",
        body: {
          type: "object",
          required: ["tournamentId"],
          properties: {
            tournamentId: { type: "integer" },
            round: {
              type: "integer",
              minimum: 1,
              description:
                "Необязательный параметр. Если не указан, раунд вычисляется автоматически на сервере.",
            },
          },
        },
        response: {
          201: {
            type: "array",
            items: lobbySchema,
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(generateLobbiesSchema, request.body);
      try {
        const lobbies = await service.generateLobbies(
          payload.tournamentId,
          payload.round
        );
        reply.code(201).send(lobbies);
      } catch (error) {
        reply.code(400).send({
          message:
            error instanceof Error ? error.message : "Ошибка генерации лобби",
        });
      }
    }
  );

  app.post(
    "/:id/start-draft",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Начать драфт в лобби",
        description:
          "Определяет капитанов (2 игрока с самым высоким mmr) и переводит лобби в статус DRAFTING",
        params: lobbyIdParamsSchema,
        response: {
          200: lobbySchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const lobbyId = Number(id);
      try {
        const lobby = await service.startDraft(lobbyId);
        return lobby;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error ? error.message : "Ошибка начала драфта",
        });
      }
    }
  );

  app.post(
    "/draft-pick",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Выбор игрока в драфте",
        description:
          "Выбирает игрока в команду. Капитан с большим MMR начинает первым",
        body: {
          type: "object",
          required: ["lobbyId", "playerId", "team"],
          properties: {
            lobbyId: { type: "integer" },
            playerId: { type: "integer" },
            team: { type: "integer", minimum: 1, maximum: 2 },
          },
        },
        response: {
          200: lobbySchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(draftPickSchema, request.body);
      try {
        const lobby = await service.draftPick(
          payload.lobbyId,
          payload.playerId,
          payload.team
        );
        return lobby;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error ? error.message : "Ошибка выбора в драфте",
        });
      }
    }
  );

  app.post(
    "/finish-lobby",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Завершить лобби и проставить результаты",
        description:
          "Идемпотентная операция. Проставляет результаты матча и уменьшает жизни у проигравших",
        body: {
          type: "object",
          required: ["lobbyId", "winningTeam"],
          properties: {
            lobbyId: { type: "integer" },
            winningTeam: { type: "integer", minimum: 1, maximum: 2 },
          },
        },
        response: {
          200: lobbySchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(finishLobbySchema, request.body);
      try {
        const lobby = await service.finishLobby(
          payload.lobbyId,
          payload.winningTeam
        );
        return lobby;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error ? error.message : "Ошибка завершения лобби",
        });
      }
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["lobbies"],
        summary: "Получить лобби по ID",
        params: lobbyIdParamsSchema,
        response: {
          200: lobbySchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const lobbyId = Number(id);
      const lobby = await service.getLobbyById(lobbyId);
      if (!lobby) {
        return reply.code(404).send({ message: "Лобби не найдено" });
      }
      return lobby;
    }
  );

  app.get(
    "/tournament/:tournamentId",
    {
      schema: {
        tags: ["lobbies"],
        summary: "Список лобби турнира",
        params: tournamentIdParamsSchema,
        response: {
          200: {
            type: "array",
            items: lobbySchema,
          },
        },
      },
    },
    async (request) => {
      const { tournamentId } = request.params as {
        tournamentId: number | string;
      };
      const data = await service.listLobbiesByTournament(Number(tournamentId));
      return JSON.parse(JSON.stringify(data));
    }
  );

  app.get(
    "/tournament/:tournamentId/long-poll",
    {
      schema: {
        tags: ["lobbies"],
        summary: "Долгое оповещение об изменениях лобби турнира",
        description:
          "Возвращает список лобби, когда происходят изменения (например, пике игроков). Если изменений нет в течение таймаута, возвращает 204.",
        params: tournamentIdParamsSchema,
        querystring: longPollQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              lastUpdate: { type: "string", format: "date-time" },
              lobbies: {
                type: "array",
                items: lobbySchema,
              },
            },
          },
          204: { type: "null" },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { tournamentId } = request.params as {
        tournamentId: number | string;
      };
      const { since, timeoutMs } = request.query as {
        since?: string;
        timeoutMs?: number;
      };

      const tournamentIdNumber = Number(tournamentId);
      if (Number.isNaN(tournamentIdNumber)) {
        return reply.status(400).send({ message: "Invalid tournament id" });
      }

      let sinceDate: Date | null = null;
      if (since) {
        const parsed = new Date(since);
        if (Number.isNaN(parsed.getTime())) {
          return reply
            .status(400)
            .send({ message: "Invalid since date format" });
        }
        sinceDate = parsed;
      }

      const timeout = Math.min(
        Math.max(timeoutMs ?? LONG_POLL_DEFAULT_TIMEOUT_MS, 1000),
        LONG_POLL_MAX_TIMEOUT_MS
      );

      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const latestChange = await service.getLatestLobbyUpdateTimestamp(
          tournamentIdNumber
        );

        if (!sinceDate || (latestChange && latestChange > sinceDate)) {
          const lobbies = await service.listLobbiesByTournament(
            tournamentIdNumber
          );
          const lastUpdate = (latestChange ?? new Date()).toISOString();
          return reply.send({
            lastUpdate,
            lobbies,
          });
        }

        await sleep(LONG_POLL_INTERVAL_MS);
      }

      return reply.status(204).send();
    }
  );
}
