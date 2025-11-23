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

