import type { FastifyInstance } from "fastify";

import { playerSchema, errorResponseSchema } from "../../docs/schemas";
import { parseWithValidation } from "../../utils/validation";
import { createPlayerSchema, updatePlayerSchema } from "./player.schema";
import { PlayerService } from "./player.service";

const tournamentParamsSchema = {
  type: "object",
  required: ["tournamentId"],
  properties: {
    tournamentId: { type: "integer" },
  },
};

const playerIdParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const playersQuerySchema = {
  type: "object",
  properties: {
    tournamentId: { type: "integer" },
  },
};

const roundQuerySchema = {
  type: "object",
  properties: {
    round: { type: "integer", minimum: 1 },
  },
};

export async function playerRoutes(app: FastifyInstance) {
  const service = new PlayerService();

  app.post(
    "/",
    {
      schema: {
        tags: ["players"],
        summary: "Создать игрока",
        body: {
          type: "object",
          required: ["userId", "tournamentId", "nickname"],
          properties: {
            userId: { type: "integer" },
            tournamentId: { type: "integer" },
            nickname: { type: "string" },
            mmr: { type: "integer", minimum: 0 },
            seed: { type: ["integer", "null"], minimum: 0 },
            score: { type: ["integer", "null"] },
            chillZoneValue: { type: "integer" },
            lives: { type: "integer", minimum: 0 },
            status: { type: "string", enum: ["active", "eliminated"] },
          },
        },
        response: {
          201: playerSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(createPlayerSchema, request.body);
      const player = await service.createPlayer(payload);
      reply.code(201).send(player);
    }
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["players"],
        summary: "Список игроков",
        querystring: playersQuerySchema,
        response: {
          200: {
            type: "array",
            items: playerSchema,
          },
        },
      },
    },
    async (request) => {
      const query = request.query as { tournamentId?: number | string };
      const tournamentId =
        query.tournamentId !== undefined
          ? Number(query.tournamentId)
          : undefined;
      return service.listPlayers(tournamentId);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["players"],
        summary: "Получить игрока по ID",
        params: playerIdParamsSchema,
        response: {
          200: playerSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const playerId = Number(id);
      const player = await service.getById(playerId);
      if (!player) {
        return reply.code(404).send({ message: "Player not found" });
      }
      return player;
    }
  );

  app.put(
    "/:id",
    {
      schema: {
        tags: ["players"],
        summary: "Обновить игрока",
        params: playerIdParamsSchema,
        body: {
          type: "object",
          properties: {
            nickname: { type: "string" },
            mmr: { type: "integer", minimum: 0 },
            seed: { type: ["integer", "null"], minimum: 0 },
            score: { type: ["integer", "null"] },
            chillZoneValue: { type: "integer" },
            lives: { type: "integer", minimum: 0 },
            status: { type: "string", enum: ["active", "eliminated"] },
          },
        },
        response: {
          200: playerSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const playerId = Number(id);
      const payload = parseWithValidation(updatePlayerSchema, request.body);

      try {
        const player = await service.updatePlayer(playerId, payload);
        return player;
      } catch {
        return reply.code(404).send({ message: "Player not found" });
      }
    }
  );

  app.patch(
    "/:id",
    {
      schema: {
        tags: ["players"],
        summary: "Частично обновить игрока",
        params: playerIdParamsSchema,
        body: {
          type: "object",
          properties: {
            nickname: { type: "string" },
            mmr: { type: "integer", minimum: 0 },
            seed: { type: ["integer", "null"], minimum: 0 },
            score: { type: ["integer", "null"] },
            chillZoneValue: { type: "integer" },
            lives: { type: "integer", minimum: 0 },
            status: { type: "string", enum: ["active", "eliminated"] },
          },
        },
        response: {
          200: playerSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const playerId = Number(id);
      const payload = parseWithValidation(updatePlayerSchema, request.body);

      try {
        const player = await service.updatePlayer(playerId, payload);
        return player;
      } catch {
        return reply.code(404).send({ message: "Player not found" });
      }
    }
  );

  app.delete(
    "/:id",
    {
      schema: {
        tags: ["players"],
        summary: "Удалить игрока",
        params: playerIdParamsSchema,
        response: {
          204: { type: "null" },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string | number };
      const playerId = Number(id);

      try {
        await service.deletePlayer(playerId);
        reply.code(204).send();
      } catch {
        return reply.code(404).send({ message: "Player not found" });
      }
    }
  );

  app.get(
    "/tournament/:tournamentId",
    {
      schema: {
        tags: ["players"],
        summary: "Список игроков турнира",
        params: tournamentParamsSchema,
        response: {
          200: {
            type: "array",
            items: playerSchema,
          },
        },
      },
    },
    async (request) => {
      const { tournamentId } = request.params as {
        tournamentId: number | string;
      };
      return service.listByTournament(Number(tournamentId));
    }
  );

  app.get(
    "/tournament/:tournamentId/chill-zone",
    {
      schema: {
        tags: ["players"],
        summary: "Список игроков в chill zone для раунда",
        params: tournamentParamsSchema,
        querystring: roundQuerySchema,
        response: {
          200: {
            type: "array",
            items: playerSchema,
          },
        },
      },
    },
    async (request) => {
      const { tournamentId } = request.params as {
        tournamentId: number | string;
      };
      const { round } = request.query as { round?: number };
      return service.listChillZonePlayers(
        Number(tournamentId),
        round !== undefined ? Number(round) : undefined
      );
    }
  );
}
