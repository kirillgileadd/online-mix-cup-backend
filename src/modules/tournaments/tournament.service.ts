import type { Tournament, TournamentStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type { UpdateTournamentInput } from "./tournament.schema";

export class TournamentService {
  createTournament(
    name: string,
    price: number,
    eventDate?: string | null,
    prizePool?: number | null,
    previewUrl?: string | null
  ): Promise<Tournament> {
    return prisma.tournament.create({
      data: {
        name,
        status: "draft",
        price,
        eventDate: eventDate ? new Date(eventDate) : null,
        prizePool: prizePool ?? null,
        previewUrl: previewUrl ?? null,
      },
    });
  }

  listTournaments(status?: TournamentStatus) {
    return prisma.tournament.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  getById(id: number) {
    return prisma.tournament.findUnique({
      where: { id },
    });
  }

  updateStatus(id: number, status: TournamentStatus) {
    return prisma.tournament.update({
      where: { id },
      data: { status },
    });
  }

  updateTournament(id: number, data: UpdateTournamentInput) {
    const updateData: {
      name?: string;
      eventDate?: Date | null;
      price?: number;
      prizePool?: number | null;
      previewUrl?: string | null;
    } = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.eventDate !== undefined) {
      updateData.eventDate = data.eventDate ? new Date(data.eventDate) : null;
    }
    if (data.price !== undefined) {
      updateData.price = data.price;
    }
    if (data.prizePool !== undefined) {
      updateData.prizePool = data.prizePool;
    }
    if (data.previewUrl !== undefined) {
      updateData.previewUrl = data.previewUrl;
    }

    return prisma.tournament.update({
      where: { id },
      data: updateData,
    });
  }

  async startTournament(id: number) {
    return prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({ where: { id } });

      if (!tournament) {
        throw new Error("Tournament not found");
      }

      if (tournament.status === "running" || tournament.status === "finished") {
        throw new Error("Tournament already started");
      }

      const approvedApplications = await tx.application.findMany({
        where: {
          tournamentId: id,
          status: "approved",
        },
      });
      const existingPlayersCount = await tx.player.count({
        where: { tournamentId: id },
      });

      if (approvedApplications.length === 0 && existingPlayersCount === 0) {
        throw new Error("No approved applications to form players");
      }

      if (approvedApplications.length > 0) {
        await tx.player.createMany({
          data: approvedApplications.map((application) => ({
            userId: application.userId,
            tournamentId: application.tournamentId,
            nickname:
              application.nickname && application.nickname.trim().length > 0
                ? application.nickname.trim()
                : `Player_${application.userId}`,
            mmr: application.mmr,
            gameRoles: application.gameRoles,
            lives: 3,
            chillZoneValue: 0,
          })),
          skipDuplicates: true,
        });
      }

      return tx.tournament.update({
        where: { id },
        data: { status: "running" },
      });
    });
  }
}
