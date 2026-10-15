import { z } from 'zod'
import { paginationQuery } from '../../utils/response'

export const createPostSchema = z
  .object({
    text: z
      .string()
      .trim()
      .max(500, 'Post can be at most 500 characters')
      .default(''),
    image: z.url('Image must be a valid URL').optional(),
    // public_id returned by POST /uploads/video-signature (after the browser uploaded the file to Cloudinary)
    videoPublicId: z.string().trim().min(1).max(200).optional()
  })
  .refine(
    v => v.text.length > 0 || v.image || v.videoPublicId,
    'A post needs text, an image or a video'
  )
  .refine(
    v => !(v.image && v.videoPublicId),
    'Choose either an image or a video, not both'
  )

/** GET /posts — `scope=following` only returns people you follow; `q` searches text, name and username. */
export const feedQuery = paginationQuery.extend({
  scope: z.enum(['all', 'following']).default('all'),
  q: z.string().trim().min(1).max(50).optional()
})

export const createCommentSchema = z.object({
  text: z.string().trim().min(1, 'Comment cannot be empty').max(300),
  parentId: z.string().optional()
})
