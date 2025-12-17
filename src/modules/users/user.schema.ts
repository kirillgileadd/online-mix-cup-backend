import { z } from "zod";

export const userPayloadSchema = z.object({
  telegramId: z.string().min(1),
  username: z.string().optional().nullable(),
  nickname: z.string().min(1).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  discordUsername: z.string().optional().nullable(),
  steamProfileLink: z.string().url().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
  roles: z.array(z.string().min(1)).optional(),
});

export const updateUserSchema = z.object({
  username: z.string().min(1).optional().nullable(),
  nickname: z.string().min(1).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  discordUsername: z.string().optional().nullable(),
  steamProfileLink: z.string().url().optional().nullable(),
  roles: z.array(z.string().min(1)).optional(),
});

export const userRegistrationSchema = userPayloadSchema
  .omit({ photoUrl: true })
  .extend({
    tournamentId: z.number().int().positive(),
    mmr: z.number().int().nonnegative(),
    gameRoles: z.string().min(1),
    nickname: z.string().min(1),
    dotabuff: z.string().optional(),
    receiptImageBase64: z.string().optional(),
  });

export const updateProfileSchema = z.object({
  nickname: z.string().min(1).optional().nullable(),
  discordUsername: z.string().optional().nullable(),
  photoBase64: z.string().optional().nullable(),
  steamProfileLink: z.string().url().optional().nullable(),
});

export const updateNotificationSettingsSchema = z.object({
  isTelegramNotifications: z.boolean().optional(),
  isSSENotifications: z.boolean().optional(),
  notificationsVolume: z.number().int().min(1).max(10).optional(),
});

export type UserPayload = z.infer<typeof userPayloadSchema>;
export type UpdateUserPayload = z.infer<typeof updateUserSchema>;
export type UserRegistrationPayload = z.infer<typeof userRegistrationSchema>;
export type UpdateProfilePayload = z.infer<typeof updateProfileSchema>;
export type UpdateNotificationSettingsPayload = z.infer<
  typeof updateNotificationSettingsSchema
>;
