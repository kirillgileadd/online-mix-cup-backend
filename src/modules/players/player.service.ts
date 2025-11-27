import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type { CreatePlayerInput, UpdatePlayerInput } from "./player.schema";

export class PlayerService {
  createPlayer(data: CreatePlayerInput) {
    return prisma.player.create({
      data: {
        userId: data.userId,
        tournamentId: data.tournamentId,
        nickname: data.nickname,
        gameRoles: data.gameRoles ?? "flex",
        mmr: data.mmr ?? 1000,
        seed: data.seed ?? null,
        score: data.score ?? null,
        chillZoneValue: data.chillZoneValue ?? 0,
        lives: data.lives ?? 3,
        status: data.status ?? "active",
      },
      include: {
        user: true,
        tournament: true,
      },
    });
  }

  listPlayers(tournamentId?: number) {
    return prisma.player.findMany({
      where: {
        ...(tournamentId ? { tournamentId } : {}),
      },
      include: {
        user: true,
        tournament: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  getById(id: number) {
    return prisma.player.findUnique({
      where: { id },
      include: {
        user: true,
        tournament: true,
      },
    });
  }

  listByTournament(tournamentId: number) {
    return prisma.player.findMany({
      where: { tournamentId },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  }

  async listChillZonePlayers(tournamentId: number, round?: number) {
    // Determine round: if not provided, use latest round with lobbies
    let targetRound = round;
    if (targetRound === undefined) {
      const lastLobby = await prisma.lobby.findFirst({
        where: { tournamentId },
        orderBy: { round: "desc" },
        select: { round: true },
      });
      targetRound = lastLobby?.round;
    }

    if (targetRound === undefined) {
      return [];
    }

    const lobbies = await prisma.lobby.findMany({
      where: { tournamentId, round: targetRound },
      select: { id: true },
    });

    if (lobbies.length === 0) {
      return [];
    }

    const participations = await prisma.participation.findMany({
      where: { lobbyId: { in: lobbies.map((l) => l.id) } },
      select: { playerId: true },
    });

    const playerIdsInRound = participations.map((p) => p.playerId);

    return prisma.player.findMany({
      where: {
        tournamentId,
        status: "active",
        ...(playerIdsInRound.length ? { id: { notIn: playerIdsInRound } } : {}),
      },
      include: {
        user: true,
        tournament: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  updatePlayer(id: number, data: UpdatePlayerInput) {
    const updateData: {
      nickname?: string;
      gameRoles?: string;
      mmr?: number;
      seed?: number | null;
      score?: number | null;
      chillZoneValue?: number;
      lives?: number;
      status?: "active" | "eliminated";
    } = {};

    if (data.nickname !== undefined) {
      updateData.nickname = data.nickname;
    }
    if (data.gameRoles !== undefined) {
      updateData.gameRoles = data.gameRoles;
    }
    if (data.mmr !== undefined) {
      updateData.mmr = data.mmr;
    }
    if (data.seed !== undefined) {
      updateData.seed = data.seed;
    }
    if (data.score !== undefined) {
      updateData.score = data.score;
    }
    if (data.chillZoneValue !== undefined) {
      updateData.chillZoneValue = data.chillZoneValue;
    }
    if (data.lives !== undefined) {
      updateData.lives = data.lives;
    }
    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    return prisma.player.update({
      where: { id },
      data: updateData as Prisma.PlayerUpdateInput,
      include: {
        user: true,
        tournament: true,
      },
    });
  }

  async deletePlayer(id: number): Promise<void> {
    await prisma.player.delete({
      where: { id },
    });
  }
}
