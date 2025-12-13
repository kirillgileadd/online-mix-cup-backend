import { z } from "zod";

export const createPlayerSchema = z.object({
  userId: z.number().int().positive(),
  tournamentId: z.number().int().positive(),
  gameRoles: z.string().min(1).optional(),
  mmr: z.number().int().nonnegative().optional(),
  seed: z.number().int().nonnegative().optional().nullable(),
  score: z.number().int().optional().nullable(),
  chillZoneValue: z.number().int().optional(),
  lives: z.number().int().nonnegative().optional(),
  status: z.enum(["active", "eliminated"]).optional(),
});

export const updatePlayerSchema = z.object({
  gameRoles: z.string().min(1).optional(),
  mmr: z.number().int().nonnegative().optional(),
  seed: z.number().int().nonnegative().optional().nullable(),
  score: z.number().int().optional().nullable(),
  chillZoneValue: z.number().int().optional(),
  lives: z.number().int().nonnegative().optional(),
  status: z.enum(["active", "eliminated"]).optional(),
});

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
