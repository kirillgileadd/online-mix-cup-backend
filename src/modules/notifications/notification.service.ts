import type { FastifyReply } from "fastify";
import pino from "pino";

import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import type { NotificationPayload } from "./notification.schema";

const logger = pino();

type SSEStream = {
  reply: FastifyReply;
  userId: number;
};

/**
 * Сервис для отправки уведомлений через Telegram Bot API
 */
export class TelegramNotificationService {
  private readonly apiUrl: string;

  constructor() {
    this.apiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  }

  /**
   * Отправляет уведомление пользователю через Telegram
   */
  async sendNotification(
    userId: number,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Получаем пользователя, его telegramChatId и настройки уведомлений
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          telegramChatId: true,
          notificationSettings: {
            select: {
              isTelegramNotifications: true,
            },
          },
        },
      });

      if (!user) {
        logger.warn({ userId }, "Пользователь не найден");
        return { success: false, error: "User not found" };
      }

      // Проверяем настройки уведомлений (по умолчанию true, если настройки не найдены)
      const isTelegramNotifications =
        user.notificationSettings?.isTelegramNotifications ?? true;
      if (!isTelegramNotifications) {
        logger.info({ userId }, "Telegram уведомления отключены пользователем");
        return {
          success: false,
          error: "Telegram notifications disabled by user",
        };
      }

      // Используем только telegramChatId, если его нет - не отправляем уведомление
      if (!user.telegramChatId) {
        logger.warn(
          { userId },
          "Пользователь не имеет telegramChatId, уведомление не отправляется"
        );
        return {
          success: false,
          error: "User has no telegramChatId",
        };
      }

      const chatId = user.telegramChatId;

      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          description?: string;
        };
        const errorMessage = errorData.description || `HTTP ${response.status}`;

        // Логируем ошибки, но не прерываем выполнение
        if (response.status === 403) {
          logger.warn(
            { userId, chatId },
            `Бот заблокирован пользователем: ${errorMessage}`
          );
        } else if (response.status === 400) {
          logger.warn({ userId, chatId }, `Неверный chat_id: ${errorMessage}`);
        } else {
          logger.error(
            { userId, chatId, status: response.status },
            `Ошибка отправки Telegram уведомления: ${errorMessage}`
          );
        }

        return { success: false, error: errorMessage };
      }

      logger.info(
        { userId, chatId },
        "Telegram уведомление успешно отправлено"
      );
      return { success: true };
    } catch (error) {
      logger.error(
        { error, userId },
        "Ошибка при отправке Telegram уведомления"
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

/**
 * Сервис для управления SSE подключениями
 */
export class SSENotificationService {
  private connections: Map<number, Set<SSEStream>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Запускаем heartbeat каждые 30 секунд
    this.startHeartbeat();
  }

  /**
   * Регистрирует новое SSE подключение
   */
  registerConnection(userId: number, stream: SSEStream): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(stream);

    logger.info(
      { userId, totalConnections: this.getTotalConnections() },
      "SSE подключение зарегистрировано"
    );

    // Обрабатываем закрытие соединения
    stream.reply.raw.on("close", () => {
      this.unregisterConnection(userId, stream);
    });

    stream.reply.raw.on("error", (error) => {
      logger.warn({ error, userId }, "Ошибка SSE соединения");
      this.unregisterConnection(userId, stream);
    });
  }

  /**
   * Удаляет SSE подключение
   */
  unregisterConnection(userId: number, stream: SSEStream): void {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(stream);
      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }

    logger.info(
      { userId, totalConnections: this.getTotalConnections() },
      "SSE подключение удалено"
    );
  }

  /**
   * Отправляет уведомление конкретному пользователю
   */
  async sendToUser(
    userId: number,
    notification: NotificationPayload
  ): Promise<void> {
    // Проверяем настройки уведомлений пользователя
    const settings = await prisma.notificationSettings.findUnique({
      where: { userId },
      select: { isSSENotifications: true },
    });

    // По умолчанию уведомления включены, если настройки не найдены
    const isSSENotifications = settings?.isSSENotifications ?? true;
    if (!isSSENotifications) {
      logger.info({ userId }, "SSE уведомления отключены пользователем");
      return;
    }

    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      return;
    }

    const message = `data: ${JSON.stringify(notification)}\n\n`;
    const deadConnections: SSEStream[] = [];

    for (const stream of userConnections) {
      try {
        stream.reply.raw.write(message);
      } catch (error) {
        logger.warn({ error, userId }, "Ошибка отправки SSE сообщения");
        deadConnections.push(stream);
      }
    }

    // Удаляем мертвые соединения
    for (const deadStream of deadConnections) {
      this.unregisterConnection(userId, deadStream);
    }

    if (userConnections.size > 0) {
      logger.info(
        { userId, sentCount: userConnections.size },
        "SSE уведомление отправлено"
      );
    }
  }

  /**
   * Отправляет уведомление множеству пользователей
   */
  async sendToUsers(
    userIds: number[],
    notification: NotificationPayload
  ): Promise<void> {
    await Promise.all(
      userIds.map((userId) => this.sendToUser(userId, notification))
    );
  }

  /**
   * Запускает heartbeat для поддержания соединений
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      const heartbeatMessage = ": heartbeat\n\n";
      const deadStreams: Array<{ userId: number; stream: SSEStream }> = [];

      for (const [userId, streams] of this.connections.entries()) {
        for (const stream of streams) {
          try {
            stream.reply.raw.write(heartbeatMessage);
          } catch (error) {
            deadStreams.push({ userId, stream });
          }
        }
      }

      // Удаляем мертвые соединения
      for (const { userId, stream } of deadStreams) {
        this.unregisterConnection(userId, stream);
      }
    }, 30000); // 30 секунд
  }

  /**
   * Останавливает heartbeat
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Возвращает общее количество активных подключений
   */
  private getTotalConnections(): number {
    let total = 0;
    for (const streams of this.connections.values()) {
      total += streams.size;
    }
    return total;
  }
}

