import { z } from "zod";

export const createLeaderboardSchema = z.object({
  userId: z.number().int().positive(),
  points: z.number().int().nonnegative().optional().default(0),
});

export const updateLeaderboardSchema = z.object({
  points: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime().optional(),
});

export const addPointsSchema = z.object({
  points: z.number().int(),
  createdAt: z.string().datetime().optional(),
});

export type CreateLeaderboardInput = z.infer<typeof createLeaderboardSchema>;
export type UpdateLeaderboardInput = z.infer<typeof updateLeaderboardSchema>;
export type AddPointsInput = z.infer<typeof addPointsSchema>;

