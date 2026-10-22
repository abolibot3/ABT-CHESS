// ============ ABT-CHESS Game Logic v2 ============
const token = sessionStorage.getItem('abt_token');
const username = sessionStorage.getItem('abt_username');
const mode = sessionStorage.getItem('abt_mode');
const roomCode = sessionStorage.getItem('abt_roomCode');

// ============ تنظیمات ============
let settings = window.ABTSettings.loadSettings();
window.ABTSettings.applySettings(settings);   // ✅ این خط رو اضافه کن

// ✅ اعمال فوری تنظیمات روی DOM
window.ABTSettings.applySettings(settings);

let gameStartTime = null;
let moveHistory = [];
let captures = { w: 0, b: 0 };

if (!token) window.location.href = '/login.html';

// ============ اتصال Socket ============
const socket = io({
  auth: { token },
  reconnectionAttempts: 3,
  reconnectionDelay: 1000
});

// ============ متغیرهای بازی ============
let game = new Chess();
let myColor = null;
let roomId = null;
let board = null;
let gameStarted = false;
let captchaTimerInterval = null;

const searchModal = document.getElementById('searchModal');
const captchaModal = document.getElementById('captchaModal');
const waitingOpponentModal = document.getElementById('waitingOpponentModal');
const gameArea = document.getElementById('gameArea');
const statusEl = document.getElementById('status');

// ۷. تابع جلوگیری از تزریق کد (XSS)
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ مقداردهی تخته ============
function initBoard() {
  if (board) {
    board.destroy();
    board = null;
  }

  document.getElementById('board').innerHTML = '';

  const pieceThemeUrl = (window.ABTSettings.PIECE_THEMES[settings.pieceTheme]
    || window.ABTSettings.PIECE_THEMES.wikipediaLocal).url;

  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    orientation: myColor === 'w' ? 'white' : 'black',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoverSquare: onMouseoverSquare,
    onMouseoutSquare: onMouseoutSquare,
    onSnapEnd: () => board.position(game.fen(), settings.animations),
    showNotation: settings.showCoords,
    pieceTheme: pieceThemeUrl
  });

  // ✅ چک کن که عنصر board واقعاً اندازه داره
  const boardEl = document.getElementById('board');
  console.log('📐 Board dimensions:', boardEl.offsetWidth, 'x', boardEl.offsetHeight);

  window.addEventListener('resize', () => {
    if (board) board.resize();
  });

  // ✅ دو بار resize برای اطمینان
  setTimeout(() => {
    if (board) board.resize();
    console.log('📐 After resize:', boardEl.offsetWidth, 'x', boardEl.offsetHeight);
  }, 100);

  setTimeout(() => {
    if (board) board.resize();
  }, 500);

  // اعمال تنظیمات
  window.ABTSettings.applySettings(settings);
}

// ============ هایلایت حرکات مجاز ============

// جلوگیری از درگ مهره‌های حریف یا وقتی نوبت ما نیست
function onDragStart(source, piece) {
  if (!gameStarted) return false;
  if (game.game_over()) return false;

  // فقط مهره‌های خودمون
  if (myColor === 'w' && piece[0] === 'b') return false;
  if (myColor === 'b' && piece[0] === 'w') return false;

  // فقط وقتی نوبت ماست
  if (game.turn() !== myColor) return false;

  return true;
}

// وقتی موس روی یه خونه میره → حرکات مجاز رو هایلایت کن
function onMouseoverSquare(square, piece) {
  if (!gameStarted) return;

  // فقط اگه یه مهره از خودمون روی این خونه باشه و نوبت ما باشه
  if (!piece) return;
  if (myColor === 'w' && piece[0] === 'b') return;
  if (myColor === 'b' && piece[0] === 'w') return;
  if (game.turn() !== myColor) return;

  const moves = game.moves({ square, verbose: true });
  if (moves.length === 0) return;

  highlightSquares(moves);
}

// وقتی موس از خونه خارج میشه → هایلایت‌ها رو پاک کن
function onMouseoutSquare() {
  removeHighlights();
}

