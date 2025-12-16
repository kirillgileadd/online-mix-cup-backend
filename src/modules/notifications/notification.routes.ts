import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { NotificationService } from "./notification.service";

export async function notificationRoutes(
  app: FastifyInstance,
  options: FastifyPluginOptions & { notificationService?: NotificationService }
) {
  // Используем singleton экземпляр для единого состояния SSE подключений
  const notificationService =
    options.notificationService || NotificationService.getInstance();
  const sseService = notificationService.getSSEService();

  app.get(
    "/stream",
    {
      preHandler: [app.authenticateSSE],
      schema: {
        tags: ["notifications"],
        summary: "Подключение к потоку уведомлений через Server-Sent Events",
        description:
          "Устанавливает SSE соединение для получения уведомлений в реальном времени. Требует аутентификации. " +
          "Токен передается через cookie 'accessToken'. " +
          "Возвращает поток Server-Sent Events (text/event-stream).",
        // Для SSE потоков не указываем схему response, так как это потоковый ответ
      },
    },
    async (request, reply) => {
      const user = request.user;
      const userId = user.sub;

      // Устанавливаем заголовки для SSE
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no"); // Отключаем буферизацию в nginx

      // CORS заголовки для SSE (дополнительно к основным настройкам CORS)
      const origin = request.headers.origin;
      if (origin) {
        reply.raw.setHeader("Access-Control-Allow-Origin", origin);
      }
      reply.raw.setHeader("Access-Control-Allow-Credentials", "true");

      // Отправляем начальное сообщение
      reply.raw.write(": connected\n\n");

      // Создаем объект stream для регистрации
      const stream = { reply, userId };

      // Регистрируем подключение
      sseService.registerConnection(userId, stream);

      // Обрабатываем закрытие соединения
      request.raw.on("close", () => {
        sseService.unregisterConnection(userId, stream);
      });

      request.raw.on("error", () => {
        sseService.unregisterConnection(userId, stream);
      });

      // Сообщаем Fastify, что соединение будет открытым
      // Не вызываем reply.send() или reply.code(), так как это поток
      return reply;
    }
  );
}
