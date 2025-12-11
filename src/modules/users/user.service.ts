import { Prisma, type User } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { RoleService } from "../roles/role.service";
import { SteamService } from "../steam/steam.service";
import type { UpdateUserPayload, UserPayload } from "./user.schema";

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
        photoUrl?: string | null;
        discordUsername?: string | null;
        steamId64?: string | null;
      } = {};

      // Обновляем username только если он передан и отличается
      if (
        payload.username !== undefined &&
        payload.username !== existingUser.username
      ) {
        updateData.username = payload.username;
      }

      // Обновляем photoUrl только если он передан и отличается
      if (
        payload.photoUrl !== undefined &&
        payload.photoUrl !== existingUser.photoUrl
      ) {
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
        photoUrl: payload.photoUrl ?? null,
        discordUsername: payload.discordUsername ?? null,
        steamId64: steamId64,
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

    // Добавляем только те поля, которые определены (не undefined)
    if (data.username !== undefined) {
      updateData.username = data.username;
    }
    if (data.photoUrl !== undefined) {
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
}
