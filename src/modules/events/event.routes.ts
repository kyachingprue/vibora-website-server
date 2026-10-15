import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { optionalAuth, requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { created, idParam, message, ok, userId } from "../../utils/response";

const router = Router();

const createSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(1000).default(""),
  location: z.string().trim().min(2).max(100),
  startsAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), "Event must be in the future"),
  cover: z.url().optional(),
});

const withCounts = (viewerId?: string) => ({
  _count: { select: { attendees: true } },
  attendees: { where: { userId: viewerId ?? "" }, select: { userId: true }, take: 1 },
});

const toDto = (e: {
  id: string; title: string; description: string; cover: string | null; location: string; startsAt: Date;
  _count: { attendees: number }; attendees: unknown[];
}) => ({
  id: e.id, title: e.title, description: e.description, cover: e.cover, location: e.location, startsAt: e.startsAt,
  goingCount: e._count.attendees, going: e.attendees.length > 0,
});

router.get("/", optionalAuth, async (req, res) => {
  const rows = await prisma.event.findMany({
    where: { startsAt: { gte: new Date() } }, // upcoming only
    orderBy: { startsAt: "asc" },
    include: withCounts(req.user?.id),
  });
  ok(res, rows.map(toDto));
});

router.post("/", requireAuth, validate({ body: createSchema }), async (req, res) => {
  const event = await prisma.event.create({ data: req.body, include: withCounts(userId(req)) });
  created(res, toDto(event));
});

router.post("/:id/going", requireAuth, validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  if (!(await prisma.event.findUnique({ where: { id }, select: { id: true } }))) throw ApiError.notFound("Event not found");
  await prisma.eventAttendee.createMany({ data: [{ eventId: id, userId: userId(req) }], skipDuplicates: true });
  message(res, "You are going");
});

router.delete("/:id/going", requireAuth, validate({ params: idParam }), async (req, res) => {
  await prisma.eventAttendee.deleteMany({ where: { eventId: req.params.id as string, userId: userId(req) } });
  message(res, "No longer going");
});

export default router;
