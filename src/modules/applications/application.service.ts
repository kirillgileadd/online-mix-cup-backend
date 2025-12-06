import { ApplicationStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { FileService } from "../files/file.service";
import type { ApplicationPayload } from "./application.schema";

export class ApplicationService {
  private readonly fileService = new FileService();

  createApplication(payload: ApplicationPayload) {
    return prisma.application.create({
      data: {
        userId: payload.userId,
        tournamentId: payload.tournamentId,
        mmr: payload.mmr,
        gameRoles: payload.gameRoles,
        nickname: payload.nickname,
        dotabuff: payload.dotabuff ?? null,
        isPaid: payload.isPaid ?? false,
        receiptImageUrl: payload.receiptImageUrl ?? null,
        status: "pending",
      },
      include: {
        tournament: true,
      },
    });
  }

  listPendingApplications(tournamentId?: number) {
    return prisma.application.findMany({
      where: {
        status: "pending",
        ...(typeof tournamentId === "number" ? { tournamentId } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: true,
        tournament: true,
      },
    });
  }

  listApplications(tournamentId?: number) {
    return prisma.application.findMany({
      where: {
        ...(typeof tournamentId === "number" ? { tournamentId } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: true,
        tournament: true,
      },
    });
  }

  private updateStatus(id: number, status: ApplicationStatus) {
    return prisma.application.update({
      where: { id },
      data: { status },
      include: {
        user: true,
        tournament: true,
      },
    });
  }

  approveApplication(id: number) {
    return this.updateStatus(id, "approved");
  }

  rejectApplication(id: number) {
    return this.updateStatus(id, "rejected");
  }

  getApprovedApplicationsByTournament(tournamentId: number) {
    return prisma.application.findMany({
      where: {
        tournamentId,
        status: "approved",
      },
    });
  }

  async deleteApplication(id: number) {
    // Сначала получаем заявку, чтобы узнать путь к файлу чека
    const application = await prisma.application.findUnique({
      where: { id },
      select: {
        receiptImageUrl: true,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    // Удаляем файл чека, если он существует
    if (application.receiptImageUrl) {
      try {
        await this.fileService.deleteFile(application.receiptImageUrl);
      } catch (error) {
        // Логируем ошибку, но не прерываем удаление заявки
        console.error(
          `Failed to delete receipt file for application ${id}:`,
          error
        );
      }
    }

    // Удаляем заявку из базы данных
    return prisma.application.delete({
      where: { id },
      include: {
        user: true,
        tournament: true,
      },
    });
  }
}
