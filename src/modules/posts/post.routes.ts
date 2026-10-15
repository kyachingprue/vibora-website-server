import { z } from "zod";
import { Router } from "express";
import { optionalAuth, requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { created, idParam, message, ok, paginationQuery, userId } from "../../utils/response";
import { createCommentSchema, createPostSchema, feedQuery } from "./post.schema";
import { postService } from "./post.service";

const router = Router();
type Page = { cursor?: string; limit: number };
const pid = (req: { params: Record<string, unknown> }) => req.params.id as string;

// ── feed ──
router.get("/", validate({ query: feedQuery }), optionalAuth, async (req, res) => {
  const q = req.query as unknown as Page & { scope: "all" | "following"; q?: string };
  const { items, nextCursor } = await postService.list({ viewerId: req.user?.id, ...q });
  ok(res, items, { nextCursor });
});

router.get("/trending", async (_req, res) => {
  ok(res, await postService.trending());
});

router.get("/bookmarks", requireAuth, validate({ query: paginationQuery }), async (req, res) => {
  const { cursor, limit } = req.query as unknown as Page;
  const { items, nextCursor } = await postService.bookmarks(userId(req), cursor, limit);
  ok(res, items, { nextCursor });
});

router.post("/", requireAuth, validate({ body: createPostSchema }), async (req, res) => {
  created(res, await postService.create(userId(req), req.body));
});

// ── single post ──
router.get("/:id", validate({ params: idParam }), optionalAuth, async (req, res) => {
  ok(res, await postService.get(pid(req), req.user?.id));
});

router.patch("/:id", requireAuth, validate({ params: idParam, body: z.object({ text: z.string().trim().max(500) }) }), async (req, res) => {
  ok(res, await postService.update(pid(req), userId(req), req.body.text));
});

router.delete("/:id", requireAuth, validate({ params: idParam }), async (req, res) => {
  await postService.remove(pid(req), userId(req));
  message(res, "Post deleted");
});

// ── reactions ──
router.post("/:id/like", requireAuth, validate({ params: idParam }), async (req, res) => {
  ok(res, await postService.like(pid(req), userId(req)));
});
router.delete("/:id/like", requireAuth, validate({ params: idParam }), async (req, res) => {
  ok(res, await postService.unlike(pid(req), userId(req)));
});
router.post("/:id/bookmark", requireAuth, validate({ params: idParam }), async (req, res) => {
  ok(res, await postService.bookmark(pid(req), userId(req)));
});
router.delete("/:id/bookmark", requireAuth, validate({ params: idParam }), async (req, res) => {
  ok(res, await postService.unbookmark(pid(req), userId(req)));
});
router.post("/:id/share", validate({ params: idParam }), async (req, res) => {
  ok(res, await postService.share(pid(req)));
});

// ── comments ──
router.get("/:id/comments", validate({ params: idParam, query: paginationQuery }), async (req, res) => {
  const { cursor, limit } = req.query as unknown as Page;
  const { items, nextCursor } = await postService.comments(pid(req), cursor, limit);
  ok(res, items, { nextCursor });
});

router.post("/:id/comments", requireAuth, validate({ params: idParam, body: createCommentSchema }), async (req, res) => {
  created(res, await postService.addComment(pid(req), userId(req), req.body.text, req.body.parentId));
});

export const commentRouter = Router();
commentRouter.delete("/:id", requireAuth, validate({ params: idParam }), async (req, res) => {
  await postService.removeComment(pid(req), userId(req));
  message(res, "Comment deleted");
});

export default router;
