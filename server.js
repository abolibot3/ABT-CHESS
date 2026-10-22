// ============ ABT-CHESS Server v3 (Secure) ============
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// ۱. تنظیمات امن CORS و Socket
const io = new Server(server, {
  cors: { 
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"], 
    methods: ["GET", "POST"]
  },
  pingTimeout: 10000,
  maxHttpBufferSize: 5e4,
  allowEIO3: false
});

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET باید در .env تنظیم شود (حداقل 32 کاراکتر)');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// ========== دیتابیس JSON ==========
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, matches: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return { users: {}, matches: [] };
  }
}
function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ۲. امنیت HTTP با Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.socket.io"],
      imgSrc: ["'self'", "data:", "https://cdnjs.cloudflare.com", "https://chessboardjs.com", "https://cdn.jsdelivr.net"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  noSniff: true,
  hsts: { maxAge: 31536000, includeSubDomains: true }
}));

app.use(compression());
app.use(express.json({ limit: '10kb' }));

// ========== Rate Limiter ==========
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'درخواست‌های بیش از حد. لطفاً صبر کن.' }
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'تلاش‌های ورود بیش از حد.' }
});
app.use('/api/', apiLimiter);

// ========== فایل‌های استاتیک ==========
app.use(express.static(path.join(__dirname, 'public')));

// ========== API ورود ==========
app.post('/api/login', authLimiter, (req, res) => {
  const { username, roomCode } = req.body;

  // ۳. اعتبارسنجی سخت‌گیرانه ورودی‌ها
  if (!username || typeof username !== 'string' || username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: 'نام کاربری باید بین 2 تا 20 کاراکتر باشد' });
  }
  // جلوگیری از تزریق کد در نام کاربری
  if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(username)) {
    return res.status(400).json({ error: 'نام کاربری فقط حروف و عدد' });
  }
  if (roomCode && !/^[a-zA-Z0-9]{4,8}$/.test(roomCode)) {
    return res.status(400).json({ error: 'کد اتاق باید ۴ تا ۸ کاراکتر (حرف یا عدد) باشد' });
  }

  const token = jwt.sign(
    { username, roomCode: roomCode || null },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  res.json({ token, username });
});

// ========== احراز هویت Socket.IO ==========
// ۴. اعتبارسنجی مجدد در سوکت
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token || typeof token !== 'string') return next(new Error('توکن نامعتبر'));
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.username || decoded.username.length > 20) {
      return next(new Error('اطلاعات توکن نامعتبر'));
    }
    socket.username = decoded.username;
    socket.roomCode = decoded.roomCode;
    socket.connectedAt = Date.now();
    next();
  } catch {
    next(new Error('توکن منقضی یا نامعتبر'));
  }
});

// ========== مدیریت بازی‌ها ==========
const waitingRandom = [];
const waitingByCode = new Map();
const activeGames = new Map();
const socketRoom = new Map();
const behaviorTracker = new Map();

