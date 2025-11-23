import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { roleSchema } from "../../docs/schemas";
import { RoleService } from "./role.service";
import {
  createRoleSchema,
  roleAssignmentSchema,
} from "./role.schema";

export async function roleRoutes(app: FastifyInstance) {
  const service = new RoleService();

  const roleResponseSchema = {
    ...roleSchema,
    properties: {
      ...roleSchema.properties,
      usersCount: { type: "integer" },
    },
  };

  app.get(
    "/",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["roles"],
        summary: "Список ролей",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "array",
            items: roleResponseSchema,
          },
        },
      },
    },
    async () => {
      const roles = await service.listRoles();
      return roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        createdAt: role.createdAt,
        usersCount: role.users.length,
      }));
    }
  );

  app.post(
    "/",
    {
      preHandler: [app.authenticate, app.authorize(["admin"])],
      schema: {
        tags: ["roles"],
        summary: "Создать роль",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            description: { type: ["string", "null"] },
          },
        },
        response: {
          201: roleSchema,
        },
      },
    },
    async (request, reply) => {
      const data = createRoleSchema.parse(request.body);
      const role = await service.createRole(data);
      reply.code(201).send(role);
    }
  );

  const assignmentBody = {
    type: "object",
    required: ["userId", "role"],
    properties: {
      userId: { type: "integer" },
      role: { type: "string" },
    },
  };

  app.post(
    "/assign",
    {
      preHandler: [app.authenticate, app.authorize(["admin"])],
      schema: {
        tags: ["roles"],
        summary: "Назначить роль пользователю",
        security: [{ bearerAuth: [] }],
        body: assignmentBody,
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
    async (request) => {
      const { userId, role } = roleAssignmentSchema.parse(request.body);
      await service.assignRoleToUser(userId, role);
      return { message: `Role ${role} assigned` };
    }
  );

  app.post(
    "/revoke",
    {
      preHandler: [app.authenticate, app.authorize(["admin"])],
      schema: {
        tags: ["roles"],
        summary: "Отозвать роль у пользователя",
        security: [{ bearerAuth: [] }],
        body: assignmentBody,
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
    async (request) => {
      const { userId, role } = roleAssignmentSchema.parse(request.body);
      await service.removeRoleFromUser(userId, role);
      return { message: `Role ${role} revoked` };
    }
  );
}

