import { z } from "zod";

export const userPayloadSchema = z.object({
  telegramId: z.string().min(1),
  username: z.string().optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  discordUsername: z.string().optional().nullable(),
  roles: z.array(z.string().min(1)).optional(),
});

export const updateUserSchema = z.object({
  username: z.string().min(1).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  discordUsername: z.string().optional().nullable(),
  roles: z.array(z.string().min(1)).optional(),
});

export const userRegistrationSchema = userPayloadSchema
  .omit({ photoUrl: true })
  .extend({
    tournamentId: z.number().int().positive(),
    mmr: z.number().int().nonnegative(),
    gameRoles: z.string().min(1),
    nickname: z.string().min(1),
  });

export type UserPayload = z.infer<typeof userPayloadSchema>;
export type UpdateUserPayload = z.infer<typeof updateUserSchema>;
export type UserRegistrationPayload = z.infer<typeof userRegistrationSchema>;
