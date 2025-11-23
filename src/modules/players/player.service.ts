import { prisma } from "../../config/prisma";

export class PlayerService {
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
}
