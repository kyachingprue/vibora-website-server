import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma'
import { requireAdmin } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { idParam, message, ok } from '../../utils/response'
import { getOnlineUserIds } from '../../lib/socket'

const router = Router()
router.use(requireAdmin)

const userSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  avatar: true,
  createdAt: true,
  emailVerified: true,
  _count: { select: { followers: true, following: true, posts: true } }
} as const

/** Aggregate daily counts for the last N days from a list of dates. */
function dailyCounts(dates: Date[], days: number) {
  const map = new Map<string, number>()
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    map.set(d.toISOString().slice(0, 10), 0)
  }
  for (const dt of dates) {
    const key = new Date(dt).toISOString().slice(0, 10)
    if (map.has(key)) map.set(key, (map.get(key) || 0) + 1)
  }
  return Array.from(map.entries()).map(([date, count]) => ({ date, count }))
}

router.get('/overview', async (_req, res) => {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [
    users,
    activeUsers,
    posts,
    comments,
    likes,
    follows,
    notifications,
    registrationDates,
    postDates,
    recentUsers
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.post.count(),
    prisma.comment.count(),
    prisma.like.count(),
    prisma.follow.count(),
    prisma.notification.count(),
    prisma.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.post.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        avatar: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 8
    })
  ])

  const onlineIds = getOnlineUserIds()

  ok(res, {
    totals: {
      users,
      activeUsers,
      deactivatedUsers: users - activeUsers,
      posts,
      comments,
      likes,
      follows,
      notifications,
      onlineUsers: onlineIds.length
    },
    registrations: dailyCounts(
      registrationDates.map(r => r.createdAt),
      30
    ),
    postTrends: dailyCounts(
      postDates.map(r => r.createdAt),
      30
    ),
    recentUsers,
    onlineUserIds: onlineIds
  })
})

router.get('/analytics', async (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30))
  const since = new Date()
  since.setDate(since.getDate() - days)

  const [userDates, postDates, likeCount, commentCount, followCount, totals] =
    await Promise.all([
      prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.post.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.like.count({ where: { createdAt: { gte: since } } }),
      prisma.comment.count({ where: { createdAt: { gte: since } } }),
      prisma.follow.count({ where: { createdAt: { gte: since } } }),
      Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.post.count(),
        prisma.comment.count()
      ])
    ])

  const onlineIds = getOnlineUserIds()

  ok(res, {
    rangeDays: days,
    registrations: dailyCounts(
      userDates.map(r => r.createdAt),
      days
    ),
    postTrends: dailyCounts(
      postDates.map(r => r.createdAt),
      days
    ),
    engagement: {
      likes: likeCount,
      comments: commentCount,
      follows: followCount
    },
    totals: {
      users: totals[0],
      activeUsers: totals[1],
      deactivatedUsers: totals[0] - totals[1],
      posts: totals[2],
      comments: totals[3],
      onlineUsers: onlineIds.length
    },
    onlineUserIds: onlineIds
  })
})

router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim()
  const status = String(req.query.status || 'all')
  const role = String(req.query.role || 'all')
  const sort = String(req.query.sort || 'newest')
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))

  const where: Record<string, unknown> = {
    ...(status === 'active'
      ? { isActive: true }
      : status === 'inactive'
        ? { isActive: false }
        : {}),
    ...(role === 'admin'
      ? {
          OR: [
            { role: { equals: 'admin', mode: 'insensitive' as const } },
            { role: { equals: 'administrator', mode: 'insensitive' as const } }
          ]
        }
      : role === 'user'
        ? {
            AND: [
              { role: { not: 'admin', mode: 'insensitive' as const } },
              { role: { not: 'administrator', mode: 'insensitive' as const } }
            ]
          }
        : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { username: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { id: { contains: q } }
          ]
        }
      : {})
  }

  const orderBy =
    sort === 'oldest'
      ? { createdAt: 'asc' as const }
      : sort === 'name'
        ? { name: 'asc' as const }
        : sort === 'followers'
          ? { followers: { _count: 'desc' as const } }
          : { createdAt: 'desc' as const }

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy,
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.user.count({ where })
  ])

  const onlineIds = new Set(getOnlineUserIds())

  ok(res, {
    items: items.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      avatar: u.avatar,
      createdAt: u.createdAt,
      emailVerified: u.emailVerified,
      followersCount: u._count.followers,
      followingCount: u._count.following,
      postsCount: u._count.posts,
      isOnline: onlineIds.has(u.id)
    })),
    total,
    page,
    pages: Math.ceil(total / limit) || 1
  })
})

