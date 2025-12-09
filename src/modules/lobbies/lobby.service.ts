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
            teams: {
              create: [
                {}, // Команда 1
                {}, // Команда 2
              ],
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
            teams: true,
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

      // Получаем существующие команды лобби (они создаются при generateLobbies)
      const existingTeams = await tx.team.findMany({
        where: { lobbyId },
        orderBy: { id: "asc" },
      });

      if (existingTeams.length !== 2) {
        throw new Error(
          `В лобби должно быть ровно 2 команды, найдено: ${existingTeams.length}`
        );
      }

      const team1 = existingTeams[0];
      const team2 = existingTeams[1];

      if (!team1 || !team2) {
        throw new Error("Не удалось получить команды лобби");
      }

      // Бросаем жребий: случайно выбираем победителя жребия
      const random = Math.random() < 0.5;
      const lotteryWinner = random ? captain1 : captain2;
      const lotteryLoser = random ? captain2 : captain1;

      // Победитель жребия выбирает первым
      const firstPicker = lotteryWinner;
      const secondPicker = lotteryLoser;

      // Назначаем капитанов и закрепляем за ними первый слот (0) в своих командах
      await tx.participation.update({
        where: { id: firstPicker.id },
        data: { isCaptain: true, teamId: team1.id, slot: 0 },
      });

      await tx.participation.update({
        where: { id: secondPicker.id },
        data: { isCaptain: true, teamId: team2.id, slot: 0 },
      });

      // Обновляем статус лобби и сохраняем результаты жребия
      // firstPickerId будет установлен игроками с фронта через отдельный запрос
      const updatedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: {
          status: "DRAFTING",
          lotteryWinnerId: lotteryWinner.playerId,
          firstPickerId: null, // По умолчанию null, будет установлен игроками
        },
        include: {
          participations: {
            include: {
              player: {
                include: {
                  user: true,
                },
              },
              team: true,
            },
          },
          teams: true,
        },
      });

      return updatedLobby;
    });
  }

  /**
   * Выбор игрока в драфте
   * type: "add" - добавляет игрока в команду, "remove" - удаляет игрока из команды
   * slot - позиция игрока в команде (0-4). Если не указан при добавлении, выбирается автоматически
   */
  async draftPick(
    lobbyId: number,
    playerId: number,
    teamId: number,
    type: "add" | "remove",
    slot?: number | null
  ) {
    return prisma.$transaction(async (tx) => {
      const lobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: {
            include: {
              team: true,
            },
          },
          teams: true,
        },
      });

      if (!lobby) {
        throw new Error("Лобби не найдено");
      }

      if (lobby.status !== "DRAFTING" && lobby.status !== "PLAYING") {
        throw new Error("Лобби должно быть в стадии драфта или игры");
      }

      // Находим команду по ID
      const targetTeam = lobby.teams.find((t) => t.id === teamId);

      if (!targetTeam) {
        throw new Error(`Команда с ID ${teamId} не найдена в этом лобби`);
      }

      // Находим участие игрока
      const participation = lobby.participations.find(
        (p) => p.playerId === playerId
      );

      if (!participation) {
        throw new Error("Игрок не найден в этом лобби");
      }

      // Если type === "remove", удаляем игрока из команды
      if (type === "remove") {
        // Проверяем, что игрок действительно в команде
        if (participation.teamId !== targetTeam.id) {
          throw new Error("Игрок не находится в указанной команде");
        }

        // Нельзя удалить капитана
        if (participation.isCaptain) {
          throw new Error("Нельзя удалить капитана из команды");
        }

        // Удаляем игрока из команды
        await tx.participation.update({
          where: { id: participation.id },
          data: {
            teamId: null,
            slot: null,
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
                team: true,
              },
            },
            teams: true,
          },
        });
      }

      // Если type === "add", добавляем игрока в команду
      // Проверяем, что игрок еще не в команде
      if (participation.teamId !== null) {
        throw new Error("Игрок уже выбран в команду");
      }

      // Проверяем, что в команде меньше 5 игроков
      const teamParticipations = lobby.participations.filter(
        (p) => p.teamId === targetTeam.id
      );

      if (teamParticipations.length >= 5) {
        throw new Error("Команда уже заполнена (максимум 5 игроков)");
      }

      // Определяем слот для игрока
      let targetSlot: number;
      if (slot !== null && slot !== undefined) {
        // Если слот указан явно, проверяем его валидность
        if (slot < 0 || slot > 4) {
          throw new Error("Слот должен быть от 0 до 4");
        }

        // Проверяем, что слот не занят
        const slotOccupied = teamParticipations.some((p) => p.slot === slot);
        if (slotOccupied) {
          throw new Error(`Слот ${slot} уже занят в этой команде`);
        }

        targetSlot = slot;
      } else {
        // Если слот не указан, определяем следующий свободный слот
        const usedSlots = teamParticipations
          .map((p) => p.slot)
          .filter((s): s is number => s !== null);
        const nextSlot = usedSlots.length > 0 ? Math.max(...usedSlots) + 1 : 1; // Слот 0 уже занят капитаном

        if (nextSlot > 4) {
          throw new Error("Все слоты в команде заняты");
        }

        targetSlot = nextSlot;
      }

      // Обновляем участие
      await tx.participation.update({
        where: { id: participation.id },
        data: {
          teamId: targetTeam.id,
          slot: targetSlot,
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
              team: true,
            },
          },
          teams: true,
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
          participations: {
            include: {
              team: true,
            },
          },
          teams: true,
        },
      });

      if (!lobby) {
        throw new Error("Лобби не найдено");
      }

      if (lobby.status === "FINISHED") {
        throw new Error("Нельзя начать игру в завершённом лобби");
      }

      // Проверяем, что все игроки выбраны
      const allPicked = lobby.participations.every((p) => p.teamId !== null);

      if (!allPicked) {
        throw new Error("Не все игроки выбраны в команды");
      }

      // Проверяем, что в каждой команде по 5 игроков
      const teams = lobby.teams;
      if (teams.length !== 2) {
        throw new Error("В лобби должно быть ровно 2 команды");
      }

      for (const team of teams) {
        const teamCount = lobby.participations.filter(
          (p) => p.teamId === team.id
        ).length;

        if (teamCount !== 5) {
          throw new Error(
            `В команде ${team.id} должно быть ровно 5 игроков, сейчас ${teamCount}`
          );
        }
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
              team: true,
            },
          },
          teams: true,
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
    teams: Array<{ id: number }>;
    participations: Array<{
      teamId: number | null;
      slot: number | null;
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
    // Сортируем команды по ID для определения порядка
    const teams = lobby.teams.sort((a, b) => a.id - b.id);

    if (teams.length !== 2) {
      console.error("Ожидается 2 команды, найдено:", teams.length);
      return;
    }

    // Разделяем игроков по командам
    const team1Members: TeamMember[] = [];
    const team2Members: TeamMember[] = [];

    const team1Id = teams[0]?.id;
    const team2Id = teams[1]?.id;

    if (!team1Id || !team2Id) {
      console.error("Не найдены команды для лобби");
      return;
    }

    for (const participation of lobby.participations) {
      if (participation.teamId === team1Id) {
        team1Members.push({
          discordUsername: participation.player.user.discordUsername,
          userId: participation.player.user.id,
          isCaptain: participation.isCaptain,
          nickname: participation.player.nickname,
        });
      } else if (participation.teamId === team2Id) {
        team2Members.push({
          discordUsername: participation.player.user.discordUsername,
          userId: participation.player.user.id,
          isCaptain: participation.isCaptain,
          nickname: participation.player.nickname,
        });
      }
    }

    // Сортируем игроков по слотам для правильного порядка
    team1Members.sort((a, b) => {
      const aParticipation = lobby.participations.find(
        (p) => p.player.user.id === a.userId && p.teamId === team1Id
      );
      const bParticipation = lobby.participations.find(
        (p) => p.player.user.id === b.userId && p.teamId === team1Id
      );
      const aSlot = aParticipation?.slot ?? 999;
      const bSlot = bParticipation?.slot ?? 999;
      return aSlot - bSlot;
    });

    team2Members.sort((a, b) => {
      const aParticipation = lobby.participations.find(
        (p) => p.player.user.id === a.userId && p.teamId === team2Id
      );
      const bParticipation = lobby.participations.find(
        (p) => p.player.user.id === b.userId && p.teamId === team2Id
      );
      const aSlot = aParticipation?.slot ?? 999;
      const bSlot = bParticipation?.slot ?? 999;
      return aSlot - bSlot;
    });

    // Создаем каналы и перемещаем игроков
    const { team1ChannelId, team2ChannelId } =
      await this.discordService.createVoiceChannelsAndMovePlayers(
        team1Members,
        team2Members,
        lobby.id
      );

    // Сохраняем ID каналов в базу данных в соответствующие Team
    if (team1ChannelId && team1Id) {
      await prisma.team.update({
        where: { id: team1Id },
        data: { discordChannelId: team1ChannelId },
      });
    }

    if (team2ChannelId && team2Id) {
      await prisma.team.update({
        where: { id: team2Id },
        data: { discordChannelId: team2ChannelId },
      });
    }
  }

  /**
   * Завершение лобби и проставление результатов
   * Идемпотентная операция
   */
  async finishLobby(lobbyId: number, winningTeamId: number) {
    return prisma.$transaction(async (tx) => {
      const lobby = await tx.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          participations: {
            include: {
              player: true,
              team: true,
            },
          },
          teams: true,
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

      // Находим команду-победителя по ID
      const winningTeamEntity = lobby.teams.find(
        (team) => team.id === winningTeamId
      );

      if (!winningTeamEntity) {
        throw new Error(
          `Команда с ID ${winningTeamId} не найдена в этом лобби`
        );
      }

      // Проставляем результаты
      for (const participation of lobby.participations) {
        const isWinner = participation.teamId === winningTeamEntity.id;
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
              team: true,
            },
          },
          teams: true,
        },
      });

      // Перемещаем игроков в общий канал и удаляем созданные каналы (асинхронно)
      const teamChannelIds = finishedLobby.teams
        .map((t) => t.discordChannelId)
        .filter((id): id is string => id !== null);

      if (teamChannelIds.length > 0) {
        this.discordService
          .movePlayersToGeneralAndDeleteChannels(
            teamChannelIds[0] || null,
            teamChannelIds[1] || null,
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
            team: true,
          },
          orderBy: [{ teamId: "asc" }, { slot: "asc" }],
        },
        teams: {
          include: {
            participations: {
              include: {
                player: {
                  include: {
                    user: true,
                  },
                },
              },
              orderBy: {
                slot: "asc",
              },
            },
          },
          orderBy: {
            id: "asc",
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
            team: true,
          },
          orderBy: [{ teamId: "asc" }, { slot: "asc" }],
        },
        teams: {
          include: {
            participations: {
              include: {
                player: {
                  include: {
                    user: true,
                  },
                },
              },
              orderBy: {
                slot: "asc",
              },
            },
          },
          orderBy: {
            id: "asc",
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

      // Сбрасываем все isCaptain = false и teamId = null для всех participations в лобби
      await tx.participation.updateMany({
        where: { lobbyId: lobbyId },
        data: {
          isCaptain: false,
          teamId: null,
          slot: null,
          pickedAt: null,
        },
      });

      // Удаляем команды лобби
      await tx.team.deleteMany({
        where: { lobbyId: lobbyId },
      });

      // Сбрасываем результаты жребия
      await tx.lobby.update({
        where: { id: lobbyId },
        data: {
          lotteryWinnerId: null,
          firstPickerId: null,
        },
      });

      // Изменяем статус лобби на PENDING и сбрасываем результаты жребия
      const updatedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: {
          status: "PENDING",
          lotteryWinnerId: null,
          firstPickerId: null,
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
          tournament: true,
        },
      });

      return updatedLobby;
    });
  }

  /**
   * Определяет текущего пикера в драфте
   * Возвращает ID капитана, который должен выбирать сейчас
   */
  async getCurrentPicker(lobbyId: number): Promise<number | null> {
    const lobby = await prisma.lobby.findUnique({
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

    if (lobby.status !== "DRAFTING") {
      return null;
    }

    if (!lobby.firstPickerId) {
      return null;
    }

    // Находим капитанов
    const captains = lobby.participations.filter((p) => p.isCaptain);
    if (captains.length !== 2) {
      return null;
    }

    const captain1 = captains[0];
    const captain2 = captains[1];

    if (!captain1 || !captain2) {
      return null;
    }

    // Определяем первого и второго пикера
    const firstPicker =
      lobby.firstPickerId === captain1.playerId ? captain1 : captain2;
    const secondPicker =
      lobby.firstPickerId === captain1.playerId ? captain2 : captain1;

    // Подсчитываем количество сделанных пиков (не капитанов)
    const pickedCount = lobby.participations.filter(
      (p) => p.pickedAt && !p.isCaptain
    ).length;

    // Если еще не было пиков, выбирает первый пикер
    if (pickedCount === 0) {
      return firstPicker.playerId;
    }

    // Паттерн выбора: [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
    // 0 = первый пикер, 1 = второй пикер
    const pattern = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1];
    const turn = pattern[pickedCount % pattern.length];

    return turn === 0 ? firstPicker.playerId : secondPicker.playerId;
  }

  /**
   * Устанавливает первого пикера в лобби
   * Используется игроками для выбора, кто будет выбирать первым после жребия
   */
  async setFirstPicker(lobbyId: number, firstPickerId: number) {
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

      if (lobby.status !== "DRAFTING") {
        throw new Error("Лобби должно быть в стадии драфта");
      }

      // Проверяем, что указанный игрок является капитаном
      const participation = lobby.participations.find(
        (p) => p.playerId === firstPickerId
      );

      if (!participation) {
        throw new Error("Игрок не найден в этом лобби");
      }

      if (!participation.isCaptain) {
        throw new Error("Первый пикер должен быть капитаном");
      }

      // Обновляем firstPickerId
      const updatedLobby = await tx.lobby.update({
        where: { id: lobbyId },
        data: { firstPickerId },
        include: {
          participations: {
            include: {
              player: {
                include: {
                  user: true,
                },
              },
              team: true,
            },
          },
          teams: true,
        },
      });

      return updatedLobby;
    });
  }
}
