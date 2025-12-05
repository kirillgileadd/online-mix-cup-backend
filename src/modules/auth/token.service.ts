import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "../../config/prisma";

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Сравнивает два токена с защитой от timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  
  // Если длины разные, создаем буферы одинаковой длины для безопасного сравнения
  if (aBuffer.length !== bBuffer.length) {
    const maxLength = Math.max(aBuffer.length, bBuffer.length);
    const aPadded = Buffer.alloc(maxLength);
    const bPadded = Buffer.alloc(maxLength);
    aBuffer.copy(aPadded);
    bBuffer.copy(bPadded);
    return timingSafeEqual(aPadded, bPadded);
  }
  
  return timingSafeEqual(aBuffer, bBuffer);
}

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
    
    // Защита от timing attacks: используем фиктивный хеш для сравнения
    const dummyHash = "0".repeat(64); // 64 символа для SHA-256 hex
    
    const record = await prisma.refreshToken.findUnique({
      where: { token: hashed },
    });

    // Используем constant-time сравнение для защиты от timing attacks
    // Сравниваем с реальным токеном или с фиктивным, чтобы время выполнения было одинаковым
    const tokenToCompare = record ? record.token : dummyHash;
    const isValidToken = record
      ? constantTimeCompare(hashed, tokenToCompare)
      : false;

    // Всегда выполняем сравнение для выравнивания времени выполнения
    if (!isValidToken || !record) {
      // Выполняем фиктивную операцию для выравнивания времени выполнения
      constantTimeCompare(hashed, dummyHash);
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
