import { ZodError } from "zod";
import { FastifyError } from "fastify";

export class ValidationError extends Error implements FastifyError {
  statusCode = 400;
  code = "VALIDATION_ERROR";
  cause: ZodError;

  constructor(error: ZodError) {
    super("Validation error");
    this.name = "ValidationError";
    this.cause = error;
  }
}

export function parseWithValidation<T>(
  schema: { parse: (data: unknown) => T },
  data: unknown
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(error);
    }
    throw error;
  }
}

/**
 * Санитизирует строку для предотвращения XSS и других атак
 * Удаляет опасные символы и паттерны
 */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(/[<>]/g, "") // Удаляем < и > для предотвращения XSS
    .replace(/javascript:/gi, "") // Удаляем javascript: протокол
    .replace(/on\w+=/gi, "") // Удаляем обработчики событий (onclick=, onerror= и т.д.)
    .trim();
}

/**
 * Санитизирует объект, рекурсивно обрабатывая все строковые значения
 */
export function sanitizeObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return sanitizeString(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as T;
  }

  if (obj !== null && typeof obj === "object") {
    const sanitized = {} as T;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Проверяет, что значение является безопасным целым числом
 */
export function safeParseInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

