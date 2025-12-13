import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type {
  CreateLeaderboardInput,
  UpdateLeaderboardInput,
  AddPointsInput,
} from "./leaderboard.schema";

export class LeaderboardService {
  /**
   * Записать историю изменения очков
   */
  private async recordHistory(
    leaderboardId: number,
    userId: number,
    points: number,
    createdAt?: Date
  ) {
    await prisma.leaderboardHistory.create({
      data: {
        leaderboardId,
        userId,
        points,
        createdAt: createdAt ?? new Date(),
      },
    });
  }

  /**
   * Создать запись в лидерборде для пользователя
   * Если запись уже существует, обновит её
   */
  async createLeaderboard(data: CreateLeaderboardInput) {
    // Проверяем, существует ли уже запись для этого пользователя
    const existingEntry = await prisma.leaderboard.findUnique({
      where: { userId: data.userId },
      select: { id: true, points: true },
    });

    let entry;
    let isNewEntry = false;

    if (existingEntry) {
      // Если запись существует, обновляем её
      entry = await prisma.leaderboard.update({
        where: { userId: data.userId },
        data: {
          points: data.points ?? existingEntry.points,
        },
        include: {
          user: true,
        },
      });
    } else {
      // Если записи нет, создаём новую
      isNewEntry = true;
      entry = await prisma.leaderboard.create({
        data: {
          userId: data.userId,
          points: data.points ?? 0,
        },
        include: {
          user: true,
        },
      });
    }

    // Записываем историю только если это новая запись или очки изменились
    if (
      isNewEntry ||
      (existingEntry && existingEntry.points !== entry.points)
    ) {
      await this.recordHistory(entry.id, entry.userId, entry.points);
    }

    // Пересчитываем ранги после создания/обновления
    await this.recalculateRanks();

    // Возвращаем обновленную запись с актуальным rank
    return prisma.leaderboard.findUnique({
      where: { id: entry.id },
      include: {
        user: true,
      },
    });
  }

  /**
   * Получить все записи лидерборда, отсортированные по очкам (по убыванию)
   */
  listLeaderboard(limit?: number, offset?: number) {
    return prisma.leaderboard.findMany({
      include: {
        user: true,
      },
      orderBy: {
        points: "desc",
      },
      ...(limit !== undefined ? { take: limit } : {}),
      ...(offset !== undefined ? { skip: offset } : {}),
    });
  }

  /**
   * Получить запись лидерборда по ID
   */
  getById(id: number) {
    return prisma.leaderboard.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
  }

  /**
   * Получить запись лидерборда по userId
   */
  getByUserId(userId: number) {
    return prisma.leaderboard.findUnique({
      where: { userId },
      include: {
        user: true,
      },
    });
  }

  /**
   * Обновить запись лидерборда
   */
  async updateLeaderboard(id: number, data: UpdateLeaderboardInput) {
    const updateData: Prisma.LeaderboardUpdateInput = {};

    if (data.points !== undefined) {
      // Получаем текущую запись для записи истории
      const currentEntry = await prisma.leaderboard.findUnique({
        where: { id },
        select: { userId: true, points: true },
      });

      updateData.points = data.points;

      // Записываем историю изменения, если очки изменились
      if (currentEntry && currentEntry.points !== data.points) {
        const historyDate = data.createdAt
          ? new Date(data.createdAt)
          : undefined;
        await this.recordHistory(
          id,
          currentEntry.userId,
          data.points,
          historyDate
        );
      }
    }

    await prisma.leaderboard.update({
      where: { id },
      data: updateData,
    });

    // Пересчитываем ранги после обновления
    await this.recalculateRanks();

    // Возвращаем обновленную запись с актуальным rank
    return prisma.leaderboard.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
  }

  /**
   * Обновить запись лидерборда по userId
   */
  async updateLeaderboardByUserId(
    userId: number,
    data: UpdateLeaderboardInput
  ) {
    const updateData: Prisma.LeaderboardUpdateInput = {};

    if (data.points !== undefined) {
      // Получаем текущую запись для записи истории
      const currentEntry = await prisma.leaderboard.findUnique({
        where: { userId },
        select: { id: true, points: true },
      });

      if (currentEntry) {
        updateData.points = data.points;

        // Записываем историю изменения, если очки изменились
        if (currentEntry.points !== data.points) {
          const historyDate = data.createdAt
            ? new Date(data.createdAt)
            : undefined;
          await this.recordHistory(
            currentEntry.id,
            userId,
            data.points,
            historyDate
          );
        }
      }
    }

    await prisma.leaderboard.update({
      where: { userId },
      data: updateData,
    });

    // Пересчитываем ранги после обновления
    await this.recalculateRanks();

    // Возвращаем обновленную запись с актуальным rank
    return prisma.leaderboard.findUnique({
      where: { userId },
      include: {
        user: true,
      },
    });
  }

