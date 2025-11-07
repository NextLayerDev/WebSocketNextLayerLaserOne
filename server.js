import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import dotenv from 'dotenv'

// Carregar variáveis de ambiente
dotenv.config()

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.WEBSOCKET_HOST || '0.0.0.0'
const port = parseInt(process.env.WEBSOCKET_PORT || '8080', 10)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000']

// Inicializar o Express
const app = express()

// Healthcheck simples (para Cloudflare e monitoramento)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

// Criar servidor HTTP a partir do Express
const server = http.createServer(app)

// Configurar Socket.IO
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true)
      } else {
        callback(new Error('Origin not allowed by CORS'))
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Mapa de usuários online
const usuariosOnline = new Map()

// Eventos Socket.IO
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id)

  socket.on('user:join', (userId) => {
    if (!userId) return
    usuariosOnline.set(userId, { socketId: socket.id, timestamp: new Date() })
    socket.join(`user:${userId}`)
    io.emit('status:update', { userId, status: 'online' })
    console.log(`👤 Usuário ${userId} entrou. Total: ${usuariosOnline.size}`)
  })

  socket.on('message:send', (data) => {
    socket.emit('message:received', data)
    io.to(`user:${data.destinatarioId}`).emit('message:received', data)
  })

  socket.on('disconnect', () => {
    for (const [userId, u] of usuariosOnline.entries()) {
      if (u.socketId === socket.id) usuariosOnline.delete(userId)
    }
    console.log('❌ Cliente desconectado:', socket.id)
  })
})

// Iniciar servidor
server.listen(port, hostname, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║ 🚀 Servidor WebSocket + HTTP rodando          ║
║ 🌍 Host: ${hostname}:${port}
║ 🔌 Socket.io: Ativo
║ 🌐 Origens permitidas: ${allowedOrigins.join(', ')} 
╚══════════════════════════════════════════════╝
  `)
})
