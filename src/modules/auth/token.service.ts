import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../../config/prisma";

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export class TokenService {
  async createRefreshToken(userId: number) {
    const rawToken = randomBytes(48).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await prisma.refreshToken.create({
      data: {
        userId,
        token: hashToken(rawToken),
        expiresAt,
      },
    });

    return {
      refreshToken: rawToken,
      expiresAt,
    };
  }

  async verifyRefreshToken(token: string) {
    const hashed = hashToken(token);
    const record = await prisma.refreshToken.findUnique({
      where: { token: hashed },
    });

    if (!record) {
      throw new Error("Refresh token not found");
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await prisma.refreshToken.delete({ where: { token: hashed } });
      throw new Error("Refresh token expired");
    }

    return record;
  }

  async revokeToken(token: string) {
    await prisma.refreshToken.delete({
      where: { token: hashToken(token) },
    });
  }

  async revokeAllForUser(userId: number) {
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }
}
