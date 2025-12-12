import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export interface ValidationErrorResponse {
  message?: string;
  data?: {
    [fieldName: string]: string[];
  };
}

function formatZodError(
  error: ZodError,
  logger?: { debug: (obj: any, msg: string) => void }
): ValidationErrorResponse {
  const data: { [fieldName: string]: string[] } = {};

  // ZodError использует свойство 'issues', а не 'errors'
  const issues = error.issues || [];

  if (logger) {
    logger.debug(
      {
        hasIssues: !!error.issues,
        issuesLength: error.issues?.length,
        issuesType: typeof error.issues,
        issuesIsArray: Array.isArray(error.issues),
      },
      "Checking ZodError structure"
    );
  }

  // Проверяем, что issues существует и это непустой массив
  if (!issues || !Array.isArray(issues) || issues.length === 0) {
    if (logger) {
      logger.debug(
        {
          error,
          issues,
          issuesType: typeof issues,
          issuesIsArray: Array.isArray(issues),
          errorKeys: Object.keys(error),
        },
        "ZodError has no issues array or it's empty"
      );
    }
    return {
      message: "Validation error",
      data: {},
    };
  }

  if (logger) {
    logger.debug(
      { issues, issuesCount: issues.length },
      "Formatting ZodError with issues"
    );
  }

  issues.forEach((issue) => {
    const path =
      issue.path && Array.isArray(issue.path) ? issue.path.join(".") : "";
    const fieldName = path || "root";

    if (logger) {
      logger.debug(
        { path, fieldName, message: issue.message, code: issue.code },
        "Processing validation error"
      );
    }

    if (!data[fieldName]) {
      data[fieldName] = [];
    }

    data[fieldName].push(issue.message || "Invalid value");
  });

  if (logger) {
    logger.debug({ data }, "Formatted validation data");
  }

  // Всегда возвращаем data с полями, если были ошибки
  return {
    message: "Validation error",
    data: Object.keys(data).length > 0 ? data : {},
  };
}

function formatFastifyValidationError(
  error: FastifyError
): ValidationErrorResponse {
  const data: { [fieldName: string]: string[] } = {};

  if (error.validation && Array.isArray(error.validation)) {
    error.validation.forEach((validationError) => {
      const missingProperty =
        validationError.params &&
        typeof validationError.params === "object" &&
        "missingProperty" in validationError.params
          ? String(validationError.params.missingProperty)
          : undefined;

      const fieldName = validationError.instancePath
        ? validationError.instancePath.replace(/^\//, "")
        : missingProperty || "root";

      if (!data[fieldName]) {
        data[fieldName] = [];
      }

      const message =
        validationError.message || `Invalid value for ${fieldName}`;
      data[fieldName].push(message);
    });
  }

  return {
    message: error.message || "Validation error",
    data: Object.keys(data).length > 0 ? data : {},
  };
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Логируем все ошибки для отладки
  request.log.debug(
    {
      errorName: error.name,
      errorCode: error.code,
      errorMessage: error.message,
      errorStatus: error.statusCode,
      hasCause: !!error.cause,
      causeType: error.cause?.constructor?.name,
      isZodError: error.cause instanceof ZodError,
      hasValidation: !!error.validation,
    },
    "Error handler called"
  );

  // Проверка ValidationError по имени (наш кастомный класс) - ПЕРВЫМ!
  // Проверяем и по name, и по code, и по наличию cause с ZodError
  const isValidationError =
    (error.name === "ValidationError" || error.code === "VALIDATION_ERROR") &&
    (error as any).cause instanceof ZodError;

  if (isValidationError) {
    try {
      const zodError = (error as any).cause as ZodError;
      request.log.debug(
        {
          errorName: error.name,
          errorCode: error.code,
          zodIssues: zodError.issues,
          zodIssuesLength: zodError.issues?.length,
        },
        "Processing ValidationError with ZodError cause"
      );
      const formatted = formatZodError(zodError, request.log);
      request.log.debug({ formatted }, "Formatted ValidationError");
      return reply.status(400).send(formatted);
    } catch (formatError) {
      request.log.error(
        { error: formatError, originalError: error },
        "Error formatting ValidationError"
      );
    }
  }

  // Обработка ошибок Zod (через ValidationError или напрямую)
  if (error.cause instanceof ZodError) {
    try {
      request.log.debug(
        {
          errorName: error.name,
          errorCode: error.code,
          zodIssues: error.cause.issues,
          zodIssuesLength: error.cause.issues?.length,
        },
        "Processing Zod error from cause"
      );
      const formatted = formatZodError(error.cause, request.log);
      request.log.debug({ formatted }, "Formatted Zod error");
      return reply.status(400).send(formatted);
    } catch (formatError) {
      request.log.error(
        { error: formatError, originalError: error },
        "Error formatting Zod error"
      );
    }
  }

  // Проверка, является ли сама ошибка ZodError (на случай прямого throw)
  if (error instanceof ZodError) {
    try {
      const formatted = formatZodError(error, request.log);
      request.log.debug({ formatted, zodError: error }, "Formatting Zod error");
      return reply.status(400).send(formatted);
    } catch (formatError) {
      request.log.error(
        { error: formatError, originalError: error },
        "Error formatting Zod error"
      );
    }
  }

  // Обработка ошибок валидации Fastify (JSON Schema)
  if (
    error.statusCode === 400 &&
    error.validation &&
    Array.isArray(error.validation)
  ) {
    try {
      const formatted = formatFastifyValidationError(error);
      request.log.debug(
        { formatted, validation: error.validation },
        "Formatting Fastify validation error"
      );
      return reply.status(400).send(formatted);
    } catch (formatError) {
      request.log.error(
        { error: formatError, originalError: error },
        "Error formatting Fastify validation error"
      );
    }
  }

  // Обработка других ошибок
  const statusCode = error.statusCode || 500;

  // В продакшене не раскрываем детали внутренних ошибок
  const isProduction = process.env.NODE_ENV === "production";
  let message = "Internal server error";

  // Логируем ошибки на правильном уровне
  if (statusCode >= 500) {
    // Критические ошибки сервера - всегда error
    request.log.error(
      {
        errorName: error.name,
        errorCode: error.code,
        errorMessage: error.message,
        errorStack: error.stack,
        statusCode,
        url: request.url,
        method: request.method,
      },
      "Internal server error"
    );
  } else if (statusCode >= 400) {
    // Ошибки клиента (4xx) - warn для мониторинга подозрительной активности
    request.log.warn(
      {
        errorName: error.name,
        errorCode: error.code,
        errorMessage: error.message,
        statusCode,
        url: request.url,
        method: request.method,
      },
      "Client error"
    );
  }

  if (!isProduction) {
    // В разработке показываем детали ошибки
    message = error.message || "Internal server error";
  }

  reply.status(statusCode).send({
    message,
    ...(statusCode === 500 && !isProduction
      ? { error: error.message, stack: error.stack }
      : {}),
  });
}
