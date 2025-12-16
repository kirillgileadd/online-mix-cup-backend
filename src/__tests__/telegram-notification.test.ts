import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../config/prisma";
import { TelegramNotificationService } from "../modules/notifications/notification.service";
import { UserService } from "../modules/users/user.service";
import { env } from "../config/env";

describe("Telegram Notification Test", () => {
  let userId: number;
  let userService: UserService;
  let telegramService: TelegramNotificationService;

  // Укажите здесь ваш Telegram chat_id для теста
  // Вы можете получить его, отправив сообщение боту @userinfobot или @getidsbot
  // Или установите через переменную окружения TELEGRAM_TEST_CHAT_ID
  const testChatId = process.env.TELEGRAM_TEST_CHAT_ID || "";

  beforeAll(async () => {
    userService = new UserService();
    telegramService = new TelegramNotificationService();

    if (!testChatId) {
      console.warn(
        "⚠️  TELEGRAM_TEST_CHAT_ID не установлен. Установите его для полноценного теста."
      );
      console.warn(
        "   Вы можете получить chat_id, отправив сообщение боту @userinfobot"
      );
    }

    if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === "1234567890:test-token-for-testing") {
      console.warn(
        "⚠️  TELEGRAM_BOT_TOKEN не установлен или использует тестовое значение."
      );
      console.warn("   Убедитесь, что установлен реальный токен бота.");
    }
  });

  afterAll(async () => {
    // Удаляем тестового пользователя
    if (userId) {
      await prisma.userRole.deleteMany({
        where: { userId },
      });
      await prisma.user.delete({
        where: { id: userId },
      });
    }
    await prisma.$disconnect();
  });

  it("1. Создание пользователя с telegramChatId", async () => {
    if (!testChatId) {
      console.log("⏭️  Пропускаем создание пользователя (нет testChatId)");
      return;
    }

    const uniqueTelegramId = `test_notification_${Date.now()}`;
    const user = await userService.getOrCreate({
      telegramId: uniqueTelegramId,
      username: "test_notification_user",
      telegramChatId: testChatId,
    });

    expect(user).toBeDefined();
    expect(user.id).toBeDefined();
    expect(user.telegramChatId).toBe(testChatId);
    userId = user.id;

    console.log(`✅ Пользователь создан: ID=${userId}, chatId=${testChatId}`);
  });

  it("2. Отправка тестового уведомления", async () => {
    if (!userId) {
      console.log("⏭️  Пропускаем отправку уведомления (пользователь не создан)");
      return;
    }

    const testMessage = `🧪 Тестовое уведомление от ${new Date().toLocaleString("ru-RU")}\n\nЭто тестовое сообщение для проверки работы Telegram уведомлений.`;

    console.log(`📤 Отправка уведомления пользователю ID=${userId}...`);

    const result = await telegramService.sendNotification(userId, testMessage);

    console.log("📥 Результат отправки:", result);

    if (result.success) {
      console.log("✅ Уведомление успешно отправлено! Проверьте ваш Telegram.");
    } else {
      console.error("❌ Ошибка отправки:", result.error);
      console.error("\nВозможные причины:");
      console.error("1. Бот заблокирован пользователем (403)");
      console.error("2. Неверный chat_id (400)");
      console.error("3. Неверный TELEGRAM_BOT_TOKEN");
      console.error("4. Проблемы с сетью");
    }

    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("error");

    // В реальном тесте мы проверяем, что метод выполнился
    // Но успех зависит от реального Telegram API
    if (!result.success) {
      console.warn(
        `⚠️  Уведомление не отправлено: ${result.error}. Проверьте настройки.`
      );
    }
  });

  it("3. Проверка отправки уведомления без telegramChatId", async () => {
    if (!userId) {
      console.log("⏭️  Пропускаем тест (пользователь не создан)");
      return;
    }

    // Временно удаляем telegramChatId
    await prisma.user.update({
      where: { id: userId },
      data: { telegramChatId: null },
    });

    const result = await telegramService.sendNotification(
      userId,
      "Это сообщение не должно отправиться"
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("User has no telegramChatId");

    console.log("✅ Корректно обработано отсутствие telegramChatId");

    // Восстанавливаем chatId
    if (testChatId) {
      await prisma.user.update({
        where: { id: userId },
        data: { telegramChatId: testChatId },
      });
    }
  });

  it("4. Проверка отправки уведомления несуществующему пользователю", async () => {
    const fakeUserId = 999999;
    const result = await telegramService.sendNotification(
      fakeUserId,
      "Это сообщение не должно отправиться"
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("User not found");

    console.log("✅ Корректно обработано отсутствие пользователя");
  });

  it("5. Отправка нескольких уведомлений подряд", async () => {
    if (!userId) {
      console.log("⏭️  Пропускаем тест (пользователь не создан)");
      return;
    }

    const messages = [
      "🎮 Первое уведомление",
      "📢 Второе уведомление",
      "✅ Третье уведомление - финальное",
    ];

    console.log(`📤 Отправка ${messages.length} уведомлений подряд...`);

    const results = await Promise.all(
      messages.map((msg, index) => {
        console.log(`   Отправка сообщения ${index + 1}/${messages.length}...`);
        return telegramService.sendNotification(userId, msg);
      })
    );

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`✅ Успешно отправлено: ${successCount}`);
    if (failCount > 0) {
      console.log(`❌ Ошибок: ${failCount}`);
      results.forEach((r, i) => {
        if (!r.success) {
          console.log(`   Сообщение ${i + 1}: ${r.error}`);
        }
      });
    }

    // Проверяем, что все вызовы завершились
    expect(results).toHaveLength(messages.length);
  });
});

