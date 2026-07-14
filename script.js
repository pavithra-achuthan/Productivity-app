/* ============================= STATE ============================= */
let DB = {
  settings: { motivationMessage: "Small steps, every day.", streakBreakMessage: "It's okay — every streak starts again with day one. Get back on it today." },
  challenges: [],
  todos: []
};
let currentChallengeId = null;
let editingTaskId = null;
let activeTab = 'challenges';
 
/* ============================= UTIL ============================= */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function toKey(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function todayKey(){ return toKey(new Date()); }
function keyToDate(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(k, n){ const d=keyToDate(k); d.setDate(d.getDate()+n); return toKey(d); }
function dayDiff(a,b){ return Math.round((keyToDate(b)-keyToDate(a))/86400000); }
function fmtNice(k){ const d=keyToDate(k); return d.toLocaleDateString(undefined,{day:'numeric', month:'short', year:'numeric'}); }
function yearMonth(k){ return k.slice(0,7); }
function showToast(msg){
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2200);
}
function openModal(id){ document.getElementById(id).classList.add('show'); }
function closeModal(id){ document.getElementById(id).classList.remove('show'); }
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
 
/* ============================= STORAGE (offline, on-device) ============================= */
// Uses the phone browser's own localStorage — no network or server needed, works fully offline.
const STORAGE_PREFIX = 'streaks-app:';
function loadKey(key, fallback){
  try{ const raw = localStorage.getItem(STORAGE_PREFIX+key); return raw ? JSON.parse(raw) : fallback; }
  catch(e){ return fallback; }
}
function saveKey(key, value){
  try{ localStorage.setItem(STORAGE_PREFIX+key, JSON.stringify(value)); }
  catch(e){ console.error('save failed', key, e); showToast("Couldn't save — device storage may be full"); }
}
async function loadAll(){
  DB.settings = loadKey('settings', DB.settings);
  DB.challenges = loadKey('challenges', []).map(migrateChallenge);
  DB.todos = loadKey('todos', []);
}
function saveSettingsData(){ return saveKey('settings', DB.settings); }
function saveChallenges(){ return saveKey('challenges', DB.challenges); }
function saveTodos(){ return saveKey('todos', DB.todos); }
 
// Upgrades challenges saved by the older version of this app to the new per-day data shape.
function migrateChallenge(ch){
  if(!ch.days){
    ch.days = {};
    const comps = ch.completions || {};
    const cheats = ch.cheatDays || [];
    const allDates = new Set([...Object.keys(comps), ...cheats]);
    allDates.forEach(dateKey=>{
      const tasksMap = {};
      (comps[dateKey]||[]).forEach(taskId=>{ tasksMap[taskId] = true; });
      ch.days[dateKey] = { tasks: tasksMap, cheatUsed: cheats.includes(dateKey) };
    });
    delete ch.completions; delete ch.cheatDays;
  }
  ch.tasks = (ch.tasks||[]).map(t => ({
    id: t.id, name: t.name,
    createdDate: t.createdDate || ch.startDate,
    deletedDate: t.deletedDate || null
  }));
  if(ch.lastBreakNotified===undefined) ch.lastBreakNotified = null;
  return ch;
}
 
/* ============================= CHALLENGE LOGIC ============================= */
function getChallenge(id){ return DB.challenges.find(c=>c.id===id); }
 
function activeTasksForDay(ch, dateKey){
  return ch.tasks.filter(t => t.createdDate <= dateKey && (!t.deletedDate || dateKey < t.deletedDate));
}
 
function dayStatus(ch, key){
  if(key < ch.startDate || key > ch.endDate) return 'blank';
  const tKey = todayKey();
  if(key > tKey) return 'future';
  const rec = ch.days[key];
  if(rec && rec.cheatUsed) return 'cheat';
  const active = activeTasksForDay(ch, key);
  if(active.length===0) return 'empty'; // no tasks yet — neutral, doesn't count either way
  const doneCount = active.filter(t => rec && rec.tasks && rec.tasks[t.id]).length;
  if(doneCount===active.length) return 'complete';
  if(key===tKey) return 'pending';
  return 'missed';
}
 
function currentStreak(ch){
  let ptr = todayKey();
  let st = dayStatus(ch, ptr);
  if(st==='pending' || st==='future' || st==='blank') ptr = addDays(ptr,-1);
  let streak = 0;
  while(ptr >= ch.startDate){
    const s = dayStatus(ch, ptr);
    if(s==='complete' || s==='cheat'){ streak++; ptr = addDays(ptr,-1); }
    else if(s==='empty'){ ptr = addDays(ptr,-1); } // skip, don't count or break
    else break;
  }
  return streak;
}
function bestStreak(ch){
  let run=0, best=0, ptr = ch.startDate;
  const endLimit = todayKey() < ch.endDate ? todayKey() : ch.endDate;
  while(ptr <= endLimit){
    const s = dayStatus(ch, ptr);
    if(s==='complete' || s==='cheat'){ run++; best=Math.max(best,run); }
    else if(s==='missed'){ run=0; }
    // 'empty' days (no tasks yet) are skipped — run stays as is
    ptr = addDays(ptr,1);
  }
  return best;
}
function totalDays(ch){ return dayDiff(ch.startDate, ch.endDate) + 1; }
function completedDaysCount(ch){
  let count=0, ptr=ch.startDate;
  const endLimit = todayKey() < ch.endDate ? todayKey() : ch.endDate;
  while(ptr<=endLimit){ const s = dayStatus(ch, ptr); if(s==='complete'||s==='cheat') count++; ptr = addDays(ptr,1); }
  return count;
}
function cheatDaysUsedThisMonth(ch){
  const thisMonth = yearMonth(todayKey());
  return Object.keys(ch.days).filter(k => ch.days[k].cheatUsed && yearMonth(k)===thisMonth).length;
}
function isChallengeOver(ch){ return todayKey() > ch.endDate; }
 
/* ============================= RENDER: HOME ============================= */
function switchTab(tab){
  activeTab = tab;
  document.getElementById('tabChallengesBtn').classList.toggle('active', tab==='challenges');
  document.getElementById('tabTodoBtn').classList.toggle('active', tab==='todo');
  document.getElementById('panel-challenges').classList.toggle('active', tab==='challenges');
  document.getElementById('panel-todo').classList.toggle('active', tab==='todo');
  document.getElementById('fabAdd').style.display = tab==='challenges' ? 'flex' : 'none';
}
 
function renderHome(){
  const list = document.getElementById('challengeList');
  if(DB.challenges.length===0){
    list.innerHTML = `<div class="empty-state">
      <div class="eicon"></div><div class="etitle">No challenges yet</div>
      <div class="edesc">Tap the + button to start your first streak.</div></div>`;
  } else {
    list.innerHTML = DB.challenges.map(ch=>{
      const cs = currentStreak(ch), bs = bestStreak(ch);
      const done = completedDaysCount(ch), tot = totalDays(ch);
      const pct = tot>0 ? Math.min(100, Math.round(done/tot*100)) : 0;
      const over = isChallengeOver(ch);
      return `<div class="challenge-card" onclick="openChallenge('${ch.id}')">
        <div class="del-x" onclick="event.stopPropagation(); confirmDeleteChallenge('${ch.id}')">✕</div>
        <div class="cname">${escapeHtml(ch.name)}${over?'<span class="ended-badge">Ended</span>':''}</div>
        <div class="cdates">${fmtNice(ch.startDate)} → ${fmtNice(ch.endDate)}</div>
        <div class="streak-row">
          <div class="streak-pill"><span class="flame">🔥</span>${cs}</div>
          <div class="streak-pill best">best ${bs}</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-meta"><span>${done}/${tot} days</span><span>${pct}%</span></div>
      </div>`;
    }).join('');
  }
 
  const tlist = document.getElementById('todoList');
  if(DB.todos.length===0){
    tlist.innerHTML = `<div class="empty-state"><div class="eicon"></div><div class="etitle">Nothing on your list</div><div class="edesc">Add something above.</div></div>`;
  } else {
    tlist.innerHTML = DB.todos.map(t=>`
      <div class="todo-row ${t.completed?'done':''}">
        <div class="checkbox ${t.completed?'checked':''}" onclick="toggleTodo('${t.id}')">${t.completed?'✓':''}</div>
        <div class="ttext">${escapeHtml(t.text)}</div>
        <div class="tdel" onclick="deleteTodo('${t.id}')">✕</div>
      </div>`).join('');
  }
}
 
/* ============================= TODOS ============================= */
function addTodo(){
  const input = document.getElementById('newTodoInput');
  const text = input.value.trim(); if(!text) return;
  DB.todos.unshift({ id: uid(), text, completed:false });
  input.value=''; saveTodos(); renderHome();
}
function toggleTodo(id){ const t = DB.todos.find(x=>x.id===id); if(!t) return; t.completed = !t.completed; saveTodos(); renderHome(); }
function deleteTodo(id){ DB.todos = DB.todos.filter(x=>x.id!==id); saveTodos(); renderHome(); }
document.getElementById('newTodoInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addTodo(); });
 
/* ============================= NAVIGATION ============================= */
function showView(id){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function goHome(){ showView('view-home'); document.getElementById('fabAdd').style.display = activeTab==='challenges' ? 'flex' : 'none'; renderHome(); }
function goSettings(){
  document.getElementById('setMotivation').value = DB.settings.motivationMessage;
  document.getElementById('setBreakMsg').value = DB.settings.streakBreakMessage;
  document.getElementById('fabAdd').style.display='none';
  showView('view-settings');
}
 
/* ============================= DATE PICKER (calendar-only, no typing) ============================= */
let dpTarget = null; // 'start' | 'end'
let dpViewDate = new Date();
let chStartValue = null, chEndValue = null;
 
function updateDateDisplays(){
  const st = document.getElementById('chStartText'), et = document.getElementById('chEndText');
  st.textContent = chStartValue ? fmtNice(chStartValue) : 'Select date';
  et.textContent = chEndValue ? fmtNice(chEndValue) : 'Select date';
  document.getElementById('chStartDisplay').classList.toggle('placeholder', !chStartValue);
  document.getElementById('chEndDisplay').classList.toggle('placeholder', !chEndValue);
}
function openDatePicker(target){
  dpTarget = target;
  const cur = target==='start' ? chStartValue : chEndValue;
  dpViewDate = cur ? keyToDate(cur) : new Date();
  renderDatePicker();
  openModal('modalDatePicker');
}
function dpShiftMonth(n){ dpViewDate.setMonth(dpViewDate.getMonth()+n); renderDatePicker(); }
function renderDatePicker(){
  const y = dpViewDate.getFullYear(), m = dpViewDate.getMonth();
  document.getElementById('dpTitle').textContent = dpViewDate.toLocaleDateString(undefined,{month:'long', year:'numeric'});
  const firstDay = new Date(y,m,1);
  const lead = firstDay.getDay();
  const daysInMonth = new Date(y,m+1,0).getDate();
  const tKey = todayKey();
  const selected = dpTarget==='start' ? chStartValue : chEndValue;
  const minAllowed = dpTarget==='end' ? chStartValue : null;
  let html = '';
  for(let i=0;i<lead;i++) html += `<div class="dp-cell blank"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const key = toKey(new Date(y,m,d));
    const isToday = key===tKey;
    const isSelected = key===selected;
    const disabled = minAllowed && key < minAllowed;
    html += `<div class="dp-cell ${isToday?'today':''} ${isSelected?'selected':''} ${disabled?'disabled':''}" onclick="pickDate('${key}')">${d}</div>`;
  }
  document.getElementById('dpGrid').innerHTML = html;
}
function pickDate(key){
  if(dpTarget==='start'){
    chStartValue = key;
    if(chEndValue && chEndValue < chStartValue) chEndValue = chStartValue;
  } else {
    if(chStartValue && key < chStartValue){ showToast('End date must be on or after the start date'); return; }
    chEndValue = key;
  }
  updateDateDisplays();
  closeModal('modalDatePicker');
}
 
/* ============================= CREATE CHALLENGE ============================= */
function openCreateChallenge(){
  document.getElementById('chName').value='';
  chStartValue = todayKey();
  chEndValue = addDays(todayKey(), 30);
  updateDateDisplays();
  openModal('modalCreateChallenge');
}
function createChallenge(){
  const name = document.getElementById('chName').value.trim();
  if(!name){ showToast('Give your challenge a name'); return; }
  if(!chStartValue || !chEndValue){ showToast('Pick a start and end date'); return; }
  if(chEndValue < chStartValue){ showToast('End date must be on or after the start date'); return; }
  const ch = { id: uid(), name, startDate:chStartValue, endDate:chEndValue, tasks:[], days:{}, lastBreakNotified:null };
  DB.challenges.unshift(ch);
  saveChallenges();
  closeModal('modalCreateChallenge');
  openChallenge(ch.id);
}
 
/* ============================= CHALLENGE DETAIL ============================= */
function openChallenge(id){
  currentChallengeId = id;
  const ch = getChallenge(id); if(!ch) return;
 
  const yKey = addDays(todayKey(),-1);
  if(yKey >= ch.startDate && dayStatus(ch,yKey)==='missed' && ch.lastBreakNotified!==yKey && bestStreak(ch)>0 && currentStreak(ch)===0){
    ch.lastBreakNotified = yKey; saveChallenges();
    document.getElementById('streakBreakText').textContent = DB.settings.streakBreakMessage;
    openModal('modalStreakBreak');
  }
 
  document.getElementById('detailTitle').textContent = ch.name;
  showView('view-detail');
  document.getElementById('fabAdd').style.display='none';
  renderDetail();
}
 
function renderDetail(){
  const ch = getChallenge(currentChallengeId); if(!ch) return;
  const cs = currentStreak(ch), bs = bestStreak(ch);
  const done = completedDaysCount(ch), tot = totalDays(ch);
  const pct = tot>0 ? Math.min(100, Math.round(done/tot*100)) : 0;
  const tKey = todayKey();
  const over = isChallengeOver(ch);
  const inRange = tKey>=ch.startDate && tKey<=ch.endDate;
  const rec = ch.days[tKey];
  const todayActiveTasks = activeTasksForDay(ch, tKey);
  const isCheatToday = !!(rec && rec.cheatUsed);
  const cheatUsedMonth = cheatDaysUsedThisMonth(ch);
  const cheatLeft = 5 - cheatUsedMonth;
  const todayStatus = dayStatus(ch, tKey);
  const locked = over || !inRange;
 
  document.getElementById('detailScroll').innerHTML = `
    ${over ? `<div class="ended-banner">This challenge ended on ${fmtNice(ch.endDate)}. It's now read-only.</div>` : ''}
    <div class="hero-stats">
      <div class="hero-stat"><div class="val flamecol" id="curStreakVal">🔥 ${cs}</div><div class="lbl">Current</div></div>
      <div class="hero-divider"></div>
      <div class="hero-stat"><div class="val">${bs}</div><div class="lbl">Best</div></div>
      <div class="hero-divider"></div>
      <div class="hero-stat"><div class="val">${pct}%</div><div class="lbl">Progress</div></div>
    </div>
 
    <div class="card-block">
      <div class="block-head">
        <h3>Today's tasks</h3>
        <div class="add-link ${locked?'disabled':''}" onclick="openTaskModal()">+ Add task</div>
      </div>
      ${ch.tasks.length===0 ? `<div class="hint">Add tasks below — complete all of them each day to keep your streak alive.</div>` :
        todayActiveTasks.length===0 ? `<div class="hint">No tasks apply to today yet.</div>` :
        todayActiveTasks.map(t=>{
          const isDone = !!(rec && rec.tasks && rec.tasks[t.id]);
          return `<div class="task-row ${isDone?'done':''}">
            <div class="checkbox ${isDone?'checked':''} ${locked?'disabled':''}" onclick="toggleTaskToday('${t.id}')">${isDone?'✓':''}</div>
            <div class="tname">${escapeHtml(t.name)}</div>
            <div class="tactions">
              <span onclick="openTaskModal('${t.id}')">✎</span>
              <span onclick="deleteTask('${t.id}')">✕</span>
            </div>
          </div>`;
        }).join('')
      }
    </div>
 
    <div class="card-block">
      <div class="block-head"><h3>Cheat days</h3></div>
      <div class="cheat-row">
        <div class="cheat-info"><div class="cnum">${Math.max(0,cheatLeft)}/5</div><div class="clbl">left this month</div></div>
        <button class="cheat-btn" ${(locked || (!isCheatToday && (cheatLeft<=0 || todayStatus==='complete'))) ? 'disabled':''} onclick="useCheatDay()">
          ${isCheatToday ? 'Undo cheat day' : 'Use for today'}
        </button>
      </div>
      <div class="cheat-dots">${[0,1,2,3,4].map(i=>`<div class="cheat-dot ${i < cheatUsedMonth ? 'used':''}"></div>`).join('')}</div>
      <div class="cheat-reset-link" onclick="confirmResetCheatDays()">Reset cheat days</div>
    </div>
 
    <div class="card-block">
      <div class="block-head"><h3>Calendar</h3></div>
      ${renderCalendar(ch)}
      <div class="hint">🟢 complete · 🟠 cheat day · 🔴 missed</div>
    </div>
 
    <div class="card-block danger-zone">
      <button class="btn btn-danger btn-sm" onclick="confirmDeleteChallenge('${ch.id}', true)">Delete this challenge</button>
    </div>
  `;
}
 
function renderCalendar(ch){
  const start = keyToDate(ch.startDate);
  const leadBlanks = start.getDay();
  let cells = '';
  for(let i=0;i<leadBlanks;i++) cells += `<div class="cal-cell blank"></div>`;
  let ptr = ch.startDate;
  while(ptr <= ch.endDate){
    const s = dayStatus(ch, ptr);
    const cls = s==='complete'?'complete':s==='cheat'?'cheat':s==='missed'?'missed':'';
    const today = ptr===todayKey() ? 'today':'';
    const d = keyToDate(ptr).getDate();
    cells += `<div class="cal-cell ${cls} ${today}">${d}</div>`;
    ptr = addDays(ptr,1);
  }
  return `<div class="calendar-grid">${cells}</div>`;
}
 
function toggleTaskToday(taskId){
  const ch = getChallenge(currentChallengeId); if(!ch) return;
  const tKey = todayKey();
  if(tKey < ch.startDate || tKey > ch.endDate){ showToast("This challenge isn't active today"); return; }
  if(!ch.days[tKey]) ch.days[tKey] = { tasks:{}, cheatUsed:false };
  const rec = ch.days[tKey];
  const activeToday = activeTasksForDay(ch, tKey);
  const wasComplete = activeToday.length>0 && activeToday.every(t => rec.tasks[t.id]);
  rec.tasks[taskId] = !rec.tasks[taskId];
  const nowComplete = activeToday.length>0 && activeToday.every(t => rec.tasks[t.id]);
  saveChallenges();
  renderDetail();
  renderHome();
  if(!wasComplete && nowComplete){
    showToast('Day complete — streak up! 🔥');
    const el = document.getElementById('curStreakVal');
    if(el){ el.classList.add('pulse'); setTimeout(()=>el.classList.remove('pulse'),500); }
  } else if(wasComplete && !nowComplete){
    showToast('Task unchecked — streak updated');
  }
}
 
function openTaskModal(taskId){
  editingTaskId = taskId || null;
  document.getElementById('taskModalTitle').textContent = taskId ? 'Edit task' : 'Add task';
  const ch = getChallenge(currentChallengeId);
  document.getElementById('taskNameInput').value = taskId ? (ch.tasks.find(t=>t.id===taskId)?.name || '') : '';
  document.getElementById('taskHint').textContent = taskId ? '' : 'This task will apply from today onward — it won\u2019t change past days.';
  openModal('modalTask');
}
function saveTaskModal(){
  const name = document.getElementById('taskNameInput').value.trim();
  if(!name){ showToast('Task needs a name'); return; }
  const ch = getChallenge(currentChallengeId);
  if(editingTaskId){
    const t = ch.tasks.find(t=>t.id===editingTaskId);
    if(t) t.name = name;
  } else {
    ch.tasks.push({ id: uid(), name, createdDate: todayKey(), deletedDate: null });
  }
  saveChallenges();
  closeModal('modalTask');
  renderDetail();
}
function deleteTask(taskId){
  const ch = getChallenge(currentChallengeId);
  const t = ch.tasks.find(t=>t.id===taskId);
  if(t) t.deletedDate = todayKey(); // stops applying from today forward; past days keep their record
  saveChallenges();
  renderDetail(); renderHome();
}
 
function useCheatDay(){
  const ch = getChallenge(currentChallengeId); if(!ch) return;
  const tKey = todayKey();
  if(!ch.days[tKey]) ch.days[tKey] = { tasks:{}, cheatUsed:false };
  if(ch.days[tKey].cheatUsed){
    ch.days[tKey].cheatUsed = false;
    saveChallenges();
    renderDetail(); renderHome();
    showToast('Cheat day undone');
    return;
  }
  if(cheatDaysUsedThisMonth(ch) >= 5){ showToast('No cheat days left this month'); return; }
  ch.days[tKey].cheatUsed = true;
  saveChallenges();
  renderDetail(); renderHome();
  showToast('Cheat day used — streak protected');
}
function confirmResetCheatDays(){
  document.getElementById('confirmIcon').textContent = '';
  document.getElementById('confirmTitle').textContent = 'Reset cheat days?';
  document.getElementById('confirmText').textContent = "This clears every cheat day used on this challenge, giving you a fresh 5 for this month. This can't be undone.";
  const btn = document.getElementById('confirmActionBtn');
  btn.onclick = ()=>{
    const ch = getChallenge(currentChallengeId);
    Object.keys(ch.days).forEach(k => { ch.days[k].cheatUsed = false; });
    saveChallenges();
    closeModal('modalConfirm');
    renderDetail(); renderHome();
    showToast('Cheat days reset');
  };
  openModal('modalConfirm');
}
 
/* ============================= DELETE / RESET CONFIRM ============================= */
function confirmDeleteChallenge(id, fromDetail){
  document.getElementById('confirmIcon').textContent = '';
  document.getElementById('confirmTitle').textContent = 'Delete challenge?';
  document.getElementById('confirmText').textContent = "This removes the challenge, its tasks and all progress. This can't be undone.";
  const btn = document.getElementById('confirmActionBtn');
  btn.onclick = ()=>{
    DB.challenges = DB.challenges.filter(c=>c.id!==id);
    saveChallenges();
    closeModal('modalConfirm');
    if(fromDetail) goHome(); else renderHome();
    showToast('Challenge deleted');
  };
  openModal('modalConfirm');
}
function confirmResetAll(){
  document.getElementById('confirmIcon').textContent = '⚠️';
  document.getElementById('confirmTitle').textContent = 'Reset all data?';
  document.getElementById('confirmText').textContent = 'This permanently deletes every challenge, to-do item, and setting on this device.';
  const btn = document.getElementById('confirmActionBtn');
  btn.onclick = async ()=>{
    DB = { settings:{motivationMessage:"Small steps, every day.", streakBreakMessage:"It's okay — every streak starts again with day one. Get back on it today."}, challenges:[], todos:[] };
    await Promise.all([saveSettingsData(), saveChallenges(), saveTodos()]);
    closeModal('modalConfirm');
    goHome();
    showToast('All data reset');
  };
  openModal('modalConfirm');
}
 
/* ============================= SETTINGS ============================= */
function saveSettingsForm(){
  DB.settings.motivationMessage = document.getElementById('setMotivation').value.trim() || 'Small steps, every day.';
  DB.settings.streakBreakMessage = document.getElementById('setBreakMsg').value.trim() || "It's okay — every streak starts again with day one.";
  saveSettingsData();
  showToast('Settings saved');
}
function exportBackup(){
  try{
    const blob = new Blob([JSON.stringify(DB, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `streaks-backup-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup downloaded');
  }catch(e){ showToast('Export failed on this device'); }
}
function importBackup(evt){
  const file = evt.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.settings || !Array.isArray(parsed.challenges) || !Array.isArray(parsed.todos)) throw new Error('bad shape');
      DB = parsed;
      DB.challenges = DB.challenges.map(migrateChallenge);
      await Promise.all([saveSettingsData(), saveChallenges(), saveTodos()]);
      showToast('Backup restored');
      goHome();
    }catch(e){ showToast('That file could not be read'); }
  };
  reader.readAsText(file);
  evt.target.value = '';
}
 
/* ============================= BOOT ============================= */
async function boot(){
  const started = Date.now();
  await loadAll();
  document.getElementById('splashMsg').textContent = DB.settings.motivationMessage;
  const elapsed = Date.now() - started;
  const wait = Math.max(0, 3000 - elapsed);
  setTimeout(()=>{
    document.getElementById('splash').classList.add('hide');
    document.getElementById('app').classList.add('show');
    renderHome();
    setTimeout(()=>{ document.getElementById('splash').style.display='none'; }, 650);
  }, wait);
}
boot();