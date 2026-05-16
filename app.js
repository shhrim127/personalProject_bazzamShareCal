const CONFIG = window.APP_CONFIG || {};
const API_BASE = `${CONFIG.SUPABASE_URL || ""}/rest/v1`;

const DEFAULT_COLORS = ['#ff6b81', '#6c5ce7', '#00b894', '#ff9f1c'];

const state = {
  roomId: null,
  roomSlug: null,
  roomToken: null,
  members: [],
  availability: [],
  events: [],
  activeSlot: Number(localStorage.getItem('calendar-active-slot') || '1'),
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),
  scheduleDate: null,
  pollHandle: null,
};

function qs(id) { return document.getElementById(id); }
function sanitize(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function makeAvatar(member) {
  const bg = encodeURIComponent((member.color || '#6d5dfc').replace('#', ''));
  const text = encodeURIComponent((member.name || `멤버 ${member.slot}`).slice(0, 2));
  return `https://placehold.co/100x100/${bg}/ffffff?text=${text}`;
}
function getMemberBySlot(slot) {
  return state.members.find(m => m.slot === slot) || { slot, name: `멤버 ${slot}`, color: DEFAULT_COLORS[slot - 1] || '#6d5dfc', avatar_url: '' };
}
function getMemberById(id) { return state.members.find(m => m.id === id); }
function formatDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function monthTitle(year, month) { return `${year}년 ${month + 1}월`; }

function getUrlState() {
  const params = new URLSearchParams(location.search);
  state.roomSlug = params.get('room');
  state.roomToken = params.get('token');
}
function setUrlState(roomSlug, roomToken) {
  const url = new URL(location.href);
  url.searchParams.set('room', roomSlug);
  url.searchParams.set('token', roomToken);
  history.replaceState({}, '', url.toString());
  state.roomSlug = roomSlug;
  state.roomToken = roomToken;
}
function showConfigWarning(message) {
  const el = qs('configWarning');
  if(el) { el.style.display = 'block'; el.textContent = message; }
}
function clearConfigWarning() {
  const el = qs('configWarning');
  if(el) { el.style.display = 'none'; el.textContent = ''; }
}

function randomString(length = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((v) => chars[v % chars.length])
    .join("");
}

async function supabaseFetch(url, options = {}) {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    throw new Error('Supabase URL이 설정되지 않았습니다.');
  }
  const headers = {
    'Content-Type': 'application/json',
    'apikey': CONFIG.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.message || 'Supabase 통신 실패');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function updateShareLinkBox() {
  if (state.roomSlug && state.roomToken) {
    qs('shareLinkBox').textContent = `${location.origin}${location.pathname}?room=${state.roomSlug}&token=${state.roomToken}`;
  } else {
    qs('shareLinkBox').textContent = '방을 만들면 링크가 생성됩니다.';
  }
}

function renderLegend() {
  const active = getMemberBySlot(state.activeSlot);
  qs('activeMemberBtn').textContent = `활성 멤버: ${active.name}`;
  qs('activeMemberBtn').style.background = active.color || '#6d5dfc';
  qs('legend').innerHTML = state.members
    .sort((a, b) => a.slot - b.slot)
    .map(member => `
      <div class="legend-item">
        <span class="color-chip" style="background:${member.color}"></span>
        <img src="${member.avatar_url || makeAvatar(member)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;border:1px solid #e6e8f0" alt="" />
        <span>${sanitize(member.name)}</span>
      </div>`)
    .join('');
}

// [핵심 변경] 입력 중이거나 색상을 고르는 중에는 화면이 강제로 리렌더링되지 않도록 락을 세밀하게 조정합니다.
let isEditingInput = false;

function renderMembers() {
  if (isEditingInput) return; // 유저가 조작 중일 때는 화면 갱신 차단

  qs('memberGrid').innerHTML = [1, 2, 3, 4].map((slot) => {
    const member = getMemberBySlot(slot);
    
    return `
      <div class="member-card">
        <div class="member-header">
          <div class="member-title">
            <div class="avatar"><img src="${member.avatar_url || makeAvatar(member)}" alt="${sanitize(member.name)}" /></div>
            <div class="member-meta">
              <strong>${sanitize(member.name)}</strong>
              <span><span class="color-chip" style="background:${member.color}"></span>${member.color}</span>
            </div>
          </div>
          <button class="secondary active-select" data-active-slot="${slot}" style="background:${state.activeSlot === slot ? member.color : '#edf2ff'};color:${state.activeSlot === slot ? '#fff' : '#334155'}">
            ${state.activeSlot === slot ? '선택됨' : '선택'}
          </button>
        </div>
        <div class="field">
          <label>이름 (입력 후 빈 곳을 클릭하면 자동 저장)</label>
          <input type="text" data-name-slot="${slot}" value="${sanitize(member.name)}" maxlength="20" />
        </div>
        <div class="field">
          <label>나만의 색상 선택하기 (바꾸면 자동 저장)</label>
          <input type="color" data-color-slot="${slot}" value="${member.color}" style="width:100%; height:40px; cursor:pointer; padding:0; border:1px solid #e8ebf4; border-radius:12px;" />
        </div>
        <div class="field">
          <label>프로필 사진 URL (입력 후 빈 곳 클릭시 자동 저장)</label>
          <input type="url" data-avatar-url-slot="${slot}" value="${sanitize(member.avatar_url || '')}" placeholder="https://..." />
        </div>
        <div class="field">
          <label>또는 사진 파일 직접 업로드 (선택 즉시 즉시 저장)</label>
          <input type="file" accept="image/*" data-avatar-file-slot="${slot}" />
        </div>
      </div>`;
  }).join('');

  document.querySelectorAll('[data-active-slot]').forEach(btn => btn.addEventListener('click', () => {
    state.activeSlot = Number(btn.dataset.activeSlot);
    localStorage.setItem('calendar-active-slot', String(state.activeSlot));
    renderMembers();
    renderLegend();
  }));

  document.querySelectorAll('[data-name-slot]').forEach(input => {
    input.addEventListener('focus', () => { isEditingInput = true; });
    input.addEventListener('blur', async () => {
      isEditingInput = false;
      const slot = Number(input.dataset.nameSlot);
      await handleAutoSave(slot);
    });
    input.addEventListener('keydown', async (e) => {
      if(e.key === 'Enter') input.blur();
    });
  });

  document.querySelectorAll('[data-avatar-url-slot]').forEach(input => {
    input.addEventListener('focus', () => { isEditingInput = true; });
    input.addEventListener('blur', async () => {
      isEditingInput = false;
      const slot = Number(input.dataset.avatarUrlSlot);
      await handleAutoSave(slot);
    });
  });

  // [수정] 색상 조절 창을 여는 순간(`click`) 락을 걸고, 색상 선택이 끝나 창이 닫히거나 값 조작이 완료되면(`change`) 락을 해제하고 저장합니다.
  document.querySelectorAll('[data-color-slot]').forEach(input => {
    input.addEventListener('click', () => { isEditingInput = true; });
    input.addEventListener('change', async () => {
      isEditingInput = false;
      const slot = Number(input.dataset.colorSlot);
      await handleAutoSave(slot);
    });
  });

  document.querySelectorAll('[data-avatar-file-slot]').forEach(input => input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const slot = Number(input.dataset.avatarFileSlot);
    isEditingInput = true;
    const reader = new FileReader();
    reader.onload = async () => {
      const urlInput = document.querySelector(`[data-avatar-url-slot="${slot}"]`);
      if(urlInput) urlInput.value = reader.result;
      isEditingInput = false;
      await handleAutoSave(slot);
    };
    reader.readAsDataURL(file);
  }));
}

