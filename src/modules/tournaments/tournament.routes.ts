import type { FastifyInstance } from "fastify";

import { tournamentSchema, errorResponseSchema } from "../../docs/schemas";
import {
  createTournamentSchema,
  updateTournamentStatusSchema,
} from "./tournament.schema";
import { TournamentService } from "./tournament.service";

const tournamentParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const tournamentStatusBodySchema = {
  type: "object",
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: ["draft", "collecting", "running", "finished"],
    },
  },
};

export async function tournamentRoutes(app: FastifyInstance) {
  const service = new TournamentService();

  app.get(
    "/",
    {
      schema: {
        tags: ["tournaments"],
        summary: "Список турниров",
        response: {
          200: {
            type: "array",
            items: tournamentSchema,
          },
        },
      },
    },
    async () => service.listTournaments()
  );

  app.post(
    "/",
    {
      // preHandler: app.authenticate,
      schema: {
        tags: ["tournaments"],
        summary: "Создать турнир",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["name", "price"],
          properties: {
            name: { type: "string" },
            eventDate: { type: ["string", "null"], format: "date-time" },
            price: { type: "integer", minimum: 0 },
            prizePool: { type: ["integer", "null"], minimum: 0 },
          },
        },
        response: {
          201: tournamentSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = createTournamentSchema.parse(request.body);
      const tournament = await service.createTournament(
        payload.name,
        payload.price,
        payload.eventDate,
        payload.prizePool
      );
      reply.code(201).send(tournament);
    }
  );

  app.patch(
    "/:id/status",
    {
      // preHandler: app.authenticate,
      schema: {
        tags: ["tournaments"],
        summary: "Обновить статус турнира",
        security: [{ bearerAuth: [] }],
        params: tournamentParamsSchema,
        body: tournamentStatusBodySchema,
        response: {
          200: tournamentSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number | string };
      const tournamentId = Number(id);
      const { status } = updateTournamentStatusSchema.parse(request.body);
      try {
        return await service.updateStatus(tournamentId, status);
      } catch {
        return reply.code(404).send({ message: "Tournament not found" });
      }
    }
  );

  app.post(
    "/:id/start",
    {
      // preHandler: app.authenticate,
      schema: {
        tags: ["tournaments"],
        summary: "Стартовать турнир и сформировать игроков",
        security: [{ bearerAuth: [] }],
        params: tournamentParamsSchema,
        response: {
          200: tournamentSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number | string };
      const tournamentId = Number(id);
      try {
        const tournament = await service.startTournament(tournamentId);
        reply.send(tournament);
      } catch (error) {
        reply.code(400).send({
          message:
            error instanceof Error
              ? error.message
              : "Unable to start tournament",
        });
      }
    }
  );
}
