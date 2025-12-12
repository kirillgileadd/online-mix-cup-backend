import type { Tournament, TournamentStatus } from "@prisma/client";
import pino from "pino";

import { prisma } from "../../config/prisma";
import { FileService } from "../files/file.service";
import type { UpdateTournamentInput } from "./tournament.schema";

const logger = pino();

export class TournamentService {
  private readonly fileService = new FileService();

  async createTournament(
    name: string,
    price: number,
    eventDate?: string | null,
    prizePool?: number | null,
    previewImageBase64?: string | null
  ) {
    let previewUrl: string | null = null;

    // Обрабатываем preview изображение, если оно передано
    if (previewImageBase64) {
      const filePath = await this.fileService.saveTournamentPreviewImage(
        previewImageBase64,
        `tournament_preview_${name}`
      );
      previewUrl = this.fileService.getFileUrl(filePath);
    }

    const tournament = await prisma.tournament.create({
      data: {
        name,
        status: "draft",
        price,
        eventDate: eventDate ? new Date(eventDate) : null,
        prizePool: prizePool ?? null,
        previewUrl,
      },
    });

    // Возвращаем с дополнительными полями
    return {
      ...tournament,
      approvedApplicationsCount: 0, // Новый турнир не имеет одобренных заявок
      calculatedPrizePool: prizePool ?? 0, // Если prizePool не указан, то 0 (нет заявок)
    };
  }

  async listTournaments(status?: TournamentStatus) {
    const tournaments = await prisma.tournament.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: {
        createdAt: "desc",
      },
    });

    // Получаем количество одобренных заявок для каждого турнира
    const tournamentsWithStats = await Promise.all(
      tournaments.map(async (tournament) => {
        const approvedApplicationsCount = await prisma.application.count({
          where: {
            tournamentId: tournament.id,
            status: "approved",
          },
        });

        // Рассчитываем призовой фонд: если не указан явно, то количество одобренных заявок * цена
        const calculatedPrizePool =
          tournament.prizePool ?? approvedApplicationsCount * tournament.price;

        return {
          ...tournament,
          approvedApplicationsCount,
          calculatedPrizePool,
        };
      })
    );

    return tournamentsWithStats;
  }

  async getById(id: number) {
    const tournament = await prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      return null;
    }

    // Получаем количество одобренных заявок
    const approvedApplicationsCount = await prisma.application.count({
      where: {
        tournamentId: tournament.id,
        status: "approved",
      },
    });

    // Рассчитываем призовой фонд: если не указан явно, то количество одобренных заявок * цена
    const calculatedPrizePool =
      tournament.prizePool ?? approvedApplicationsCount * tournament.price;

    return {
      ...tournament,
      approvedApplicationsCount,
      calculatedPrizePool,
    };
  }

  updateStatus(id: number, status: TournamentStatus) {
    return prisma.tournament.update({
      where: { id },
      data: { status },
    });
  }

  async updateTournament(id: number, data: UpdateTournamentInput) {
    // Получаем текущий турнир, чтобы узнать старый previewUrl
    const currentTournament = await prisma.tournament.findUnique({
      where: { id },
      select: { previewUrl: true, name: true },
    });

    if (!currentTournament) {
      throw new Error("Tournament not found");
    }

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

    // Обрабатываем preview изображение, если оно передано
    if (data.previewImageBase64 !== undefined) {
      // Удаляем старое изображение, если оно было
      if (currentTournament.previewUrl) {
        try {
          await this.fileService.deleteFile(currentTournament.previewUrl);
        } catch (error) {
          // Логируем ошибку, но не прерываем обновление
          logger.error(
            { error, tournamentId: id, previewUrl: currentTournament.previewUrl },
            "Failed to delete old preview file for tournament"
          );
        }
      }

      if (data.previewImageBase64) {
        // Сохраняем новое изображение
        const filePath = await this.fileService.saveTournamentPreviewImage(
          data.previewImageBase64,
          `tournament_preview_${data.name || currentTournament.name || id}`
        );
        updateData.previewUrl = this.fileService.getFileUrl(filePath);
      } else {
        // Если передано null, удаляем изображение
        updateData.previewUrl = null;
      }
    }

    const updatedTournament = await prisma.tournament.update({
      where: { id },
      data: updateData,
    });

    // Получаем количество одобренных заявок
    const approvedApplicationsCount = await prisma.application.count({
      where: {
        tournamentId: updatedTournament.id,
        status: "approved",
      },
    });

    // Рассчитываем призовой фонд
    const calculatedPrizePool =
      updatedTournament.prizePool ??
      approvedApplicationsCount * updatedTournament.price;

    return {
      ...updatedTournament,
      approvedApplicationsCount,
      calculatedPrizePool,
    };
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

  async deleteTournament(id: number) {
    // Получаем турнир для удаления preview изображения
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      select: {
        id: true,
        previewUrl: true,
      },
    });

    // Получаем все заявки турнира с receiptImageUrl перед удалением
    const applications = await prisma.application.findMany({
      where: { tournamentId: id },
      select: {
        id: true,
        receiptImageUrl: true,
      },
    });

    // Удаляем preview изображение турнира
    if (tournament?.previewUrl) {
      try {
        await this.fileService.deleteFile(tournament.previewUrl);
      } catch (error) {
        // Логируем ошибку, но не прерываем удаление турнира
        logger.error(
          { error, tournamentId: id, previewUrl: tournament.previewUrl },
          "Failed to delete preview file for tournament"
        );
      }
    }

    // Удаляем все файлы чеков
    for (const application of applications) {
      if (application.receiptImageUrl) {
        try {
          await this.fileService.deleteFile(application.receiptImageUrl);
        } catch (error) {
          // Логируем ошибку, но не прерываем удаление турнира
          logger.error(
            { error, applicationId: application.id, receiptImageUrl: application.receiptImageUrl },
            "Failed to delete receipt file for application"
          );
        }
      }
    }

    // Удаляем турнир (каскадно удалятся все заявки, игроки и лобби)
    return prisma.tournament.delete({
      where: { id },
    });
  }
}
