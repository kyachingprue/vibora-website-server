import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'
import { cursorArgs, toPage } from '../../utils/response'
import {
  deleteVideo,
  verifyUploadedVideo,
  videoThumbnailUrl
} from '../../lib/cloudinary'
import { actorSelect, notify } from '../notifications/notification.service'

/** What to load for every post. `viewerId` powers the liked / bookmarked flags. */
const postInclude = (viewerId?: string) =>
  ({
    author: { select: actorSelect },
    _count: { select: { likes: true, comments: true } },
    likes: {
      where: { userId: viewerId ?? '' },
      select: { userId: true },
      take: 1
    },
    bookmarks: {
      where: { userId: viewerId ?? '' },
      select: { userId: true },
      take: 1
    }
  }) satisfies Prisma.PostInclude

type PostRow = Prisma.PostGetPayload<{
  include: ReturnType<typeof postInclude>
}>

export const toPostDto = (p: PostRow) => ({
  id: p.id,
  text: p.text,
  image: p.image,
  video:
    p.video && p.videoPublicId
      ? {
          url: p.video,
          thumbnail: videoThumbnailUrl(p.videoPublicId),
          duration: p.videoDuration
        }
      : null,
  createdAt: p.createdAt,
  author: p.author,
  likesCount: p._count.likes,
  commentsCount: p._count.comments,
  sharesCount: p.shares,
  liked: p.likes.length > 0,
  bookmarked: p.bookmarks.length > 0
})

const orderBy = [
  { createdAt: 'desc' },
  { id: 'desc' }
] satisfies Prisma.PostOrderByWithRelationInput[]

async function assertPost(id: string) {
  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, authorId: true }
  })
  if (!post) throw ApiError.notFound('Post not found')
  return post
}

/** "hi @sara and @liam" -> notify sara and liam */
async function notifyMentions(text: string, actorId: string, postId: string) {
  const names = [
    ...new Set(
      [...text.matchAll(/@([a-z0-9_]{3,20})/gi)].map(m => m[1]!.toLowerCase())
    )
  ]
  if (names.length === 0) return
  const users = await prisma.user.findMany({
    where: { username: { in: names } },
    select: { id: true }
  })
  await Promise.all(
    users.map(u =>
      notify({ recipientId: u.id, actorId, type: 'MENTION', postId })
    )
  )
}