// تابع هایلایت
function highlightSquares(moves) {
  const $board = $('#board');

  // پاک کردن قبلی‌ها
  $board.find('.square-55d63').removeClass('highlight-move highlight-capture');
  $board.find('.move-hint').remove();

  moves.forEach(move => {
    const $square = $board.find('.square-' + move.to);
    if (!$square.length) return;

    // اگه حرکت حمله‌ای بود → رنگ قرمز
    if (move.captured || move.flags.includes('e')) {
      $square.addClass('highlight-capture');
    } else {
      $square.addClass('highlight-move');
      // یه نقطه کوچیک وسط خونه (به جای رنگ کردن کل خونه)
      $square.append('<div class="move-hint"></div>');
    }
  });
}

function removeHighlights() {
  const $board = $('#board');
  $board.find('.square-55d63').removeClass('highlight-move highlight-capture');
  $board.find('.move-hint').remove();
}

// ============ حرکت ============
function onDrop(source, target) {
  removeHighlights();

  if (!gameStarted) return 'snapback';

  if (game.turn() !== myColor) {
    statusEl.textContent = '⏳ نوبت شما نیست!';
    return 'snapback';
  }

  const move = game.move({
    from: source,
    to: target,
    promotion: 'q'
  });

  if (move === null) return 'snapback';

  // شمارش مهره‌های گرفته‌شده
  if (move.captured) {
    captures[myColor] = (captures[myColor] || 0) + 1;
  }
  moveHistory.push(move);

  socket.emit('move', {
    roomId,
    fen: game.fen(),
    move: { from: source, to: target, promotion: 'q' }
  });

  updateStatus();
  checkGameOver();
}

// ============ پشتیبانی از کلیک (اختیاری) ============
let selectedSquare = null;

$(document).on('click', '#board .square-55d63', function () {
  if (!gameStarted) return;
  if (game.turn() !== myColor) return;

  const $square = $(this);
  const square = getSquareFromElement($square);

  // اگه قبلاً یه خونه انتخاب شده بود → حرکت کن
  if (selectedSquare && selectedSquare !== square) {
    const move = game.move({
      from: selectedSquare,
      to: square,
      promotion: 'q'
    });

    if (move) {
      socket.emit('move', {
        roomId,
        fen: game.fen(),
        move: { from: selectedSquare, to: square, promotion: 'q' }
      });
      board.position(game.fen());
      updateStatus();
      checkGameOver();
    }

    // پاک‌سازی
    removeHighlights();
    $('.square-55d63').removeClass('selected-square');
    selectedSquare = null;
    return;
  }

  // انتخاب مهره
  const piece = game.get(square);
  if (!piece) return;
  if (myColor === 'w' && piece.color === 'b') return;
  if (myColor === 'b' && piece.color === 'w') return;

  selectedSquare = square;
  $('.square-55d63').removeClass('selected-square');
  $square.addClass('selected-square');

  const moves = game.moves({ square, verbose: true });
  highlightSquares(moves);
});

// پیدا کردن نام خونه از المان
function getSquareFromElement($el) {
  const classes = $el.attr('class').split(/\s+/);
  for (const c of classes) {
    if (c.startsWith('square-') && c !== 'square-55d63') {
      return c.replace('square-', '');
    }
  }
  return null;
}

// ============ وضعیت ============
function updateStatus() {
  if (!gameStarted) {
    statusEl.textContent = 'در حال آماده‌سازی...';
    return;
  }

  if (game.game_over()) {
    checkGameOver();
    return;
  }

  const turn = game.turn() === 'w' ? 'سفید' : 'سیاه';
  const isMyTurn = game.turn() === myColor;
  statusEl.textContent = `${turn} بازی می‌کند${game.in_check() ? ' (کیش!)' : ''}${isMyTurn ? ' — نوبت شما' : ' — منتظر حریف'}`;
}