  /**
   * Добавить очки пользователю (создать запись, если её нет)
   */
  async addPoints(userId: number, data: AddPointsInput) {
    // Получаем текущую запись, если она существует
    const currentEntry = await prisma.leaderboard.findUnique({
      where: { userId },
      select: { id: true, points: true },
    });

    // Используем upsert для создания или обновления записи
    const result = await prisma.leaderboard.upsert({
      where: { userId },
      update: {
        points: {
          increment: data.points,
        },
      },
      create: {
        userId,
        points: data.points,
      },
      select: {
        id: true,
        points: true,
      },
    });

    // Записываем историю изменения очков
    const historyDate = data.createdAt ? new Date(data.createdAt) : undefined;
    if (currentEntry) {
      // Обновление существующей записи
      await this.recordHistory(
        currentEntry.id,
        userId,
        result.points,
        historyDate
      );
    } else {
      // Создание новой записи
      await this.recordHistory(result.id, userId, result.points, historyDate);
    }

    // Пересчитываем ранги после изменения очков
    await this.recalculateRanks();

    // Возвращаем обновленную запись с актуальным rank
    return prisma.leaderboard.findUnique({
      where: { userId },
      include: {
        user: true,
      },
    });
  }

  /**
   * Пересчитать ранги для всех записей в лидерборде
   */
  async recalculateRanks(): Promise<void> {
    // Получаем все записи, отсортированные по очкам
    const entries = await prisma.leaderboard.findMany({
      orderBy: [{ points: "desc" }, { id: "asc" }],
      select: { id: true },
    });

    // Обновляем rank для каждой записи
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        await prisma.leaderboard.update({
          where: { id: entry.id },
          data: { rank: i + 1 },
        });
      }
    }
  }

  /**
   * Получить позицию пользователя в лидерборде
   */
  async getUserRank(userId: number): Promise<number | null> {
    const userEntry = await prisma.leaderboard.findUnique({
      where: { userId },
      select: {
        rank: true,
        id: true,
        userId: true,
        points: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return userEntry?.rank ?? null;
  }

  /**
   * Удалить запись из лидерборда
   */
  async deleteLeaderboard(id: number): Promise<void> {
    await prisma.leaderboard.delete({
      where: { id },
    });

    // Пересчитываем ранги после удаления
    await this.recalculateRanks();
  }

  /**
   * Удалить запись из лидерборда по userId
   */
  async deleteLeaderboardByUserId(userId: number): Promise<void> {
    await prisma.leaderboard.delete({
      where: { userId },
    });

    // Пересчитываем ранги после удаления
    await this.recalculateRanks();
  }

  /**
   * Получить историю изменений очков для пользователя
   */
  getHistoryByUserId(userId: number, limit?: number, offset?: number) {
    return prisma.leaderboardHistory.findMany({
      where: { userId },
      orderBy: {
        createdAt: "asc",
      },
      ...(limit !== undefined ? { take: limit } : {}),
      ...(offset !== undefined ? { skip: offset } : {}),
    });
  }

  /**
   * Получить историю изменений очков для записи лидерборда
   */
  getHistoryByLeaderboardId(
    leaderboardId: number,
    limit?: number,
    offset?: number
  ) {
    return prisma.leaderboardHistory.findMany({
      where: { leaderboardId },
      orderBy: {
        createdAt: "asc",
      },
      ...(limit !== undefined ? { take: limit } : {}),
      ...(offset !== undefined ? { skip: offset } : {}),
    });
  }

  /**
   * Получить историю изменений очков для пользователя за период
   */
  getHistoryByUserIdAndDateRange(
    userId: number,
    startDate: Date,
    endDate: Date,
    limit?: number,
    offset?: number
  ) {
    return prisma.leaderboardHistory.findMany({
      where: {
        userId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      ...(limit !== undefined ? { take: limit } : {}),
      ...(offset !== undefined ? { skip: offset } : {}),
    });
  }
}