async function handleAutoSave(slot) {
  const nameInput = document.querySelector(`[data-name-slot="${slot}"]`);
  const colorInput = document.querySelector(`[data-color-slot="${slot}"]`);
  const avatarInput = document.querySelector(`[data-avatar-url-slot="${slot}"]`);
  
  if(!nameInput || !colorInput) return;
  
  const name = nameInput.value.trim() || `멤버 ${slot}`;
  const color = colorInput.value;
  const avatarUrl = avatarInput ? avatarInput.value.trim() : '';
  
  try {
    await upsertMember(slot, name, color, avatarUrl);
    await loadRoomState();
  } catch (error) {
    alert(error.message);
  }
}

function renderCalendar() {
  qs('monthTitle').textContent = monthTitle(state.currentYear, state.currentMonth);
  const calendar = qs('calendar');
  calendar.innerHTML = '';
  ['일', '월', '화', '수', '목', '금', '토'].forEach(label => {
    const cell = document.createElement('div');
    cell.className = 'weekday';
    cell.textContent = label;
    calendar.appendChild(cell);
  });
  const firstDay = new Date(state.currentYear, state.currentMonth, 1);
  const lastDay = new Date(state.currentYear, state.currentMonth + 1, 0);
  const prevLastDay = new Date(state.currentYear, state.currentMonth, 0);
  const startWeekday = firstDay.getDay();
  const totalCells = Math.ceil((startWeekday + lastDay.getDate()) / 7) * 7;
  const today = new Date();

  for (let i = 0; i < totalCells; i++) {
    let year = state.currentYear;
    let month = state.currentMonth;
    let day;
    let muted = false;
    if (i < startWeekday) {
      day = prevLastDay.getDate() - startWeekday + i + 1;
      month -= 1;
      if (month < 0) { month = 11; year -= 1; }
      muted = true;
    } else if (i >= startWeekday + lastDay.getDate()) {
      day = i - (startWeekday + lastDay.getDate()) + 1;
      month += 1;
      if (month > 11) { month = 0; year += 1; }
      muted = true;
    } else {
      day = i - startWeekday + 1;
    }
    const dateKey = formatDateKey(year, month, day);
    const dayAvailability = state.availability.filter(item => item.date === dateKey);
    const dayEvents = state.events.filter(item => item.date === dateKey);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const cell = document.createElement('div');
    cell.className = `day ${muted ? 'muted' : ''} ${isToday ? 'today' : ''}`;
    cell.innerHTML = `
      <div class="day-top">
        <div class="date-num">${day}</div>
        <div class="day-actions">
          <button class="mini-btn" data-heart="${dateKey}">하트</button>
          <button class="mini-btn" data-schedule="${dateKey}">일정</button>
        </div>
      </div>
      <div class="heart-list">
        ${dayAvailability.map(item => {
          const member = getMemberById(item.member_id);
          if (!member) return '';
          return `<span class="heart" style="color:${member.color}" title="${sanitize(member.name)}">♥</span>`;
        }).join('')}
      </div>
      <div class="schedule-list">
        ${dayEvents.map(item => {
          const member = getMemberById(item.member_id);
          const name = member?.name || '멤버';
          const color = member?.color || '#cbd5e1';
          return `<div class="schedule-item" style="border-left-color:${color};background:${color}18"><strong>${sanitize(name)}</strong> ${sanitize(item.title || '(제목 없음)')}${item.memo ? `<div>${sanitize(item.memo)}</div>` : ''}</div>`;
        }).join('')}
      </div>`;
    calendar.appendChild(cell);
  }
  document.querySelectorAll('[data-heart]').forEach(btn => btn.addEventListener('click', () => toggleHeart(btn.dataset.heart)));
  document.querySelectorAll('[data-schedule]').forEach(btn => btn.addEventListener('click', () => openScheduleModal(btn.dataset.schedule)));
}