router.get('/users/:id', validate({ params: idParam }), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id as string },
    select: {
      ...userSelect,
      bio: true,
      location: true,
      website: true,
      cover: true,
      updatedAt: true
    }
  })
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' })
  }
  const onlineIds = new Set(getOnlineUserIds())
  ok(res, {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    avatar: user.avatar,
    cover: user.cover,
    bio: user.bio,
    location: user.location,
    website: user.website,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    emailVerified: user.emailVerified,
    followersCount: user._count.followers,
    followingCount: user._count.following,
    postsCount: user._count.posts,
    isOnline: onlineIds.has(user.id)
  })
})

router.patch(
  '/users/:id/status',
  validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }),
  async (req, res) => {
    const targetId = req.params.id as string
    if (targetId === req.user?.id && !req.body.isActive) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account.'
      })
    }

    if (!req.body.isActive) {
      const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: { role: true }
      })
      const isAdmin =
        target && ['admin', 'administrator'].includes(target.role.toLowerCase())
      if (isAdmin) {
        const adminCount = await prisma.user.count({
          where: {
            isActive: true,
            OR: [
              { role: { equals: 'admin', mode: 'insensitive' } },
              { role: { equals: 'administrator', mode: 'insensitive' } }
            ]
          }
        })
        if (adminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: 'Cannot deactivate the last active administrator.'
          })
        }
      }
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: { isActive: req.body.isActive },
      select: {
        id: true,
        name: true,
        username: true,
        isActive: true,
        role: true
      }
    })

    try {
      const { broadcastAdminEvent } = await import('../../lib/socket.js')
      broadcastAdminEvent('user:status', {
        id: user.id,
        isActive: user.isActive
      })
    } catch {
      /* socket optional */
    }

    ok(res, user)
  }
)

router.delete('/users/:id', validate({ params: idParam }), async (req, res) => {
  const targetId = req.params.id as string
  if (targetId === req.user?.id) {
    return res.status(400).json({
      success: false,
      message: 'You cannot delete your own account.'
    })
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true }
  })
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found' })
  }

  const isAdmin = ['admin', 'administrator'].includes(target.role.toLowerCase())
  if (isAdmin) {
    const adminCount = await prisma.user.count({
      where: {
        isActive: true,
        OR: [
          { role: { equals: 'admin', mode: 'insensitive' } },
          { role: { equals: 'administrator', mode: 'insensitive' } }
        ]
      }
    })
    if (adminCount <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the last administrator.'
      })
    }
  }

  await prisma.user.delete({ where: { id: targetId } })

  try {
    const { broadcastAdminEvent } = await import('../../lib/socket.js')
    broadcastAdminEvent('user:deleted', { id: targetId })
  } catch {
    /* optional */
  }

  message(res, 'User deleted')
})

router.get('/posts', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  const q = String(req.query.q || '').trim()

  const where = q
    ? {
        OR: [
          { text: { contains: q, mode: 'insensitive' as const } },
          {
            author: { username: { contains: q, mode: 'insensitive' as const } }
          }
        ]
      }
    : {}

  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      select: {
        id: true,
        text: true,
        image: true,
        video: true,
        shares: true,
        createdAt: true,
        author: {
          select: { id: true, name: true, username: true, avatar: true }
        },
        _count: { select: { likes: true, comments: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.post.count({ where })
  ])

  ok(res, {
    items: items.map(p => ({
      id: p.id,
      text: p.text,
      image: p.image,
      video: p.video,
      shares: p.shares,
      createdAt: p.createdAt,
      author: p.author,
      likesCount: p._count.likes,
      commentsCount: p._count.comments
    })),
    total,
    page,
    pages: Math.ceil(total / limit) || 1
  })
})

router.delete('/posts/:id', validate({ params: idParam }), async (req, res) => {
  await prisma.post.delete({ where: { id: req.params.id as string } })
  message(res, 'Post deleted')
})

export default router
