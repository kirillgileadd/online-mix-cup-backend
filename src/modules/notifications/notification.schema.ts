import { z } from "zod";

export const notificationPayloadSchema = z.object({
  type: z.literal("lobby_created"),
  data: z.object({
    lobbyId: z.number(),
    round: z.number(),
    tournamentId: z.number(),
    tournamentName: z.string(),
    message: z.string(),
  }),
});

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

