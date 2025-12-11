import pino from "pino";
import { env } from "../../config/env";

const logger = pino();

/**
 * Сервис для работы со Steam API
 */
export class SteamService {
  private readonly apiKey = env.STEAM_API_KEY;
  private readonly baseUrl = "https://api.steampowered.com";

  /**
   * Получает steamId64 из ссылки на профиль Steam
   * Поддерживает два формата:
   * - https://steamcommunity.com/profiles/76561198012345678 (прямой ID)
   * - https://steamcommunity.com/id/customname (кастомное имя, требует API ключ)
   */
  async getSteamId64(steamProfileLink: string): Promise<string | null> {
    try {
      // Нормализуем URL
      const url = this.normalizeUrl(steamProfileLink);

      // Пытаемся извлечь ID из прямого профиля
      const directId = this.extractDirectId(url);
      if (directId) {
        return directId;
      }

      // Если это кастомное имя, используем Steam API
      const customName = this.extractCustomName(url);
      if (customName) {
        return await this.resolveVanityUrl(customName);
      }

      logger.warn(
        { steamProfileLink },
        "Не удалось определить формат Steam профиля"
      );
      return null;
    } catch (error) {
      logger.error(
        { error, steamProfileLink },
        "Ошибка при получении steamId64"
      );
      return null;
    }
  }

  /**
   * Нормализует URL профиля Steam
   */
  private normalizeUrl(url: string): string {
    // Убираем пробелы и приводим к нижнему регистру
    let normalized = url.trim().toLowerCase();

    // Добавляем протокол, если его нет
    if (
      !normalized.startsWith("http://") &&
      !normalized.startsWith("https://")
    ) {
      normalized = `https://${normalized}`;
    }

    // Убираем слеш в конце
    normalized = normalized.replace(/\/$/, "");

    return normalized;
  }

  /**
   * Извлекает steamId64 из прямого профиля
   * Формат: https://steamcommunity.com/profiles/76561198012345678
   */
  private extractDirectId(url: string): string | null {
    const match = url.match(/steamcommunity\.com\/profiles\/(\d{17})/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }

  /**
   * Извлекает кастомное имя из профиля
   * Формат: https://steamcommunity.com/id/customname
   */
  private extractCustomName(url: string): string | null {
    const match = url.match(/steamcommunity\.com\/id\/([^\/\?]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }

  /**
   * Использует Steam Web API для получения steamId64 из кастомного имени
   * Требует STEAM_API_KEY
   */
  private async resolveVanityUrl(vanityUrl: string): Promise<string | null> {
    if (!this.apiKey) {
      logger.warn(
        "STEAM_API_KEY не установлен, невозможно разрешить кастомное имя Steam профиля"
      );
      return null;
    }

    try {
      const apiUrl = `${this.baseUrl}/ISteamUser/ResolveVanityURL/v0001/`;
      const params = new URLSearchParams({
        key: this.apiKey,
        vanityurl: vanityUrl,
      });

      const response = await fetch(`${apiUrl}?${params.toString()}`);

      if (!response.ok) {
        logger.error(
          { status: response.status, vanityUrl },
          "Ошибка при запросе к Steam API"
        );
        return null;
      }

      const data = (await response.json()) as {
        response?: {
          success?: number;
          steamid?: string;
          message?: string;
        };
      };

      if (data.response?.success === 1 && data.response.steamid) {
        return data.response.steamid;
      }

      logger.warn(
        { response: data.response, vanityUrl },
        "Steam API вернул неуспешный ответ"
      );
      return null;
    } catch (error) {
      logger.error({ error, vanityUrl }, "Ошибка при запросе к Steam API");
      return null;
    }
  }
}