function openScheduleModal(date) {
  state.scheduleDate = date;
  qs('scheduleDate').value = date;
  qs('scheduleSlot').value = `${state.activeSlot}번 · ${getMemberBySlot(state.activeSlot).name}`;
  const currentMember = getMemberBySlot(state.activeSlot);
  const existing = state.events.find(item => item.date === date && item.member_id === currentMember.id);
  qs('scheduleTitle').value = existing?.title || '';
  qs('scheduleMemo').value = existing?.memo || '';
  qs('scheduleModal').classList.add('show');
}
function closeScheduleModal() {
  qs('scheduleModal').classList.remove('show');
  state.scheduleDate = null;
}

async function createRoom() {
  try {
    const slug = randomString(8);
    const token = randomString(24);
    const rooms = await supabaseFetch(`${API_BASE}/rooms`, {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ slug, token })
    });
    const room = rooms[0];
    state.roomId = room.id;
    setUrlState(room.slug, room.token);

    const seedMembers = [
      { room_id: room.id, slot: 1, name: "멤버 1", color: DEFAULT_COLORS[0] },
      { room_id: room.id, slot: 2, name: "멤버 2", color: DEFAULT_COLORS[1] },
      { room_id: room.id, slot: 3, name: "멤버 3", color: DEFAULT_COLORS[2] },
      { room_id: room.id, slot: 4, name: "멤버 4", color: DEFAULT_COLORS[3] }
    ];
    await supabaseFetch(`${API_BASE}/members`, {
      method: 'POST',
      body: JSON.stringify(seedMembers)
    });

    updateShareLinkBox();
    
    setTimeout(async () => {
      await loadRoomState();
      startPolling();
    }, 500);
  } catch (error) {
    alert(error.message);
  }
}

async function loadRoomState(showAlert = false) {
  if (!state.roomSlug || !state.roomToken) return;
  // [수정] 사용자가 조작(입력, 컬러 피커 조정) 중일 때는 서버로부터 자동 새로고침(백그라운드 폴링)을 일시 정지시킵니다.
  if (isEditingInput && !showAlert) return; 

  try {
    if (!state.roomId) {
      const rooms = await supabaseFetch(`${API_BASE}/rooms?slug=eq.${state.roomSlug}&token=eq.${state.roomToken}`);
      if (!rooms || rooms.length === 0) throw new Error('유효하지 않은 방 링크입니다.');
      state.roomId = rooms[0].id;
    }
    
    const [members, availability, events] = await Promise.all([
      supabaseFetch(`${API_BASE}/members?room_id=eq.${state.roomId}&order=slot`),
      supabaseFetch(`${API_BASE}/availability?room_id=eq.${state.roomId}`),
      supabaseFetch(`${API_BASE}/events?room_id=eq.${state.roomId}`)
    ]);

    state.members = members || [];
    state.availability = availability || [];
    state.events = events || [];
    renderAll();
    if (showAlert) alert('최신 상태로 갱신했습니다.');
  } catch (error) {
    console.error(error);
    if (showAlert) alert(error.message);
  }
}

