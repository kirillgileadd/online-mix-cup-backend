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
  required: [
    "id",
    "userId",
    "tournamentId",
    "nickname",
    "mmr",
    "gameRoles",
    "chillZoneValue",
    "lives",
    "status",
    "createdAt",
  ],
  properties: {
    id: integerSchema,
    userId: integerSchema,
    tournamentId: integerSchema,
    nickname: { type: "string" },
    mmr: { type: "integer" },
    gameRoles: { type: "string" },
    seed: { type: ["integer", "null"] },
    score: { type: ["integer", "null"] },
    chillZoneValue: { type: "integer" },
    lives: { type: "integer" },
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

export const participationSchema = {
  type: "object",
  required: ["id", "lobbyId", "playerId", "isCaptain"],
  properties: {
    id: integerSchema,
    lobbyId: integerSchema,
    playerId: integerSchema,
    team: { type: ["integer", "null"] },
    isCaptain: { type: "boolean" },
    pickedAt: { type: ["string", "null"], format: "date-time" },
    result: {
      type: ["string", "null"],
      enum: ["WIN", "LOSS", "NONE", null],
    },
    player: {
      type: ["object", "null"],
      properties: {
        id: integerSchema,
        userId: integerSchema,
        tournamentId: integerSchema,
        nickname: { type: "string" },
        mmr: { type: "integer" },
        gameRoles: { type: "string" },
        seed: { type: ["integer", "null"] },
        score: { type: ["integer", "null"] },
        chillZoneValue: { type: "integer" },
        lives: { type: "integer" },
        status: { type: "string", enum: ["active", "eliminated"] },
        createdAt: { type: "string", format: "date-time" },
        user: {
          type: ["object", "null"],
          properties: {
            id: integerSchema,
            telegramId: { type: "string" },
            username: { type: ["string", "null"] },
            photoUrl: { type: ["string", "null"] },
            discordUsername: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
};

export const lobbySchema = {
  type: "object",
  required: ["id", "round", "status", "createdAt"],
  properties: {
    id: integerSchema,
    round: { type: "integer" },
    status: {
      type: "string",
      enum: ["PENDING", "DRAFTING", "PLAYING", "FINISHED"],
    },
    tournamentId: { type: ["integer", "null"] },
    createdAt: { type: "string", format: "date-time" },
    participations: {
      type: "array",
      items: participationSchema,
    },
  },
};
