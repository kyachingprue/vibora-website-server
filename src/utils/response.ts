import type { Request, Response } from 'express'
import { z } from 'zod'
import { ApiError } from './ApiError'

/** Success envelope: { success: true, data, ...meta } */
export const ok = <T>(
  res: Response,
  data: T,
  meta: Record<string, unknown> = {},
  status = 200
) => res.status(status).json({ success: true, data, ...meta })

export const created = <T>(res: Response, data: T) => ok(res, data, {}, 201)

export const message = (res: Response, text: string, status = 200) =>
  res.status(status).json({ success: true, message: text })

/** Id of the logged-in user (set by requireAuth). Throws 401 if missing. */
export const userId = (req: Request): string => {
  if (!req.user) throw ApiError.unauthorized()
  return req.user.id
}

/** Shared ?cursor=&limit= query used by every paginated list. */
export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10)
})

/** Prisma args for cursor pagination (fetches one extra row to know if there is a next page). */
export const cursorArgs = (cursor: string | undefined, limit: number) => ({
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
})

/** Trims the extra row and returns { items, nextCursor }. */
export const toPage = <T extends { id: string }>(rows: T[], limit: number) => {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null
  }
}

export const idParam = z.object({ id: z.string().min(1) })
export const usernameParam = z.object({ username: z.string().min(1) })
