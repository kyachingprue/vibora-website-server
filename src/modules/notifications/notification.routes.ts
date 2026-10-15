import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { idParam, message, ok, paginationQuery, userId } from "../../utils/response";
import { notificationService } from "./notification.service";

const router = Router();
router.use(requireAuth);

router.get("/", validate({ query: paginationQuery }), async (req, res) => {
  const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
  const { items, nextCursor } = await notificationService.list(userId(req), cursor, limit);
  ok(res, items, { nextCursor });
});

router.get("/unread-count", async (req, res) => {
  ok(res, { count: await notificationService.unreadCount(userId(req)) });
});

router.patch("/read-all", async (req, res) => {
  await notificationService.markAllRead(userId(req));
  message(res, "All notifications marked as read");
});

router.patch("/:id/read", validate({ params: idParam }), async (req, res) => {
  await notificationService.markRead(userId(req), req.params.id as string);
  message(res, "Notification marked as read");
});

router.delete("/:id", validate({ params: idParam }), async (req, res) => {
  await notificationService.deleteOne(userId(req), req.params.id as string);
  message(res, "Notification deleted");
});

router.delete("/", async (req, res) => {
  await notificationService.clear(userId(req));
  message(res, "Notifications cleared");
});

export default router;
