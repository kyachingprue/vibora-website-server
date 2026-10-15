import { randomUUID } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env'
import { ApiError } from '../utils/ApiError'

// 🔑 CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET come from your .env via src/config/env.ts
if (env.cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true
  })
}

export const imageFolder = (userId: string) => `socialhub/images/${userId}`

export function createImageUploadSignature(userId: string) {
  assertEnabled()
  const publicId = `${imageFolder(userId)}/${randomUUID()}`
  const timestamp = Math.round(Date.now() / 1000)
  const signedParams = {
    folder: imageFolder(userId),
    public_id: publicId,
    timestamp,
    allowed_formats: 'jpg,jpeg,png,webp,avif'
  }
  const signature = cloudinary.utils.api_sign_request(
    signedParams,
    env.CLOUDINARY_API_SECRET!
  )
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    fields: { ...signedParams, api_key: env.CLOUDINARY_API_KEY!, signature },
    maxFileMB: 8
  }
}

export const ALLOWED_VIDEO_FORMATS = ['mp4', 'mov', 'webm', 'm4v', '3gp']

const maxVideoBytes = () => env.MAX_VIDEO_MB * 1024 * 1024

/** Every user uploads into their own folder, so a public_id proves who it belongs to. */
export const videoFolder = (userId: string) => `socialhub/videos/${userId}`

export const ownsVideo = (userId: string, publicId: string) =>
  publicId.startsWith(`${videoFolder(userId)}/`) && !publicId.includes('..')

function assertEnabled() {
  if (!env.cloudinaryEnabled) {
    throw new ApiError(
      503,
      'Video uploads are not configured on this server',
      'UPLOADS_DISABLED'
    )
  }
}

/**
 * Step 1 of a video upload. The browser asks for a signature, then uploads the file
 * straight to Cloudinary (the video never passes through this server).
 * The server picks the public_id, so the client cannot upload into another user's folder
 * or use a format that is not allowed.
 */
export function createVideoUploadSignature(userId: string) {
  assertEnabled()

  const publicId = `${videoFolder(userId)}/${randomUUID()}`
  const timestamp = Math.round(Date.now() / 1000)
  const allowedFormats = ALLOWED_VIDEO_FORMATS.join(',')

  // Only these parameters are signed; the client must send exactly these values.
  const signedParams = {
    allowed_formats: allowedFormats,
    public_id: publicId,
    timestamp
  }
  const signature = cloudinary.utils.api_sign_request(
    signedParams,
    env.CLOUDINARY_API_SECRET!
  )

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/video/upload`,
    // Append every entry of `fields` to the multipart form together with the `file`
    fields: { ...signedParams, api_key: env.CLOUDINARY_API_KEY!, signature },
    publicId,
    maxFileMB: env.MAX_VIDEO_MB,
    maxDurationSeconds: env.MAX_VIDEO_SECONDS,
    expiresInSeconds: 3600 // Cloudinary rejects signatures older than 1 hour
  }
}

type CloudinaryVideo = {
  secure_url: string
  bytes: number
  duration?: number
  format?: string
}

/**
 * Step 2: before a post is saved, ask Cloudinary (not the client) what was really uploaded.
 * Checks ownership, size and duration, and deletes the file if it breaks the rules.
 */
export async function verifyUploadedVideo(userId: string, publicId: string) {
  assertEnabled()
  if (!ownsVideo(userId, publicId))
    throw ApiError.forbidden(
      'This video does not belong to you',
      'VIDEO_NOT_OWNED'
    )

  let asset: CloudinaryVideo
  try {
    asset = (await cloudinary.api.resource(publicId, {
      resource_type: 'video'
    })) as CloudinaryVideo
  } catch {
    throw ApiError.badRequest(
      'Video was not found. Upload it first, then create the post.',
      'VIDEO_NOT_FOUND'
    )
  }

  if (asset.bytes > maxVideoBytes()) {
    await deleteVideo(publicId)
    throw new ApiError(
      413,
      `Video is too large (max ${env.MAX_VIDEO_MB} MB)`,
      'VIDEO_TOO_LARGE'
    )
  }
  if (asset.duration !== undefined && asset.duration > env.MAX_VIDEO_SECONDS) {
    await deleteVideo(publicId)
    throw ApiError.badRequest(
      `Video is too long (max ${env.MAX_VIDEO_SECONDS} seconds)`,
      'VIDEO_TOO_LONG'
    )
  }

  return { url: asset.secure_url, duration: asset.duration ?? null }
}

/** Poster image for a video (a frame picked automatically by Cloudinary). */
export const videoThumbnailUrl = (publicId: string): string | null =>
  env.cloudinaryEnabled
    ? cloudinary.url(publicId, {
        resource_type: 'video',
        format: 'jpg',
        secure: true,
        transformation: [{ width: 720, crop: 'limit', start_offset: 'auto' }]
      })
    : null

/** Best-effort delete — a failure is logged but never breaks the request. */
export async function deleteVideo(publicId: string) {
  if (!env.cloudinaryEnabled) return
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
      invalidate: true
    })
  } catch (err) {
    console.error('Cloudinary delete failed:', publicId, err)
  }
}
