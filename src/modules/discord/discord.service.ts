import {
  Client,
  GatewayIntentBits,
  Guild,
  VoiceChannel,
  TextChannel,
  CategoryChannel,
  ChannelType,
} from "discord.js";
import pino from "pino";
import { env } from "../../config/env";

const logger = pino();

export interface TeamMember {
  discordUsername: string | null;
  userId: number;
  isCaptain?: boolean;
  nickname?: string | null;
}

export class DiscordService {
  private client: Client | null = null;
  private isReady: boolean = false;

  /**
   * Инициализация Discord клиента
   */
  async initialize(): Promise<void> {
    if (!env.DISCORD_BOT_TOKEN) {
      logger.warn(
        "DISCORD_BOT_TOKEN не установлен, Discord сервис будет отключен"
      );
      return;
    }

    try {
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      });

      this.client.once("ready", () => {
        logger.info("Discord бот успешно подключен");
        this.isReady = true;
      });

      this.client.on("error", (error) => {
        logger.error({ error }, "Ошибка Discord клиента");
      });

      await this.client.login(env.DISCORD_BOT_TOKEN);
    } catch (error) {
      logger.error({ error }, "Ошибка инициализации Discord клиента");
      throw error;
    }
  }

  /**
   * Ожидание готовности клиента
   */
  private async waitForReady(): Promise<void> {
    if (!this.client) {
      throw new Error("Discord клиент не инициализирован");
    }

    if (this.isReady) {
      return;
    }

    // Ждем до 10 секунд
    const maxWait = 10000;
    const startTime = Date.now();

    while (!this.isReady && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!this.isReady) {
      throw new Error("Discord клиент не готов в течение таймаута");
    }
  }

  /**
   * Создание двух голосовых каналов для команд и перемещение игроков
   */
  async createVoiceChannelsAndMovePlayers(
    team1: TeamMember[],
    team2: TeamMember[],
    lobbyId: number,
    steamLobby?: {
      gameName: string;
      gameMode: number;
      passKey: string;
      serverRegion: number;
    }
  ): Promise<{ team1ChannelId: string | null; team2ChannelId: string | null }> {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
      logger.warn(
        "Discord конфигурация не установлена, пропускаем создание каналов"
      );
      return { team1ChannelId: null, team2ChannelId: null };
    }

    try {
      await this.waitForReady();

      if (!this.client) {
        throw new Error("Discord клиент не инициализирован");
      }

      const guild = await this.client.guilds.fetch(env.DISCORD_GUILD_ID);
      if (!guild) {
        throw new Error(`Гильдия с ID ${env.DISCORD_GUILD_ID} не найдена`);
      }

      // Определяем родительскую категорию (опционально)
      let parentCategoryId: string | null = null;

      if (env.DISCORD_CHANNEL_ID) {
        // Получаем родительский канал (категорию или канал)
        const parentChannel = await guild.channels.fetch(
          env.DISCORD_CHANNEL_ID
        );
        if (parentChannel) {
          if (parentChannel.type === ChannelType.GuildCategory) {
            parentCategoryId = parentChannel.id;
          } else if (
            parentChannel.parent &&
            parentChannel.parent.type === ChannelType.GuildCategory
          ) {
            parentCategoryId = parentChannel.parent.id;
          }
        } else {
          logger.warn(
            { channelId: env.DISCORD_CHANNEL_ID },
            "Канал с указанным ID не найден, создаем каналы в корне сервера"
          );
        }
      }
      // Если DISCORD_CHANNEL_ID не указан, parentCategoryId останется null
      // и каналы будут созданы в корне сервера

      // Находим капитанов в командах
      const team1Captain = team1.find((member) => member.isCaptain);
      const team2Captain = team2.find((member) => member.isCaptain);

      // Формируем названия каналов по имени капитана
      const team1ChannelName = team1Captain?.nickname
        ? `${team1Captain.nickname}'s Team Lobby - ${lobbyId}`
        : `Команда 1 - Лобби ${lobbyId}`;
      const team2ChannelName = team2Captain?.nickname
        ? `${team2Captain.nickname}'s Team Lobby - ${lobbyId}`
        : `Команда 2 - Лобби ${lobbyId}`;

      // Создаем голосовые каналы
      const team1Channel = await guild.channels.create({
        name: team1ChannelName,
        type: ChannelType.GuildVoice,
        parent: parentCategoryId,
        userLimit: 5,
      });

      const team2Channel = await guild.channels.create({
        name: team2ChannelName,
        type: ChannelType.GuildVoice,
        parent: parentCategoryId,
        userLimit: 5,
      });

      logger.info(
        {
          team1ChannelId: team1Channel.id,
          team2ChannelId: team2Channel.id,
          lobbyId,
        },
        "Созданы голосовые каналы для команд"
      );

      // Перемещаем игроков в соответствующие каналы
      await this.movePlayersToChannel(guild, team1, team1Channel.id);
      await this.movePlayersToChannel(guild, team2, team2Channel.id);

      // Отправляем информацию о лобби в общий текстовый канал
      await this.sendLobbyInfoToGeneralTextChannel(
        guild,
        team1Channel.id,
        team2Channel.id,
        lobbyId,
        steamLobby
      );

      return {
        team1ChannelId: team1Channel.id,
        team2ChannelId: team2Channel.id,
      };
    } catch (error) {
      logger.error(
        { error, lobbyId },
        "Ошибка при создании голосовых каналов и перемещении игроков"
      );
      // Не пробрасываем ошибку, чтобы не блокировать основной процесс
      return { team1ChannelId: null, team2ChannelId: null };
    }
  }

  /**
   * Перемещение игроков команды в голосовой канал
   */
  private async movePlayersToChannel(
    guild: Guild,
    teamMembers: TeamMember[],
    channelId: string
  ): Promise<void> {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !(channel instanceof VoiceChannel)) {
      logger.warn({ channelId }, "Голосовой канал не найден");
      return;
    }

    for (const member of teamMembers) {
      if (!member.discordUsername) {
        logger.debug(
          { userId: member.userId },
          "У игрока нет Discord username, пропускаем"
        );
        continue;
      }

      try {
        // Ищем пользователя среди тех, кто уже находится в голосовых каналах
        // Discord username может быть в формате "username" или "username#1234"
        const usernameWithoutDiscriminator =
          member.discordUsername.split("#")[0];

        if (!usernameWithoutDiscriminator) {
          logger.warn(
            { discordUsername: member.discordUsername },
            "Некорректный Discord username"
          );
          continue;
        }

        // Ищем пользователя среди тех, кто находится в голосовых каналах
        // Это не требует GuildMembers интента
        let foundMember = null;

        // Проходим по всем голосовым состояниям (пользователи в голосовых каналах)
        for (const [userId, voiceState] of guild.voiceStates.cache) {
          const guildMember = voiceState.member;
          if (!guildMember) continue;

          const memberUsername = guildMember.user.username.toLowerCase();
          const displayName = guildMember.displayName.toLowerCase();
          const targetUsername = usernameWithoutDiscriminator.toLowerCase();

          if (
            memberUsername === targetUsername ||
            displayName === targetUsername
          ) {
            foundMember = guildMember;
            break;
          }
        }

        if (!foundMember) {
          logger.debug(
            { discordUsername: member.discordUsername },
            "Пользователь Discord не найден среди участников в голосовых каналах. Перемещение возможно только для пользователей, которые уже находятся в голосовом канале."
          );
          continue;
        }

        // Перемещаем в канал, если пользователь находится в голосовом канале
        if (foundMember.voice.channel) {
          await foundMember.voice.setChannel(channel);
          logger.info(
            {
              discordUsername: member.discordUsername,
              channelId,
            },
            "Игрок перемещен в голосовой канал"
          );
        } else {
          logger.debug(
            { discordUsername: member.discordUsername },
            "Игрок не находится в голосовом канале, пропускаем перемещение"
          );
        }
      } catch (error) {
        logger.error(
          { error, discordUsername: member.discordUsername },
          "Ошибка при перемещении игрока"
        );
        // Продолжаем с другими игроками
      }
    }
  }

  /**
   * Отправка информации о лобби в общий текстовый канал
   */
  private async sendLobbyInfoToGeneralTextChannel(
    guild: Guild,
    team1VoiceChannelId: string,
    team2VoiceChannelId: string,
    lobbyId: number,
    steamLobby?: {
      gameName: string;
      gameMode: number;
      passKey: string;
      serverRegion: number;
    }
  ): Promise<void> {
    if (!env.DISCORD_GENERAL_TEXT_CHANNEL_ID) {
      logger.warn(
        "DISCORD_GENERAL_TEXT_CHANNEL_ID не установлен, пропускаем отправку сообщения"
      );
      return;
    }

    try {
      // Получаем голосовые каналы для получения их имен
      const team1VoiceChannel = await guild.channels.fetch(team1VoiceChannelId);
      const team2VoiceChannel = await guild.channels.fetch(team2VoiceChannelId);

      const team1ChannelName =
        team1VoiceChannel instanceof VoiceChannel
          ? team1VoiceChannel.name
          : `Команда 1 - Лобби ${lobbyId}`;
      const team2ChannelName =
        team2VoiceChannel instanceof VoiceChannel
          ? team2VoiceChannel.name
          : `Команда 2 - Лобби ${lobbyId}`;

      // Получаем общий текстовый канал
      const generalTextChannel = await guild.channels.fetch(
        env.DISCORD_GENERAL_TEXT_CHANNEL_ID
      );

      if (!generalTextChannel || !(generalTextChannel instanceof TextChannel)) {
        logger.warn(
          { channelId: env.DISCORD_GENERAL_TEXT_CHANNEL_ID },
          "Общий текстовый канал не найден"
        );
        return;
      }

      // Формируем сообщение с информацией о лобби
      // Если steamLobby null, используем стандартные данные и указываем, что лобби не создано автоматически
      const isLobbyCreated = steamLobby !== null && steamLobby !== undefined;
      const gameName = steamLobby?.gameName || `mf${lobbyId}`;
      const passKey = steamLobby?.passKey || "12345";
      const region = steamLobby
        ? this.getRegionName(steamLobby.serverRegion)
        : "Стокгольм";
      const gameMode = steamLobby
        ? this.getGameModeName(steamLobby.gameMode)
        : "Captains Draft";

      let lobbyMessage = `**🎮 Лобби ${lobbyId} началось!**\n\n`;

      if (!isLobbyCreated) {
        lobbyMessage += `⚠️ **Лобби не было создано автоматически.** Пожалуйста, создайте лобби вручную.\n\n`;
      }

      lobbyMessage += `**Название лобби:** ${gameName}
**Пароль:** ${passKey || "Нет пароля"}
**Регион:** ${region}
**Режим игры:** ${gameMode}

**Голосовые каналы:**
🔊 ${team1ChannelName}
🔊 ${team2ChannelName}`;

      // Отправляем сообщение в общий текстовый канал
      await generalTextChannel.send(lobbyMessage);
      logger.info(
        { channelId: generalTextChannel.id, lobbyId },
        "Сообщение о лобби отправлено в общий текстовый канал"
      );
    } catch (error) {
      logger.error(
        { error, lobbyId },
        "Ошибка при отправке сообщения о лобби в общий текстовый канал"
      );
      // Не пробрасываем ошибку, чтобы не блокировать основной процесс
    }
  }

  /**
   * Преобразует код региона сервера в читаемое название
   */
  private getRegionName(serverRegion?: number): string {
    if (!serverRegion) {
      return "Не указан";
    }

    const regionMap: Record<number, string> = {
      0: "US West",
      1: "US East",
      2: "Europe West",
      3: "Europe East",
      4: "Singapore",
      5: "Dubai",
      6: "Australia",
      7: "Austria",
      8: "Stockholm",
      9: "Brazil",
      10: "South Africa",
      11: "PW Telecom Shanghai",
      12: "PW Unicom",
      13: "Chile",
      14: "Peru",
      15: "India",
      16: "PW Telecom Guangdong",
      17: "PW Telecom Zhejiang",
      18: "Japan",
      19: "PW Telecom Wuhan",
    };

    return regionMap[serverRegion] || `Регион ${serverRegion}`;
  }

  /**
   * Преобразует код режима игры в читаемое название
   */
  private getGameModeName(gameMode?: number): string {
    if (!gameMode) {
      return "Не указан";
    }

    const gameModeMap: Record<number, string> = {
      0: "None",
      1: "All Pick",
      2: "Captains Mode",
      3: "Random Draft",
      4: "Single Draft",
      5: "All Random",
      6: "Intro",
      7: "Diretide",
      8: "Reverse Captains Mode",
      9: "Greeviling",
      10: "Tutorial",
      11: "Mid Only",
      12: "Least Played",
      13: "Limited Heroes",
      14: "Compendium Matchmaking",
      15: "Custom",
      16: "Captains Draft",
      17: "Balanced Draft",
      18: "Ability Draft",
      19: "Event",
      20: "All Random Deathmatch",
      21: "1v1 Mid",
      22: "Ranked Matchmaking",
    };

    return gameModeMap[gameMode] || `Режим ${gameMode}`;
  }

  /**
   * Перемещение всех игроков из каналов в общий канал и удаление каналов
   */
  async movePlayersToGeneralAndDeleteChannels(
    team1ChannelId: string | null,
    team2ChannelId: string | null,
    lobbyId: number
  ): Promise<void> {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
      logger.warn(
        "Discord конфигурация не установлена, пропускаем очистку каналов"
      );
      return;
    }

    if (!env.DISCORD_GENERAL_CHANNEL_ID) {
      logger.warn(
        "DISCORD_GENERAL_CHANNEL_ID не установлен, пропускаем перемещение игроков"
      );
      // Все равно удаляем каналы, если они есть
      if (team1ChannelId || team2ChannelId) {
        await this.deleteChannels(team1ChannelId, team2ChannelId, lobbyId);
      }
      return;
    }

    try {
      await this.waitForReady();

      if (!this.client) {
        throw new Error("Discord клиент не инициализирован");
      }

      const guild = await this.client.guilds.fetch(env.DISCORD_GUILD_ID);
      if (!guild) {
        throw new Error(`Гильдия с ID ${env.DISCORD_GUILD_ID} не найдена`);
      }

      const generalChannel = await guild.channels.fetch(
        env.DISCORD_GENERAL_CHANNEL_ID
      );
      if (!generalChannel || !(generalChannel instanceof VoiceChannel)) {
        logger.warn(
          { channelId: env.DISCORD_GENERAL_CHANNEL_ID },
          "Общий голосовой канал не найден"
        );
        // Все равно удаляем каналы
        await this.deleteChannels(team1ChannelId, team2ChannelId, lobbyId);
        return;
      }

      // Перемещаем всех игроков из обоих каналов в общий канал
      if (team1ChannelId) {
        await this.moveAllPlayersFromChannelToGeneral(
          guild,
          team1ChannelId,
          generalChannel.id
        );
      }

      if (team2ChannelId) {
        await this.moveAllPlayersFromChannelToGeneral(
          guild,
          team2ChannelId,
          generalChannel.id
        );
      }

      // Удаляем каналы
      await this.deleteChannels(team1ChannelId, team2ChannelId, lobbyId);
    } catch (error) {
      logger.error(
        { error, team1ChannelId, team2ChannelId },
        "Ошибка при перемещении игроков и удалении каналов"
      );
    }
  }

  /**
   * Перемещение всех игроков из канала в общий канал
   */
  private async moveAllPlayersFromChannelToGeneral(
    guild: Guild,
    sourceChannelId: string,
    generalChannelId: string
  ): Promise<void> {
    try {
      const sourceChannel = await guild.channels.fetch(sourceChannelId);
      if (!sourceChannel || !(sourceChannel instanceof VoiceChannel)) {
        logger.warn({ channelId: sourceChannelId }, "Исходный канал не найден");
        return;
      }

      // Получаем всех участников в исходном канале
      const membersInChannel = sourceChannel.members;

      for (const [memberId, member] of membersInChannel) {
        try {
          if (member.voice.channel?.id === sourceChannelId) {
            await member.voice.setChannel(generalChannelId);
            logger.debug(
              { memberId, sourceChannelId, generalChannelId },
              "Игрок перемещен в общий канал"
            );
          }
        } catch (error) {
          logger.error(
            { error, memberId, sourceChannelId },
            "Ошибка при перемещении игрока"
          );
          // Продолжаем с другими игроками
        }
      }
    } catch (error) {
      logger.error(
        { error, sourceChannelId },
        "Ошибка при перемещении игроков из канала"
      );
    }
  }

  /**
   * Удаление каналов (голосовых и текстовых)
   */
  private async deleteChannels(
    team1ChannelId: string | null,
    team2ChannelId: string | null,
    lobbyId: number
  ): Promise<void> {
    if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
      return;
    }

    try {
      await this.waitForReady();

      if (!this.client) {
        throw new Error("Discord клиент не инициализирован");
      }

      const guild = await this.client.guilds.fetch(env.DISCORD_GUILD_ID);
      if (!guild) {
        throw new Error(`Гильдия с ID ${env.DISCORD_GUILD_ID} не найдена`);
      }

      // Удаляем голосовые каналы
      if (team1ChannelId) {
        try {
          const channel = await guild.channels.fetch(team1ChannelId);
          if (channel && channel instanceof VoiceChannel) {
            await channel.delete();
            logger.info(
              { channelId: team1ChannelId },
              "Голосовой канал команды 1 удален"
            );
          }
        } catch (error) {
          logger.error(
            { error, channelId: team1ChannelId },
            "Ошибка при удалении голосового канала команды 1"
          );
        }
      }

      if (team2ChannelId) {
        try {
          const channel = await guild.channels.fetch(team2ChannelId);
          if (channel && channel instanceof VoiceChannel) {
            await channel.delete();
            logger.info(
              { channelId: team2ChannelId },
              "Голосовой канал команды 2 удален"
            );
          }
        } catch (error) {
          logger.error(
            { error, channelId: team2ChannelId },
            "Ошибка при удалении голосового канала команды 2"
          );
        }
      }
    } catch (error) {
      logger.error(
        { error, team1ChannelId, team2ChannelId },
        "Ошибка при удалении каналов"
      );
    }
  }

  /**
   * Закрытие соединения с Discord
   */
  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.isReady = false;
      logger.info("Discord клиент отключен");
    }
  }
}