/**
 * Singleton экземпляр NotificationService
 */
let notificationServiceInstance: NotificationService | null = null;

/**
 * Основной сервис-оркестратор уведомлений
 */
export class NotificationService {
  private telegramService: TelegramNotificationService;
  private sseService: SSENotificationService;

  constructor(
    telegramService?: TelegramNotificationService,
    sseService?: SSENotificationService
  ) {
    this.telegramService = telegramService || new TelegramNotificationService();
    this.sseService = sseService || new SSENotificationService();
  }

  /**
   * Получает singleton экземпляр NotificationService
   */
  static getInstance(): NotificationService {
    if (!notificationServiceInstance) {
      notificationServiceInstance = new NotificationService();
    }
    return notificationServiceInstance;
  }

  /**
   * Отправляет уведомления всем игрокам в созданных лобби
   */
  async notifyLobbyCreated(
    lobbies: Array<{
      id: number;
      round: number;
      tournamentId: number | null;
      participations: Array<{
        player: {
          userId: number;
          user: {
            id: number;
          } | null;
        };
      }>;
      tournament?: {
        name: string;
      } | null;
    }>
  ): Promise<void> {
    if (lobbies.length === 0) {
      return;
    }

    // Получаем информацию о турнире из первого лобби
    const firstLobby = lobbies[0]!; // Уже проверили что массив не пустой выше
    const tournamentId = firstLobby.tournamentId;

    if (!tournamentId) {
      logger.warn("Не удалось отправить уведомления: турнир не указан");
      return;
    }

    // Если название турнира не загружено, получаем его из БД
    let tournamentName = firstLobby.tournament?.name;
    if (!tournamentName) {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { name: true },
      });
      tournamentName = tournament?.name || "Неизвестный турнир";
    }

    // Собираем все уведомления
    const notifications: Array<{
      userId: number;
      lobbyId: number;
      round: number;
    }> = [];

    for (const lobby of lobbies) {
      for (const participation of lobby.participations) {
        const userId = participation.player.userId;
        notifications.push({
          userId,
          lobbyId: lobby.id,
          round: lobby.round,
        });
      }
    }

    // Отправляем уведомления параллельно
    const promises: Promise<unknown>[] = [];
    const userIds: number[] = [];

    for (const notification of notifications) {
      userIds.push(notification.userId);

      const message = `🎮 Игра скоро начнется! Вы попали в лобби раунда ${notification.round} турнира ${tournamentName}. Лобби #${notification.lobbyId}`;

      const notificationPayload: NotificationPayload = {
        type: "lobby_created",
        data: {
          lobbyId: notification.lobbyId,
          round: notification.round,
          tournamentId,
          tournamentName,
          message,
        },
      };

      // Отправляем через Telegram
      promises.push(
        this.telegramService
          .sendNotification(notification.userId, message)
          .catch((error) => {
            logger.error(
              { error, userId: notification.userId },
              "Ошибка отправки Telegram уведомления"
            );
          })
      );
    }

    // Отправляем SSE уведомления всем пользователям
    if (userIds.length > 0) {
      // Загружаем настройки уведомлений для всех пользователей батчем
      const uniqueUserIds = Array.from(new Set(userIds));
      const notificationSettings = await prisma.notificationSettings.findMany({
        where: {
          userId: { in: uniqueUserIds },
        },
        select: {
          userId: true,
          isSSENotifications: true,
        },
      });

      // Создаем Map для быстрого доступа к настройкам
      const settingsMap = new Map(
        notificationSettings.map((s) => [s.userId, s.isSSENotifications])
      );

      // Для каждого уникального пользователя отправляем уведомление о каждом его лобби
      const userNotifications = new Map<number, NotificationPayload[]>();

      for (const notification of notifications) {
        // Проверяем настройки (по умолчанию true, если настройки не найдены)
        const isSSENotifications = settingsMap.get(notification.userId) ?? true;
        if (!isSSENotifications) {
          continue; // Пропускаем пользователей с отключенными SSE уведомлениями
        }

        const payload: NotificationPayload = {
          type: "lobby_created",
          data: {
            lobbyId: notification.lobbyId,
            round: notification.round,
            tournamentId,
            tournamentName,
            message: `🎮 Игра скоро начнется! Вы попали в лобби раунда ${notification.round} турнира ${tournamentName}. Лобби #${notification.lobbyId}`,
          },
        };

        if (!userNotifications.has(notification.userId)) {
          userNotifications.set(notification.userId, []);
        }
        userNotifications.get(notification.userId)!.push(payload);
      }

      // Отправляем уведомления
      const ssePromises: Promise<void>[] = [];
      for (const [userId, payloads] of userNotifications.entries()) {
        for (const payload of payloads) {
          ssePromises.push(this.sseService.sendToUser(userId, payload));
        }
      }
      await Promise.allSettled(ssePromises);
    }

    // Ждем завершения всех Telegram уведомлений
    await Promise.allSettled(promises);

    logger.info(
      {
        lobbiesCount: lobbies.length,
        notificationsCount: notifications.length,
        uniqueUsers: new Set(userIds).size,
      },
      "Уведомления о создании лобби отправлены"
    );
  }

  /**
   * Получает SSE сервис для регистрации подключений
   */
  getSSEService(): SSENotificationService {
    return this.sseService;
  }
}
