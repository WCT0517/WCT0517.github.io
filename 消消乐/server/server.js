const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 排行榜数据（内存存储，生产环境应使用数据库）
let leaderboard = [];

// API: 获取排行榜
app.get('/api/leaderboard', (req, res) => {
  const sorted = [...leaderboard].sort((a, b) => b.score - a.score).slice(0, 10);
  res.json(sorted);
});

// API: 提交分数
app.post('/api/leaderboard', (req, res) => {
  const { name, score, level } = req.body;
  if (!name || !score) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  leaderboard.push({
    name: name.substring(0, 10),
    score: parseInt(score),
    level: parseInt(level) || 1,
    timestamp: Date.now()
  });
  
  // 只保留前1000条记录
  if (leaderboard.length > 1000) {
    leaderboard = leaderboard.sort((a, b) => b.score - a.score).slice(0, 1000);
  }
  
  res.json({ success: true });
});

// 房间管理
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('新玩家连接:', socket.id);
  
  let currentRoom = null;
  let playerName = '';
  
  // 加入房间
  socket.on('join_room', ({ roomId, name }) => {
    playerName = name || '匿名玩家';
    currentRoom = roomId;
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        players: [],
        maxPlayers: 30,
        status: 'waiting'
      });
    }
    
    const room = rooms.get(roomId);
    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    
    const player = {
      id: socket.id,
      name: playerName,
      score: 0,
      ready: false
    };
    
    room.players.push(player);
    
    // 通知房间内所有人
    io.to(roomId).emit('player_joined', { player: playerName, count: room.players.length });
    io.to(roomId).emit('room_update', { players: room.players });
    
    console.log(`玩家 ${playerName} 加入房间 ${roomId}`);
  });
  
  // 发送聊天消息
  socket.on('chat', ({ message }) => {
    if (currentRoom && message) {
      io.to(currentRoom).emit('chat', { 
        player: playerName, 
        message: message.substring(0, 100) 
      });
    }
  });
  
  // 同步游戏进度
  socket.on('sync_progress', ({ score, moves }) => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.score = score;
        }
        io.to(currentRoom).emit('player_progress', { 
          playerId: socket.id,
          player: playerName,
          score, 
          moves 
        });
      }
    }
  });
  
  // 准备就绪
  socket.on('player_ready', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.ready = true;
        }
        
        // 检查是否所有玩家都准备
        const allReady = room.players.every(p => p.ready);
        if (allReady && room.players.length >= 1) {
          room.status = 'playing';
          io.to(currentRoom).emit('game_start', { roomId: currentRoom });
        }
      }
    }
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log('玩家断开:', socket.id);
    
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        
        if (room.players.length === 0) {
          rooms.delete(currentRoom);
        } else {
          io.to(currentRoom).emit('player_left', { 
            player: playerName, 
            count: room.players.length 
          });
          io.to(currentRoom).emit('room_update', { players: room.players });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`WebSocket 服务已启动`);
});
