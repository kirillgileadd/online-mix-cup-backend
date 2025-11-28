import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../config/prisma";
import { TournamentService } from "../modules/tournaments/tournament.service";
import { PlayerService } from "../modules/players/player.service";
import { LobbyService } from "../modules/lobbies/lobby.service";
import { UserService } from "../modules/users/user.service";

describe("Lobby System - Полный сценарий", () => {
  let tournamentId: number;
  let userIds: number[] = [];
  let playerIds: number[] = [];
  let lobbyId: number;

  const tournamentService = new TournamentService();
  const playerService = new PlayerService();
  const lobbyService = new LobbyService();
  const userService = new UserService();

  // Очистка данных после тестов
  afterAll(async () => {
    // Удаляем в правильном порядке из-за foreign keys
    // Сначала удаляем все Participation
    if (playerIds.length > 0) {
      await prisma.participation.deleteMany({
        where: { playerId: { in: playerIds } },
      });
    }

    if (lobbyId) {
      await prisma.participation.deleteMany({
        where: { lobbyId },
      });
      await prisma.lobby.delete({
        where: { id: lobbyId },
      });
    }

    // Удаляем все лобби турнира (на случай второго раунда)
    if (tournamentId) {
      const allLobbies = await prisma.lobby.findMany({
        where: { tournamentId },
      });
      for (const lobby of allLobbies) {
        await prisma.participation.deleteMany({
          where: { lobbyId: lobby.id },
        });
        await prisma.lobby.delete({
          where: { id: lobby.id },
        });
      }
    }

    if (playerIds.length > 0) {
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

  it("1. Создание турнира", async () => {
    const tournament = await tournamentService.createTournament(
      "Test Tournament",
      100,
      null,
      1000
    );

    expect(tournament).toBeDefined();
    expect(tournament.name).toBe("Test Tournament");
    expect(tournament.status).toBe("draft");
    tournamentId = tournament.id;
  });

  it("2. Создание 12 пользователей", async () => {
    const users = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        userService.getOrCreate({
          telegramId: `test_user_${Date.now()}_${i}`,
          username: `testuser${i}`,
        })
      )
    );

    expect(users).toHaveLength(12);
    userIds = users.map((u) => u.id);
    expect(userIds.every((id) => typeof id === "number")).toBe(true);
  });

  it("3. Создание 12 игроков с разными MMR", async () => {
    // Создаём игроков с разными MMR для проверки сортировки
    // Первые 10 будут с высоким MMR (попадут в лобби)
    // Последние 2 с низким MMR (попадут в chill zone)
    const mmrValues = [
      2000,
      1900,
      1800,
      1700,
      1600,
      1500,
      1400,
      1300,
      1200,
      1100, // Первые 10
      1000,
      900, // Последние 2
    ];

    const players = await Promise.all(
      userIds.map((userId, index) =>
        playerService.createPlayer({
          userId,
          tournamentId,
          nickname: `Player_${index}`,
          mmr: mmrValues[index],
          lives: 3,
          chillZoneValue: 0,
        })
      )
    );

    expect(players).toHaveLength(12);
    playerIds = players.map((p) => p.id);
    expect(players.every((p) => p.mmr > 0)).toBe(true);
  });

  it("4. Генерация лобби - 10 игроков попадают, 2 в chill zone", async () => {
    const lobbies = await lobbyService.generateLobbies(tournamentId);

    expect(lobbies).toHaveLength(1);
    const [firstLobby] = lobbies;
    if (!firstLobby) {
      throw new Error("Лобби не создано");
    }

    expect(firstLobby.participations).toHaveLength(10);
    expect(firstLobby.status).toBe("PENDING");
    expect(firstLobby.round).toBe(1);
    lobbyId = firstLobby.id;

    // Проверяем, что игроки в лобби имеют chillZoneValue = 0
    const playersInLobby = await prisma.player.findMany({
      where: {
        id: { in: firstLobby.participations.map((p) => p.playerId) },
      },
    });

    expect(playersInLobby.every((p) => p.chillZoneValue === 0)).toBe(true);

    // Проверяем, что игроки в chill zone имеют chillZoneValue = 1
    const playersNotInLobby = await prisma.player.findMany({
      where: {
        tournamentId,
        id: { notIn: firstLobby.participations.map((p) => p.playerId) },
      },
    });

    expect(playersNotInLobby).toHaveLength(2);
    expect(playersNotInLobby.every((p) => p.chillZoneValue === 1)).toBe(true);
  });

  it("5. Начало драфта - определение капитанов", async () => {
    const lobby = await lobbyService.startDraft(lobbyId);

    expect(lobby.status).toBe("DRAFTING");

    // Проверяем, что есть 2 капитана
    const captains = lobby.participations.filter((p) => p.isCaptain);
    expect(captains).toHaveLength(2);

    // Проверяем, что капитаны - это игроки с самым высоким MMR внутри лобби
    const mmrSorted = lobby.participations
      .map((p) => p.player?.mmr || 0)
      .sort((a, b) => b - a);

    const captainMmr = captains
      .map((c) => c.player?.mmr || 0)
      .sort((a, b) => b - a);

    expect(captainMmr).toEqual(mmrSorted.slice(0, 2));

    // И у каждой команды есть капитан
    expect(captains.some((c) => c.team === 1)).toBe(true);
    expect(captains.some((c) => c.team === 2)).toBe(true);
  });

  it("6. Драфт - распределение игроков по командам", async () => {
    // Получаем текущее состояние лобби
    let lobby = await lobbyService.getLobbyById(lobbyId);
    if (!lobby) throw new Error("Лобби не найдено");

    // Находим капитанов
    const captains = lobby.participations.filter((p) => p.isCaptain);
    expect(captains).toHaveLength(2);

    // Определяем команды капитанов (при старте драфта им автоматически назначены команды)
    const team1 = 1;
    const team2 = 2;
    const captainTeam1 = captains.find((p) => p.team === team1);
    const captainTeam2 = captains.find((p) => p.team === team2);
    if (!captainTeam1 || !captainTeam2) {
      throw new Error("Не определены капитаны для обеих команд");
    }

    // Получаем список игроков без команды (капитаны уже занимают первые слоты)
    const unassignedPlayers = lobby.participations.filter(
      (p) => p.team === null
    );

    // Распределяем оставшихся игроков по очереди (snake draft)
    // Капитан 1 (team1) выбирает первым, затем капитан 2 (team2), и так далее
    const draftOrder: Array<{ playerId: number; team: number }> = [];
    let currentTeam = team1; // Капитан 1 начинает

    for (const player of unassignedPlayers) {
      draftOrder.push({ playerId: player.playerId, team: currentTeam });
      // Переключаем команду для следующего выбора
      currentTeam = currentTeam === team1 ? team2 : team1;
    }

    // Выполняем все выборы
    for (const pick of draftOrder) {
      await lobbyService.draftPick(lobbyId, pick.playerId, pick.team);
    }

    lobby = await lobbyService.getLobbyById(lobbyId);
    if (!lobby) {
      throw new Error("Лобби не найдено после драфта");
    }

    // Проверяем, что все игроки распределены (но статус ещё DRAFTING)
    expect(lobby.status).toBe("DRAFTING");
    const allAssigned = lobby.participations.every((p) => p.team !== null);
    expect(allAssigned).toBe(true);

    // Переводим лобби в статус PLAYING
    lobby = await lobbyService.startPlaying(lobbyId);
    if (!lobby) {
      throw new Error("Лобби не найдено после начала игры");
    }
    expect(lobby.status).toBe("PLAYING");

    // Проверяем, что в каждой команде по 5 игроков
    const team1Players = lobby.participations.filter((p) => p.team === team1);
    const team2Players = lobby.participations.filter((p) => p.team === team2);

    expect(team1Players).toHaveLength(5);
    expect(team2Players).toHaveLength(5);
  });

  it("7. Завершение лобби - проигравшие теряют жизни", async () => {
    const winningTeam = 1;

    // Получаем жизни игроков до завершения
    const playersBefore = await prisma.player.findMany({
      where: {
        id: { in: playerIds },
      },
    });

    const initialLives = new Map(playersBefore.map((p) => [p.id, p.lives]));

    // Завершаем лобби
    const finishedLobby = await lobbyService.finishLobby(lobbyId, winningTeam);

    expect(finishedLobby.status).toBe("FINISHED");

    // Проверяем результаты
    const winners = finishedLobby.participations.filter(
      (p) => p.team === winningTeam
    );
    const losers = finishedLobby.participations.filter(
      (p) => p.team !== winningTeam
    );

    expect(winners.every((p) => p.result === "WIN")).toBe(true);
    expect(losers.every((p) => p.result === "LOSS")).toBe(true);

    // Проверяем, что у проигравших уменьшились жизни
    const playersAfter = await prisma.player.findMany({
      where: {
        id: { in: playerIds },
      },
    });

    for (const player of playersAfter) {
      const wasInLobby = finishedLobby.participations.some(
        (p) => p.playerId === player.id
      );

      if (wasInLobby) {
        const participation = finishedLobby.participations.find(
          (p) => p.playerId === player.id
        );

        if (participation?.result === "LOSS") {
          const initialLife = initialLives.get(player.id) || 3;
          expect(player.lives).toBe(initialLife - 1);
        } else if (participation?.result === "WIN") {
          const initialLife = initialLives.get(player.id) || 3;
          expect(player.lives).toBe(initialLife);
        }
      }
    }
  });

  it("8. Проверка идемпотентности finishLobby", async () => {
    // Пытаемся завершить уже завершённое лобби
    const result1 = await lobbyService.finishLobby(lobbyId, 1);
    const result2 = await lobbyService.finishLobby(lobbyId, 1);

    expect(result1.status).toBe("FINISHED");
    expect(result2.status).toBe("FINISHED");
    expect(result1.id).toBe(result2.id);
  });

  it("9. Генерация второго раунда - игроки из chill zone получают приоритет", async () => {
    // Для второго раунда нужно минимум 10 активных игроков
    // У нас есть 10 игроков из первого лобби (у 5 проигравших lives = 2, у 5 победителей lives = 3)
    // И 2 игрока в chill zone (lives = 3, chillZoneValue = 1)
    // Всего 12 игроков, но нужно проверить, что игроки из chill zone попали первыми

    // Проверяем текущее состояние игроков
    const allPlayers = await prisma.player.findMany({
      where: {
        tournamentId,
        status: "active",
        lives: { gte: 0 },
      },
      orderBy: [{ chillZoneValue: "desc" }, { mmr: "desc" }],
    });

    // Должно быть 12 активных игроков (10 из лобби + 2 из chill zone)
    expect(allPlayers.length).toBeGreaterThanOrEqual(10);

    // Проверяем, что есть игроки с chillZoneValue = 1 (из chill zone)
    const chillZonePlayers = allPlayers.filter((p) => p.chillZoneValue === 1);
    expect(chillZonePlayers.length).toBeGreaterThanOrEqual(2);

    // Генерируем второй раунд
    const lobbies = await lobbyService.generateLobbies(tournamentId, 2);

    expect(lobbies).toHaveLength(1);
    const [secondRoundLobby] = lobbies;
    if (!secondRoundLobby) {
      throw new Error("Лобби второго раунда не создано");
    }
    expect(secondRoundLobby.round).toBe(2);

    // Проверяем, что игроки в лобби сохранили своё значение chillZoneValue
    const playersInLobby = await prisma.player.findMany({
      where: {
        id: {
          in: secondRoundLobby.participations.map((p) => p.playerId),
        },
      },
    });

    // Хотя бы один игрок должен иметь повышенный chillZoneValue (> 0), если он был в chill zone
    const lobbyHasBoostedPriority = playersInLobby.some(
      (p) => p.chillZoneValue >= 1
    );
    expect(lobbyHasBoostedPriority).toBe(true);

    // Проверяем, что игроки из chill zone (которые были с chillZoneValue = 1) попали в лобби
    // Для этого проверяем, что хотя бы один из игроков в лобби был в списке chillZonePlayers
    const playerIdsInLobby = new Set(
      secondRoundLobby.participations.map((p) => p.playerId)
    );
    const hadChillZonePlayer = chillZonePlayers.some((p) =>
      playerIdsInLobby.has(p.id)
    );
    expect(hadChillZonePlayer).toBe(true);

    // Очищаем второе лобби
    await prisma.participation.deleteMany({
      where: { lobbyId: secondRoundLobby.id },
    });
    await prisma.lobby.delete({
      where: { id: secondRoundLobby.id },
    });
  });
});

describe("Lobby System - Множественные лобби в одном раунде", () => {
  let tournamentId: number;
  let userIds: number[] = [];
  let playerIds: number[] = [];
  let lobbyIds: number[] = [];

  const tournamentService = new TournamentService();
  const playerService = new PlayerService();
  const lobbyService = new LobbyService();
  const userService = new UserService();

  // Очистка данных после тестов
  afterAll(async () => {
    // Удаляем в правильном порядке из-за foreign keys
    if (playerIds.length > 0) {
      await prisma.participation.deleteMany({
        where: { playerId: { in: playerIds } },
      });
    }

    if (lobbyIds.length > 0) {
      for (const lobbyId of lobbyIds) {
        await prisma.participation.deleteMany({
          where: { lobbyId },
        });
        await prisma.lobby.delete({
          where: { id: lobbyId },
        });
      }
    }

    // Удаляем все лобби турнира
    if (tournamentId) {
      const allLobbies = await prisma.lobby.findMany({
        where: { tournamentId },
      });
      for (const lobby of allLobbies) {
        await prisma.participation.deleteMany({
          where: { lobbyId: lobby.id },
        });
        await prisma.lobby.delete({
          where: { id: lobby.id },
        });
      }
    }

    if (playerIds.length > 0) {
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

  it("1. Создание турнира", async () => {
    const tournament = await tournamentService.createTournament(
      "Test Tournament Multiple Lobbies",
      100,
      null,
      1000
    );

    expect(tournament).toBeDefined();
    tournamentId = tournament.id;
  });

  it("2. Создание 32 пользователей", async () => {
    const users = await Promise.all(
      Array.from({ length: 32 }, (_, i) =>
        userService.getOrCreate({
          telegramId: `test_user_multi_${Date.now()}_${i}`,
          username: `testusermulti${i}`,
        })
      )
    );

    expect(users).toHaveLength(32);
    userIds = users.map((u) => u.id);
  });

  it("3. Создание 32 игроков с разными MMR", async () => {
    // Создаём игроков с разными MMR (от 2000 до 1000)
    const mmrValues = Array.from({ length: 32 }, (_, i) => 2000 - i * 30);

    const players = await Promise.all(
      userIds.map((userId, index) =>
        playerService.createPlayer({
          userId,
          tournamentId,
          nickname: `Player_multi_${index}`,
          mmr: mmrValues[index],
          lives: 3,
          chillZoneValue: 0,
        })
      )
    );

    expect(players).toHaveLength(32);
    playerIds = players.map((p) => p.id);
  });

  it("4. Генерация лобби - должно быть 3 лобби по 10 игроков и 2 в chill zone", async () => {
    const lobbies = await lobbyService.generateLobbies(tournamentId);

    // Должно быть создано 3 лобби (30 игроков) и 2 игрока в chill zone
    expect(lobbies).toHaveLength(3);
    lobbyIds = lobbies.map((l) => l.id);

    // Проверяем, что каждое лобби содержит 10 игроков
    for (const lobby of lobbies) {
      expect(lobby.participations).toHaveLength(10);
      expect(lobby.status).toBe("PENDING");
      expect(lobby.round).toBe(1);
    }

    // Проверяем, что все игроки в лобби имеют chillZoneValue = 0
    const allPlayersInLobbies = lobbies.flatMap((l) =>
      l.participations.map((p) => p.playerId)
    );
    expect(allPlayersInLobbies).toHaveLength(30);

    const playersInLobbies = await prisma.player.findMany({
      where: {
        id: { in: allPlayersInLobbies },
      },
    });

    expect(playersInLobbies.every((p) => p.chillZoneValue === 0)).toBe(true);

    // Проверяем, что 2 игрока в chill zone имеют chillZoneValue = 1
    const playersNotInLobbies = await prisma.player.findMany({
      where: {
        tournamentId,
        id: { notIn: allPlayersInLobbies },
        status: "active",
      },
    });

    expect(playersNotInLobbies).toHaveLength(2);
    expect(playersNotInLobbies.every((p) => p.chillZoneValue === 1)).toBe(true);
  });

  it("5. Все лобби можно начать драфт независимо", async () => {
    // Начинаем драфт для всех трёх лобби
    const drafts = await Promise.all(
      lobbyIds.map((lobbyId) => lobbyService.startDraft(lobbyId))
    );

    expect(drafts).toHaveLength(3);

    // Проверяем, что все лобби в статусе DRAFTING
    for (const draft of drafts) {
      expect(draft.status).toBe("DRAFTING");
      const captains = draft.participations.filter((p) => p.isCaptain);
      expect(captains).toHaveLength(2);
    }
  });

  it("6. Проверка, что все лобби имеют одинаковый раунд", async () => {
    const allLobbies = await prisma.lobby.findMany({
      where: { tournamentId, round: 1 },
    });

    expect(allLobbies.length).toBeGreaterThanOrEqual(3);
    expect(new Set(allLobbies.map((l) => l.round)).size).toBe(1);
    const [firstRoundLobby] = allLobbies;
    if (!firstRoundLobby) {
      throw new Error("Лобби первого раунда не найдено");
    }
    expect(firstRoundLobby.round).toBe(1);
  });
});
