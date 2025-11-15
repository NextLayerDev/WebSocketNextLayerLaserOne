import { createServer } from 'http'
import { Server } from 'socket.io'
import express from 'express'
import dotenv from 'dotenv'

// Carregar variáveis de ambiente
dotenv.config()

// ========================================
// SERVIDOR WEBSOCKET STANDALONE
// ========================================

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.WEBSOCKET_PORT || '3001', 10)

// Configuração de CORS - permitir conexões do frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001']

// Criar aplicação Express
const app = express()
app.use(express.json())

// ========================================
// ENDPOINTS HTTP
// ========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: usuariosOnline.size
  })
})

app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: usuariosOnline.size
  })
})

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    port,
    environment: dev ? 'development' : 'production',
    connections: usuariosOnline.size,
    usuariosOnline: Array.from(usuariosOnline.keys())
  })
})

// ========================================
// ENDPOINT /emit (Next.js chama para mandar eventos)
// ========================================
app.post('/emit', (req, res) => {
  try {
    const { room, event, data } = req.body

    if (!room || !event) {
      return res.status(400).json({
        success: false,
        error: 'Room e event são obrigatórios'
      })
    }

    io.to(room).emit(event, data)

    res.json({
      success: true,
      room,
      event,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Erro ao emitir evento:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Criar servidor HTTP
const httpServer = createServer(app)

// Mapa de usuários online: userId -> socketId
const usuariosOnline = new Map()

// ========================================
// CONFIGURAR SOCKET.IO
// ========================================
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket',"polling"], // 🔥 OBRIGATÓRIO
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ========================================
// EVENTOS SOCKET.IO
// ========================================
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id, '| IP:', socket.handshake.address)

  socket.on('user:join', (userId) => {
    if (!userId) return

    const existingUser = usuariosOnline.get(userId)
    if (existingUser && existingUser.socketId !== socket.id) {
      console.log(`🔄 Usuário ${userId} reconectou.`)
    }

    usuariosOnline.set(userId, {
      socketId: socket.id,
      userId,
      timestamp: new Date(),
    })

    socket.join(`user:${userId}`)

    io.emit('status:update', {
      userId,
      status: 'online',
      ultimoAcesso: new Date().toISOString(),
    })

    console.log(`👤 Usuário ${userId} entrou | Total online: ${usuariosOnline.size}`)
  })

  socket.on('message:send', (data) => {
    socket.emit('message:received', data)
    io.to(`user:${data.destinatarioId}`).emit('message:received', data)
  })

  socket.on('typing:start', (data) => {
    io.to(`user:${data.destinatarioId}`).emit('typing:update', {
      userId: data.userId,
      isTyping: true,
    })
  })

  socket.on('typing:stop', (data) => {
    io.to(`user:${data.destinatarioId}`).emit('typing:update', {
      userId: data.userId,
      isTyping: false,
    })
  })

  socket.on('status:change', (data) => {
    io.emit('status:update', {
      userId: data.userId,
      status: data.status,
      ultimoAcesso: new Date().toISOString(),
    })
  })

  socket.on('messages:mark-read', (data) => {
    io.to(`user:${data.remetenteId}`).emit('messages:read', {
      userId: data.destinatarioId,
    })
  })

  socket.on('omni:join', (userId) => {
    if (!userId) return
    socket.join('omni-updates')
    socket.join(`omni-user:${userId}`)
    console.log(`📱 [Omni] Usuário ${userId} entrou`)
  })

  socket.on('omni:leave', (userId) => {
    if (!userId) return
    socket.leave('omni-updates')
    socket.leave(`omni-user:${userId}`)
  })

  socket.on('disconnect', (reason) => {
    let disconnectedUserId = null

    for (const [userId, userSocket] of usuariosOnline.entries()) {
      if (userSocket.socketId === socket.id) {
        disconnectedUserId = userId
        usuariosOnline.delete(userId)
        break
      }
    }

    if (disconnectedUserId) {
      io.emit('status:update', {
        userId: disconnectedUserId,
        status: 'offline',
        ultimoAcesso: new Date().toISOString(),
      })
      console.log(`👋 Usuário ${disconnectedUserId} desconectou | Motivo: ${reason}`)
    } else {
      console.log(`🔌 Socket ${socket.id} desconectou | Motivo: ${reason}`)
    }
  })

  socket.on('error', (error) => {
    console.error('❌ Erro no socket:', socket.id, error)
  })
})

// ========================================
// SHUTDOWN
// ========================================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido, encerrando servidor...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido, encerrando servidor...')
  httpServer.close(() => process.exit(0))
})

// ========================================
// INICIAR SERVIDOR
// REMOVIDO O HOSTNAME 🔥 ESSA ERA A CAUSA DO ERRO
// ========================================
httpServer.listen(port, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🚀 Servidor WebSocket Standalone                          ║
║                                                            ║
║  📍 Porta: ${port}
║  🔌 Socket.io: Ativo                                       ║
║  🌍 Ambiente: ${dev ? 'Desenvolvimento' : 'Produção'}
║  🌐 Origens: ${allowedOrigins.slice(0, 2).join(', ')}
║  📊 Conexões ativas: ${usuariosOnline.size}
║                                                            ║
║  ✅ Chat Interno: Ativo                                    ║
║  ✅ Omni WhatsApp: Ativo                                   ║
║  ✅ Endpoint /emit: Ativo                                  ║
╚════════════════════════════════════════════════════════════╝
  `)
})
