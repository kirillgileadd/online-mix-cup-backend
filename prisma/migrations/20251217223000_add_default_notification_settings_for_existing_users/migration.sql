-- Добавляем дефолтные настройки уведомлений для всех существующих пользователей,
-- у которых еще нет записей в NotificationSettings
INSERT INTO "NotificationSettings" ("userId", "isTelegramNotifications", "isSSENotifications", "notificationsVolume", "createdAt", "updatedAt")
SELECT 
    "id" as "userId",
    true as "isTelegramNotifications",
    true as "isSSENotifications",
    5 as "notificationsVolume",
    CURRENT_TIMESTAMP as "createdAt",
    CURRENT_TIMESTAMP as "updatedAt"
FROM "User"
WHERE "id" NOT IN (
    SELECT "userId" FROM "NotificationSettings"
);

