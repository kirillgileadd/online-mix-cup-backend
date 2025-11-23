import { Prisma, type User } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { RoleService } from "../roles/role.service";
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

    if (existingUser) {
      const needsUpdate =
        (payload.username ?? null) !== existingUser.username ||
        (payload.photoUrl ?? null) !== existingUser.photoUrl ||
        (payload.discordUsername ?? null) !== existingUser.discordUsername;

      if (needsUpdate) {
        return prisma.user.update({
          where: { id: existingUser.id },
          data: {
            username: payload.username ?? null,
            photoUrl: payload.photoUrl ?? null,
            discordUsername: payload.discordUsername ?? null,
          },
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
      },
    });

    await this.roleService.ensureDefaultRole(user.id);

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

  updateUser(id: number, data: UpdateUserPayload) {
    return prisma.user.update({
      where: { id },
      data: data as Prisma.UserUpdateInput,
    });
  }

  deleteUser(id: number) {
    return prisma.user.delete({
      where: { id },
    });
  }
}
