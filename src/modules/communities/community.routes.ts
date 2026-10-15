import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { optionalAuth, requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { created, idParam, message, ok, userId } from "../../utils/response";

const router = Router();

const createSchema = z.object({
  name: z.string().trim().min(3).max(60),
  about: z.string().trim().max(300).default(""),
  cover: z.url().optional(),
});

const withCounts = (viewerId?: string) => ({
  _count: { select: { members: true } },
  members: { where: { userId: viewerId ?? "" }, select: { userId: true }, take: 1 },
});

const toDto = (c: {
  id: string; name: string; about: string; cover: string | null;
  _count: { members: number }; members: unknown[];
}) => ({ id: c.id, name: c.name, about: c.about, cover: c.cover, membersCount: c._count.members, joined: c.members.length > 0 });

router.get("/", optionalAuth, async (req, res) => {
  const rows = await prisma.community.findMany({
    orderBy: { members: { _count: "desc" } },
    include: withCounts(req.user?.id),
  });
  ok(res, rows.map(toDto));
});

router.post("/", requireAuth, validate({ body: createSchema }), async (req, res) => {
  const community = await prisma.community.create({
    data: { ...req.body, members: { create: { userId: userId(req) } } }, // creator joins automatically
    include: withCounts(userId(req)),
  });
  created(res, toDto(community));
});

const exists = async (id: string) => {
  if (!(await prisma.community.findUnique({ where: { id }, select: { id: true } }))) throw ApiError.notFound("Community not found");
};

router.post("/:id/join", requireAuth, validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await exists(id);
  await prisma.communityMember.createMany({ data: [{ communityId: id, userId: userId(req) }], skipDuplicates: true });
  message(res, "Joined community");
});

router.delete("/:id/join", requireAuth, validate({ params: idParam }), async (req, res) => {
  await prisma.communityMember.deleteMany({ where: { communityId: req.params.id as string, userId: userId(req) } });
  message(res, "Left community");
});

export default router;
