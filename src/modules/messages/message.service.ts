import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { cursorArgs, toPage } from "../../utils/response";
import { actorSelect } from "../notifications/notification.service";

async function assertMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { userId: true },
  });
  if (!member) throw ApiError.notFound("Conversation not found");
}

export const messageService = {
  async conversations(userId: string) {
    const rows = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      include: {
        members: { where: { userId: { not: userId } }, include: { user: { select: actorSelect } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      user: c.members[0]?.user ?? null,
      lastMessage: c.messages[0] ?? null,
      updatedAt: c.updatedAt,
    }));
  },

  /** Finds the 1-to-1 conversation with `username`, or creates it. */
  async start(userId: string, username: string) {
    const target = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!target) throw ApiError.notFound("User not found");
    if (target.id === userId) throw ApiError.badRequest("You cannot message yourself");

    const existing = await prisma.conversation.findFirst({
      where: { AND: [{ members: { some: { userId } } }, { members: { some: { userId: target.id } } }] },
      select: { id: true },
    });
    if (existing) return existing;

    return prisma.conversation.create({
      data: { members: { create: [{ userId }, { userId: target.id }] } },
      select: { id: true },
    });
  },

  async messages(conversationId: string, userId: string, cursor: string | undefined, limit: number) {
    await assertMember(conversationId, userId);
    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorArgs(cursor, limit),
    });
    return toPage(rows, limit); // newest first — the client can reverse for display
  },

  async send(conversationId: string, userId: string, text: string) {
    await assertMember(conversationId, userId);
    const [message] = await prisma.$transaction([
      prisma.message.create({ data: { conversationId, senderId: userId, text } }),
      prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ]);
    return message;
  },
};
