import { createServer } from 'http'
import { Server } from 'socket.io'

// Carregar variáveis de ambiente (use dotenv se necessário, ou configure via sistema)
// Para usar dotenv, instale: npm install dotenv
// e descomente: import dotenv from 'dotenv'; dotenv.config();

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.WEBSOCKET_HOST || '0.0.0.0' // 0.0.0.0 para aceitar conexões externas na VPS
const port = parseInt(process.env.WEBSOCKET_PORT || '3001', 10)

// Configuração de CORS - permitir conexões do frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001']

// Criar servidor HTTP
const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      connections: usuariosOnline.size 
    }))
    return
  }

  // Endpoint de status
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'running',
      port,
      environment: dev ? 'development' : 'production',
      connections: usuariosOnline.size,
      usuariosOnline: Array.from(usuariosOnline.keys())
    }))
    return
  }

  // Para outras rotas, retornar 404
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

// Configurar Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Se não houver origin (ex: mobile apps, Postman), permitir
      if (!origin) {
        return callback(null, true)
      }

      // Verificar se a origin está na lista de permitidas
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true)
      } else {
        callback(new Error('Não permitido pelo CORS'))
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true, // Compatibilidade com versões antigas
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Mapa de usuários online: userId -> socketId
const usuariosOnline = new Map()

// Tornar io acessível globalmente (caso precise ser usado externamente)
global.io = io

// Eventos do Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id, '| IP:', socket.handshake.address)

  // Usuário entra no chat
  socket.on('user:join', (userId) => {
    if (!userId) {
      console.warn('⚠️ Tentativa de join sem userId:', socket.id)
      return
    }

    // Remover usuário anterior se já estiver conectado (evitar duplicatas)
    const existingUser = usuariosOnline.get(userId)
    if (existingUser && existingUser.socketId !== socket.id) {
      console.log(`🔄 Usuário ${userId} reconectou. Removendo conexão antiga: ${existingUser.socketId}`)
      io.to(existingUser.socketId).emit('force-disconnect', { reason: 'Nova conexão detectada' })
      io.sockets.sockets.get(existingUser.socketId)?.disconnect()
    }

    usuariosOnline.set(userId, {
      socketId: socket.id,
      userId,
      timestamp: new Date(),
    })

    // Entrar na sala do usuário (para mensagens privadas)
    socket.join(`user:${userId}`)

    // Notificar todos sobre status online
    io.emit('status:update', {
      userId,
      status: 'online',
      ultimoAcesso: new Date().toISOString(),
    })

    console.log(`👤 Usuário ${userId} entrou no chat | Total online: ${usuariosOnline.size}`)
  })

  // Eventos do Omni WhatsApp
  socket.on('omni:join', (userId) => {
    if (!userId) return
    socket.join('omni-updates')
    socket.join(`omni-user:${userId}`)
    console.log(`📱 Usuário ${userId} entrou no Omni`)
  })

  // Nova mensagem enviada
  socket.on('message:send', (data) => {
    // Enviar para o remetente (confirmação)
    socket.emit('message:received', data)

    // Enviar para o destinatário
    io.to(`user:${data.destinatarioId}`).emit('message:received', data)
  })

  // Usuário digitando
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

  // Atualização de status manual
  socket.on('status:change', (data) => {
    io.emit('status:update', {
      userId: data.userId,
      status: data.status,
      ultimoAcesso: new Date().toISOString(),
    })
  })

  // Marcar mensagens como lidas
  socket.on('messages:mark-read', (data) => {
    io.to(`user:${data.remetenteId}`).emit('messages:read', {
      userId: data.destinatarioId,
    })
  })

  // Evento genérico para emitir para salas específicas (útil para integração)
  socket.on('emit:to-room', (data) => {
    if (data.room && data.event) {
      io.to(data.room).emit(data.event, data.payload)
    }
  })

  // Evento genérico para broadcast
  socket.on('emit:broadcast', (data) => {
    if (data.event) {
      io.emit(data.event, data.payload)
    }
  })

  // Desconexão
  socket.on('disconnect', (reason) => {
    // Encontrar userId pelo socketId
    let disconnectedUserId = null
    
    for (const [userId, userSocket] of usuariosOnline.entries()) {
      if (userSocket.socketId === socket.id) {
        disconnectedUserId = userId
        usuariosOnline.delete(userId)
        break
      }
    }

    if (disconnectedUserId) {
      // Notificar que ficou offline
      io.emit('status:update', {
        userId: disconnectedUserId,
        status: 'offline',
        ultimoAcesso: new Date().toISOString(),
      })
      console.log(`👋 Usuário ${disconnectedUserId} desconectou | Motivo: ${reason} | Total online: ${usuariosOnline.size}`)
    } else {
      console.log(`🔌 Cliente ${socket.id} desconectou | Motivo: ${reason}`)
    }
  })

  // Erro no socket
  socket.on('error', (error) => {
    console.error('❌ Erro no socket:', socket.id, error)
  })
})

// Tratamento de erros do servidor HTTP
httpServer.once('error', (err) => {
  console.error('❌ Erro no servidor:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido, encerrando servidor...')
  httpServer.close(() => {
    console.log('✅ Servidor encerrado com sucesso')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido, encerrando servidor...')
  httpServer.close(() => {
    console.log('✅ Servidor encerrado com sucesso')
    process.exit(0)
  })
})

// Iniciar servidor
httpServer.listen(port, hostname, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🚀 Servidor WebSocket Standalone                         ║
║                                                            ║
║  📍 URL: http://${hostname}:${port}                    ║
║  🔌 Socket.io: Ativo                                      ║
║  🌍 Ambiente: ${dev ? 'Desenvolvimento' : 'Produção'}                          ║
║  🌐 Origens permitidas: ${allowedOrigins.join(', ')}      ║
║  📊 Conexões ativas: ${usuariosOnline.size}              ║
╚════════════════════════════════════════════════════════════╝
  `)
})

