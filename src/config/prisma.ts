import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../generated/client";
import { env } from "./env";

// Оптимизированный connection pool для маломощного сервера
// Ограничиваем количество соединений, чтобы не перегружать сервер
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 25, // Увеличено с 5 до 25 для обработки 200 RPS
  min: 5, // Увеличено с 1 до 5 для быстрого старта
  idleTimeoutMillis: 30000, // Закрывать неиспользуемые соединения через 30 сек
  connectionTimeoutMillis: 5000, // Увеличено с 2 до 5 сек для стабильности
  // Дополнительные настройки для производительности
  statement_timeout: 10000, // Таймаут выполнения запроса 10 сек
  query_timeout: 10000, // Таймаут запроса 10 сек
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
