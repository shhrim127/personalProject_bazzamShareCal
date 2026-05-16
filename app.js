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
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

function randomString(length = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length))).map((v) => chars[v % chars.length]).join("");
}

async function supabaseFetch(url, options = {}) {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL === 'YOUR_SUPABASE_URL') return null;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': CONFIG.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function updateShareLinkBox() {
  if (state.roomSlug && state.roomToken) {
    qs('shareLinkBox').textContent = `${location.origin}${location.pathname}?room=${state.roomSlug}&token=${state.roomToken}`;
  }
}

function renderLegend() {
  const active = getMemberBySlot(state.activeSlot);
  const btn = qs('activeMemberBtn');
  if(btn) {
    btn.textContent = `나: ${active.name}`;
    btn.style.background = active.color || '#6d5dfc';
  }
}

let isEditingInput = false;

function renderMembers() {
  if (isEditingInput) return;

  qs('memberGrid').innerHTML = [1, 2, 3, 4].map((slot) => {
    const member = getMemberBySlot(slot);
    return `
      <div class="member-card" style="border-left: 5px solid ${member.color}">
        <div class="member-header">
          <div class="member-title">
            <div class="avatar"><img src="${member.avatar_url || makeAvatar(member)}" alt="" /></div>
            <div class="field" style="margin-left:4px;">
              <input type="text" data-name-slot="${slot}" value="${sanitize(member.name)}" placeholder="이름 변경" style="width:110px; padding:4px 6px;" />
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="color" data-color-slot="${slot}" value="${member.color}" style="width:28px; height:24px; border:none; cursor:pointer; background:none;" />
            <button class="secondary active-select" data-active-slot="${slot}" style="padding:4px 8px; font-size:11px; background:${state.activeSlot === slot ? member.color : '#edf2ff'}; color:${state.activeSlot === slot ? '#fff' : '#334155'}">
              ${state.activeSlot === slot ? '선택됨' : '선택'}
            </button>
          </div>
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
    input.addEventListener('blur', async () => { isEditingInput = false; await handleAutoSave(Number(input.dataset.nameSlot)); });
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter') input.blur(); });
  });

  document.querySelectorAll('[data-color-slot]').forEach(input => {
    input.addEventListener('click', () => { isEditingInput = true; });
    input.addEventListener('change', async () => { isEditingInput = false; await handleAutoSave(Number(input.dataset.colorSlot)); });
  });
}

async function handleAutoSave(slot) {
  const nameInput = document.querySelector(`[data-name-slot="${slot}"]`);
  const colorInput = document.querySelector(`[data-color-slot="${slot}"]`);
  if(!nameInput || !colorInput) return;
  await upsertMember(slot, nameInput.value.trim() || `멤버 ${slot}`, colorInput.value, getMemberBySlot(slot).avatar_url);
  await loadRoomState();
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
    let year = state.currentYear, month = state.currentMonth, day, muted = false;
    if (i < startWeekday) {
      day = prevLastDay.getDate() - startWeekday + i + 1; month -= 1;
      if (month < 0) { month = 11; year -= 1; } muted = true;
    } else if (i >= startWeekday + lastDay.getDate()) {
      day = i - (startWeekday + lastDay.getDate()) + 1; month += 1;
      if (month > 11) { month = 0; year += 1; } muted = true;
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
      <div class="date-num">${day}</div>
      <div class="indicator-row">
        ${dayAvailability.map(item => {
          const m = getMemberById(item.member_id);
          return m ? `<span class="heart-dot" style="color:${m.color}">♥</span>` : '';
        }).join('')}
        ${dayEvents.map(item => {
          const m = getMemberById(item.member_id);
          return m ? `<span class="event-badge" style="background:${m.color}"></span>` : '';
        }).join('')}
      </div>`;
      
    cell.addEventListener('click', () => openDayModal(dateKey));
    calendar.appendChild(cell);
  }
}

function openDayModal(date) {
  state.scheduleDate = date;
  qs('modalDateTitle').textContent = `${date} 일정 상세`;
  
  const dayEvents = state.events.filter(item => item.date === date);
  const listEl = qs('modalEventList');
  
  if(dayEvents.length === 0) {
    listEl.innerHTML = `<div style="color:#64748b; font-size:12px; text-align:center; padding:8px;">등록된 일정이 없습니다.</div>`;
  } else {
    listEl.innerHTML = dayEvents.map(item => {
      const m = getMemberById(item.member_id);
      return `
        <div class="modal-event-item" style="border-left-color: ${m?.color || '#cbd5e1'}">
          <div class="evt-title"><strong>${sanitize(m?.name || '멤버')}</strong>: ${sanitize(item.title || '(제목 없음)')}</div>
          ${item.memo ? `<div class="evt-memo">${sanitize(item.memo)}</div>` : ''}
        </div>`;
    }).join('');
  }

  const currentMember = getMemberBySlot(state.activeSlot);
  const existing = state.events.find(item => item.date === date && item.member_id === currentMember.id);
  qs('scheduleTitle').value = existing?.title || '';
  qs('scheduleMemo').value = existing?.memo || '';
  
  const hasHeart = state.availability.find(item => item.date === date && item.member_id === currentMember.id);
  qs('modalHeartBtn').textContent = hasHeart ? "♥ 하트 취소" : "♡ 하트 누르기";
  qs('modalHeartBtn').style.background = hasHeart ? "#ff6b81" : "#edf2ff";
  qs('modalHeartBtn').style.color = hasHeart ? "#fff" : "#334155";

  qs('scheduleModal').classList.add('show');
}

function closeScheduleModal() {
  qs('scheduleModal').classList.remove('show');
  state.scheduleDate = null;
}

async function toggleHeartModal() {
  try {
    const member = state.members.find(m => m.slot === state.activeSlot);
    if (!member) return;
    const date = state.scheduleDate;
    const existing = state.availability.find(item => item.date === date && item.member_id === member.id);
    if (existing) {
      await supabaseFetch(`${API_BASE}/availability?room_id=eq.${state.roomId}&date=eq.${date}&member_id=eq.${member.id}`, { method: 'DELETE' });
    } else {
      await supabaseFetch(`${API_BASE}/availability`, { method: 'POST', body: JSON.stringify({ room_id: state.roomId, date, member_id: member.id }) });
    }
    await loadRoomState();
    openDayModal(date);
  } catch (e) {}
}

async function saveSchedule() {
  try {
    const member = state.members.find(m => m.slot === state.activeSlot);
    if (!member) return;
    const title = qs('scheduleTitle').value.trim();
    const memo = qs('scheduleMemo').value.trim();
    if(!title) { alert('일정 제목을 입력하세요.'); return; }

    const existing = state.events.find(item => item.date === state.scheduleDate && item.member_id === member.id);
    if (existing) {
      await supabaseFetch(`${API_BASE}/events?room_id=eq.${state.roomId}&date=eq.${state.scheduleDate}&member_id=eq.${member.id}`, {
        method: 'PATCH', body: JSON.stringify({ title, memo, updated_at: new Date().toISOString() })
      });
    } else {
      await supabaseFetch(`${API_BASE}/events`, {
        method: 'POST', body: JSON.stringify({ room_id: state.roomId, date: state.scheduleDate, member_id: member.id, title, memo })
      });
    }
    await loadRoomState();
    closeScheduleModal();
  } catch (e) {}
}

async function deleteSchedule() {
  try {
    const member = state.members.find(m => m.slot === state.activeSlot);
    if (!member) return;
    await supabaseFetch(`${API_BASE}/events?room_id=eq.${state.roomId}&date=eq.${state.scheduleDate}&member_id=eq.${member.id}`, { method: 'DELETE' });
    await loadRoomState();
    closeScheduleModal();
  } catch (e) {}
}

async function createRoom() {
  try {
    const slug = randomString(8), token = randomString(24);
    const rooms = await supabaseFetch(`${API_BASE}/rooms`, { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify({ slug, token }) });
    const room = rooms[0];
    state.roomId = room.id; setUrlState(room.slug, room.token);
    const seedMembers = [
      { room_id: room.id, slot: 1, name: "멤버 1", color: DEFAULT_COLORS[0] },
      { room_id: room.id, slot: 2, name: "멤버 2", color: DEFAULT_COLORS[1] },
      { room_id: room.id, slot: 3, name: "멤버 3", color: DEFAULT_COLORS[2] },
      { room_id: room.id, slot: 4, name: "멤버 4", color: DEFAULT_COLORS[3] }
    ];
    await supabaseFetch(`${API_BASE}/members`, { method: 'POST', body: JSON.stringify(seedMembers) });
    updateShareLinkBox();
    setTimeout(async () => { await loadRoomState(); startPolling(); }, 500);
  } catch (e) {}
}

async function loadRoomState() {
  if (!state.roomSlug || !state.roomToken) return;
  if (isEditingInput) return; 
  try {
    if (!state.roomId) {
      const rooms = await supabaseFetch(`${API_BASE}/rooms?slug=eq.${state.roomSlug}&token=eq.${state.roomToken}`);
      if (!rooms || rooms.length === 0) return;
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
  } catch (e) {}
}

async function upsertMember(slot, name, color, avatarUrl) {
  if (!state.roomId) return;
  await supabaseFetch(`${API_BASE}/members?room_id=eq.${state.roomId}&slot=eq.${slot}`, {
    method: 'PATCH', body: JSON.stringify({ name, color, avatar_url: avatarUrl, updated_at: new Date().toISOString() })
  });
}

function startPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = setInterval(() => { if (state.roomSlug && state.roomToken) loadRoomState(); }, 4000);
}
function renderAll() { updateShareLinkBox(); renderMembers(); renderLegend(); renderCalendar(); }

function bind() {
  qs('createRoomBtn').addEventListener('click', createRoom);
  qs('copyLinkBtn').addEventListener('click', async () => {
    const text = qs('shareLinkBox').textContent;
    if (!text || text.includes('방을 만들면')) return;
    await navigator.clipboard.writeText(text); alert('공유 링크를 복사했습니다.');
  });
  qs('prevMonth').addEventListener('click', () => { state.currentMonth -= 1; if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear -= 1; } renderCalendar(); });
  qs('nextMonth').addEventListener('click', () => { state.currentMonth += 1; if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear += 1; } renderCalendar(); });
  qs('closeModalBtn').addEventListener('click', closeScheduleModal);
  qs('saveScheduleBtn').addEventListener('click', saveSchedule);
  qs('deleteScheduleBtn').addEventListener('click', deleteSchedule);
  qs('modalHeartBtn').addEventListener('click', toggleHeartModal);
}

(function init() {
  bind(); getUrlState(); updateShareLinkBox(); renderAll();
  if (state.roomSlug && state.roomToken) { loadRoomState(); startPolling(); }
})();