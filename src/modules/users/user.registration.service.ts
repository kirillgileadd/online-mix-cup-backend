import { ApplicationService } from "../applications/application.service";
import { FileService } from "../files/file.service";
import type { UserRegistrationPayload } from "./user.schema";
import { UserService } from "./user.service";

export class UserRegistrationService {
  constructor(
    private readonly userService = new UserService(),
    private readonly applicationService = new ApplicationService(),
    private readonly fileService = new FileService()
  ) {}

  async registerForTournament(payload: UserRegistrationPayload) {
    const user = await this.userService.getOrCreate({
      telegramId: payload.telegramId,
      username: payload.username,
      nickname: payload.nickname,
      discordUsername: payload.discordUsername,
    });

    // Обрабатываем receiptImageBase64 если он передан
    let receiptImageUrl: string | undefined;
    if (payload.receiptImageBase64) {
      const filePath = await this.fileService.saveBase64Image(
        payload.receiptImageBase64,
        `receipt_${user.id}_${payload.tournamentId}`
      );
      receiptImageUrl = this.fileService.getFileUrl(filePath);
    }

    return this.applicationService.createApplication({
      userId: user.id,
      tournamentId: payload.tournamentId,
      mmr: payload.mmr,
      gameRoles: payload.gameRoles,
      nickname: payload.nickname,
      dotabuff: payload.dotabuff,
      isPaid: payload.receiptImageBase64 ? true : false,
      receiptImageUrl,
    });
  }
}