export const postService = {
  async list(opts: {
    viewerId?: string
    cursor?: string
    limit: number
    scope?: 'all' | 'following'
    q?: string
    username?: string
  }) {
    const { viewerId, cursor, limit, scope, q, username } = opts

    const where: Prisma.PostWhereInput = {
      ...(username && { author: { username } }),
      ...(scope === 'following' &&
        viewerId && {
          author: { followers: { some: { followerId: viewerId } } }
        }),
      ...(q && {
        OR: [
          { text: { contains: q, mode: 'insensitive' } },
          { author: { username: { contains: q, mode: 'insensitive' } } },
          { author: { name: { contains: q, mode: 'insensitive' } } }
        ]
      })
    }

    const rows = await prisma.post.findMany({
      where,
      orderBy,
      include: postInclude(viewerId),
      ...cursorArgs(cursor, limit)
    })
    const page = toPage(rows, limit)
    return { items: page.items.map(toPostDto), nextCursor: page.nextCursor }
  },

  async bookmarks(viewerId: string, cursor: string | undefined, limit: number) {
    const rows = await prisma.post.findMany({
      where: { bookmarks: { some: { userId: viewerId } } },
      orderBy,
      include: postInclude(viewerId),
      ...cursorArgs(cursor, limit)
    })
    const page = toPage(rows, limit)
    return { items: page.items.map(toPostDto), nextCursor: page.nextCursor }
  },

  async get(id: string, viewerId?: string) {
    const post = await prisma.post.findUnique({
      where: { id },
      include: postInclude(viewerId)
    })
    if (!post) throw ApiError.notFound('Post not found')
    return toPostDto(post)
  },

  async create(
    authorId: string,
    data: { text: string; image?: string; videoPublicId?: string }
  ) {
    // Cloudinary is asked what was really uploaded (owner, size, duration) before the post is saved
    const video = data.videoPublicId
      ? await verifyUploadedVideo(authorId, data.videoPublicId)
      : null

    const post = await prisma.post.create({
      data: {
        text: data.text,
        image: data.image,
        authorId,
        ...(video && {
          video: video.url,
          videoPublicId: data.videoPublicId,
          videoDuration: video.duration
        })
      },
      include: postInclude(authorId)
    })
    await notifyMentions(data.text, authorId, post.id)
    return toPostDto(post)
  },

  async update(id: string, userId: string, text: string) {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true }
    })
    if (!post) throw ApiError.notFound('Post not found')
    if (post.authorId !== userId)
      throw ApiError.forbidden('You can only edit your own posts')
    const updated = await prisma.post.update({
      where: { id },
      data: { text },
      include: postInclude(userId)
    })
    return toPostDto(updated)
  },

  async remove(id: string, userId: string) {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true, videoPublicId: true }
    })
    if (!post) throw ApiError.notFound('Post not found')
    if (post.authorId !== userId)
      throw ApiError.forbidden('You can only delete your own posts')
    await prisma.post.delete({ where: { id } })
    if (post.videoPublicId) void deleteVideo(post.videoPublicId) // free the Cloudinary storage (best effort)
  },

  async like(id: string, userId: string) {
    const post = await assertPost(id)
    const { count } = await prisma.like.createMany({
      data: [{ userId, postId: id }],
      skipDuplicates: true
    })
    if (count > 0)
      await notify({
        recipientId: post.authorId,
        actorId: userId,
        type: 'LIKE',
        postId: id
      })
    return {
      liked: true,
      likesCount: await prisma.like.count({ where: { postId: id } })
    }
  },

  async unlike(id: string, userId: string) {
    await assertPost(id)
    await prisma.like.deleteMany({ where: { userId, postId: id } })
    return {
      liked: false,
      likesCount: await prisma.like.count({ where: { postId: id } })
    }
  },

  async bookmark(id: string, userId: string) {
    await assertPost(id)
    await prisma.bookmark.createMany({
      data: [{ userId, postId: id }],
      skipDuplicates: true
    })
    return { bookmarked: true }
  },

  async unbookmark(id: string, userId: string) {
    await prisma.bookmark.deleteMany({ where: { userId, postId: id } })
    return { bookmarked: false }
  },

  async share(id: string) {
    await assertPost(id)
    const post = await prisma.post.update({
      where: { id },
      data: { shares: { increment: 1 } },
      select: { shares: true }
    })
    return { sharesCount: post.shares }
  },

  /** Top hashtags across all posts (powers the "Trending" card). */
  async trending() {
    const rows = await prisma.$queryRaw<{ tag: string; posts: bigint }[]>`
      SELECT lower(m[1]) AS tag, count(*) AS posts
      FROM "Post", regexp_matches("text", '#([A-Za-z0-9_]+)', 'g') AS m
      GROUP BY 1
      ORDER BY posts DESC, tag ASC
      LIMIT 10`
    return rows.map(r => ({ tag: r.tag, posts: Number(r.posts) }))
  },

  // ───────────── comments ─────────────

  async comments(postId: string, cursor: string | undefined, limit: number) {
    await assertPost(postId)
    const rows = await prisma.comment.findMany({
      where: { postId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { author: { select: actorSelect } },
      ...cursorArgs(cursor, limit)
    })
    return toPage(rows, limit)
  },

  async addComment(
    postId: string,
    userId: string,
    text: string,
    parentId?: string
  ) {
    const post = await assertPost(postId)
    let recipientId = post.authorId
    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, postId: true, parentId: true, authorId: true }
      })
      if (!parent || parent.postId !== postId)
        throw ApiError.badRequest('Reply target does not belong to this post')
      if (parent.parentId)
        throw ApiError.badRequest('Replies can only target top-level comments')
      recipientId = parent.authorId
    }
    const comment = await prisma.comment.create({
      data: {
        postId,
        authorId: userId,
        text,
        ...(parentId ? { parentId } : {})
      },
      include: { author: { select: actorSelect } }
    })
    await notify({ recipientId, actorId: userId, type: 'COMMENT', postId })
    return comment
  },

  async removeComment(commentId: string, userId: string) {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { authorId: true, post: { select: { authorId: true } } }
    })
    if (!comment) throw ApiError.notFound('Comment not found')
    // The comment's author or the post's author may delete it
    if (comment.authorId !== userId && comment.post.authorId !== userId)
      throw ApiError.forbidden()
    await prisma.comment.delete({ where: { id: commentId } })
  }
}
