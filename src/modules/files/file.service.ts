import { writeFile, mkdir } from "fs/promises";
import { join, resolve, normalize } from "path";
import { existsSync } from "fs";

// Максимальный размер файла: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Разрешенные MIME типы
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

// Разрешенные расширения файлов
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

export class FileService {
  private readonly uploadsDir = "uploads";
  private readonly receiptsDir = join(this.uploadsDir, "receipts");

  constructor() {
    this.ensureDirectoriesExist();
  }

  private async ensureDirectoriesExist() {
    if (!existsSync(this.uploadsDir)) {
      await mkdir(this.uploadsDir, { recursive: true });
    }
    if (!existsSync(this.receiptsDir)) {
      await mkdir(this.receiptsDir, { recursive: true });
    }
  }

  /**
   * Валидирует base64 строку и определяет MIME тип
   */
  private validateBase64Image(base64Data: string): {
    mimeType: string;
    extension: string;
    base64String: string;
  } {
    // Убираем префикс data:image/...;base64, если он есть
    const base64String = base64Data.includes(",")
      ? base64Data.split(",")[1] ?? base64Data
      : base64Data;

    if (!base64String || base64String.trim().length === 0) {
      throw new Error("Invalid base64 data: empty string");
    }

    // Проверяем размер файла (приблизительно, base64 увеличивает размер на ~33%)
    const estimatedSize = (base64String.length * 3) / 4;
    if (estimatedSize > MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
      );
    }

    // Определяем MIME тип и расширение
    let mimeType: string | null = null;
    let extension = "jpg";

    if (base64Data.includes("data:image/")) {
      const mimeMatch = base64Data.match(/data:image\/(\w+);base64/);
      if (mimeMatch && mimeMatch[1]) {
        const detectedType = mimeMatch[1].toLowerCase();
        extension = detectedType === "jpeg" ? "jpg" : detectedType;
        mimeType = `image/${detectedType}`;
      }
    }

    // Проверяем, что MIME тип разрешен
    if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new Error(`MIME type ${mimeType} is not allowed`);
    }

    // Проверяем расширение
    if (!ALLOWED_EXTENSIONS.includes(`.${extension}`)) {
      throw new Error(`File extension .${extension} is not allowed`);
    }

    // Дополнительная проверка: декодируем и проверяем магические байты
    try {
      const buffer = Buffer.from(base64String, "base64");
      
      // Проверяем реальный размер после декодирования
      if (buffer.length > MAX_FILE_SIZE) {
        throw new Error(
          `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
        );
      }

      // Проверяем магические байты для определения реального типа файла
      const detectedMime = this.detectMimeTypeFromBuffer(buffer);
      if (detectedMime && !ALLOWED_MIME_TYPES.includes(detectedMime)) {
        throw new Error(
          `Detected file type ${detectedMime} does not match declared type or is not allowed`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("File size")) {
        throw error;
      }
      throw new Error("Invalid base64 data: cannot decode");
    }

    return {
      mimeType: mimeType || "image/jpeg",
      extension,
      base64String,
    };
  }

  /**
   * Определяет MIME тип по магическим байтам файла
   */
  private detectMimeTypeFromBuffer(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }

    // PNG: 89 50 4E 47
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return "image/png";
    }

    // GIF: 47 49 46 38
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
      return "image/gif";
    }

    // WebP: RIFF...WEBP
    if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }

    return null;
  }

  /**
   * Санитизирует имя файла для предотвращения path traversal
   */
  private sanitizeFilename(filename: string): string {
    // Удаляем опасные символы
    return filename
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/\.\./g, "") // Удаляем ..
      .replace(/^\./, "") // Удаляем ведущую точку
      .substring(0, 100); // Ограничиваем длину
  }

  /**
   * Сохраняет base64 изображение в файл
   * @param base64Data - строка base64 (может быть с префиксом data:image/...;base64,)
   * @param filename - имя файла (без расширения, будет добавлено автоматически)
   * @returns путь к сохраненному файлу относительно корня проекта
   */
  async saveBase64Image(base64Data: string, filename: string): Promise<string> {
    await this.ensureDirectoriesExist();

    // Валидируем и получаем данные
    const { extension, base64String } = this.validateBase64Image(base64Data);

    // Санитизируем имя файла
    const sanitizedFilename = this.sanitizeFilename(filename);

    // Генерируем уникальное имя файла с timestamp
    const timestamp = Date.now();
    const uniqueFilename = `${sanitizedFilename}_${timestamp}.${extension}`;
    const filePath = join(this.receiptsDir, uniqueFilename);

    // Проверяем, что путь находится внутри receiptsDir (защита от path traversal)
    const normalizedPath = normalize(resolve(filePath));
    const normalizedReceiptsDir = normalize(resolve(this.receiptsDir));
    if (!normalizedPath.startsWith(normalizedReceiptsDir)) {
      throw new Error("Invalid file path: path traversal detected");
    }

    // Декодируем base64 и сохраняем файл
    const buffer = Buffer.from(base64String, "base64");
    await writeFile(filePath, buffer);

    // Возвращаем путь относительно корня для URL
    return filePath.replace(/\\/g, "/");
  }

  /**
   * Получает URL для доступа к файлу
   * @param filePath - путь к файлу (относительно корня проекта)
   * @returns URL для доступа к файлу
   */
  getFileUrl(filePath: string): string {
    // Убираем обратные слеши и возвращаем путь для URL
    return `/${filePath.replace(/\\/g, "/")}`;
  }
}
