import pino from "pino";
import { env } from "../../config/env";

const logger = pino();

export interface CreateLobbyRequest {
  gameName: string;
  gameMode: number;
  passKey: string;
  serverRegion: number;
}

export interface CreateLobbyResponse {
  success: boolean;
  lobby?: {
    lobbyId: number;
    gameName: string;
    gameMode: number;
    passKey: string;
    serverRegion: number;
    allowCheats: boolean;
    fillWithBots: boolean;
    allowSpectating: boolean;
    visibility: number;
    allchat: boolean;
  };
  message?: string;
}

export interface LobbyStatusResponse {
  inLobby: boolean;
  lobbyId?: number;
  message: string;
}

export interface InvitePlayersRequest {
  steamIDs: string[];
}

export interface InvitePlayersResponse {
  success: boolean;
  message: string;
}

export interface LeaveLobbyResponse {
  success: boolean;
  message: string;
}

export class SteamBotService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = env.STEAM_BOT_URL || "http://localhost:8080";
  }

  /**
   * Создает лобби через Steam бота
   * Ждет до 30 секунд пока лобби будет создано
   */
  async createLobby(request: CreateLobbyRequest): Promise<CreateLobbyResponse> {
    try {
      const url = `${this.baseUrl}/api/lobby/create`;
      logger.info({ request, url }, "Создание лобби через Steam бота");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText },
          "Ошибка при создании лобби"
        );
        throw new Error(
          `Ошибка при создании лобби: ${response.status} ${errorText}`
        );
      }

      const data = (await response.json()) as CreateLobbyResponse;

      if (!data.success || !data.lobby) {
        logger.error({ data }, "Лобби не было создано");
        throw new Error(data.message || "Не удалось создать лобби");
      }

      logger.info({ lobbyId: data.lobby.lobbyId }, "Лобби успешно создано");
      return data;
    } catch (error) {
      logger.error({ error, request }, "Ошибка при создании лобби");
      throw error;
    }
  }

  /**
   * Проверяет статус лобби
   */
  async getLobbyStatus(): Promise<LobbyStatusResponse> {
    try {
      const url = `${this.baseUrl}/api/lobby/status`;
      const response = await fetch(url, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Ошибка при проверке статуса: ${response.status}`);
      }

      return (await response.json()) as LobbyStatusResponse;
    } catch (error) {
      logger.error({ error }, "Ошибка при проверке статуса лобби");
      throw error;
    }
  }

  /**
   * Приглашает игроков в лобби
   * Принимает массив Steam ID64 как строки (для точности больших чисел)
   */
  async invitePlayers(steamIDs: string[]): Promise<InvitePlayersResponse> {
    try {
      const url = `${this.baseUrl}/api/lobby/invite`;
      logger.info({ steamIDs }, "Приглашение игроков в лобби");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ steamIDs }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText },
          "Ошибка при приглашении игроков"
        );
        throw new Error(
          `Ошибка при приглашении игроков: ${response.status} ${errorText}`
        );
      }

      const data = (await response.json()) as InvitePlayersResponse;
      logger.info({ data }, "Игроки приглашены");
      return data;
    } catch (error) {
      logger.error({ error, steamIDs }, "Ошибка при приглашении игроков");
      throw error;
    }
  }

  /**
   * Покидает лобби
   */
  async leaveLobby(): Promise<LeaveLobbyResponse> {
    try {
      const url = `${this.baseUrl}/api/lobby/leave`;
      logger.info("Покидание лобби");

      const response = await fetch(url, {
        method: "POST",
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText },
          "Ошибка при покидании лобби"
        );
        throw new Error(
          `Ошибка при покидании лобби: ${response.status} ${errorText}`
        );
      }

      const data = (await response.json()) as LeaveLobbyResponse;
      logger.info({ data }, "Лобби покинуто");
      return data;
    } catch (error) {
      logger.error({ error }, "Ошибка при покидании лобби");
      throw error;
    }
  }
}
