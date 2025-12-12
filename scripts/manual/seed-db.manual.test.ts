import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";

import { prisma } from "../../src/config/prisma";
import { TournamentService } from "../../src/modules/tournaments/tournament.service";
import { UserService } from "../../src/modules/users/user.service";
import { PlayerService } from "../../src/modules/players/player.service";

describe("Manual seed: 22 players", () => {
  const tournamentService = new TournamentService();
  const userService = new UserService();
  const playerService = new PlayerService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("создаёт турнир и 22 игроков без очистки", async () => {
    const uniqueRunSuffix = Date.now();

    const tournament = await tournamentService.createTournament(
      `Manual seed ${uniqueRunSuffix}`,
      0,
      null,
      0
    );

    const users = await Promise.all(
      Array.from({ length: 22 }, (_, index) =>
        userService.getOrCreate({
          telegramId: `manual_seed_${uniqueRunSuffix}_${index}`,
          username: `manualseed${index}`,
        })
      )
    );

    const players = await Promise.all(
      users.map((user, index) =>
        playerService.createPlayer({
          userId: user.id,
          tournamentId: tournament.id,
          nickname: `ManualSeed_${index}`,
          mmr: 2100 - index * 10,
          gameRoles: "flex",
        })
      )
    );

    const playerCount = await prisma.player.count({
      where: { tournamentId: tournament.id },
    });

    expect(players).toHaveLength(22);
    expect(new Set(players.map((player) => player.tournamentId)).size).toBe(1);
    expect(playerCount).toBe(22);
  });
});
