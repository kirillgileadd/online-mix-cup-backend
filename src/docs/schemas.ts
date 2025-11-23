const integerSchema = {
  type: "integer",
};

export const userSchema = {
  type: "object",
  required: ["id", "telegramId", "createdAt"],
  properties: {
    id: integerSchema,
    telegramId: { type: "string" },
    username: { type: ["string", "null"] },
    photoUrl: { type: ["string", "null"] },
    discordUsername: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    roles: {
      type: "array",
      items: { type: "string" },
      default: [],
    },
  },
};

export const applicationSchema = {
  type: "object",
  required: [
    "id",
    "userId",
    "tournamentId",
    "mmr",
    "gameRoles",
    "nickname",
    "status",
    "createdAt",
  ],
  properties: {
    id: integerSchema,
    userId: integerSchema,
    tournamentId: integerSchema,
    mmr: { type: "integer" },
    gameRoles: { type: "string" },
    nickname: { type: "string" },
    status: { type: "string", enum: ["pending", "approved", "rejected"] },
    createdAt: { type: "string", format: "date-time" },
    user: userSchema,
  },
};

export const tournamentSchema = {
  type: "object",
  required: ["id", "name", "status", "price", "createdAt"],
  properties: {
    id: integerSchema,
    name: { type: "string" },
    status: {
      type: "string",
      enum: ["draft", "collecting", "running", "finished"],
    },
    eventDate: { type: ["string", "null"] },
    price: { type: "integer" },
    prizePool: { type: ["integer", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
};

export const applicationWithTournamentSchema = {
  type: "object",
  required: [
    "id",
    "userId",
    "tournamentId",
    "mmr",
    "gameRoles",
    "nickname",
    "status",
    "createdAt",
    "tournament",
  ],
  properties: {
    id: integerSchema,
    userId: integerSchema,
    tournamentId: integerSchema,
    mmr: { type: "integer" },
    gameRoles: { type: "string" },
    nickname: { type: "string" },
    status: { type: "string", enum: ["pending", "approved", "rejected"] },
    createdAt: { type: "string", format: "date-time" },
    tournament: tournamentSchema,
  },
};

export const playerSchema = {
  type: "object",
  required: ["id", "userId", "tournamentId", "status", "createdAt"],
  properties: {
    id: integerSchema,
    userId: integerSchema,
    tournamentId: integerSchema,
    seed: { type: ["integer", "null"] },
    score: { type: ["integer", "null"] },
    status: { type: "string", enum: ["active", "eliminated"] },
    createdAt: { type: "string", format: "date-time" },
    user: userSchema,
  },
};

export const errorResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    data: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
};

export const roleSchema = {
  type: "object",
  required: ["id", "name", "createdAt"],
  properties: {
    id: integerSchema,
    name: { type: "string" },
    description: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
};

export const tokenPairSchema = {
  type: "object",
  required: ["accessToken", "tokenType", "expiresIn", "roles"],
  properties: {
    accessToken: { type: "string" },
    tokenType: { type: "string", enum: ["Bearer"] },
    expiresIn: { type: "integer" },
    roles: {
      type: "array",
      items: { type: "string" },
    },
    user: {
      type: "object",
      properties: {
        username: { type: ["string", "null"] },
        photoUrl: { type: ["string", "null"] },
      },
    },
  },
};
