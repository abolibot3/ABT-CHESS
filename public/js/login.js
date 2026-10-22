// ============ Login Logic ============
const form = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const roomCodeInput = document.getElementById('roomCode');
const codeGroup = document.getElementById('codeGroup');
const errorEl = document.getElementById('error');

let currentMode = 'random';

// تغییر تب
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentMode = tab.dataset.mode;
    codeGroup.classList.toggle('hidden', currentMode !== 'code');
  });
});

// ارسال فرم
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';

 const username = usernameInput.value.trim().replace(/[<>]/g, '');
  const roomCode = currentMode === 'code' ? roomCodeInput.value.trim() : null;

  // اعتبارسنجی سمت کلاینت
  if (username.length < 2) {
    errorEl.textContent = 'نام کاربری حداقل ۲ کاراکتر';
    return;
  }
  if (currentMode === 'code' && !/^[a-zA-Z0-9]{4,8}$/.test(roomCode)) {
  errorEl.textContent = 'کد اتاق باید ۴ تا ۸ کاراکتر (حرف یا عدد) باشد';
  return;
}

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, roomCode })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'خطا در ورود';
      return;
    }

    // ذخیره توکن و رفتن به صفحه بازی
    sessionStorage.setItem('abt_token', data.token);
    sessionStorage.setItem('abt_username', data.username);
    sessionStorage.setItem('abt_mode', currentMode);
    sessionStorage.setItem('abt_roomCode', roomCode || '');

    window.location.href = '/game.html';

  } catch (err) {
    errorEl.textContent = 'ارتباط با سرور برقرار نشد';
  }
});