async function upsertMember(slot, name, color, avatarUrl) {
  if (!state.roomId) throw new Error("방이 연결되지 않았습니다.");
  
  const existingColor = state.members.find(m => m.color.toLowerCase() === color.toLowerCase() && m.slot !== slot);
  if (existingColor) throw new Error("이미 다른 멤버가 사용 중인 색상입니다.");

  await supabaseFetch(`${API_BASE}/members?room_id=eq.${state.roomId}&slot=eq.${slot}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, color, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
  });
}

async function toggleHeart(date) {
  try {
    const member = state.members.find(m => m.slot === state.activeSlot);
    if (!member) return;

    const existing = state.availability.find(item => item.date === date && item.member_id === member.id);
    if (existing) {
      await supabaseFetch(`${API_BASE}/availability?room_id=eq.${state.roomId}&date=eq.${date}&member_id=eq.${member.id}`, {
        method: 'DELETE'
      });
    } else {
      await supabaseFetch(`${API_BASE}/availability`, {
        method: 'POST',
        body: JSON.stringify({ room_id: state.roomId, date, member_id: member.id })
      });
    }
    await loadRoomState(false);
  } catch (error) {
    alert(error.message);
  }
}

async function saveSchedule() {
  try {
    const member = state.members.find(m => m.slot === state.activeSlot);
    if (!member) return;

    const title = qs('scheduleTitle').value.trim();
    const memo = qs('scheduleMemo').value.trim();
    const existing = state.events.find(item => item.date === state.scheduleDate && item.member_id === member.id);

    if (existing) {
      await supabaseFetch(`${API_BASE}/events?room_id=eq.${state.roomId}&date=eq.${state.scheduleDate}&member_id=eq.${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, memo, updated_at: new Date().toISOString() })
      });
    } else {
      await supabaseFetch(`${API_BASE}/events`, {
        method: 'POST',
        body: JSON.stringify({ room_id: state.roomId, date: state.scheduleDate, member_id: member.id, title, memo })
      });
    }
    await loadRoomState();
    closeScheduleModal();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteSchedule() {
  try {
    const member = state.members.find(m => m.slot === state.activeSlot);
    if (!member) return;

    await supabaseFetch(`${API_BASE}/events?room_id=eq.${state.roomId}&date=eq.${state.scheduleDate}&member_id=eq.${member.id}`, {
      method: 'DELETE'
    });
    await loadRoomState();
    closeScheduleModal();
  } catch (error) {
    alert(error.message);
  }
}

function startPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = setInterval(() => {
    if (state.roomSlug && state.roomToken) loadRoomState(false);
  }, 4000);
}

function renderAll() {
  updateShareLinkBox();
  renderMembers();
  renderLegend();
  renderCalendar();
}

function bind() {
  qs('createRoomBtn').addEventListener('click', createRoom);
  qs('reloadBtn').addEventListener('click', () => loadRoomState(true));
  qs('copyLinkBtn').addEventListener('click', async () => {
    const text = qs('shareLinkBox').textContent;
    if (!text || text.includes('방을 만들면')) return;
    await navigator.clipboard.writeText(text);
    alert('공유 링크를 복사했습니다.');
  });
  qs('prevMonth').addEventListener('click', () => { state.currentMonth -= 1; if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear -= 1; } renderCalendar(); });
  qs('nextMonth').addEventListener('click', () => { state.currentMonth += 1; if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear += 1; } renderCalendar(); });
  qs('todayBtn').addEventListener('click', () => { const now = new Date(); state.currentMonth = now.getMonth(); state.currentYear = now.getFullYear(); renderCalendar(); });
  qs('closeModalBtn').addEventListener('click', closeScheduleModal);
  qs('saveScheduleBtn').addEventListener('click', saveSchedule);
  qs('deleteScheduleBtn').addEventListener('click', deleteSchedule);
  qs('scheduleModal').addEventListener('click', (e) => { if (e.target.id === 'scheduleModal') closeScheduleModal(); });
}

(function init() {
  bind();
  getUrlState();
  updateShareLinkBox();
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    showConfigWarning('index.html 하단의 window.APP_CONFIG에 Supabase URL / anon key를 넣으면 바로 연결됩니다.');
  } else {
    clearConfigWarning();
  }
  renderAll();
  if (state.roomSlug && state.roomToken && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    loadRoomState(false);
    startPolling();
  }
})();