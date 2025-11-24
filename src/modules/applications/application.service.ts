import { ApplicationStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type { ApplicationPayload } from "./application.schema";

export class ApplicationService {
  createApplication(payload: ApplicationPayload) {
    return prisma.application.create({
      data: {
        ...payload,
        status: "pending",
      },
      include: {
        tournament: true,
      },
    });
  }

  listPendingApplications(tournamentId?: number) {
    return prisma.application.findMany({
      where: {
        status: "pending",
        ...(typeof tournamentId === "number" ? { tournamentId } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: true,
      },
    });
  }

  listApplications(tournamentId?: number) {
    return prisma.application.findMany({
      where: {
        ...(typeof tournamentId === "number" ? { tournamentId } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: true,
      },
    });
  }

  private updateStatus(id: number, status: ApplicationStatus) {
    return prisma.application.update({
      where: { id },
      data: { status },
    });
  }

  approveApplication(id: number) {
    return this.updateStatus(id, "approved");
  }

  rejectApplication(id: number) {
    return this.updateStatus(id, "rejected");
  }

  getApprovedApplicationsByTournament(tournamentId: number) {
    return prisma.application.findMany({
      where: {
        tournamentId,
        status: "approved",
      },
    });
  }
}
