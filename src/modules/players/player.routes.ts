import type { FastifyInstance } from "fastify";

import { playerSchema } from "../../docs/schemas";
import { PlayerService } from "./player.service";

const paramsSchema = {
  type: "object",
  required: ["tournamentId"],
  properties: {
    tournamentId: { type: "integer" },
  },
};

export async function playerRoutes(app: FastifyInstance) {
  const service = new PlayerService();

  app.get(
    "/tournament/:tournamentId",
    {
      schema: {
        tags: ["players"],
        summary: "Список игроков турнира",
        params: paramsSchema,
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
}
