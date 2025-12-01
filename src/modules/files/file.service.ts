import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

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
   * Сохраняет base64 изображение в файл
   * @param base64Data - строка base64 (может быть с префиксом data:image/...;base64,)
   * @param filename - имя файла (без расширения, будет добавлено автоматически)
   * @returns путь к сохраненному файлу относительно корня проекта
   */
  async saveBase64Image(base64Data: string, filename: string): Promise<string> {
    await this.ensureDirectoriesExist();

    // Убираем префикс data:image/...;base64, если он есть
    const base64String = base64Data.includes(",")
      ? base64Data.split(",")[1] ?? base64Data
      : base64Data;

    if (!base64String) {
      throw new Error("Invalid base64 data");
    }

    // Определяем расширение файла из base64 или используем jpg по умолчанию
    let extension = "jpg";
    if (base64Data.includes("data:image/")) {
      const mimeMatch = base64Data.match(/data:image\/(\w+);base64/);
      if (mimeMatch && mimeMatch[1]) {
        extension = mimeMatch[1];
        // Нормализуем расширения
        if (extension === "jpeg") extension = "jpg";
      }
    }

    // Генерируем уникальное имя файла с timestamp
    const timestamp = Date.now();
    const uniqueFilename = `${filename}_${timestamp}.${extension}`;
    const filePath = join(this.receiptsDir, uniqueFilename);

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
