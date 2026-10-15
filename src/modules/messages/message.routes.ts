import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { created, idParam, ok, paginationQuery, userId } from "../../utils/response";
import { messageService } from "./message.service";

const router = Router();
router.use(requireAuth);

const startSchema = z.object({ username: z.string().trim().min(1) });
const sendSchema = z.object({ text: z.string().trim().min(1, "Message cannot be empty").max(1000) });

router.get("/conversations", async (req, res) => {
  ok(res, await messageService.conversations(userId(req)));
});

router.post("/conversations", validate({ body: startSchema }), async (req, res) => {
  ok(res, await messageService.start(userId(req), req.body.username));
});

router.get("/conversations/:id/messages", validate({ params: idParam, query: paginationQuery }), async (req, res) => {
  const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };
  const { items, nextCursor } = await messageService.messages(req.params.id as string, userId(req), cursor, limit);
  ok(res, items, { nextCursor });
});

router.post("/conversations/:id/messages", validate({ params: idParam, body: sendSchema }), async (req, res) => {
  created(res, await messageService.send(req.params.id as string, userId(req), req.body.text));
});

export default router;
