import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { AUTH_COOKIE, cookieOptions, requireAuth, signToken } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { UserModel } from '../models/user.js'

const Credentials = z.object({
  email: z.string().email('enter a valid email address'),
  password: z.string().min(10, 'use at least 10 characters'),
})

export const authRouter = Router()

authRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = Credentials.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const existing = await UserModel.findOne({ email: parsed.data.email.toLowerCase() })
    if (existing) throw new HttpError(409, 'EMAIL_TAKEN', 'that email is already registered')

    const user = await UserModel.create({
      email: parsed.data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
    })

    res.cookie(AUTH_COOKIE, signToken(user.id), cookieOptions())
    res.status(201).json({ user: { id: user.id, email: user.email } })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = Credentials.safeParse(req.body)
    // Same message whether the email is unknown or the password is wrong.
    const rejection = new HttpError(401, 'BAD_CREDENTIALS', 'Invalid Credentials')
    if (!parsed.success) throw rejection

    const user = await UserModel.findOne({ email: parsed.data.email.toLowerCase() })
    if (!user) throw rejection
    if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) throw rejection

    res.cookie(AUTH_COOKIE, signToken(user.id), cookieOptions())
    res.status(200).json({ user: { id: user.id, email: user.email } })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: undefined })
  res.status(204).end()
})

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.userId)
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'sign in to continue')
    res.json({ user: { id: user.id, email: user.email } })
  } catch (error) {
    next(error)
  }
})
