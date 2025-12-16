import { Prisma, type User } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { FileService } from "../files/file.service";
import { RoleService } from "../roles/role.service";
import { SteamService } from "../steam/steam.service";
import type {
  UpdateProfilePayload,
  UpdateUserPayload,
  UserPayload,
} from "./user.schema";

const userWithRoles = {
  include: {
    roles: {
      include: {
        role: true,
      },
    },
  },
} satisfies Prisma.UserDefaultArgs;

export type UserWithRoles = Prisma.UserGetPayload<typeof userWithRoles>;

export class UserService {
  private readonly roleService = new RoleService();
  private readonly steamService = new SteamService();
  private readonly fileService = new FileService();

  listUsersWithRoles() {
    return prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      ...userWithRoles,
    });
  }

  async getOrCreate(payload: UserPayload): Promise<User> {
    const existingUser = await prisma.user.findUnique({
      where: { telegramId: payload.telegramId },
    });

    // Получаем steamId64 из steamProfileLink, если он передан
    let steamId64: string | null = null;
    if (payload.steamProfileLink) {
      steamId64 = await this.steamService.getSteamId64(
        payload.steamProfileLink
      );
    }

    if (existingUser) {
      // Собираем только те поля, которые нужно обновить (переданы и отличаются)
      const updateData: {
        username?: string | null;
        nickname?: string | null;
        photoUrl?: string | null;
        discordUsername?: string | null;
        steamId64?: string | null;
        telegramChatId?: string | null;
      } = {};

      // Обновляем username только если он передан и отличается
      if (
        payload.username !== undefined &&
        payload.username !== existingUser.username
      ) {
        updateData.username = payload.username;
      }

      if (
        payload.telegramChatId !== undefined &&
        payload.telegramChatId !== existingUser.telegramChatId
      ) {
        updateData.telegramChatId = payload.telegramChatId;
      }

      // Обновляем nickname только если он передан и отличается
      if (
        payload.nickname !== undefined &&
        payload.nickname !== existingUser.nickname
      ) {
        updateData.nickname = payload.nickname;
      }

      // Обновляем photoUrl только если он передан и отличается
      if (
        payload.photoUrl !== undefined &&
        payload.photoUrl !== existingUser.photoUrl
      ) {
        // Удаляем старое фото, если оно было
        if (existingUser.photoUrl) {
          try {
            await this.fileService.deleteFile(existingUser.photoUrl);
          } catch (error) {
            // Логируем ошибку, но не прерываем обновление
            console.error("Failed to delete old profile photo:", error);
          }
        }
        updateData.photoUrl = payload.photoUrl;
      }

      // Обновляем discordUsername только если он передан и отличается
      if (
        payload.discordUsername !== undefined &&
        payload.discordUsername !== existingUser.discordUsername
      ) {
        updateData.discordUsername = payload.discordUsername;
      }

      // Обновляем steamId64 если steamProfileLink передан
      if (payload.steamProfileLink !== undefined) {
        updateData.steamId64 = steamId64;
      }

      // Обновляем telegramChatId только если он передан и отличается
      if (
        payload.telegramChatId !== undefined &&
        payload.telegramChatId !== existingUser.telegramChatId
      ) {
        updateData.telegramChatId = payload.telegramChatId;
      }

      // Обновляем только если есть изменения
      if (Object.keys(updateData).length > 0) {
        return prisma.user.update({
          where: { id: existingUser.id },
          data: updateData,
        });
      }
      return existingUser;
    }

    const user = await prisma.user.create({
      data: {
        telegramId: payload.telegramId,
        username: payload.username ?? null,
        nickname: payload.nickname ?? null,
        photoUrl: payload.photoUrl ?? null,
        discordUsername: payload.discordUsername ?? null,
        steamId64: steamId64,
        telegramChatId: payload.telegramChatId ?? null,
      },
    });

    // Назначаем роли, если они указаны, иначе назначаем дефолтную роль
    if (payload.roles && payload.roles.length > 0) {
      await this.roleService.updateUserRoles(user.id, payload.roles);
    } else {
      await this.roleService.ensureDefaultRole(user.id);
    }

    return user;
  }

  findByTelegramId(telegramId: string) {
    return prisma.user.findUnique({
      where: { telegramId },
    });
  }

  findByTelegramIdWithRoles(telegramId: string) {
    return prisma.user.findUnique({
      where: { telegramId },
      ...userWithRoles,
    });
  }

  findById(id: number) {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  findByIdWithRoles(id: number) {
    return prisma.user.findUnique({
      where: { id },
      ...userWithRoles,
    });
  }

  async updateUser(id: number, data: Omit<UpdateUserPayload, "roles">) {
    const updateData: Prisma.UserUpdateInput = {};

    // Получаем текущего пользователя для удаления старого фото
    const currentUser = await prisma.user.findUnique({
      where: { id },
      select: { photoUrl: true },
    });

    if (!currentUser) {
      throw new Error("User not found");
    }

    // Добавляем только те поля, которые определены (не undefined)
    if (data.username !== undefined) {
      updateData.username = data.username;
    }
    if (data.nickname !== undefined) {
      updateData.nickname = data.nickname;
    }
    if (data.photoUrl !== undefined) {
      // Удаляем старое фото, если оно было и обновляется на новое
      if (currentUser.photoUrl && data.photoUrl !== currentUser.photoUrl) {
        try {
          await this.fileService.deleteFile(currentUser.photoUrl);
        } catch (error) {
          // Логируем ошибку, но не прерываем обновление
          console.error("Failed to delete old profile photo:", error);
        }
      }
      // Если устанавливаем photoUrl в null, также удаляем файл
      if (currentUser.photoUrl && data.photoUrl === null) {
        try {
          await this.fileService.deleteFile(currentUser.photoUrl);
        } catch (error) {
          console.error("Failed to delete old profile photo:", error);
        }
      }
      updateData.photoUrl = data.photoUrl;
    }
    if (data.discordUsername !== undefined) {
      updateData.discordUsername = data.discordUsername;
    }

    // Если передан steamProfileLink, получаем steamId64
    if (data.steamProfileLink !== undefined) {
      if (data.steamProfileLink) {
        const steamId64 = await this.steamService.getSteamId64(
          data.steamProfileLink
        );
        updateData.steamId64 = steamId64;
      } else {
        // Если steamProfileLink установлен в null, очищаем steamId64
        updateData.steamId64 = null;
      }
    }

    return prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteUser(id: number): Promise<void> {
    // Проверяем, существует ли пользователь
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new Error("User not found");
    }

    await prisma.user.delete({
      where: { id },
    });
  }

  async updateProfile(id: number, data: UpdateProfilePayload) {
    const updateData: Prisma.UserUpdateInput = {};

    // Получаем текущего пользователя для удаления старого фото
    const currentUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!currentUser) {
      throw new Error("User not found");
    }

    // Обрабатываем nickname
    if (data.nickname !== undefined) {
      updateData.nickname = data.nickname;
    }

    // Обрабатываем discordUsername
    if (data.discordUsername !== undefined) {
      updateData.discordUsername = data.discordUsername;
    }

    // Обрабатываем photoBase64
    if (data.photoBase64 !== undefined) {
      if (data.photoBase64) {
        // Сохраняем новое фото
        const filePath = await this.fileService.saveProfileImage(
          data.photoBase64,
          `profile_${id}`
        );
        updateData.photoUrl = this.fileService.getFileUrl(filePath);

        // Удаляем старое фото, если оно было
        if (currentUser.photoUrl) {
          try {
            await this.fileService.deleteFile(currentUser.photoUrl);
          } catch (error) {
            // Логируем ошибку, но не прерываем обновление
            console.error("Failed to delete old profile photo:", error);
          }
        }
      } else {
        // Если передано null, удаляем фото
        updateData.photoUrl = null;
        if (currentUser.photoUrl) {
          try {
            await this.fileService.deleteFile(currentUser.photoUrl);
          } catch (error) {
            console.error("Failed to delete old profile photo:", error);
          }
        }
      }
    }

    // Обрабатываем steamProfileLink
    if (data.steamProfileLink !== undefined) {
      if (data.steamProfileLink) {
        const steamId64 = await this.steamService.getSteamId64(
          data.steamProfileLink
        );
        updateData.steamId64 = steamId64;
      } else {
        // Если steamProfileLink установлен в null, очищаем steamId64
        updateData.steamId64 = null;
      }
    }

    return prisma.user.update({
      where: { id },
      data: updateData,
    });
  }
}
