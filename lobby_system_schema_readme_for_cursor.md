# Lobby matchmaking — Prisma schema + README (краткая версия для Cursor)

Документ включает:
- Сокращённую Prisma schema
- Краткое описание логики лобби, chill zone, драфта и жизней
- Архитектурную закладку под будущие турниры (группы, сетка)
- Prompt для Cursor для генерации приложения на Fastify + Prisma

---

## 1. Prisma schema (краткая)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Player {
  id            String   @id @default(cuid())
  username      String   @unique
  mmr           Int      @default(1000)
  lives         Int      @default(3)
  chillPriority Int      @default(0)
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  participations Participation[]
}

model Tournament {
  id        String   @id @default(cuid())
  name      String
  status    TournamentStatus @default(PLANNED)
  config    Json?
  createdAt DateTime @default(now())

  players TournamentPlayer[]
  lobbies Lobby[]
}

enum TournamentStatus {
  PLANNED
  GROUP_STAGE
  PLAYOFF
  FINISHED
}

model TournamentPlayer {
  id           String   @id @default(cuid())
  tournament   Tournament @relation(fields: [tournamentId], references: [id])
  tournamentId String

  player     Player   @relation(fields: [playerId], references: [id])
  playerId   String

  mmr        Int      @default(1000)
  lives      Int      @default(3)
  active     Boolean  @default(true)
  group      String?

  participations Participation[]
}

model Lobby {
  id            String   @id @default(cuid())
  round         Int
  status        LobbyStatus @default(PENDING)
  createdAt     DateTime @default(now())

  tournament   Tournament? @relation(fields: [tournamentId], references: [id])
  tournamentId String?

  participations Participation[]
}

enum LobbyStatus {
  PENDING
  DRAFTING
  PLAYING
  FINISHED
}

model Participation {
  id          String   @id @default(cuid())

  lobby       Lobby    @relation(fields: [lobbyId], references: [id])
  lobbyId     String

  tournamentPlayer TournamentPlayer? @relation(fields: [tournamentPlayerId], references: [id])
  tournamentPlayerId String?

  player      Player  @relation(fields: [playerId], references: [id])
  playerId    String

  team        Int?
  isCaptain   Boolean @default(false)
  pickedAt    DateTime?
  result      ParticipationResult?

  @@unique([playerId, lobbyId])
}

enum ParticipationResult {
  WIN
  LOSS
  NONE
}
```

---

## 2. Логика приложения (кратко)

### Лобби
1. Берём всех игроков с `active=true` и `lives >= 0`.
2. Сортируем по:
   - `chillPriority` desc
   - `mmr` desc
3. Формируем группы по 10 человек.
4. Оставшиеся → chill zone: `chillPriority += 1`.
5. Попавшие в лобби: `chillPriority = 0`.

### Капитаны
- 2 игрока с самым высоким `mmr`.
- Получают `isCaptain=true`.

### Драфт
- Очередность выбора: капитан с большим MMR начинает.
- При выборе: выставляется `team`, `pickedAt`.

### Матч
- После результата у проигравших `lives -= 1`.
- Лобби получает статус `FINISHED`.
- Игроки с `lives < 0` больше не попадают в лобби.

---

## 3. Расширение под турниры (кратко)

Archi-закладка для будущего:
- `Tournament` — сущность турнира.
- `TournamentPlayer` — привязка игроков к турниру (отдельные mmr/lives, группы).
- `Lobby` привязывается к турниру.
- Позже можно добавить:
  - групповой этап через `group`
  - сетку через таблицу `BracketMatch`

Текущая логика лобби независима от турниров, но структура данных позволяет плавно добавить турнирные режимы.

---

## 4. Prompt для Cursor

**Сгенерировать backend-приложение на Fastify + Prisma.**

Функциональность:
1. CRUD игроков.
2. Генерация лобби по описанному алгоритму.
3. Определение капитанов и драфт.
4. Проставление результатов матчей.
5. Система жизней (`lives`).
6. Chill zone с приоритетом (`chillPriority`).
7. Структуры для будущих турниров (`Tournament`, `TournamentPlayer`).
8. Эндпоинты:
   - POST `/players`
   - POST `/generate-lobbies`
   - POST `/draft-pick`
   - POST `/finish-lobby`
   - POST `/tournaments`

Требования:
- TypeScript, Fastify, Prisma.
- Валидация запросов.
- Идемпотентность `/finish-lobby`.
- Код должен быть модульным: отдельный модуль генерации лобби.

*Конец документа.*

