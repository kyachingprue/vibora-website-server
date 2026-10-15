import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { verifyAccessToken } from '../utils/jwt'
import { prisma } from '../config/prisma'
import { env } from '../config/env'

/** userId -> Set of socket ids */
const onlineUsers = new Map<string, Set<string>>()
/** socket id -> userId */
const socketToUser = new Map<string, string>()

let io: Server | null = null

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers.keys())
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId)
}

export function broadcastAdminEvent(event: string, payload: unknown) {
  if (!io) return
  io.to('admins').emit(event, payload)
}

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigins,
      credentials: true
    },
    path: '/socket.io'
  })

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.headers?.authorization as string)?.replace(
          /^Bearer\s+/i,
          ''
        )
      if (!token) return next(new Error('Unauthorized'))
      const { sub } = verifyAccessToken(token)
      const user = await prisma.user.findUnique({
        where: { id: sub },
        select: { id: true, role: true, isActive: true }
      })
      if (!user || !user.isActive) return next(new Error('Unauthorized'))
      ;(socket as Socket & { userId: string; role: string }).userId = user.id
      ;(socket as Socket & { userId: string; role: string }).role = user.role
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket: Socket) => {
    const s = socket as Socket & { userId: string; role: string }
    const userId = s.userId
    if (!userId) {
      socket.disconnect(true)
      return
    }

    // Track presence
    let set = onlineUsers.get(userId)
    if (!set) {
      set = new Set()
      onlineUsers.set(userId, set)
    }
    const wasOffline = set.size === 0
    set.add(socket.id)
    socketToUser.set(socket.id, userId)

    if (wasOffline) {
      io?.emit('user:online', { userId })
      broadcastAdminEvent('presence:update', {
        userId,
        online: true,
        onlineCount: onlineUsers.size
      })
    }

    // Join admin room if admin
    const role = (s.role || '').toLowerCase()
    if (role === 'admin' || role === 'administrator') {
      socket.join('admins')
    }

    // Clients may request current online list (admins)
    socket.on('presence:list', (cb?: (ids: string[]) => void) => {
      if (typeof cb === 'function') cb(getOnlineUserIds())
    })

    // Explicitly reject any client attempts to change account status via socket
    socket.on('admin:setStatus', () => {
      socket.emit('error', { message: 'Use the authenticated REST API for status changes.' })
    })
    socket.on('admin:deleteUser', () => {
      socket.emit('error', { message: 'Use the authenticated REST API for deletions.' })
    })

    socket.on('disconnect', () => {
      const uid = socketToUser.get(socket.id)
      socketToUser.delete(socket.id)
      if (!uid) return
      const sockets = onlineUsers.get(uid)
      if (!sockets) return
      sockets.delete(socket.id)
      if (sockets.size === 0) {
        onlineUsers.delete(uid)
        io?.emit('user:offline', { userId: uid })
        broadcastAdminEvent('presence:update', {
          userId: uid,
          online: false,
          onlineCount: onlineUsers.size
        })
      }
    })
  })

  console.log('✅ Socket.IO ready')
  return io
}

export function getIO() {
  return io
}
