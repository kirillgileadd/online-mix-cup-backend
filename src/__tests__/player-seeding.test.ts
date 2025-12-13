import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";

import { prisma } from "../config/prisma";
import { TournamentService } from "../modules/tournaments/tournament.service";
import { UserService } from "../modules/users/user.service";
import { PlayerService } from "../modules/players/player.service";

describe("Player seeding - 22 users and players", () => {
  const tournamentService = new TournamentService();
  const userService = new UserService();
  const playerService = new PlayerService();

  let tournamentId: number;
  const userIds: number[] = [];
  const playerIds: number[] = [];

  afterAll(async () => {
    if (playerIds.length > 0) {
      await prisma.participation.deleteMany({
        where: { playerId: { in: playerIds } },
      });
      await prisma.player.deleteMany({
        where: { id: { in: playerIds } },
      });
    }

    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    if (tournamentId) {
      await prisma.tournament.delete({
        where: { id: tournamentId },
      });
    }

    await prisma.$disconnect();
  });

  it("создаёт турнир и 22 игроков", async () => {
    const tournament = await tournamentService.createTournament(
      "Players 22 test",
      0,
      null,
      0
    );

    tournamentId = tournament.id;

    const createdUsers = await Promise.all(
      Array.from({ length: 22 }, (_, index) =>
        userService.getOrCreate({
          telegramId: `seed_player_${Date.now()}_${index}`,
          username: `seedplayer${index}`,
        })
      )
    );
    userIds.push(...createdUsers.map((user) => user.id));

    const createdPlayers = await Promise.all(
      userIds.map((userId, index) =>
        playerService.createPlayer({
          userId,
          tournamentId,
          mmr: 2000 - index * 10,
          gameRoles: "flex",
        })
      )
    );
    playerIds.push(...createdPlayers.map((player) => player.id));

    expect(createdPlayers).toHaveLength(22);
    expect(new Set(createdPlayers.map((player) => player.tournamentId)).size).toBe(
      1
    );

    const playersInTournament = await prisma.player.count({
      where: { tournamentId },
    });
    expect(playersInTournament).toBe(22);
  });
});