function checkGameOver() {
  if (!game.game_over()) return;

  gameStarted = false;

  // محاسبه زمان
  const elapsedMs = gameStartTime ? Date.now() - gameStartTime : 0;
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  // تعداد کل حرکات
  const totalMoves = Math.ceil(game.history().length / 2);

  // تعیین نتیجه
  let resultType = 'draw';   // 'win' | 'loss' | 'draw'
  let title = '';
  let subtitle = '';
  let icon = '';

  if (game.in_checkmate()) {
    const loser = game.turn();  // کسی که نوبتشه و مات شده
    const iWon = loser !== myColor;
    resultType = iWon ? 'win' : 'loss';
    if (iWon) {
      icon = '🏆';
      title = 'شاه مات! شما برنده شدید';
      subtitle = `حریف در حرکت ${totalMoves} مات شد`;
    } else {
      icon = '💔';
      title = 'شاه مات شدید';
      subtitle = `در حرکت ${totalMoves} باختید`;
    }
  } else if (game.in_stalemate()) {
    resultType = 'draw';
    icon = '🤝';
    title = 'پات! مساوی';
    subtitle = 'حریف مهره‌ای برای حرکت ندارد';
  } else if (game.in_threefold_repetition()) {
    resultType = 'draw';
    icon = '🔁';
    title = 'مساوی';
    subtitle = 'تکرار سه‌باره وضعیت';
  } else if (game.insufficient_material()) {
    resultType = 'draw';
    icon = '⚖️';
    title = 'مساوی';
    subtitle = 'مهره کافی برای مات نیست';
  } else if (game.in_draw()) {
    resultType = 'draw';
    icon = '🤝';
    title = 'مساوی';
    subtitle = 'قانون ۵۰ حرکت';
  }

  // نمایش مودال
  showGameOverModal({
    resultType,
    icon,
    title,
    subtitle,
    moves: totalMoves,
    time: timeStr,
    captures: captures[myColor] || 0
  });
}

// ============ شروع ============
socket.on('connect', () => {
  console.log('✅ متصل شد');
  searchModal.classList.remove('hidden');
  socket.emit('join_queue', { mode });
});

socket.on('connect_error', (err) => {
  console.error('خطای اتصال:', err.message);
  alert('خطا در اتصال به سرور: ' + err.message);
  window.location.href = '/login.html';
});

socket.on('waiting', ({ message }) => {
  document.getElementById('searchMessage').textContent = message;
});

socket.on('no_opponent', ({ message }) => {
  searchModal.classList.add('hidden');
  alert(message);
  window.location.href = '/login.html';
});

// ============ پیدا شدن حریف ============
// ============ پیدا شدن حریف ============
socket.on('match_found', (data) => {
  console.log('🎯 حریف پیدا شد:', data);
  roomId = data.roomId;
  myColor = data.color;

  // ۸. استفاده از escapeHTML برای جلوگیری از تزریق اسکریپت در اسم
  document.getElementById('whiteName').textContent =
    myColor === 'w' ? escapeHTML(username) : escapeHTML(data.opponent);
  document.getElementById('blackName').textContent =
    myColor === 'b' ? escapeHTML(username) : escapeHTML(data.opponent);

  searchModal.classList.add('hidden');
  showCaptcha(data.captcha, data.captchaExpiresAt);
});

// ============ کپچا ============
function showCaptcha(question, expiresAt) {
  document.getElementById('captchaQuestion').textContent = question;
  document.getElementById('captchaInput').value = '';
  document.getElementById('captchaError').textContent = '';
  captchaModal.classList.remove('hidden');

  const totalMs = 15000;
  const remainingMs = Math.max(0, expiresAt - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);

  const fill = document.getElementById('timerFill');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  requestAnimationFrame(() => {
    fill.style.transition = `width ${remainingMs}ms linear`;
    fill.style.width = '0%';
  });

  if (captchaTimerInterval) clearInterval(captchaTimerInterval);
  captchaTimerInterval = setTimeout(() => {
    captchaModal.classList.add('hidden');
    alert('⏱ زمان تمام شد.');
    socket.disconnect();
    window.location.href = '/login.html';
  }, remainingMs);

  setTimeout(() => document.getElementById('captchaInput').focus(), 100);
}

document.getElementById('captchaSubmit').addEventListener('click', submitCaptcha);
document.getElementById('captchaInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') submitCaptcha();
});

function submitCaptcha() {
  const answer = document.getElementById('captchaInput').value.trim();
  if (!answer) return;

  clearTimeout(captchaTimerInterval);
  socket.emit('captcha_answer', { answer, roomId });
}

socket.on('captcha_ok', () => {
  captchaModal.classList.add('hidden');
  waitingOpponentModal.classList.remove('hidden');
});

