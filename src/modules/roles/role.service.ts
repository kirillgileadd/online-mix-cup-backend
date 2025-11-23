import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";

export class RoleService {
  private roleInclude = {
    include: {
      users: {
        select: {
          userId: true,
        },
      },
    },
  } satisfies Prisma.RoleDefaultArgs;

  listRoles() {
    return prisma.role.findMany({
      orderBy: { createdAt: "asc" },
      ...this.roleInclude,
    });
  }

  async createRole(data: {
    name: string;
    description?: string | null | undefined;
  }) {
    return prisma.role.create({
      data: {
        name: data.name,
        description: data.description ?? null,
      },
    });
  }

  private ensureRole(name: string) {
    return prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  async assignRoleToUser(userId: number, roleName: string) {
    const role = await this.ensureRole(roleName);

    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId,
          roleId: role.id,
        },
      },
      update: {},
      create: {
        userId,
        roleId: role.id,
      },
    });

    return role;
  }

  async ensureDefaultRole(userId: number, roleName = "player") {
    await this.assignRoleToUser(userId, roleName);
  }

  async removeRoleFromUser(userId: number, roleName: string) {
    const role = await prisma.role.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      return null;
    }

    await prisma.userRole.deleteMany({
      where: {
        userId,
        roleId: role.id,
      },
    });

    return role;
  }

  async getUserRoleNames(userId: number) {
    const roles = await prisma.userRole.findMany({
      where: { userId },
      include: {
        role: true,
      },
    });

    return roles.map((relation) => relation.role.name);
  }

  async updateUserRoles(userId: number, roleNames: string[]) {
    // Удаляем все текущие роли пользователя
    await prisma.userRole.deleteMany({
      where: { userId },
    });

    // Добавляем новые роли
    for (const roleName of roleNames) {
      await this.assignRoleToUser(userId, roleName);
    }

    return this.getUserRoleNames(userId);
  }
}
