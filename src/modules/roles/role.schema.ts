import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(255).optional().nullable(),
});

export const roleAssignmentSchema = z.object({
  userId: z.number().int().positive(),
  role: z.string().min(2).max(50),
});

