import http from 'node:http'
import { createApp } from './app'
import { env } from './config/env'
import { prisma } from './config/prisma'
import { initSocket } from './lib/socket'

async function main() {
  await prisma.$connect()
  console.log('✅ Database connected')

  const app = createApp()
  const httpServer = http.createServer(app)
  initSocket(httpServer)

  const server = httpServer.listen(env.PORT, () => {
    console.log(
      `🚀 API ready on http://localhost:${env.PORT}/api  (${env.NODE_ENV})`
    )
  })

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down…`)
    server.close(async () => {
      await prisma.$disconnect()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(err => {
  console.error('❌ Failed to start server:', err)
  process.exit(1)
})

process.on('unhandledRejection', reason =>
  console.error('Unhandled rejection:', reason)
)
