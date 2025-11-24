FROM node:22-alpine AS base

WORKDIR /app

# Устанавливаем зависимости
COPY package.json package-lock.json ./
RUN npm ci

# Копируем исходники и Prisma схемы
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./

# Генерируем Prisma клиент и собираем проект
RUN npx prisma generate
RUN npm run build

# Продакшен-образ
FROM node:22-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

# Копируем зависимости и собранный код
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma
COPY package.json package-lock.json ./

EXPOSE 8000

CMD ["node", "dist/index.js"]