// ============ شروع بازی ============
socket.on('game_start', (data) => {
  console.log('🎮 بازی شروع شد:', data);
  waitingOpponentModal.classList.add('hidden');
  searchModal.classList.add('hidden');
  captchaModal.classList.add('hidden');

  game = new Chess(data.fen);
  gameStarted = true;
  gameStartTime = Date.now();
  moveHistory = [];
  captures = { w: 0, b: 0 };

  document.getElementById('whiteName').textContent = data.white;
  document.getElementById('blackName').textContent = data.black;

  gameArea.style.display = 'flex';

  setTimeout(() => {
    initBoard();
    updateStatus();
  }, 100);
});

// ============ حرکت حریف ============
socket.on('opponent_move', ({ fen, move }) => {
  console.log('♟️ حرکت حریف:', move);

  try {
    const testGame = new Chess(game.fen());
    const result = testGame.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    if (!result) return;

    if (result.captured) {
      const opponentColor = myColor === 'w' ? 'b' : 'w';
      captures[opponentColor] = (captures[opponentColor] || 0) + 1;
    }
    moveHistory.push(result);

    game = testGame;
    if (board) board.position(game.fen(), settings.animations);
    updateStatus();
    checkGameOver();
  } catch (e) {
    console.error('خطا در اعمال حرکت حریف:', e);
  }
});

// ============ خروج حریف ============
socket.on('opponent_left', (data) => {
  if (!gameStarted) return;
  gameStarted = false;

  const elapsedMs = gameStartTime ? Date.now() - gameStartTime : 0;
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  showGameOverModal({
    resultType: 'win',
    icon: '🚪',
    title: 'حریف از بازی خارج شد',
    subtitle: `${data.username || 'حریف'} بازی را ترک کرد`,
    moves: Math.ceil(game.history().length / 2),
    time: timeStr,
    captures: captures[myColor] || 0
  });

  launchConfetti();
});

socket.on('opponent_resigned', (data) => {
  if (!gameStarted) return;
  gameStarted = false;

  const elapsedMs = gameStartTime ? Date.now() - gameStartTime : 0;
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  showGameOverModal({
    resultType: 'win',
    icon: '🏳️',
    title: 'حریف تسلیم شد!',
    subtitle: `${data.username || 'حریف'} بازی را باخت`,
    moves: Math.ceil(game.history().length / 2),
    time: timeStr,
    captures: captures[myColor] || 0
  });

  launchConfetti();
});

// ============ خطاها ============
socket.on('error_msg', ({ message }) => {
  console.warn('⚠️', message);
  statusEl.textContent = '⚠️ ' + message;
});

socket.on('kicked', ({ reason }) => {
  alert('🚫 ' + reason);
  socket.disconnect();
  window.location.href = '/login.html';
});

// ============ دکمه‌ها ============
document.getElementById('leaveBtn').addEventListener('click', () => {
  if (!confirm('از بازی خارج می‌شوی؟ (باخت حساب می‌شود)')) return;

  gameStarted = false;

  // ✅ اول تسلیم بفرست، بعد قطع کن
  socket.emit('resign', { roomId });

  setTimeout(() => {
    socket.disconnect();
    window.location.href = '/login.html';
  }, 200);
});

document.getElementById('resignBtn').addEventListener('click', () => {
  if (!confirm('تسلیم می‌شوی؟ (باخت حساب می‌شود)')) return;

  gameStarted = false;

  // ✅ اول پیام تسلیم رو بفرست
  socket.emit('resign', { roomId });

  // ✅ بعد از یه تأخیر کوتاه، disconnect کن
  setTimeout(() => {
    socket.disconnect();
    // مودال باخت برای خودت
    showGameOverModal({
      resultType: 'loss',
      icon: '🏳️',
      title: 'تسلیم شدید',
      subtitle: 'حریف برنده شد',
      moves: Math.ceil(game.history().length / 2),
      time: '—',
      captures: captures[myColor] || 0
    });
  }, 200);
});

document.getElementById('cancelSearch').addEventListener('click', () => {
  socket.disconnect();
  window.location.href = '/login.html';
});

