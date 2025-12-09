import { z } from "zod";

export const createTournamentSchema = z.object({
  name: z.string().min(1),
  eventDate: z.string().datetime().optional().nullable(),
  price: z.number().int().nonnegative(),
  prizePool: z.number().int().nonnegative().optional().nullable(),
  previewImageBase64: z.string().optional().nullable(),
});

export const updateTournamentStatusSchema = z.object({
  status: z.enum(["draft", "collecting", "running", "finished"]),
});

export const updateTournamentSchema = z.object({
  name: z.string().min(1).optional(),
  eventDate: z.string().datetime().optional().nullable(),
  price: z.number().int().nonnegative().optional(),
  prizePool: z.number().int().nonnegative().optional().nullable(),
  previewImageBase64: z.string().optional().nullable(),
});

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;
