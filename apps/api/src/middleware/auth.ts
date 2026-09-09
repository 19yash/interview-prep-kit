import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { env, isProduction } from '../env.js'
import { HttpError } from './errors.js'

export const AUTH_COOKIE = 'ipk_session'
const TOKEN_TTL = '7d'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: TOKEN_TTL })
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  }
}

/**
 * An invalid or expired token clears the cookie as well as refusing the
 * request, so a stale session does not leave the browser retrying with a
 * token that can never work.
 */
export const requireAuth: RequestHandler = (req, res, next) => {
  const token = req.cookies?.[AUTH_COOKIE]
  if (!token) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'sign in to continue'))
    return
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string }
    if (!payload.sub) throw new Error('token has no subject')
    req.userId = payload.sub
    next()
  } catch {
    res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined })
    next(new HttpError(401, 'SESSION_EXPIRED', 'your session has expired, please sign in again'))
  }
}
