import type { NotificationType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { cursorArgs, toPage } from "../../utils/response";

export const actorSelect = { id: true, name: true, username: true, avatar: true } as const;

/** Creates a notification, skipping self-notifications (liking your own post, etc.). */
export async function notify(input: { recipientId: string; actorId: string; type: NotificationType; postId?: string }) {
  if (input.recipientId === input.actorId) return;
  await prisma.notification.create({ data: input });
}

export const notificationService = {
  async list(userId: string, cursor: string | undefined, limit: number) {
    const rows = await prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { actor: { select: actorSelect }, post: { select: { id: true, text: true, image: true } } },
      ...cursorArgs(cursor, limit),
    });
    return toPage(rows, limit);
  },

  unreadCount: (userId: string) => prisma.notification.count({ where: { recipientId: userId, read: false } }),

  markAllRead: (userId: string) =>
    prisma.notification.updateMany({ where: { recipientId: userId, read: false }, data: { read: true } }),

  markRead: (userId: string, id: string) =>
    prisma.notification.updateMany({ where: { id, recipientId: userId }, data: { read: true } }),

  deleteOne: (userId: string, id: string) => prisma.notification.deleteMany({ where: { id, recipientId: userId } }),

  clear: (userId: string) => prisma.notification.deleteMany({ where: { recipientId: userId } }),
};
