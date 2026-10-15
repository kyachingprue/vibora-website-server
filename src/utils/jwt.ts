import jwt from 'jsonwebtoken'
import { env } from '../config/env'

type AccessPayload = { sub: string }
type RefreshPayload = { sub: string; sid: string }

export const signAccessToken = (userId: string) =>
  jwt.sign({ sub: userId } satisfies AccessPayload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_MINUTES * 60 // seconds
  })

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & AccessPayload

/** `sid` = id of the RefreshToken row, used for rotation and revocation. */
export const signRefreshToken = (userId: string, sid: string) =>
  jwt.sign(
    { sub: userId, sid } satisfies RefreshPayload,
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60
    }
  )

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload & RefreshPayload
