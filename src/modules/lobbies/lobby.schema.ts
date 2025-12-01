import { z } from "zod";

export const generateLobbiesSchema = z.object({
  tournamentId: z.number().int().positive(),
  round: z
    .number()
    .int()
    .positive()
    .optional()
    .nullable()
    .transform((val) => (val === null ? undefined : val)),
});

export const draftPickSchema = z.object({
  lobbyId: z.number().int().positive(),
  playerId: z.number().int().positive().nullable(),
  team: z.number().int().min(1).max(2),
});

export const startPlayingSchema = z.object({
  lobbyId: z.number().int().positive(),
});

export const finishLobbySchema = z.object({
  lobbyId: z.number().int().positive(),
  winningTeam: z.number().int().min(1).max(2),
});

export const replacePlayerSchema = z.object({
  lobbyId: z.number().int().positive(),
  playerId: z.number().int().positive(),
});

export type GenerateLobbiesInput = z.infer<typeof generateLobbiesSchema>;
export type DraftPickInput = z.infer<typeof draftPickSchema>;
export type StartPlayingInput = z.infer<typeof startPlayingSchema>;
export type FinishLobbyInput = z.infer<typeof finishLobbySchema>;
export type ReplacePlayerInput = z.infer<typeof replacePlayerSchema>;
