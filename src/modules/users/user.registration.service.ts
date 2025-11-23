import { ApplicationService } from "../applications/application.service";
import type { UserRegistrationPayload } from "./user.schema";
import { UserService } from "./user.service";

export class UserRegistrationService {
  constructor(
    private readonly userService = new UserService(),
    private readonly applicationService = new ApplicationService()
  ) {}

  async registerForTournament(payload: UserRegistrationPayload) {
    const user = await this.userService.getOrCreate({
      telegramId: payload.telegramId,
      username: payload.username,
      discordUsername: payload.discordUsername,
    });

    console.log(payload, "payload");

    return this.applicationService.createApplication({
      userId: user.id,
      tournamentId: payload.tournamentId,
      mmr: payload.mmr,
      gameRoles: payload.gameRoles,
      nickname: payload.nickname,
    });
  }
}
