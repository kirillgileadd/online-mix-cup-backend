import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { errorResponseSchema, lobbySchema } from "../../docs/schemas";
import { parseWithValidation } from "../../utils/validation";
import {
  generateLobbiesSchema,
  draftPickSchema,
  startPlayingSchema,
  finishLobbySchema,
  replacePlayerSchema,
  setFirstPickerSchema,
  createSteamLobbySchema,
} from "./lobby.schema";
import { LobbyService } from "./lobby.service";
import { DiscordService } from "../discord/discord.service";

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

export async function lobbyRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions & { discordService?: DiscordService }
) {
  const service = new LobbyService(options.discordService);
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
          "Добавляет или удаляет игрока из команды. type: 'add' - добавляет игрока в команду, 'remove' - удаляет игрока из команды. teamId - это ID команды из массива teams лобби. slot - позиция игрока в команде (0-4), используется только при type='add', если не указан, выбирается автоматически.",
        body: {
          type: "object",
          required: ["lobbyId", "playerId", "teamId", "type"],
          properties: {
            lobbyId: { type: "integer" },
            playerId: { type: "integer" },
            teamId: { type: "integer" },
            type: {
              type: "string",
              enum: ["add", "remove"],
              description:
                "Тип операции: 'add' - добавить игрока в команду, 'remove' - удалить игрока из команды",
            },
            slot: {
              type: ["integer", "null"],
              minimum: 0,
              maximum: 4,
              description:
                "Позиция игрока в команде (0-4). Используется только при type='add'. Если не указан, выбирается автоматически",
            },
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
          payload.teamId,
          payload.type,
          payload.slot
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
    "/start-playing",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary:
          "Начать игру (создать лобби через Steam бота и перевести в статус PLAYING)",
        description:
          "Создает лобби через Steam бота, приглашает игроков, переводит лобби в статус PLAYING. Проверяет, что все игроки выбраны и в каждой команде по 5 игроков. Устанавливает таймер на 3 минуты для автоматического покидания лобби, если бот все еще в нем.",
        body: {
          type: "object",
          required: ["lobbyId"],
          properties: {
            lobbyId: { type: "integer" },
            gameName: { type: "string" },
            gameMode: { type: "integer", minimum: 1, maximum: 22 },
            passKey: { type: "string" },
            serverRegion: { type: "integer", minimum: 1 },
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
      const payload = parseWithValidation(startPlayingSchema, request.body);
      try {
        // Собираем только определенные опции (не undefined)
        const options: {
          gameName?: string;
          gameMode?: number;
          passKey?: string;
          serverRegion?: number;
        } = {};

        if (payload.gameName !== undefined) {
          options.gameName = payload.gameName;
        }
        if (payload.gameMode !== undefined) {
          options.gameMode = payload.gameMode;
        }
        if (payload.passKey !== undefined) {
          options.passKey = payload.passKey;
        }
        if (payload.serverRegion !== undefined) {
          options.serverRegion = payload.serverRegion;
        }

        const lobby = await service.startPlaying(
          payload.lobbyId,
          Object.keys(options).length > 0 ? options : undefined
        );
        return lobby;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error ? error.message : "Ошибка начала игры",
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
          required: ["lobbyId", "winningTeamId"],
          properties: {
            lobbyId: { type: "integer" },
            winningTeamId: {
              type: "integer",
              description: "ID команды-победителя",
            },
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
          payload.winningTeamId
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

  app.post(
    "/replace-player",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Заменить игрока в лобби",
        description:
          "Заменяет игрока в лобби на случайного игрока из chillzone. Игрок из лобби получает -1 жизнь, игрок из chillzone получает -1 chillZoneValue. Лобби переходит в статус PENDING, все игроки теряют статус капитанов и команды.",
        body: {
          type: "object",
          required: ["lobbyId", "playerId"],
          properties: {
            lobbyId: { type: "integer" },
            playerId: { type: "integer" },
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
      const payload = parseWithValidation(replacePlayerSchema, request.body);
      try {
        const lobby = await service.replacePlayer(
          payload.lobbyId,
          payload.playerId
        );
        return lobby;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error ? error.message : "Ошибка замены игрока",
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
    "/:id/current-picker",
    {
      schema: {
        tags: ["lobbies"],
        summary: "Получить ID текущего пикера в драфте",
        description:
          "Возвращает ID капитана, который должен выбирать сейчас в драфте. Использует паттерн [0, 1, 1, 0, 0, 1, 1, 0, 0, 1] для определения очереди.",
        params: lobbyIdParamsSchema,
        response: {
          200: {
            type: "object",
            properties: {
              currentPickerId: { type: ["integer", "null"] },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const lobbyId = Number(id);
      try {
        const currentPickerId = await service.getCurrentPicker(lobbyId);
        return { currentPickerId };
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error
              ? error.message
              : "Ошибка получения текущего пикера",
        });
      }
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

  app.post(
    "/:id/set-first-picker",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Установить первого пикера в драфте",
        description:
          "Устанавливает капитана, который будет выбирать первым в драфте. Используется после жребия для выбора первого пикера игроками.",
        params: lobbyIdParamsSchema,
        body: {
          type: "object",
          required: ["firstPickerId"],
          properties: {
            firstPickerId: {
              type: "integer",
              description: "ID капитана, который будет выбирать первым",
            },
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
      const { id } = request.params as { id: string | number };
      const lobbyId = Number(id);
      const body = request.body as { firstPickerId: number };
      const payload = parseWithValidation(setFirstPickerSchema, {
        lobbyId,
        firstPickerId: body.firstPickerId,
      });
      try {
        const lobby = await service.setFirstPicker(
          payload.lobbyId,
          payload.firstPickerId
        );
        return lobby;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error
              ? error.message
              : "Ошибка установки первого пикера",
        });
      }
    }
  );

  app.post(
    "/create-steam-lobby",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary:
          "Создать лобби через Steam бота, отправить приглашения и сообщение в Discord",
        description:
          "Создает лобби через Steam бота, отправляет приглашения всем игрокам и сообщение в Discord. Не изменяет статус лобби.",
        body: {
          type: "object",
          required: ["lobbyId"],
          properties: {
            lobbyId: { type: "integer" },
            gameName: { type: "string" },
            gameMode: { type: "integer", minimum: 1, maximum: 22 },
            passKey: { type: "string" },
            serverRegion: { type: "integer", minimum: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              steamLobby: {
                type: ["object", "null"],
                properties: {
                  lobbyId: { type: "integer" },
                  gameName: { type: "string" },
                  gameMode: { type: "integer" },
                  passKey: { type: "string" },
                  serverRegion: { type: "integer" },
                  allowCheats: { type: "boolean" },
                  fillWithBots: { type: "boolean" },
                  allowSpectating: { type: "boolean" },
                  visibility: { type: "integer" },
                  allchat: { type: "boolean" },
                },
              },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(createSteamLobbySchema, request.body);
      try {
        const options: {
          gameName?: string;
          gameMode?: number;
          passKey?: string;
          serverRegion?: number;
        } = {};

        if (payload.gameName !== undefined) {
          options.gameName = payload.gameName;
        }
        if (payload.gameMode !== undefined) {
          options.gameMode = payload.gameMode;
        }
        if (payload.passKey !== undefined) {
          options.passKey = payload.passKey;
        }
        if (payload.serverRegion !== undefined) {
          options.serverRegion = payload.serverRegion;
        }

        const result = await service.createSteamLobbyAndInvite(
          payload.lobbyId,
          Object.keys(options).length > 0 ? options : undefined
        );
        return result;
      } catch (error) {
        const statusCode =
          error instanceof Error && error.message.includes("не найдено")
            ? 404
            : 400;
        reply.code(statusCode).send({
          message:
            error instanceof Error
              ? error.message
              : "Ошибка при создании лобби",
        });
      }
    }
  );

  app.post(
    "/leave-steam-lobby",
    {
      preHandler: adminPreHandler,
      schema: {
        tags: ["lobbies"],
        summary: "Покинуть текущее лобби через Steam бота",
        description: "Покидает текущее лобби, в котором находится бот",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.leaveSteamLobby();
        return result;
      } catch (error) {
        reply.code(400).send({
          message:
            error instanceof Error
              ? error.message
              : "Ошибка при покидании лобби",
        });
      }
    }
  );
}
