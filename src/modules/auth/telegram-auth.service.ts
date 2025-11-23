import { createHash, createHmac } from "node:crypto";

import { env } from "../../config/env";
import { UserService } from "../users/user.service";
import type { User } from "@prisma/client";

export type TelegramAuthPayload = {
  id: string | number;
  first_name?: string | undefined;
  last_name?: string | undefined;
  username?: string | undefined;
  photo_url?: string | undefined;
  auth_date: number;
  hash: string;
  [key: string]: unknown;
};

const MAX_AUTH_AGE_SECONDS = 60 * 5; // 5 minutes

export class TelegramAuthService {
  constructor(private readonly userService = new UserService()) {}

  async authenticate(payload: TelegramAuthPayload): Promise<User> {
    this.verifySignature(payload);
    this.ensureFreshness(payload.auth_date);

    const telegramId = String(payload.id);
    return this.userService.getOrCreate({
      telegramId,
      username: payload.username ?? null,
      photoUrl: payload.photo_url ?? null,
    });
  }

  private verifySignature(payload: TelegramAuthPayload) {
    const { hash, ...data } = payload;

    if (!hash || typeof hash !== "string") {
      throw new Error("Missing signature");
    }

    const dataCheckString = Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = createHash("sha256")
      .update(env.TELEGRAM_BOT_TOKEN)
      .digest();
    const hex = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (hex !== hash) {
      throw new Error("Invalid Telegram signature");
    }
  }

  private ensureFreshness(authDate: number) {
    const now = Math.floor(Date.now() / 1000);
    if (now - Number(authDate) > MAX_AUTH_AGE_SECONDS) {
      throw new Error("Authorization data is too old");
    }
  }
}
