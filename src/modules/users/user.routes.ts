import { Router } from "express";
import { optionalAuth, requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { message, ok, paginationQuery, userId, usernameParam } from "../../utils/response";
import { postService } from "../posts/post.service";
import { feedQuery } from "../posts/post.schema";
import { searchUsersQuery, updateProfileSchema } from "./user.schema";
import { userService } from "./user.service";

const router = Router();
type Page = { cursor?: string; limit: number };

// NOTE: fixed paths (/search, /suggestions, /me) must come before "/:username"
router.get("/search", validate({ query: searchUsersQuery }), async (req, res) => {
  ok(res, await userService.search((req.query as { q: string }).q));
});

router.get("/suggestions", requireAuth, async (req, res) => {
  ok(res, await userService.suggestions(userId(req)));
});

router.patch("/me", requireAuth, validate({ body: updateProfileSchema }), async (req, res) => {
  ok(res, await userService.updateMe(userId(req), req.body));
});

router.get("/:username", validate({ params: usernameParam }), optionalAuth, async (req, res) => {
  ok(res, await userService.getProfile(req.params.username as string, req.user?.id));
});

router.get("/:username/posts", validate({ params: usernameParam, query: feedQuery }), optionalAuth, async (req, res) => {
  const { cursor, limit } = req.query as unknown as Page;
  const { items, nextCursor } = await postService.list({
    viewerId: req.user?.id,
    username: (req.params.username as string).toLowerCase(),
    cursor,
    limit,
  });
  ok(res, items, { nextCursor });
});

router.get("/:username/followers", validate({ params: usernameParam, query: paginationQuery }), async (req, res) => {
  const { cursor, limit } = req.query as unknown as Page;
  const { items, nextCursor } = await userService.followers(req.params.username as string, cursor, limit);
  ok(res, items, { nextCursor });
});

router.get("/:username/following", validate({ params: usernameParam, query: paginationQuery }), async (req, res) => {
  const { cursor, limit } = req.query as unknown as Page;
  const { items, nextCursor } = await userService.following(req.params.username as string, cursor, limit);
  ok(res, items, { nextCursor });
});

router.post("/:username/follow", requireAuth, validate({ params: usernameParam }), async (req, res) => {
  await userService.follow(userId(req), req.params.username as string);
  message(res, "Followed");
});

router.delete("/:username/follow", requireAuth, validate({ params: usernameParam }), async (req, res) => {
  await userService.unfollow(userId(req), req.params.username as string);
  message(res, "Unfollowed");
});

export default router;
