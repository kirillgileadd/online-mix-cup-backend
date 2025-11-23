import type { FastifyInstance } from "fastify";

import { applicationSchema, errorResponseSchema } from "../../docs/schemas";
import { parseWithValidation } from "../../utils/validation";
import { applicationPayloadSchema } from "./application.schema";
import { ApplicationService } from "./application.service";

const applicationBodySchema = {
  type: "object",
  required: ["userId", "tournamentId", "mmr", "gameRoles", "nickname"],
  properties: {
    userId: { type: "integer" },
    tournamentId: { type: "integer" },
    mmr: { type: "integer", minimum: 0 },
    gameRoles: { type: "string" },
    nickname: { type: "string" },
  },
};

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const pendingQuerySchema = {
  type: "object",
  properties: {
    tournamentId: { type: "integer" },
  },
};

export async function applicationRoutes(app: FastifyInstance) {
  const service = new ApplicationService();

  app.post(
    "/",
    {
      schema: {
        tags: ["applications"],
        summary: "Создать заявку",
        body: applicationBodySchema,
        response: {
          201: applicationSchema,
        },
      },
    },
    async (request, reply) => {
      const payload = parseWithValidation(
        applicationPayloadSchema,
        request.body
      );
      const application = await service.createApplication(payload);
      reply.code(201).send(application);
    }
  );

  app.get(
    "/pending",
    {
      // preHandler: app.authenticate,
      schema: {
        tags: ["applications"],
        summary: "Список заявок на модерации",
        security: [{ bearerAuth: [] }],
        querystring: pendingQuerySchema,
        response: {
          200: {
            type: "array",
            items: applicationSchema,
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
      return service.listPendingApplications(tournamentId);
    }
  );

  app.post(
    "/:id/approve",
    {
      // preHandler: app.authenticate,
      schema: {
        tags: ["applications"],
        summary: "Одобрить заявку",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: {
          200: applicationSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number | string };
      const applicationId = Number(id);
      try {
        return await service.approveApplication(applicationId);
      } catch (error) {
        return reply.code(404).send({ message: "Application not found" });
      }
    }
  );

  app.post(
    "/:id/reject",
    {
      // preHandler: app.authenticate,
      schema: {
        tags: ["applications"],
        summary: "Отклонить заявку",
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: {
          200: applicationSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number | string };
      const applicationId = Number(id);
      try {
        return await service.rejectApplication(applicationId);
      } catch (error) {
        return reply.code(404).send({ message: "Application not found" });
      }
    }
  );
}
