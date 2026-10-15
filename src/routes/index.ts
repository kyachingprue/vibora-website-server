import { Router } from 'express'
import { prisma } from '../config/prisma'
import authRoutes from '../modules/auth/auth.routes'
import communityRoutes from '../modules/communities/community.routes'
import eventRoutes from '../modules/events/event.routes'
import messageRoutes from '../modules/messages/message.routes'
import notificationRoutes from '../modules/notifications/notification.routes'
import postRoutes, { commentRouter } from '../modules/posts/post.routes'
import uploadRoutes from '../modules/uploads/upload.routes'
import userRoutes from '../modules/users/user.routes'
import adminRoutes from '../modules/admin/admin.routes'

const router = Router()

router.get('/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1` // fails (500) if the database is unreachable
  res.json({
    success: true,
    status: 'ok',
    uptime: Math.round(process.uptime())
  })
})

router.use('/auth', authRoutes)
router.use('/admin', adminRoutes)
router.use('/users', userRoutes)
router.use('/posts', postRoutes)
router.use('/comments', commentRouter)
router.use('/notifications', notificationRoutes)
router.use('/messages', messageRoutes)
router.use('/communities', communityRoutes)
router.use('/events', eventRoutes)
router.use('/uploads', uploadRoutes)

export default router
