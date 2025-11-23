import type { Tournament, TournamentStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";

export class TournamentService {
  createTournament(
    name: string,
    price: number,
    eventDate?: string | null,
    prizePool?: number | null
  ): Promise<Tournament> {
    return prisma.tournament.create({
      data: {
        name,
        status: "draft",
        price,
        eventDate: eventDate ? new Date(eventDate) : null,
        prizePool: prizePool ?? null,
      },
    });
  }

  listTournaments() {
    return prisma.tournament.findMany({
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

      if (approvedApplications.length === 0) {
        throw new Error("No approved applications to form players");
      }

      await tx.player.createMany({
        data: approvedApplications.map((application) => ({
          userId: application.userId,
          tournamentId: application.tournamentId,
        })),
        skipDuplicates: true,
      });

      return tx.tournament.update({
        where: { id },
        data: { status: "running" },
      });
    });
  }
}

