// ============ ABT-CHESS Settings Manager v2 ============
const SETTINGS_KEY = 'abt_chess_settings';

// تم‌های تخته
const BOARD_THEMES = {
  classic: { name: 'کلاسیک', light: '#e8d8b8', dark: '#b58863', border: '#d4a24a' },
  ocean:   { name: 'اقیانوس', light: '#dee3e6', dark: '#4a7ba7', border: '#4a9eff' },
  forest:  { name: 'جنگل',   light: '#e8f0dc', dark: '#5a7d3f', border: '#2ecc71' },
  royal:   { name: 'سلطنتی', light: '#e8d5e8', dark: '#7e3f8f', border: '#a855f7' },
  midnight:{ name: 'نیمه‌شب', light: '#5a6378', dark: '#2a3142', border: '#4a9eff' },
  sunset:  { name: 'غروب',   light: '#fde8d5', dark: '#c96f3f', border: '#ff6b5a' },
  chess24: { name: 'Chess24', light: '#eeeed2', dark: '#769656', border: '#769656' },
  ice:     { name: 'یخ',      light: '#e8f4f8', dark: '#7fb8d0', border: '#4a9eff' }
};

// تم‌های مهره
const PIECE_THEMES = {
  wikipediaLocal: {
    name: 'Wikipedia',
    url: '/img/chesspieces/wikipedia/{piece}.png'
  },
  wikipediaCDN: {
    name: 'Wikipedia CDN',
    url: 'https://cdn.jsdelivr.net/gh/oakmac/chessboardjs@master/website/img/chesspieces/wikipedia/{piece}.png'
  }
};

// تنظیمات پیش‌فرض
const DEFAULT_SETTINGS = {
  boardTheme: 'classic',
  pieceTheme: 'wikipediaLocal',
  boardSize: 100,
  showHints: true,
  showCoords: true,
  animations: true
};

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings(settings) {
  const root = document.documentElement;
  const theme = BOARD_THEMES[settings.boardTheme] || BOARD_THEMES.classic;

  // ✅ رنگ‌ها
  root.style.setProperty('--board-light', theme.light);
  root.style.setProperty('--board-dark', theme.dark);
  root.style.setProperty('--board-border', theme.border);
  root.style.setProperty('--accent', theme.border);

  // ✅ اندازه تخته
root.style.setProperty('--board-size', settings.boardSize);
document.body.classList.add('has-board-size');

  // ✅ کلاس‌های بدنه
  document.body.classList.toggle('hide-hints', !settings.showHints);
  document.body.classList.toggle('hide-coords', !settings.showCoords);
  document.body.classList.toggle('no-animations', !settings.animations);

  // ✅ اعمال مستقیم رنگ روی خونه‌های chessboard
  applyBoardColors(theme);
}

// ✅ اعمال مستقیم رنگ روی chessboard
function applyBoardColors(theme) {
  const styleId = 'abt-board-theme-style';
  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    #board .white-1e1d7 { background-color: ${theme.light} !important; }
    #board .black-3c85d { background-color: ${theme.dark} !important; }
    #board .board-b72b1 { border: 2px solid ${theme.border} !important; }
  `;
}

function buildThemeGrid(containerId, themes, currentKey, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  Object.entries(themes).forEach(([key, theme]) => {
    const btn = document.createElement('button');
    btn.className = 'theme-option' + (key === currentKey ? ' active' : '');
    btn.dataset.theme = key;
    btn.type = 'button';

    if (theme.light && theme.dark) {
      // تم تخته
      btn.innerHTML = `
        <div class="theme-preview">
          <div class="preview-cell" style="background:${theme.light}"></div>
          <div class="preview-cell" style="background:${theme.dark}"></div>
          <div class="preview-cell" style="background:${theme.dark}"></div>
          <div class="preview-cell" style="background:${theme.light}"></div>
        </div>
        <span class="theme-name">${theme.name}</span>
      `;
    } else {
      // تم مهره
      btn.innerHTML = `
        <div class="theme-preview piece-preview">
          <img src="${theme.url.replace('{piece}', 'wN')}" alt="" onerror="this.style.display='none'">
          <img src="${theme.url.replace('{piece}', 'bK')}" alt="" onerror="this.style.display='none'">
        </div>
        <span class="theme-name">${theme.name}</span>
      `;
    }

    btn.addEventListener('click', () => {
      container.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(key);
    });

    container.appendChild(btn);
  });
}

window.ABTSettings = {
  BOARD_THEMES,
  PIECE_THEMES,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  applySettings,
  buildThemeGrid
};