// =============================================================================
// YUMA v2.0 — ОБНОВЛЕНИЕ: Календарь, Заметки, Журнал, Напоминания
// Подключается к обеим версиям: Electron И Tauri
// Добавить в index.html ПЕРЕД renderer.js:
//   <script src="yuma-update-v2.js"></script>
// =============================================================================

(function () {
'use strict';

// =============================================================================
// ── ХРАНИЛИЩЕ (IndexedDB + LocalStorage fallback)
// =============================================================================

var DB = {
  _db: null,

  open() {
    return new Promise((resolve, reject) => {
      if (this._db) return resolve(this._db);
      var req = indexedDB.open('YumaDB', 2);
      req.onupgradeneeded = (e) => {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('events')) {
          var es = db.createObjectStore('events', { keyPath: 'id' });
          es.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('log')) {
          db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = () => reject(req.error);
    });
  },

  async getAll(store) {
    var db = await this.open();
    return new Promise((resolve, reject) => {
      var tx  = db.transaction(store, 'readonly');
      var req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  async put(store, item) {
    var db = await this.open();
    return new Promise((resolve, reject) => {
      var tx  = db.transaction(store, 'readwrite');
      var req = tx.objectStore(store).put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  async delete(store, id) {
    var db = await this.open();
    return new Promise((resolve, reject) => {
      var tx  = db.transaction(store, 'readwrite');
      var req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  },

  async clear(store) {
    var db = await this.open();
    return new Promise((resolve, reject) => {
      var tx  = db.transaction(store, 'readwrite');
      var req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }
};

// =============================================================================
// ── ГЕНЕРАТОР ID
// =============================================================================
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// =============================================================================
// ── УТИЛИТЫ ДАТ
// =============================================================================
var DateUtil = {
  todayStr()  { return new Date().toISOString().slice(0,10); },
  nowStr()    { return new Date().toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit' }); },
  fmtDate(d)  {
    var dt = new Date(d);
    return dt.toLocaleDateString('ru', { day:'2-digit', month:'2-digit', year:'numeric' });
  },
  fmtTime(t)  { return t || ''; },
  fmtDateTime(d, t) {
    return this.fmtDate(d) + (t ? ' ' + t : '');
  },
  daysInMonth(y, m) { return new Date(y, m+1, 0).getDate(); },
  firstDayOfMonth(y, m) {
    var d = new Date(y, m, 1).getDay();
    return d === 0 ? 6 : d - 1; // Пн=0
  },
  parseRelative(text) {
    // Парсим относительные напоминания: "через 10 минут", "через 2 часа", "через 1 день"
    var now = Date.now();
    var m;
    if ((m = text.match(/через\s+(\d+)\s*(мин|минут|м)/i)))   return now + parseInt(m[1]) * 60000;
    if ((m = text.match(/через\s+(\d+)\s*(ч|час|часов)/i)))   return now + parseInt(m[1]) * 3600000;
    if ((m = text.match(/через\s+(\d+)\s*(д|день|дней)/i)))   return now + parseInt(m[1]) * 86400000;
    if ((m = text.match(/^(\d+)m$/i)))   return now + parseInt(m[1]) * 60000;
    if ((m = text.match(/^(\d+)h$/i)))   return now + parseInt(m[1]) * 3600000;
    if ((m = text.match(/^(\d+)d$/i)))   return now + parseInt(m[1]) * 86400000;
    return null;
  }
};

// =============================================================================
// ── МЕНЕДЖЕР СОБЫТИЙ (CRUD)
// =============================================================================

var CalendarManager = {
  _events: [],

  async load() {
    this._events = await DB.getAll('events');
    return this._events;
  },

  async save(ev) {
    await DB.put('events', ev);
    var idx = this._events.findIndex(e => e.id === ev.id);
    if (idx >= 0) this._events[idx] = ev;
    else this._events.push(ev);
  },

  async remove(id) {
    await DB.delete('events', id);
    this._events = this._events.filter(e => e.id !== id);
  },

  forDate(dateStr) {
    return this._events.filter(e => e.date === dateStr)
                       .sort((a,b) => (a.time||'').localeCompare(b.time||''));
  },

  forMonth(year, month) {
    var prefix = `${year}-${String(month+1).padStart(2,'0')}`;
    return this._events.filter(e => e.date && e.date.startsWith(prefix));
  },

  upcomingReminders() {
    var now = Date.now();
    return this._events.filter(e => e.reminderAt && !e.reminded && e.reminderAt <= now);
  },

  create(title, date, time, type, reminderOffset) {
    var ev = {
      id:          uid(),
      title,
      date:        date || DateUtil.todayStr(),
      time:        time || '',
      type:        type || 'personal',
      reminderOffset: reminderOffset || 15,
      reminded:    false,
      createdAt:   Date.now(),
    };
    // reminderAt = время события минус offset минут
    if (date && time) {
      var eventTs = new Date(date + 'T' + time).getTime();
      ev.reminderAt = eventTs - (reminderOffset || 15) * 60000;
    }
    return ev;
  }
};

// =============================================================================
// ── МЕНЕДЖЕР ЗАМЕТОК (CRUD)
// =============================================================================

var NotesManager = {
  _notes: [],

  async load() {
    this._notes = await DB.getAll('notes');
    this._notes.sort((a,b) => b.createdAt - a.createdAt);
    return this._notes;
  },

  async save(note) {
    await DB.put('notes', note);
    var idx = this._notes.findIndex(n => n.id === note.id);
    if (idx >= 0) this._notes[idx] = note;
    else this._notes.unshift(note);
  },

  async remove(id) {
    await DB.delete('notes', id);
    this._notes = this._notes.filter(n => n.id !== id);
  },

  create(text, isReminder, reminderAt) {
    return {
      id:         uid(),
      text,
      done:       false,
      isReminder: !!isReminder,
      reminderAt: reminderAt || null,
      reminded:   false,
      pinned:     false,
      createdAt:  Date.now(),
    };
  },

  upcomingReminders() {
    var now = Date.now();
    return this._notes.filter(n => n.isReminder && n.reminderAt && !n.reminded && n.reminderAt <= now);
  }
};

// =============================================================================
// ── МЕНЕДЖЕР ЖУРНАЛА (улучшенный)
// =============================================================================

var LogManager = {
  _entries: [],
  MAX: 100,

  async load() {
    var all = await DB.getAll('log');
    this._entries = all.sort((a,b) => a.id - b.id).slice(-this.MAX);
    return this._entries;
  },

  async add(sender, text, type) {
    var entry = {
      sender,
      text,
      type: type || 'chat',
      time: DateUtil.nowStr(),
      ts:   Date.now(),
    };
    await DB.put('log', entry);
    this._entries.push(entry);
    if (this._entries.length > this.MAX) {
      this._entries.shift();
    }
    return entry;
  },

  async clear() {
    await DB.clear('log');
    this._entries = [];
  },

  filter(type) {
    if (!type || type === 'all') return this._entries;
    return this._entries.filter(e => e.type === type);
  }
};

// =============================================================================
// ── СИСТЕМА НАПОМИНАНИЙ (тикер каждые 30 сек)
// =============================================================================

var ReminderSystem = {
  _timer: null,

  start() {
    this.check();
    this._timer = setInterval(() => this.check(), 30000);
  },

  async check() {
    // Напоминания из событий
    var evReminders = CalendarManager.upcomingReminders();
    for (var ev of evReminders) {
      ev.reminded = true;
      await CalendarManager.save(ev);
      this.trigger('event', ev.title, ev.time);
    }
    // Напоминания из заметок
    var noteReminders = NotesManager.upcomingReminders();
    for (var note of noteReminders) {
      note.reminded = true;
      await NotesManager.save(note);
      this.trigger('note', note.text);
    }
  },

  trigger(type, text, time) {
    var msg = type === 'event'
      ? `⏰ Напоминание: «${text}»${time ? ' в ' + time : ''}`
      : `⏰ ${text}`;

    // Кот реагирует
    if (typeof window.showCatMessage === 'function') {
      window.showCatMessage(msg);
    }
    // В журнал
    if (typeof window.addLog === 'function') {
      window.addLog('🔔 Юма', msg, 'system');
    }
    LogManager.add('🔔 Юма', msg, 'system');

    // Системное уведомление браузера
    if (Notification && Notification.permission === 'granted') {
      new Notification('Юма напоминает', { body: text, icon: 'cat.png' });
    }

    // Звук
    if (typeof window.play8BitSound === 'function') {
      window.play8BitSound('notification');
    }

    // Обновить UI если открыт
    if (CalendarUI.visible)  CalendarUI.refresh();
    if (NotesUI.visible)     NotesUI.refresh();
  }
};

// =============================================================================
// ── ПАРСЕР КОМАНД (/remind, /note, /cal и натуральный язык)
// =============================================================================

var CommandParser = {
  // Вызывается из renderer.js перед отправкой в AI
  async intercept(text) {
    var t = text.trim();

    // /remind 10m Текст напоминания
    var remMatch = t.match(/^\/remind\s+(\S+)\s+(.+)/i);
    if (remMatch) {
      var ts = DateUtil.parseRelative(remMatch[1]);
      if (ts) {
        var note = NotesManager.create(remMatch[2], true, ts);
        await NotesManager.save(note);
        var mins = Math.round((ts - Date.now()) / 60000);
        return `Запомнила! Напомню через ${mins} мин: «${remMatch[2]}» 🐾`;
      }
    }

    // /note Текст заметки
    var noteMatch = t.match(/^\/note\s+(.+)/i);
    if (noteMatch) {
      var note2 = NotesManager.create(noteMatch[1]);
      await NotesManager.save(note2);
      NotesUI.refresh();
      return `Записала в блокнот: «${noteMatch[1]}» 📝`;
    }

    // /cal — открыть календарь
    if (t.match(/^\/cal\b/i)) {
      CalendarUI.show();
      return 'Открываю календарь! 📅';
    }

    // Натуральный язык — "напомни мне", "запомни", "запиши"
    if (t.match(/^(напомни|напомните)\s+мне\s+через\s+(\d+)\s*(мин|минут|час|ч)\s+(.+)/i)) {
      var nm = t.match(/через\s+(\d+)\s*(мин|минут|ч|час)\s+(.+)/i);
      if (nm) {
        var isHour = nm[2].startsWith('ч');
        var ms2    = parseInt(nm[1]) * (isHour ? 3600000 : 60000);
        var note3  = NotesManager.create(nm[3], true, Date.now() + ms2);
        await NotesManager.save(note3);
        var unit   = isHour ? 'ч' : 'мин';
        return `Хорошо! Напомню через ${nm[1]} ${unit}: «${nm[3]}» ⏰`;
      }
    }

    if (t.match(/^(запомни|запиши|записать|создай заметку[:]?)\s+(.+)/i)) {
      var zm = t.match(/(?:запомни|запиши|записать|создай заметку[:]?)\s+(.+)/i);
      if (zm) {
        var note4 = NotesManager.create(zm[1]);
        await NotesManager.save(note4);
        NotesUI.refresh();
        return `Записала: «${zm[1]}» 📝`;
      }
    }

    return null; // не перехвачено — отправлять в AI
  }
};

// =============================================================================
// ── CSS для всех новых панелей
// =============================================================================

function injectStyles() {
  if (document.getElementById('yuma-v2-styles')) return;
  var style = document.createElement('style');
  style.id = 'yuma-v2-styles';
  style.textContent = `
/* ═══════════════════════════════════════════
   YUMA v2 — Общие стили панелей
═══════════════════════════════════════════ */
.yuma-panel {
  position: fixed;
  background: rgba(8, 8, 18, 0.97);
  border: 1px solid #a855f7;
  border-radius: 10px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.85), 0 0 30px rgba(168,85,247,0.12);
  font-family: 'VT323', monospace;
  z-index: 95;
  display: none;
  flex-direction: column;
  backdrop-filter: blur(10px);
  overflow: hidden;
}
.yuma-panel.visible { display: flex; }

.yp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  background: rgba(168,85,247,0.1);
  border-bottom: 1px solid #1e1e3a;
  flex-shrink: 0;
}
.yp-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 11px;
  color: #a855f7;
  letter-spacing: 2px;
  flex: 1;
}
.yp-btn {
  background: none;
  border: 1px solid #2d2d4a;
  color: #6b7280;
  border-radius: 4px;
  width: 24px; height: 24px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.yp-btn:hover { border-color: #a855f7; color: white; }
.yp-btn.active { border-color: #22c55e; color: #22c55e; }
.yp-btn.danger:hover { border-color: #ef4444; color: #ef4444; }

/* ═══ КАЛЕНДАРЬ ═══ */
#yuma-calendar {
  width: 320px;
  top: 60px;
  right: 16px;
}

.cal-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #1e1e3a;
  flex-shrink: 0;
}
.cal-month-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 12px;
  color: #e2e8f0;
  letter-spacing: 1px;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  padding: 8px 10px;
  flex-shrink: 0;
}
.cal-dow {
  text-align: center;
  font-size: 10px;
  color: #4b5563;
  padding: 2px 0;
  letter-spacing: 1px;
}
.cal-day {
  text-align: center;
  padding: 4px 2px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  position: relative;
  transition: background 0.1s;
  color: #9ca3af;
}
.cal-day:hover { background: rgba(168,85,247,0.2); color: white; }
.cal-day.today {
  background: rgba(168,85,247,0.25);
  color: #e9d5ff;
  font-weight: bold;
  border: 1px solid rgba(168,85,247,0.5);
}
.cal-day.selected {
  background: rgba(168,85,247,0.45);
  color: white;
  border: 1px solid #a855f7;
}
.cal-day.has-events::after {
  content: '';
  position: absolute;
  bottom: 2px; left: 50%;
  transform: translateX(-50%);
  width: 4px; height: 4px;
  border-radius: 50%;
  background: #22c55e;
}
.cal-day.other-month { color: #2d2d4a; cursor: default; }
.cal-day.other-month:hover { background: none; color: #2d2d4a; }

.cal-events {
  border-top: 1px solid #1e1e3a;
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  min-height: 80px;
  max-height: 200px;
}
.cal-events::-webkit-scrollbar { width: 3px; }
.cal-events::-webkit-scrollbar-thumb { background: #2d2d4a; }

.cal-date-label {
  font-size: 11px;
  color: #4b5563;
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.cal-event-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  margin-bottom: 3px;
  border-radius: 5px;
  border-left: 3px solid #a855f7;
  background: rgba(168,85,247,0.07);
  font-size: 13px;
}
.cal-event-item.type-work     { border-color: #38bdf8; background: rgba(56,189,248,0.07); }
.cal-event-item.type-health   { border-color: #22c55e; background: rgba(34,197,94,0.07); }
.cal-event-item.type-personal { border-color: #a855f7; }
.cal-event-item.type-fun      { border-color: #fb923c; background: rgba(251,146,60,0.07); }
.cal-event-time { font-size: 11px; color: #6b7280; flex-shrink: 0; }
.cal-event-title { color: #e2e8f0; flex: 1; }
.cal-event-del {
  background: none; border: none;
  color: #374151; cursor: pointer;
  font-size: 12px; padding: 0 2px;
  transition: color 0.1s;
}
.cal-event-del:hover { color: #ef4444; }

.cal-no-events { color: #2d2d4a; font-size: 12px; text-align: center; padding: 16px; }

/* Форма добавления события */
.cal-add-form {
  border-top: 1px solid #1e1e3a;
  padding: 8px 10px;
  flex-shrink: 0;
  display: none;
}
.cal-add-form.open { display: block; }
.cal-add-row { display: flex; gap: 4px; margin-bottom: 5px; }
.cal-inp {
  background: rgba(0,0,0,0.4);
  border: 1px solid #2d2d4a;
  color: #e2e8f0;
  border-radius: 4px;
  padding: 4px 7px;
  font-size: 12px;
  font-family: 'VT323', monospace;
  outline: none;
  transition: border-color 0.15s;
}
.cal-inp:focus { border-color: #a855f7; }
.cal-inp.flex1 { flex: 1; }
.cal-inp.w60 { width: 60px; flex-shrink: 0; }
.cal-type-sel {
  background: rgba(0,0,0,0.4);
  border: 1px solid #2d2d4a;
  color: #9ca3af;
  border-radius: 4px;
  padding: 4px 4px;
  font-size: 11px;
  font-family: 'VT323', monospace;
  outline: none;
}
.cal-add-submit {
  width: 100%;
  background: rgba(168,85,247,0.15);
  border: 1px solid rgba(168,85,247,0.4);
  color: #e9d5ff;
  border-radius: 4px;
  padding: 5px;
  font-size: 13px;
  font-family: 'VT323', monospace;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 1px;
}
.cal-add-submit:hover { background: rgba(168,85,247,0.3); color: white; }

/* ═══ ЗАМЕТКИ ═══ */
#yuma-notes {
  width: 300px;
  bottom: 70px;
  left: 16px;
  max-height: 60vh;
}

.notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
}
.notes-list::-webkit-scrollbar { width: 3px; }
.notes-list::-webkit-scrollbar-thumb { background: #2d2d4a; }

.note-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 7px 8px;
  margin-bottom: 4px;
  border-radius: 6px;
  background: rgba(255,255,255,0.03);
  border: 1px solid #1e1e3a;
  transition: border-color 0.15s;
  group: true;
}
.note-item:hover { border-color: #2d2d4a; }
.note-item.done .note-text { color: #374151; text-decoration: line-through; }
.note-item.pinned { border-color: rgba(251,146,60,0.4); background: rgba(251,146,60,0.04); }
.note-item.reminder { border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.04); }

.note-check {
  width: 14px; height: 14px;
  border: 1px solid #374151;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 2px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.note-check:hover { border-color: #22c55e; }
.note-check.checked { background: #22c55e; border-color: #22c55e; }
.note-check.checked::after { content: '✓'; font-size: 9px; color: #000; }

.note-text { font-size: 13px; color: #d1d5db; flex: 1; line-height: 1.4; }
.note-reminder-time { font-size: 10px; color: #38bdf8; display: block; margin-top: 2px; }
.note-actions { display: none; gap: 3px; }
.note-item:hover .note-actions { display: flex; }
.note-act-btn {
  background: none; border: none;
  color: #374151; cursor: pointer;
  font-size: 11px; padding: 1px 3px;
  transition: color 0.1s;
}
.note-act-btn:hover { color: #a855f7; }
.note-act-btn.del:hover { color: #ef4444; }

.notes-input-row {
  display: flex;
  gap: 5px;
  padding: 7px 8px;
  border-top: 1px solid #1e1e3a;
  flex-shrink: 0;
}
.note-inp {
  flex: 1;
  background: rgba(0,0,0,0.4);
  border: 1px solid #2d2d4a;
  color: #e2e8f0;
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 13px;
  font-family: 'VT323', monospace;
  outline: none;
}
.note-inp:focus { border-color: #a855f7; }
.note-add-btn {
  background: rgba(168,85,247,0.2);
  border: 1px solid rgba(168,85,247,0.4);
  color: #e9d5ff;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 13px;
  font-family: 'VT323', monospace;
  cursor: pointer;
  transition: all 0.15s;
}
.note-add-btn:hover { background: rgba(168,85,247,0.35); }

/* ═══ ЖУРНАЛ v2 ═══ */
#yuma-log-v2 {
  width: 340px;
  bottom: 70px;
  right: 16px;
  max-height: 65vh;
}

.log-filters {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid #1e1e3a;
  flex-shrink: 0;
}
.log-filter-btn {
  background: none;
  border: 1px solid #2d2d4a;
  color: #4b5563;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: 'VT323', monospace;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 1px;
}
.log-filter-btn:hover { border-color: #a855f7; color: #a855f7; }
.log-filter-btn.active { border-color: #a855f7; color: #e9d5ff; background: rgba(168,85,247,0.15); }

.log-search {
  padding: 5px 10px;
  border-bottom: 1px solid #1e1e3a;
  flex-shrink: 0;
}
.log-search input {
  width: 100%;
  background: rgba(0,0,0,0.3);
  border: 1px solid #2d2d4a;
  color: #9ca3af;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  font-family: 'VT323', monospace;
  outline: none;
}
.log-search input:focus { border-color: #a855f7; color: #e2e8f0; }

.log-body-v2 {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.log-body-v2::-webkit-scrollbar { width: 3px; }
.log-body-v2::-webkit-scrollbar-thumb { background: #2d2d4a; }

.log-entry-v2 {
  display: flex;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  transition: background 0.1s;
}
.log-entry-v2:hover { background: rgba(255,255,255,0.03); }
.le-time { font-size: 10px; color: #374151; flex-shrink: 0; padding-top: 1px; }
.le-sender { font-size: 12px; font-weight: bold; flex-shrink: 0; }
.le-text { font-size: 12px; color: #9ca3af; flex: 1; word-break: break-word; line-height: 1.4; }
.le-copy {
  opacity: 0;
  background: none;
  border: none;
  color: #374151;
  cursor: pointer;
  font-size: 10px;
  flex-shrink: 0;
  padding: 0 2px;
  transition: all 0.1s;
}
.log-entry-v2:hover .le-copy { opacity: 1; }
.le-copy:hover { color: #a855f7; }

.log-empty { text-align: center; color: #2d2d4a; font-size: 12px; padding: 24px; }

.log-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 10px;
  border-top: 1px solid #1e1e3a;
  font-size: 10px;
  color: #2d2d4a;
  flex-shrink: 0;
  letter-spacing: 1px;
}
.log-footer button {
  background: none;
  border: 1px solid #2d2d4a;
  color: #374151;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  font-family: 'VT323', monospace;
  cursor: pointer;
  transition: all 0.15s;
}
.log-footer button:hover { border-color: #ef4444; color: #ef4444; }

/* ═══ СТИКЕРЫ ═══ */
.yuma-sticker {
  position: fixed;
  background: rgba(251,211,40,0.92);
  border: 1px solid rgba(200,160,0,0.6);
  border-radius: 2px;
  padding: 8px 10px 8px 10px;
  min-width: 120px;
  max-width: 180px;
  box-shadow: 2px 3px 10px rgba(0,0,0,0.5);
  font-family: 'VT323', monospace;
  font-size: 13px;
  color: #1a1000;
  z-index: 85;
  cursor: move;
  user-select: none;
  line-height: 1.4;
}
.sticker-close {
  position: absolute;
  top: 3px; right: 4px;
  width: 14px; height: 14px;
  background: rgba(0,0,0,0.15);
  border: none;
  border-radius: 2px;
  font-size: 9px;
  cursor: pointer;
  color: #5a4000;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}
.sticker-close:hover { background: rgba(200,0,0,0.3); color: #fff; }
.sticker-pin {
  position: absolute;
  top: -8px; left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
}

/* Анимации появления */
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.yuma-panel.visible { animation: slideDown 0.2s ease; }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// ── КАЛЕНДАРЬ UI
// =============================================================================

var CalendarUI = {
  visible:       false,
  currentYear:   new Date().getFullYear(),
  currentMonth:  new Date().getMonth(),
  selectedDate:  DateUtil.todayStr(),
  addFormOpen:   false,

  build() {
    if (document.getElementById('yuma-calendar')) return;
    var el = document.createElement('div');
    el.id        = 'yuma-calendar';
    el.className = 'yuma-panel';
    el.innerHTML = `
      <div class="yp-header">
        <span class="yp-title">📅 КАЛЕНДАРЬ</span>
        <button class="yp-btn" id="cal-add-toggle" title="Добавить событие">+</button>
        <button class="yp-btn danger" onclick="CalendarUI.hide()" title="Закрыть">✕</button>
      </div>
      <div class="cal-nav">
        <button class="yp-btn" onclick="CalendarUI.prevMonth()">◀</button>
        <span class="cal-month-label" id="cal-month-label"></span>
        <button class="yp-btn" onclick="CalendarUI.nextMonth()">▶</button>
      </div>
      <div class="cal-grid" id="cal-grid"></div>
      <div class="cal-events" id="cal-events"></div>
      <div class="cal-add-form" id="cal-add-form">
        <div class="cal-add-row">
          <input class="cal-inp flex1" id="cal-inp-title" placeholder="Название события">
        </div>
        <div class="cal-add-row">
          <input class="cal-inp w60" id="cal-inp-time" type="time" placeholder="Время">
          <select class="cal-type-sel" id="cal-inp-type">
            <option value="personal">👤 Личное</option>
            <option value="work">💼 Работа</option>
            <option value="health">💚 Здоровье</option>
            <option value="fun">🎉 Развлечения</option>
          </select>
          <input class="cal-inp w60" id="cal-inp-remind" placeholder="Напом." title="Напомнить за X минут">
        </div>
        <button class="cal-add-submit" onclick="CalendarUI.submitAdd()">+ ДОБАВИТЬ СОБЫТИЕ</button>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('cal-add-toggle').onclick = () => {
      this.addFormOpen = !this.addFormOpen;
      document.getElementById('cal-add-form').classList.toggle('open', this.addFormOpen);
    };

    // Сделать перетаскиваемым
    makeDraggable(el, el.querySelector('.yp-header'));
  },

  show() {
    this.build();
    document.getElementById('yuma-calendar').classList.add('visible');
    this.visible = true;
    this.render();
  },

  hide() {
    var el = document.getElementById('yuma-calendar');
    if (el) el.classList.remove('visible');
    this.visible = false;
  },

  toggle() { this.visible ? this.hide() : this.show(); },

  prevMonth() {
    this.currentMonth--;
    if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
    this.render();
  },

  nextMonth() {
    this.currentMonth++;
    if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
    this.render();
  },

  render() {
    this.renderGrid();
    this.renderEvents();
  },

  refresh() {
    if (this.visible) this.render();
  },

  renderGrid() {
    var y = this.currentYear, m = this.currentMonth;
    var monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                      'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    document.getElementById('cal-month-label').textContent = monthNames[m] + ' ' + y;

    var days     = DateUtil.daysInMonth(y, m);
    var firstDay = DateUtil.firstDayOfMonth(y, m);
    var today    = DateUtil.todayStr();
    var eventsThisMonth = CalendarManager.forMonth(y, m);
    var daysWithEvents  = new Set(eventsThisMonth.map(e => parseInt(e.date.slice(8))));

    var html = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
      .map(d => `<div class="cal-dow">${d}</div>`).join('');

    // Пустые ячейки в начале
    for (var i = 0; i < firstDay; i++) {
      html += `<div class="cal-day other-month"></div>`;
    }

    for (var d2 = 1; d2 <= days; d2++) {
      var dateStr  = `${y}-${String(m+1).padStart(2,'0')}-${String(d2).padStart(2,'0')}`;
      var isToday  = dateStr === today;
      var isSel    = dateStr === this.selectedDate;
      var hasEv    = daysWithEvents.has(d2);
      var cls = 'cal-day' +
        (isToday ? ' today' : '') +
        (isSel   ? ' selected' : '') +
        (hasEv   ? ' has-events' : '');
      html += `<div class="${cls}" onclick="CalendarUI.selectDate('${dateStr}')">${d2}</div>`;
    }

    document.getElementById('cal-grid').innerHTML = html;
  },

  selectDate(dateStr) {
    this.selectedDate = dateStr;
    // Обновить input date в форме
    var tinp = document.getElementById('cal-inp-date');
    if (tinp) tinp.value = dateStr;
    this.renderGrid();
    this.renderEvents();
    // Авто-открыть форму добавления
    if (!this.addFormOpen) {
      this.addFormOpen = true;
      document.getElementById('cal-add-form').classList.add('open');
    }
  },

  renderEvents() {
    var container = document.getElementById('cal-events');
    if (!container) return;
    var events = CalendarManager.forDate(this.selectedDate);
    var label  = DateUtil.fmtDate(this.selectedDate);

    if (events.length === 0) {
      container.innerHTML = `<div class="cal-date-label">${label}</div><div class="cal-no-events">Нет событий — нажми на + чтобы добавить</div>`;
      return;
    }

    var typeIcons = { work:'💼', personal:'👤', health:'💚', fun:'🎉' };
    container.innerHTML = `<div class="cal-date-label">${label}</div>` +
      events.map(ev => `
        <div class="cal-event-item type-${ev.type}">
          <span style="font-size:12px">${typeIcons[ev.type]||'📌'}</span>
          <span class="cal-event-time">${ev.time||'—'}</span>
          <span class="cal-event-title">${ev.title}</span>
          <button class="cal-event-del" onclick="CalendarUI.deleteEvent('${ev.id}')" title="Удалить">✕</button>
        </div>`).join('');
  },

  async submitAdd() {
    var title = document.getElementById('cal-inp-title').value.trim();
    if (!title) return;
    var time   = document.getElementById('cal-inp-time').value;
    var type   = document.getElementById('cal-inp-type').value;
    var rmin   = parseInt(document.getElementById('cal-inp-remind').value) || 15;

    var ev = CalendarManager.create(title, this.selectedDate, time, type, rmin);
    await CalendarManager.save(ev);

    document.getElementById('cal-inp-title').value = '';
    document.getElementById('cal-inp-time').value  = '';

    this.render();
    LogManager.add('📅 Юма', `Событие добавлено: «${title}» на ${DateUtil.fmtDateTime(this.selectedDate, time)}`, 'system');
    if (typeof window.showCatMessage === 'function') {
      window.showCatMessage(`Записала! «${title}» ${time ? 'в ' + time : ''} 📅`);
    }
    if (typeof window.addLog === 'function') {
      window.addLog('📅 Юма', `Событие: «${title}»`, 'system');
    }
  },

  async deleteEvent(id) {
    await CalendarManager.remove(id);
    this.render();
  }
};

window.CalendarUI = CalendarUI;

// =============================================================================
// ── ЗАМЕТКИ UI
// =============================================================================

var NotesUI = {
  visible: false,

  build() {
    if (document.getElementById('yuma-notes')) return;
    var el = document.createElement('div');
    el.id        = 'yuma-notes';
    el.className = 'yuma-panel';
    el.innerHTML = `
      <div class="yp-header">
        <span class="yp-title">📝 ЗАМЕТКИ</span>
        <button class="yp-btn" id="notes-sticker-btn" title="Добавить стикер">🗒</button>
        <button class="yp-btn danger" onclick="NotesUI.hide()">✕</button>
      </div>
      <div class="notes-list" id="notes-list"></div>
      <div class="notes-input-row">
        <input class="note-inp" id="note-inp" placeholder="/note текст или /remind 10m текст">
        <button class="note-add-btn" onclick="NotesUI.addFromInput()">+</button>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('note-inp').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.addFromInput();
    });
    document.getElementById('notes-sticker-btn').onclick = () => this.spawnSticker();

    makeDraggable(el, el.querySelector('.yp-header'));
  },

  show() {
    this.build();
    document.getElementById('yuma-notes').classList.add('visible');
    this.visible = true;
    this.refresh();
  },

  hide() {
    var el = document.getElementById('yuma-notes');
    if (el) el.classList.remove('visible');
    this.visible = false;
  },

  toggle() { this.visible ? this.hide() : this.show(); },

  async addFromInput() {
    var inp  = document.getElementById('note-inp');
    var text = inp.value.trim();
    if (!text) return;
    inp.value = '';

    // Обработка команды
    var intercept = await CommandParser.intercept(text);
    if (intercept) {
      if (typeof window.showCatMessage === 'function') {
        window.showCatMessage(intercept);
      }
      this.refresh();
      return;
    }

    // Обычная заметка
    var note = NotesManager.create(text);
    await NotesManager.save(note);
    this.refresh();
    if (typeof window.showCatMessage === 'function') {
      window.showCatMessage('Записала! 📝');
    }
  },

  refresh() {
    var list = document.getElementById('notes-list');
    if (!list) return;
    var notes = NotesManager._notes;

    if (notes.length === 0) {
      list.innerHTML = '<div style="color:#2d2d4a;font-size:12px;text-align:center;padding:20px">Нет заметок</div>';
      return;
    }

    list.innerHTML = notes.map(n => {
      var cls = 'note-item' +
        (n.done    ? ' done'     : '') +
        (n.pinned  ? ' pinned'   : '') +
        (n.isReminder ? ' reminder' : '');
      var reminderHtml = n.isReminder && n.reminderAt
        ? `<span class="note-reminder-time">⏰ ${new Date(n.reminderAt).toLocaleString('ru',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})}</span>`
        : '';
      return `
        <div class="${cls}" data-id="${n.id}">
          <div class="note-check${n.done?' checked':''}" onclick="NotesUI.toggleDone('${n.id}')"></div>
          <div style="flex:1">
            <div class="note-text">${n.text.replace(/</g,'&lt;')}</div>
            ${reminderHtml}
          </div>
          <div class="note-actions">
            <button class="note-act-btn" onclick="NotesUI.pinNote('${n.id}')" title="Стикер">📌</button>
            <button class="note-act-btn del" onclick="NotesUI.deleteNote('${n.id}')">✕</button>
          </div>
        </div>`;
    }).join('');
  },

  async toggleDone(id) {
    var note = NotesManager._notes.find(n => n.id === id);
    if (!note) return;
    note.done = !note.done;
    await NotesManager.save(note);
    this.refresh();
  },

  async pinNote(id) {
    var note = NotesManager._notes.find(n => n.id === id);
    if (!note) return;
    StickerManager.create(note.text);
  },

  async deleteNote(id) {
    await NotesManager.remove(id);
    this.refresh();
  },

  spawnSticker() {
    var inp = document.getElementById('note-inp');
    var text = inp.value.trim() || 'Заметка';
    StickerManager.create(text);
    inp.value = '';
  }
};

window.NotesUI = NotesUI;

// =============================================================================
// ── СТИКЕРЫ (перетаскиваемые на рабочем столе)
// =============================================================================

var StickerManager = {
  _stickers: [],

  create(text) {
    var el = document.createElement('div');
    el.className = 'yuma-sticker';
    el.style.top  = (80  + Math.random() * 100) + 'px';
    el.style.left = (200 + Math.random() * 200) + 'px';
    el.innerHTML = `
      <span class="sticker-pin">📌</span>
      <button class="sticker-close" onclick="this.closest('.yuma-sticker').remove()">✕</button>
      ${text.replace(/</g,'&lt;')}
    `;
    document.body.appendChild(el);
    makeDraggable(el, el);
    this._stickers.push(el);
  }
};

window.StickerManager = StickerManager;

// =============================================================================
// ── ЖУРНАЛ v2 UI
// =============================================================================

var LogUI = {
  visible:   false,
  filter:    'all',
  searchQuery: '',

  build() {
    if (document.getElementById('yuma-log-v2')) return;
    var el = document.createElement('div');
    el.id        = 'yuma-log-v2';
    el.className = 'yuma-panel';
    el.innerHTML = `
      <div class="yp-header">
        <span class="yp-title">📜 ЖУРНАЛ</span>
        <button class="yp-btn danger" onclick="LogUI.hide()">✕</button>
      </div>
      <div class="log-filters">
        <button class="log-filter-btn active" data-f="all"    onclick="LogUI.setFilter('all')">ВСЕ</button>
        <button class="log-filter-btn"        data-f="chat"   onclick="LogUI.setFilter('chat')">ЧАТ</button>
        <button class="log-filter-btn"        data-f="system" onclick="LogUI.setFilter('system')">СИСТЕМА</button>
        <button class="log-filter-btn"        data-f="debuff" onclick="LogUI.setFilter('debuff')">ДЕБАФ</button>
      </div>
      <div class="log-search">
        <input id="log-search-inp" placeholder="🔍 Поиск по журналу..." oninput="LogUI.onSearch(this.value)">
      </div>
      <div class="log-body-v2" id="log-body-v2"></div>
      <div class="log-footer">
        <span id="log-count-v2">0 записей</span>
        <button onclick="LogUI.clearLog()">ОЧИСТИТЬ</button>
      </div>
    `;
    document.body.appendChild(el);
    makeDraggable(el, el.querySelector('.yp-header'));
  },

  show() {
    this.build();
    document.getElementById('yuma-log-v2').classList.add('visible');
    this.visible = true;
    this.render();
  },

  hide() {
    var el = document.getElementById('yuma-log-v2');
    if (el) el.classList.remove('visible');
    this.visible = false;
  },

  toggle() { this.visible ? this.hide() : this.show(); },

  setFilter(f) {
    this.filter = f;
    document.querySelectorAll('.log-filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.f === f);
    });
    this.render();
  },

  onSearch(q) {
    this.searchQuery = q.toLowerCase();
    this.render();
  },

  render() {
    var body = document.getElementById('log-body-v2');
    if (!body) return;

    var entries = LogManager.filter(this.filter);
    if (this.searchQuery) {
      entries = entries.filter(e =>
        e.text.toLowerCase().includes(this.searchQuery) ||
        e.sender.toLowerCase().includes(this.searchQuery)
      );
    }

    document.getElementById('log-count-v2').textContent = entries.length + ' записей';

    if (entries.length === 0) {
      body.innerHTML = '<div class="log-empty">Пусто</div>';
      return;
    }

    var senderColor = s =>
      (s.includes('Юма') || s.includes('Yuma')) ? '#a855f7' :
      s === 'Вы' || s === 'Хозяин' ? '#22c55e' :
      s.startsWith('🔔') || s.startsWith('📅') ? '#fb923c' : '#6b7280';

    body.innerHTML = entries.map(e => `
      <div class="log-entry-v2">
        <span class="le-time">${e.time||''}</span>
        <span class="le-sender" style="color:${senderColor(e.sender)}">${e.sender}</span>
        <span class="le-text">${String(e.text).replace(/</g,'&lt;')}</span>
        <button class="le-copy" onclick="navigator.clipboard.writeText('${String(e.text).replace(/'/g,"\\'")}')">⎘</button>
      </div>`).join('');

    // Автоскролл вниз
    setTimeout(() => { body.scrollTop = body.scrollHeight; }, 20);
  },

  async add(sender, text, type) {
    await LogManager.add(sender, text, type);
    if (this.visible) this.render();
  },

  async clearLog() {
    if (!confirm('Очистить весь журнал?')) return;
    await LogManager.clear();
    this.render();
  }
};

window.LogUI = LogUI;

// =============================================================================
// ── УТИЛИТА: перетаскивание элементов
// =============================================================================

function makeDraggable(el, handle) {
  if (!handle) handle = el;
  var ox = 0, oy = 0, startX = 0, startY = 0;

  handle.addEventListener('mousedown', function(e) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' ||
        e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    startX = e.clientX; startY = e.clientY;
    var rect = el.getBoundingClientRect();
    ox = startX - rect.left;
    oy = startY - rect.top;

    function onMove(e2) {
      el.style.left = (e2.clientX - ox) + 'px';
      el.style.top  = (e2.clientY - oy) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// =============================================================================
// ── ИНТЕГРАЦИЯ С RENDERER.JS (monkey-patch)
// =============================================================================

function patchRenderer() {
  // Патчим addLog из renderer.js — дублируем в LogManager
  var origAddLog = window.addLog;
  window.addLog = function(sender, text, type) {
    if (origAddLog) origAddLog.apply(this, arguments);
    LogManager.add(sender, text, type || 'chat').then(() => {
      if (LogUI.visible) LogUI.render();
    });
  };

  // Патчим sendDockMessage — перехватываем команды до отправки в AI
  var origSend = window.sendDockMessage;
  window.sendDockMessage = async function() {
    var textarea = document.getElementById('input-dock-textarea');
    if (!textarea) { if (origSend) origSend(); return; }
    var text = textarea.value.trim();
    if (!text) return;

    var intercept = await CommandParser.intercept(text);
    if (intercept) {
      textarea.value = '';
      textarea.style.height = 'auto';
      if (typeof window.addLog === 'function') {
        window.addLog(window.config ? window.config.userName : 'Вы', text, 'chat');
        window.addLog('Юма', intercept, 'chat');
      }
      if (typeof window.showCatMessage === 'function') {
        window.showCatMessage(intercept);
      }
      return;
    }

    // Не команда — отправляем в AI как обычно
    if (origSend) origSend.apply(this, arguments);
  };

  // Патчим handleBubbleResponse — тоже перехватываем команды
  var origBubble = window.handleBubbleResponse;
  window.handleBubbleResponse = async function(txt) {
    var intercept = await CommandParser.intercept(txt);
    if (intercept) {
      if (typeof window.addLog === 'function') {
        window.addLog(window.config ? window.config.userName : 'Вы', txt, 'chat');
        window.addLog('Юма', intercept, 'chat');
      }
      if (typeof window.showCatMessage === 'function') {
        window.showCatMessage(intercept);
      }
      return;
    }
    if (origBubble) origBubble.apply(this, arguments);
  };
}

// =============================================================================
// ── ДОБАВИТЬ КНОПКИ В UI ЛЕВОЙ ПАНЕЛИ
// =============================================================================

function injectButtons() {
  // Ждём пока renderer.js создаст DOM
  var attempts = 0;
  var interval = setInterval(() => {
    attempts++;
    var uiLeft = document.getElementById('ui-left');
    if (!uiLeft && attempts < 20) return;
    clearInterval(interval);
    if (!uiLeft) return;

    // Найти строку с кнопками
    var btnRows = uiLeft.querySelectorAll('[class*="flex"]');
    var btnRow  = null;
    for (var r of btnRows) {
      if (r.querySelector('button')) { btnRow = r; break; }
    }
    if (!btnRow) return;

    var buttons = [
      { icon: '📅', title: 'Календарь (v2)',    action: () => CalendarUI.toggle() },
      { icon: '📝', title: 'Заметки (v2)',       action: () => NotesUI.toggle() },
      { icon: '📜', title: 'Журнал v2',          action: () => LogUI.toggle() },
    ];

    buttons.forEach(b => {
      if (btnRow.querySelector(`[title="${b.title}"]`)) return;
      var btn = document.createElement('button');
      btn.className = 'dock-btn';
      btn.title     = b.title;
      btn.innerHTML = `<span style="font-size:14px">${b.icon}</span>`;
      btn.onclick   = b.action;
      btnRow.appendChild(btn);
    });
  }, 300);
}

// =============================================================================
// ── ИНИЦИАЛИЗАЦИЯ
// =============================================================================

async function init() {
  injectStyles();

  // Запрос разрешения на уведомления
  if (Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Загружаем данные
  await CalendarManager.load();
  await NotesManager.load();
  await LogManager.load();

  // Запускаем систему напоминаний
  ReminderSystem.start();

  // Ждём полной загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { patchRenderer(); injectButtons(); }, 400);
    });
  } else {
    setTimeout(() => { patchRenderer(); injectButtons(); }, 400);
  }

  // Добавляем стартовую запись в журнал если пуст
  if (LogManager._entries.length === 0) {
    await LogManager.add('Юма', 'Привет! Я готова к работе 🐾', 'system');
  }

  console.log('[Yuma v2] Инициализирован: Календарь, Заметки, Журнал, Напоминания');
}

// Экспортируем для внешнего доступа
window.YumaV2 = { CalendarManager, NotesManager, LogManager, CalendarUI, NotesUI, LogUI, ReminderSystem };

init();

})();