// ۵. کپچای قوی‌تر با زمان بیشتر
function createCaptcha() {
  const a = Math.floor(Math.random() * 15) + 2;
  const b = Math.floor(Math.random() * 15) + 2;
  const ops = ['+', '-'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let answer;
  if (op === '+') answer = a + b;
  else answer = a - b;

  return {
    question: `${a} ${op} ${b} = ?`,
    answer: answer.toString(),
    expiresAt: Date.now() + 20000,
    type: 'math'
  };
}

function checkBotBehavior(socketId) {
  const tracker = behaviorTracker.get(socketId);
  if (!tracker || tracker.timestamps.length < 3) return true;
  const intervals = [];
  for (let i = 1; i < tracker.timestamps.length; i++) {
    intervals.push(tracker.timestamps[i] - tracker.timestamps[i - 1]);
  }
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
  if (variance < 50 && intervals.length > 8) return false;
  return true;
}

function createGame(socketA, socketB, roomId) {
  const whiteSocket = Math.random() < 0.5 ? socketA : socketB;
  const blackSocket = whiteSocket.id === socketA.id ? socketB : socketA;

  activeGames.set(roomId, {
    players: {
      [whiteSocket.id]: { username: whiteSocket.username, color: 'w' },
      [blackSocket.id]: { username: blackSocket.username, color: 'b' }
    },
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    startedAt: Date.now(),
    turn: 'w',
    readyCount: 0
  });

  socketRoom.set(whiteSocket.id, roomId);
  socketRoom.set(blackSocket.id, roomId);

  const c1 = createCaptcha();
  const c2 = createCaptcha();
  whiteSocket.captcha = c1;
  blackSocket.captcha = c2;
  whiteSocket.pendingRoom = roomId;
  blackSocket.pendingRoom = roomId;

  io.to(whiteSocket.id).emit('match_found', {
    roomId, color: 'w', opponent: blackSocket.username, captcha: c1.question, captchaExpiresAt: c1.expiresAt
  });
  io.to(blackSocket.id).emit('match_found', {
    roomId, color: 'b', opponent: whiteSocket.username, captcha: c2.question, captchaExpiresAt: c2.expiresAt
  });
}

function removeFromQueues(socketId) {
  const idx = waitingRandom.findIndex(s => s.id === socketId);
  if (idx > -1) waitingRandom.splice(idx, 1);
  for (const [code, s] of waitingByCode.entries()) {
    if (s.id === socketId) waitingByCode.delete(code);
  }
}

// ========== اتصال Socket ==========
io.on('connection', (socket) => {
  console.log(`✅ ${socket.username} متصل شد (${socket.id})`);

  // ۶. Rate Limit برای Socket (جلوگیری از اسپم)
  socket.messageCount = 0;
  socket.messageTimer = setInterval(() => { socket.messageCount = 0; }, 10000);
  
  const originalOn = socket.on;
  socket.on = function(event, handler) {
    return originalOn.call(this, event, function(...args) {
      if (event !== 'disconnect') {
        socket.messageCount++;
        if (socket.messageCount > 30) {
          socket.emit('kicked', { reason: 'اسپم پیام - قطع اتصال' });
          return socket.disconnect(true);
        }
      }
      return handler.apply(this, args);
    });
  };

  // ===== ورود به صف =====
  socket.on('join_queue', ({ mode }) => {
    removeFromQueues(socket.id);

    if (mode === 'random') {
      if (waitingRandom.length > 0) {
        const opponent = waitingRandom.shift();
        if (opponent.waitTimer) {
          clearTimeout(opponent.waitTimer);
          opponent.waitTimer = null;
        }
        const roomId = crypto.randomBytes(8).toString('hex');
        socket.join(roomId);
        opponent.join(roomId);
        createGame(opponent, socket, roomId);
      } else {
        waitingRandom.push(socket);
        socket.emit('waiting', { message: 'در حال جستجوی حریف...' });
        socket.waitTimer = setTimeout(() => {
          const i = waitingRandom.findIndex(s => s.id === socket.id);
          if (i > -1) {
            waitingRandom.splice(i, 1);
            socket.emit('no_opponent', { message: 'حریفی پیدا نشد. دوباره تلاش کن.' });
          }
        }, 60000);
      }
    }

    if (mode === 'code') {
      if (!socket.roomCode) return socket.emit('error_msg', { message: 'کد اتاق تنظیم نشده' });
      const code = socket.roomCode;
      if (waitingByCode.has(code)) {
        const opponent = waitingByCode.get(code);
        waitingByCode.delete(code);
        const roomId = 'room_' + code;
        socket.join(roomId);
        opponent.join(roomId);
        createGame(opponent, socket, roomId);
      } else {
        waitingByCode.set(code, socket);
        socket.emit('waiting', { message: `منتظر بازیکن با کد ${code}...` });
      }
    }
  });

  // ===== پاسخ کپچا =====
  socket.on('captcha_answer', ({ answer, roomId }) => {
    if (!socket.captcha) return socket.emit('error_msg', { message: 'چالشی وجود ندارد' });
    if (Date.now() > socket.captcha.expiresAt) {
      socket.emit('kicked', { reason: 'زمان پاسخ به چالش تمام شد' });
      return socket.disconnect(true);
    }
    if (socket.captcha.answer !== String(answer).trim()) {
      socket.emit('kicked', { reason: 'پاسخ اشتباه - احتمال ربات' });
      return socket.disconnect(true);
    }

    socket.captcha = null;
    socket.emit('captcha_ok');

    const gameRoomId = socket.pendingRoom;
    if (!gameRoomId) return;
    const game = activeGames.get(gameRoomId);
    if (!game) return;

    game.readyCount = (game.readyCount || 0) + 1;
    if (game.readyCount >= 2) {
      socket.pendingRoom = null;
      io.to(gameRoomId).emit('game_start', {
        fen: game.fen,
        white: Object.values(game.players).find(p => p.color === 'w').username,
        black: Object.values(game.players).find(p => p.color === 'b').username
      });
    }
  });

  // ===== حرکت شطرنج (با ضد تقلب) =====
  socket.on('move', ({ roomId, fen, move }) => {
    const game = activeGames.get(roomId);
    if (!game) return socket.emit('error_msg', { message: 'بازی یافت نشد' });
    if (!game.players[socket.id]) return;

    // ۱. چک کردن نوبت
    const playerColor = game.players[socket.id].color;
    if (game.turn !== playerColor) {
      return socket.emit('error_msg', { message: 'نوبت شما نیست' });
    }

    // ۲. ضد ربات (سرعت غیرطبیعی)
    if (!behaviorTracker.has(socket.id)) behaviorTracker.set(socket.id, { timestamps: [], moves: [] });
    const tracker = behaviorTracker.get(socket.id);
    const now = Date.now();
    
    if (tracker.timestamps.length > 0 && (now - tracker.timestamps[tracker.timestamps.length - 1]) < 500) {
      socket.emit('kicked', { reason: 'ارسال حرکت غیرطبیعی (اسپم)' });
      return socket.disconnect(true);
    }
    tracker.timestamps.push(now);
    if (tracker.timestamps.length > 20) tracker.timestamps.shift();

    if (!checkBotBehavior(socket.id)) {
      socket.emit('kicked', { reason: 'رفتار رباتیک شناسایی شد' });
      return socket.disconnect(true);
    }

    // ۳. اعتبارسنجی FEN و داده‌ها
    if (typeof fen !== 'string' || fen.length > 100) return;
    if (typeof move !== 'object' || !move.from || !move.to) return;
    
    // ۴. آپدیت State
    game.fen = fen;
    game.turn = game.turn === 'w' ? 'b' : 'w';
    game.lastMoveAt = now;

    socket.to(roomId).emit('opponent_move', { fen, move });
  });

  // ===== تسلیم =====
  socket.on('resign', ({ roomId }) => {
    console.log(`🏳️ ${socket.username} تسلیم شد در اتاق ${roomId}`);
    const game = activeGames.get(roomId);
    if (!game) return;

    socket.to(roomId).emit('opponent_resigned', { username: socket.username });
    activeGames.delete(roomId);
    for (const [sid, rid] of socketRoom.entries()) {
      if (rid === roomId) socketRoom.delete(sid);
    }
  });

  // ===== قطع ارتباط =====
  socket.on('disconnect', (reason) => {
    console.log(`❌ ${socket.username} قطع شد — دلیل: ${reason}`);
    clearInterval(socket.messageTimer); // پاکسازی تایمر اسپم

    removeFromQueues(socket.id);
    if (socket.waitTimer) clearTimeout(socket.waitTimer);

    const roomId = socketRoom.get(socket.id);
    if (roomId) {
      const game = activeGames.get(roomId);
      if (game) {
        socket.to(roomId).emit('opponent_left', { username: socket.username, reason: reason });
        activeGames.delete(roomId);
      }
      for (const [sid, rid] of socketRoom.entries()) {
        if (rid === roomId) socketRoom.delete(sid);
      }
    }
    behaviorTracker.delete(socket.id);
  });
});

// ========== شروع سرور ==========
server.listen(PORT, () => {
  console.log(`♟️  ABT-CHESS v3 (Secure) running on http://localhost:${PORT}`);
});