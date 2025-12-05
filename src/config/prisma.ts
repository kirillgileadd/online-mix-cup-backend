import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../generated/client";
import { env } from "./env";

// Оптимизированный connection pool для маломощного сервера
// Ограничиваем количество соединений, чтобы не перегружать сервер
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5, // Максимум 5 соединений (вместо дефолтных 10-20)
  min: 1, // Минимум 1 соединение
  idleTimeoutMillis: 30000, // Закрывать неиспользуемые соединения через 30 сек
  connectionTimeoutMillis: 2000, // Таймаут подключения 2 сек
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  // Оптимизация логирования для продакшена
  log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"], // В продакшене только ошибки
});

// Graceful shutdown: закрываем соединения при завершении приложения
process.on("beforeExit", async () => {
  await prisma.$disconnect();
  await pool.end();
});