function showGameOverModal(data) {
  const modal = document.getElementById('gameOverModal');
  const icon = document.getElementById('resultIcon');
  const title = document.getElementById('resultTitle');
  const subtitle = document.getElementById('resultSubtitle');

  icon.textContent = data.icon;
  title.textContent = data.title;
  subtitle.textContent = data.subtitle;

  document.getElementById('statMoves').textContent = data.moves;
  document.getElementById('statTime').textContent = data.time;
  document.getElementById('statCaptures').textContent = data.captures;

  // کلاس رنگ بر اساس نتیجه
  modal.querySelector('.modal-gameover').classList.remove('win', 'loss', 'draw');
  modal.querySelector('.modal-gameover').classList.add(data.resultType);

  modal.classList.remove('hidden');

  // افکت کانفتی برای برد
  if (data.resultType === 'win') {
    launchConfetti();
  }
}

// ============ کانفتی ============
function launchConfetti() {
  const container = document.getElementById('confetti');
  container.innerHTML = '';
  const colors = ['#d4a24a', '#f5c873', '#4ade80', '#4a9eff', '#ff6b5a', '#a855f7'];

  for (let i = 0; i < 120; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    piece.style.width = (Math.random() * 8 + 6) + 'px';
    piece.style.height = (Math.random() * 8 + 6) + 'px';
    container.appendChild(piece);
  }

  setTimeout(() => container.innerHTML = '', 5000);
}

// ============ تنظیمات ============
const settingsModal = document.getElementById('settingsModal');

document.getElementById('settingsBtn').addEventListener('click', () => {
  openSettingsModal();
});

document.getElementById('closeSettings').addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

function openSettingsModal() {
  // ساخت گرید تم‌ها
  window.ABTSettings.buildThemeGrid(
    'boardThemeGrid',
    window.ABTSettings.BOARD_THEMES,
    settings.boardTheme,
    (key) => {
      settings.boardTheme = key;
      window.ABTSettings.applySettings(settings);   // پیش‌نمایش زنده
    }
  );

  window.ABTSettings.buildThemeGrid(
    'pieceThemeGrid',
    window.ABTSettings.PIECE_THEMES,
    settings.pieceTheme,
    (key) => {
      settings.pieceTheme = key;
      if (board) initBoard();   // رفرش تخته
    }
  );

  // مقادیر فعلی
  document.getElementById('boardSize').value = settings.boardSize;
  document.getElementById('boardSizeValue').textContent = settings.boardSize + '%';
  document.getElementById('showHints').checked = settings.showHints;
  document.getElementById('showCoords').checked = settings.showCoords;
  document.getElementById('animations').checked = settings.animations;

  settingsModal.classList.remove('hidden');
}

// اسلایدر اندازه
document.getElementById('boardSize').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('boardSizeValue').textContent = val + '%';
  settings.boardSize = parseInt(val);
  window.ABTSettings.applySettings(settings);
});

// تاگل‌ها
['showHints', 'showCoords', 'animations'].forEach(id => {
  document.getElementById(id).addEventListener('change', (e) => {
    settings[id] = e.target.checked;
    window.ABTSettings.applySettings(settings);
    if (id === 'showCoords' && board) initBoard();   // نیاز به رفرش
  });
});

// ذخیره
document.getElementById('saveSettings').addEventListener('click', () => {
  window.ABTSettings.saveSettings(settings);
  settingsModal.classList.add('hidden');

  // نمایش پیام کوتاه
  showToast('✅ تنظیمات ذخیره شد');
});

// بازنشانی
document.getElementById('resetSettings').addEventListener('click', () => {
  if (!confirm('همه تنظیمات به حالت پیش‌فرض برگرده؟')) return;
  settings = { ...window.ABTSettings.DEFAULT_SETTINGS };
  window.ABTSettings.saveSettings(settings);
  window.ABTSettings.applySettings(settings);
  if (board) initBoard();
  settingsModal.classList.add('hidden');
  showToast('🔄 تنظیمات بازنشانی شد');
});

// ============ مودال پایان ============
document.getElementById('playAgainBtn').addEventListener('click', () => {
  // اگه بازی تموم شده و می‌خوای دوباره بازی کنی → برو به login
  window.location.href = '/login.html';
});

document.getElementById('backHomeBtn').addEventListener('click', () => {
  window.location.href = '/index.html';
});

// ============ Toast ============
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}