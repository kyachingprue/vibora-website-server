import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../config/prisma'
import {
  deleteVideo,
  createVideoUploadSignature,
  createImageUploadSignature,
  ownsVideo
} from '../../lib/cloudinary'
import { requireAuth } from '../../middleware/auth'
import { uploadLimiter } from '../../middleware/rateLimit'
import { validate } from '../../middleware/validate'
import { ApiError } from '../../utils/ApiError'
import { message, ok, userId } from '../../utils/response'

const router = Router()
router.use(requireAuth)

/**
 * POST /api/uploads/video-signature
 * Returns everything the browser needs to upload a video directly to Cloudinary.
 */
router.post('/image-signature', uploadLimiter, (_req, res) => {
  ok(res, createImageUploadSignature(userId(_req)))
})

router.post('/video-signature', uploadLimiter, (req, res) => {
  ok(res, createVideoUploadSignature(userId(req)))
})

const discardSchema = z.object({ publicId: z.string().min(1).max(200) })

/**
 * DELETE /api/uploads/video  { publicId }
 * Lets the user throw away a video they uploaded but never attached to a post
 * (e.g. they closed the composer). Videos that belong to a post cannot be removed here.
 */
router.delete('/video', validate({ body: discardSchema }), async (req, res) => {
  const { publicId } = req.body as z.infer<typeof discardSchema>
  if (!ownsVideo(userId(req), publicId))
    throw ApiError.forbidden(
      'This video does not belong to you',
      'VIDEO_NOT_OWNED'
    )

  const used = await prisma.post.findUnique({
    where: { videoPublicId: publicId },
    select: { id: true }
  })
  if (used)
    throw ApiError.conflict(
      'This video is attached to a post. Delete the post instead.'
    )

  await deleteVideo(publicId)
  message(res, 'Video discarded')
})

export default router
