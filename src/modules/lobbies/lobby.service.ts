import { prisma } from "../../config/prisma";

const LOBBY_SIZE = 10;

export class LobbyService {
  /**
   * Генерация лобби по алгоритму:
   * 1. Берём всех игроков с active=true и lives >= 0
   * 2. Сортируем по chillPriority desc, mmr desc
   * 3. Формируем группы по 10 человек
   * 4. Оставшиеся → chill zone: chillPriority += 1
   * 5. Попавшие в лобби: chillPriority = 0
   */
  async generateLobbies(tournamentId: number, round?: number) {
    return prisma.$transaction(async (tx) => {
      // Проверяем количество активных игроков, готовых к участию (жизни >= 1)
      const alivePlayersCount = await tx.player.count({
        where: {
          tournamentId,
          status: "active",
          lives: {
            gte: 1,
          },
        },
      });

      if (alivePlayersCount < LOBBY_SIZE) {
        if (tournamentId) {
          await tx.tournament
            .update({
              where: { id: tournamentId },
              data: { status: "finished" },
            })
            .catch(() => undefined);
        }
        throw new Error(
          `Недостаточно игроков с жизнями >= 1 для продолжения турнира. Турнир завершён.`
        );
      }

      // Получаем всех активных игроков с жизнями >= 1
      const playersRaw = await tx.player.findMany({
        where: {
          tournamentId,
          status: "active",
          lives: {
            gte: 1,
          },
        },
        include: {
          user: true,
        },
      });

      const players = playersRaw
        .map((player) => ({
          player,
          randomWeight: Math.random(),
        }))
        .sort((a, b) => {
          const chillDiff = b.player.chillZoneValue - a.player.chillZoneValue;
          if (chillDiff !== 0) {
            return chillDiff;
          }
          return a.randomWeight - b.randomWeight;
        })
        .map((entry) => entry.player);

      if (players.length < LOBBY_SIZE) {
        throw new Error(
          `Недостаточно игроков для создания лобби. Требуется минимум ${LOBBY_SIZE}, доступно ${players.length}`
        );
      }

      // Определяем текущий раунд и проверяем завершённость предыдущего
      let currentRound = round;
      if (!currentRound) {
        // Находим максимальный раунд
        const lastLobby = await tx.lobby.findFirst({
          where: { tournamentId },
          orderBy: { round: "desc" },
        });

        if (lastLobby) {
          const maxRound = lastLobby.round;

          // Проверяем, что все лобби в максимальном раунде завершены
          const unfinishedLobbies = await tx.lobby.findMany({
            where: {
              tournamentId,
              round: maxRound,
              status: { not: "FINISHED" },
            },
          });

          if (unfinishedLobbies.length > 0) {
            throw new Error(
              `Нельзя создать новый раунд: в раунде ${maxRound} есть незавершённые лобби (${unfinishedLobbies.length} шт.)`
            );
          }

          currentRound = maxRound + 1;
        } else {
          currentRound = 1;
        }
      } else {
        // Если раунд указан явно, проверяем предыдущий раунд (если он существует)
        if (currentRound > 1) {
          const previousRound = currentRound - 1;
          const unfinishedLobbies = await tx.lobby.findMany({
            where: {
              tournamentId,
              round: previousRound,
              status: { not: "FINISHED" },
            },
          });

          if (unfinishedLobbies.length > 0) {
            throw new Error(
              `Нельзя создать раунд ${currentRound}: в предыдущем раунде ${previousRound} есть незавершённые лобби (${unfinishedLobbies.length} шт.)`
            );
          }
        }
      }

      if (tournamentId) {
        await tx.tournament
          .update({
            where: { id: tournamentId },
            data: { status: "running" },
          })
          .catch(() => undefined);
      }

      const lobbies: Array<{ round: number; playerIds: number[] }> = [];
      const playersInLobbies: number[] = [];
      const playersInChillZone: number[] = [];

      // Формируем лобби по 10 человек
      for (let i = 0; i < players.length; i += LOBBY_SIZE) {
        const lobbyPlayers = players.slice(i, i + LOBBY_SIZE);
        if (lobbyPlayers.length === LOBBY_SIZE) {
          const playerIds = lobbyPlayers.map((p) => p.id);
          lobbies.push({
            round: currentRound,
            playerIds,
          });
          playersInLobbies.push(...playerIds);
        } else {
          // Оставшиеся игроки идут в chill zone
          playersInChillZone.push(...lobbyPlayers.map((p) => p.id));
        }
      }

      // Создаём лобби в БД
      const createdLobbies = [];
      for (const lobby of lobbies) {
        const createdLobby = await tx.lobby.create({
          data: {
            round: lobby.round,
            status: "PENDING",
            tournamentId,
            participations: {
              create: lobby.playerIds.map((playerId) => ({
                playerId,
              })),
            },
          },
          include: {
            participations: {
              include: {
                player: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        });
        createdLobbies.push(createdLobby);
      }

      // Обновляем chillPriority для игроков
      // Оставшиеся в chill zone: chillPriority += 1
      if (playersInChillZone.length > 0) {
        await tx.player.updateMany({
          where: {
            id: { in: playersInChillZone },
          },
          data: {
            chillZoneValue: {
              increment: 1,
            },
          },
        });
      }

      return createdLobbies;
    });
  }

  /**
   * Определение капитанов (2 игрока с самым высоким mmr)
   * и начало драфта
   */
  async startDraft(lobbyId: number) {
    return prisma.$transaction(async (tx) => {
      const lobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: {
            include: {
              player: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      if (!lobby) {
        throw new Error("Лобби не найдено");
      }

      if (lobby.status !== "PENDING") {
        throw new Error("Лобби уже в процессе драфта или игры");
      }

      if (lobby.participations.length !== LOBBY_SIZE) {
        throw new Error(`Лобби должно содержать ровно ${LOBBY_SIZE} игроков`);
      }

      // Сортируем по mmr и выбираем 2 капитанов
      const sortedByMmr = [...lobby.participations].sort(
        (a, b) => b.player.mmr - a.player.mmr
      );

      const captain1 = sortedByMmr[0];
      const captain2 = sortedByMmr[1];

      if (!captain1 || !captain2) {
        throw new Error("Недостаточно игроков для определения капитанов");
      }

      // Назначаем капитанов и закрепляем за ними первый слот в своих командах
      const updatedCaptain1 = await tx.participation.update({
        where: { id: captain1.id },
        data: { isCaptain: true, team: 1 },
      });

      const updatedCaptain2 = await tx.participation.update({
        where: { id: captain2.id },
        data: { isCaptain: true, team: 2 },
      });

      // Обновляем статус лобби
      const updatedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: { status: "DRAFTING" },
        include: {
          participations: {
            include: {
              player: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      return updatedLobby;
    });
  }

  /**
   * Выбор игрока в драфте
   */
  async draftPick(lobbyId: number, playerId: number, team: number) {
    return prisma.$transaction(async (tx) => {
      const lobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: true,
        },
      });

      if (!lobby) {
        throw new Error("Лобби не найдено");
      }

      if (lobby.status !== "DRAFTING") {
        throw new Error("Лобби не в стадии драфта");
      }

      const participation = lobby.participations.find(
        (p) => p.playerId === playerId
      );

      if (!participation) {
        throw new Error("Игрок не найден в этом лобби");
      }

      if (participation.team !== null) {
        throw new Error("Игрок уже выбран");
      }

      // Проверяем, что команда валидна (1 или 2)
      if (team !== 1 && team !== 2) {
        throw new Error("Команда должна быть 1 или 2");
      }

      // Обновляем участие
      await tx.participation.update({
        where: { id: participation.id },
        data: {
          team,
          pickedAt: new Date(),
        },
      });

      // Проверяем, все ли игроки выбраны
      const updatedLobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: true,
        },
      });

      const allPicked = updatedLobby?.participations.every(
        (p) => p.team !== null
      );

      if (allPicked) {
        // Все игроки выбраны, переводим лобби в статус PLAYING
        await tx.lobby.update({
          where: { id: lobbyId },
          data: { status: "PLAYING" },
        });
      }

      return tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: {
            include: {
              player: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });
    });
  }

  /**
   * Завершение лобби и проставление результатов
   * Идемпотентная операция
   */
  async finishLobby(lobbyId: number, winningTeam: number) {
    return prisma.$transaction(async (tx) => {
      const lobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: {
            include: {
              player: true,
            },
          },
        },
      });

      if (!lobby) {
        throw new Error("Лобби не найдено");
      }

      // Идемпотентность: если лобби уже завершено, возвращаем текущее состояние
      if (lobby.status === "FINISHED") {
        return lobby;
      }

      if (lobby.status !== "PLAYING") {
        throw new Error("Лобби должно быть в статусе PLAYING");
      }

      if (winningTeam !== 1 && winningTeam !== 2) {
        throw new Error("Победившая команда должна быть 1 или 2");
      }

      // Проставляем результаты
      for (const participation of lobby.participations) {
        const isWinner = participation.team === winningTeam;
        const currentLives = participation.player.lives ?? 0;
        const updatedLives = isWinner
          ? currentLives
          : Math.max(0, currentLives - 1);
        const updatedStatus = updatedLives === 0 ? "eliminated" : "active";

        await tx.participation.update({
          where: { id: participation.id },
          data: {
            result: isWinner ? "WIN" : "LOSS",
          },
        });

        await tx.player.update({
          where: { id: participation.playerId },
          data: {
            lives: updatedLives,
            status: updatedStatus,
          },
        });
      }

      // Обновляем статус лобби
      const finishedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: { status: "FINISHED" },
        include: {
          participations: {
            include: {
              player: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      return finishedLobby;
    });
  }

  /**
   * Получить лобби по ID
   */
  async getLobbyById(lobbyId: number) {
    return prisma.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        participations: {
          include: {
            player: {
              include: {
                user: true,
              },
            },
          },
        },
        tournament: true,
      },
    });
  }

  /**
   * Список лобби турнира
   */
  async listLobbiesByTournament(tournamentId: number) {
    const result = await prisma.lobby.findMany({
      where: { tournamentId },
      include: {
        participations: {
          include: {
            player: {
              include: {
                user: true,
              },
            },
          },
        },
      },
      orderBy: [{ round: "desc" }, { createdAt: "desc" }],
    });
    return result;
  }

  async getLatestLobbyUpdateTimestamp(tournamentId: number) {
    const lobbyAgg = await prisma.lobby.aggregate({
      where: { tournamentId },
      _max: {
        createdAt: true,
      },
    });

    const participationAgg = await prisma.participation.aggregate({
      where: {
        lobby: {
          tournamentId,
        },
      },
      _max: {
        pickedAt: true,
      },
    });

    const lobbyDate = lobbyAgg._max.createdAt ?? null;
    const participationDate = participationAgg._max.pickedAt ?? null;

    if (lobbyDate && participationDate) {
      return new Date(
        Math.max(lobbyDate.getTime(), participationDate.getTime())
      );
    }

    return lobbyDate ?? participationDate ?? null;
  }
}
