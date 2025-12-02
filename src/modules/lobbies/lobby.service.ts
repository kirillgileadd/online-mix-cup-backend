import { prisma } from "../../config/prisma";
import { DiscordService, TeamMember } from "../discord/discord.service";

const LOBBY_SIZE = 10;

export class LobbyService {
  private discordService: DiscordService;

  constructor(discordService?: DiscordService) {
    this.discordService = discordService || new DiscordService();
  }
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

      // Определяем случайно, кто будет выбирать первым
      const [firstCaptain, secondCaptain] =
        Math.random() < 0.5 ? [captain1, captain2] : [captain2, captain1];

      // Назначаем капитанов и закрепляем за ними первый слот в своих командах
      await tx.participation.update({
        where: { id: firstCaptain.id },
        data: { isCaptain: true, team: 1 },
      });

      await tx.participation.update({
        where: { id: secondCaptain.id },
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
   * Если playerId === null, отменяет последний пик в указанной команде
   */
  async draftPick(lobbyId: number, playerId: number | null, team: number) {
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

      if (lobby.status !== "DRAFTING" && lobby.status !== "PLAYING") {
        throw new Error("Лобби должно быть в стадии драфта или игры");
      }

      // Проверяем, что команда валидна (1 или 2)
      if (team !== 1 && team !== 2) {
        throw new Error("Команда должна быть 1 или 2");
      }

      // Если playerId === null, отменяем последний пик в команде
      if (playerId === null) {
        // Находим последний пик в указанной команде (не капитана)
        const teamPicks = lobby.participations
          .filter(
            (p) =>
              p.team === team && p.isCaptain === false && p.pickedAt !== null
          )
          .sort((a, b) => {
            if (!a.pickedAt || !b.pickedAt) return 0;
            return b.pickedAt.getTime() - a.pickedAt.getTime();
          });

        if (teamPicks.length === 0) {
          throw new Error("Нет пиков для отмены в этой команде");
        }

        const lastPick = teamPicks[0];
        if (!lastPick) {
          throw new Error("Нет пиков для отмены в этой команде");
        }

        // Отменяем пик
        await tx.participation.update({
          where: { id: lastPick.id },
          data: {
            team: null,
            pickedAt: null,
          },
        });

        // Если лобби было в статусе PLAYING, возвращаем в DRAFTING
        const updatedLobbyAfterUnpick = await tx.lobby.findUnique({
          where: { id: lobbyId },
        });
        if (updatedLobbyAfterUnpick?.status === "PLAYING") {
          await tx.lobby.update({
            where: { id: lobbyId },
            data: { status: "DRAFTING" },
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
      }

      // Обычный пик игрока
      const participation = lobby.participations.find(
        (p) => p.playerId === playerId
      );

      if (!participation) {
        throw new Error("Игрок не найден в этом лобби");
      }

      if (participation.team !== null) {
        throw new Error("Игрок уже выбран");
      }

      // Обновляем участие
      await tx.participation.update({
        where: { id: participation.id },
        data: {
          team,
          pickedAt: new Date(),
        },
      });

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
   * Начать игру (перевести лобби в статус PLAYING)
   * Проверяет, что все игроки выбраны
   */
  async startPlaying(lobbyId: number) {
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

      if (lobby.status === "FINISHED") {
        throw new Error("Нельзя начать игру в завершённом лобби");
      }

      // Проверяем, что все игроки выбраны
      const allPicked = lobby.participations.every((p) => p.team !== null);

      if (!allPicked) {
        throw new Error("Не все игроки выбраны в команды");
      }

      // Проверяем, что в каждой команде по 5 игроков
      const team1Count = lobby.participations.filter(
        (p) => p.team === 1
      ).length;
      const team2Count = lobby.participations.filter(
        (p) => p.team === 2
      ).length;

      if (team1Count !== 5 || team2Count !== 5) {
        throw new Error("В каждой команде должно быть ровно 5 игроков");
      }

      // Переводим лобби в статус PLAYING
      const updatedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: { status: "PLAYING" },
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

      // Создаем голосовые каналы в Discord и перемещаем игроков (асинхронно, не блокируем ответ)
      this.setupDiscordVoiceChannels(updatedLobby).catch((error) => {
        // Логируем ошибку, но не блокируем основной процесс
        console.error("Ошибка при настройке Discord каналов:", error);
      });

      return updatedLobby;
    });
  }

  /**
   * Настройка голосовых каналов в Discord для команд
   */
  private async setupDiscordVoiceChannels(lobby: {
    id: number;
    participations: Array<{
      team: number | null;
      isCaptain: boolean;
      player: {
        id: number;
        nickname: string;
        user: {
          id: number;
          discordUsername: string | null;
        };
      };
    }>;
  }): Promise<void> {
    // Разделяем игроков по командам
    const team1Members: TeamMember[] = [];
    const team2Members: TeamMember[] = [];

    for (const participation of lobby.participations) {
      if (participation.team === 1) {
        team1Members.push({
          discordUsername: participation.player.user.discordUsername,
          userId: participation.player.user.id,
          isCaptain: participation.isCaptain,
          nickname: participation.player.nickname,
        });
      } else if (participation.team === 2) {
        team2Members.push({
          discordUsername: participation.player.user.discordUsername,
          userId: participation.player.user.id,
          isCaptain: participation.isCaptain,
          nickname: participation.player.nickname,
        });
      }
    }

    // Создаем каналы и перемещаем игроков
    const { team1ChannelId, team2ChannelId } =
      await this.discordService.createVoiceChannelsAndMovePlayers(
        team1Members,
        team2Members,
        lobby.id
      );

    // Сохраняем ID каналов в базу данных
    if (team1ChannelId || team2ChannelId) {
      await prisma.lobby.update({
        where: { id: lobby.id },
        data: {
          team1ChannelId: team1ChannelId || null,
          team2ChannelId: team2ChannelId || null,
        },
      });
    }
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

      // Перемещаем игроков в общий канал и удаляем созданные каналы (асинхронно)
      if (finishedLobby.team1ChannelId || finishedLobby.team2ChannelId) {
        this.discordService
          .movePlayersToGeneralAndDeleteChannels(
            finishedLobby.team1ChannelId,
            finishedLobby.team2ChannelId,
            finishedLobby.id
          )
          .catch((error) => {
            // Логируем ошибку, но не блокируем основной процесс
            console.error("Ошибка при очистке Discord каналов:", error);
          });
      }

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
        updatedAt: true,
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

    const lobbyCreatedDate = lobbyAgg._max.createdAt ?? null;
    const lobbyUpdatedDate = lobbyAgg._max.updatedAt ?? null;
    const participationDate = participationAgg._max.pickedAt ?? null;

    const dates = [
      lobbyCreatedDate,
      lobbyUpdatedDate,
      participationDate,
    ].filter((d): d is Date => d !== null);

    if (dates.length === 0) {
      return null;
    }

    return new Date(Math.max(...dates.map((d) => d.getTime())));
  }

  /**
   * Замена игрока в лобби
   * Игрок из лобби меняется местами с рандомным игроком из chillzone
   * Игрок из лобби получает -1 жизнь
   * Игрок из chillzone получает -1 chillZoneValue
   * Лобби переходит в статус PENDING, все игроки теряют статус капитанов и команды
   */
  async replacePlayer(lobbyId: number, playerId: number) {
    return prisma.$transaction(async (tx) => {
      // Получаем лобби с участиями
      const lobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: {
            include: {
              player: true,
            },
          },
          tournament: true,
        },
      });

      if (!lobby) {
        throw new Error("Лобби не найдено");
      }

      if (!lobby.tournamentId) {
        throw new Error("Лобби не привязано к турниру");
      }

      // Находим participation для заменяемого игрока
      const participationToReplace = lobby.participations.find(
        (p) => p.playerId === playerId
      );

      if (!participationToReplace) {
        throw new Error("Игрок не найден в этом лобби");
      }

      // Находим всех игроков, которые участвуют в лобби текущего раунда
      const allLobbiesInRound = await tx.lobby.findMany({
        where: {
          tournamentId: lobby.tournamentId,
          round: lobby.round,
        },
        include: {
          participations: {
            select: {
              playerId: true,
            },
          },
        },
      });

      // Собираем все ID игроков, которые уже в лобби текущего раунда
      const playersInLobbies = new Set<number>();
      for (const l of allLobbiesInRound) {
        for (const p of l.participations) {
          playersInLobbies.add(p.playerId);
        }
      }

      // Находим игроков в chillzone (не участвуют ни в каком лобби текущего раунда, активные, с жизнями >= 1, того же турнира)
      const chillzonePlayers = await tx.player.findMany({
        where: {
          tournamentId: lobby.tournamentId,
          status: "active",
          lives: {
            gte: 1,
          },
          id: {
            notIn: Array.from(playersInLobbies),
          },
        },
      });

      if (chillzonePlayers.length === 0) {
        throw new Error("Нет доступных игроков в chillzone для замены");
      }

      // Выбираем случайного игрока из chillzone
      const randomIndex = Math.floor(Math.random() * chillzonePlayers.length);
      const replacementPlayer = chillzonePlayers[randomIndex];

      if (!replacementPlayer) {
        throw new Error("Не удалось выбрать игрока для замены");
      }

      // Удаляем participation для заменяемого игрока
      await tx.participation.delete({
        where: { id: participationToReplace.id },
      });

      // Создаем participation для игрока из chillzone
      await tx.participation.create({
        data: {
          lobbyId: lobbyId,
          playerId: replacementPlayer.id,
        },
      });

      // Уменьшаем lives на 1 у заменяемого игрока
      await tx.player.update({
        where: { id: playerId },
        data: {
          lives: {
            decrement: 1,
          },
          chillZoneValue: {
            increment: 1,
          },
        },
      });

      // Уменьшаем chillZoneValue на 1 у игрока из chillzone
      await tx.player.update({
        where: { id: replacementPlayer.id },
        data: {
          chillZoneValue: {
            decrement: 1,
          },
        },
      });

      // Сбрасываем все isCaptain = false и team = null для всех participations в лобби
      await tx.participation.updateMany({
        where: { lobbyId: lobbyId },
        data: {
          isCaptain: false,
          team: null,
          pickedAt: null,
        },
      });

      // Изменяем статус лобби на PENDING
      const updatedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: { status: "PENDING" },
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

      return updatedLobby;
    });
  }
}
