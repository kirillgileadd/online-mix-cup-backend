import { z } from "zod";

export const applicationPayloadSchema = z.object({
  userId: z.number().int().positive(),
  tournamentId: z.number().int().positive(),
  mmr: z.number().int().nonnegative(),
  gameRoles: z.string().min(1),
  nickname: z.string().min(1),
  dotabuff: z.string().optional(),
  isPaid: z.boolean().optional(),
  receiptImageUrl: z.string().optional(),
});

export type ApplicationPayload = z.infer<typeof applicationPayloadSchema>;

