// =============================================================================
// КОНСТАНТЫ
// =============================================================================

const STORAGE_KEYS = {
    apiKey:   'cybercat_key',
    provider: 'cybercat_provider',
    model:    'cybercat_model',
    speed:    'cybercat_speed',
    skin:     'cybercat_skin',
    sleep:    'cybercat_sleep',
    bg:       'cybercat_bg',
    userName: 'cybercat_username',
    prompt:   'cybercat_prompt',
    scale:    'cybercat_scale',
    font:     'cybercat_font',
    log:      'cybercat_log',
    uiHidden: 'cybercat_ui_hidden',
    lastSeen: 'cybercat_last_seen',
};

const DEFAULT_CONFIG = {
    moveInterval:  4500,
    talkInterval:  45000,
    apiKey:        '',
    provider:      'openrouter',
    model:         'mistralai/mistral-7b-instruct:free',
    moveSpeed:     2.0,
    userName:      'Хозяин',
    systemPrompt:  'Ты Yuma, виртуальный кот. Ты милый, немного саркастичный и любишь киберпанк. Отвечай кратко.',
    catScale:      1.0,
    fontSize:      14,
};

const AUTO_PHRASES = [
    'Мяу?',
    '{{name}}, ты тут?',
    'Мне скучно...',
    'Поиграй со мной!',
    '*смотрит на курсор*',
    'Ммм... еда...',
];

const MSG_HOUR_LIMIT = 10;

const DEBUFF_DEFS = {
    tired: {
        icon:      'z',
        label:     'Устала',
        pill:      'tired',
        phrases:   ['Ффух, устала бегать...', 'Дай отдохнуть!', 'Мур... не так быстро...'],
        speedMult: 1.8,
        animClass: 'debuff-tired',
    },
    hungry: {
        icon:      '!',
        label:     'Голодная',
        pill:      'hungry',
        phrases:   ['МЯЯУ! Хочу есть!!', 'Покорми меня... пожалуйста...', '*смотрит на миску*'],
        speedMult: 1.0,
        animClass: 'debuff-hungry',
    },
    sad: {
        icon:      '.',
        label:     'Скучает',
        pill:      'sad',
        phrases:   ['Ты давно не заходил...', 'Я думала, ты забыл про меня...', '*сидит спиной*'],
        speedMult: 1.0,
        animClass: 'debuff-sad',
    },
};

const CAT_BASE_ANIM = [
    'cat-idle-img', 'cat-walking-img', 'cat-chasing-img',
    'anim-eating', 'anim-petting', 'anim-playing', 'anim-sleeping',
];

const SOUND_CONFIGS = {
    meow: function(osc, gain, now) {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.3);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        return now + 0.3;
    },
    purr: function(osc, gain, now) {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(50, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        return now + 0.5;
    },
    laser: function(osc, gain, now) {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        return now + 0.2;
    },
    notification: function(osc, gain, now) {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(800, now + 0.1);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        return now + 0.3;
    },
};

// =============================================================================
// СОСТОЯНИЕ
// =============================================================================

var config = Object.assign({}, DEFAULT_CONFIG);

var state = {
    isMoving:         false,
    isChatting:       false,
    isSleeping:       false,
    isDragging:       false,
    isLaserOn:        false,
    isMuted:          false,
    isUIHidden:       false,
    targetX:          0,
    targetY:          0,
    laserX:           0,
    laserY:           0,
    x:                50,
    y:                50,
    hunger:           90,
    energy:           90,
    mood:             90,
    debuffs:          {},
    msgCountThisHour: 0,
    msgHourStart:     Date.now(),
};

// DOM-ссылки — заполняются в init()
var cat        = null;
var imgElement = null;
var audioCtx   = null;
var chaseFrame = null;
var dragOffsetX = 0;
var dragOffsetY = 0;

// Журнал
var eventLog = [];
var logFilter = 'all';

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ
// =============================================================================

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function $el(id) { return document.getElementById(id); }

function readFileAsDataURL(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload  = function(e) { resolve(e.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function trySave(key, value) {
    try { localStorage.setItem(key, value); } catch(e) { /* квота */ }
}

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// =============================================================================
// 1. UI TOGGLE
// =============================================================================

function toggleUI() {
    state.isUIHidden = !state.isUIHidden;

    var uiLeft    = $el('ui-left');
    var inputDock = $el('input-dock');
    var toggleBtn = $el('ui-toggle-btn');

    if (state.isUIHidden) {
        uiLeft.classList.add('ui-hidden');
        inputDock.classList.add('ui-hidden');
        toggleBtn.classList.add('visible');
        addLog('System', 'Интерфейс свёрнут', 'system');
    } else {
        uiLeft.classList.remove('ui-hidden');
        inputDock.classList.remove('ui-hidden');
        toggleBtn.classList.remove('visible');
        var badge = $el('toggle-notif-badge');
        if (badge) badge.style.display = 'none';
    }

    trySave(STORAGE_KEYS.uiHidden, state.isUIHidden);
}

function showToggleBadge() {
    if (state.isUIHidden) {
        var badge = $el('toggle-notif-badge');
        if (badge) badge.style.display = 'block';
    }
}

// =============================================================================
// 2. INPUT DOCK
// =============================================================================

function initInputDock() {
    var textarea  = $el('input-dock-textarea');
    var sendBtn   = $el('input-send-btn');
    var dock      = $el('input-dock');
    var fileInput = $el('input-dock-file');

    if (!textarea || !sendBtn || !dock || !fileInput) return;

    // Авто-рост
    textarea.addEventListener('input', function() {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });

    // Enter — отправить, Shift+Enter — перенос
    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendDockMessage();
        }
    });

    sendBtn.addEventListener('click', sendDockMessage);

    // Ctrl+V — вставка картинки
    textarea.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                handleImageAttachment(items[i].getAsFile());
                return;
            }
        }
    });

    // Drag & Drop
    dock.addEventListener('dragover', function(e) { e.preventDefault(); dock.classList.add('drag-over'); });
    dock.addEventListener('dragleave', function() { dock.classList.remove('drag-over'); });
    dock.addEventListener('drop', function(e) {
        e.preventDefault();
        dock.classList.remove('drag-over');
        var file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleImageAttachment(file);
    });

    fileInput.addEventListener('change', function(e) {
        var file = e.target.files && e.target.files[0];
        if (file) handleImageAttachment(file);
        fileInput.value = '';
    });

    // Кот смотрит на панель при фокусе
    textarea.addEventListener('focus', function() {
        if (!state.isSleeping) setFlip(state.x > 50 ? -1 : 1);
    });
}

async function sendDockMessage() {
    var textarea = $el('input-dock-textarea');
    var text = textarea.value.trim();
    if (!text) return;

    if (!checkAntiSpam()) return;

    textarea.value = '';
    textarea.style.height = 'auto';

    addLog(config.userName || 'Вы', text, 'chat');
    showCatMessage('...');
    var chatContent = $el('chat-content');
    if (chatContent) chatContent.innerHTML = '<span style="opacity:0.6">Думаю...</span>';

    var reply;
    if (config.apiKey) {
        reply = await callAI(text);
    } else {
        await delay(600);
        reply = randomItem(['Мяу! (нет ключа API)', '*мурчит молча*', 'Пррр...', 'Нужен API ключ']);
    }

    finalizeReply(reply);
    addLog('Yuma', reply, 'chat');
    play8BitSound('notification');
    showToggleBadge();
}

async function handleImageAttachment(file) {
    if (file.size > 4 * 1024 * 1024) {
        showCatMessage('Слишком тяжелый! Макс 4МБ');
        addLog('System', 'Файл слишком большой (>4МБ)', 'system');
        return;
    }
    await readFileAsDataURL(file);
    showCatMessage('Получила изображение!');
    addLog(config.userName || 'Вы', '[Изображение: ' + file.name + ']', 'chat');
    play8BitSound('notification');
}

// =============================================================================
// 3. ЖУРНАЛ СОБЫТИЙ
// =============================================================================

function toggleLog() {
    var logEl = $el('event-log');
    var btn   = $el('btn-log');
    if (!logEl || !btn) return;
    var visible = logEl.classList.contains('visible');
    logEl.classList.toggle('visible', !visible);
    btn.classList.toggle('active', !visible);
}

function setLogFilter(filter) {
    logFilter = filter;
    document.querySelectorAll('.log-filter-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    renderLog();
}

function addLog(sender, text, type) {
    if (!type) type = 'chat';
    var entry = {
        sender: sender,
        text:   text,
        type:   type,
        time:   new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    eventLog.push(entry);
    if (eventLog.length > 100) eventLog.shift();

    try {
        localStorage.setItem(STORAGE_KEYS.log, JSON.stringify(eventLog.slice(-20)));
    } catch(e) { /* квота */ }

    renderLog();
    updateLogCount();

    var body = $el('event-log-body');
    if (body) setTimeout(function() { body.scrollTop = body.scrollHeight; }, 30);
}

function renderLog() {
    var body = $el('event-log-body');
    if (!body) return;

    var filtered = logFilter === 'all'
        ? eventLog
        : eventLog.filter(function(e) { return e.type === logFilter; });

    if (filtered.length === 0) {
        body.innerHTML = '<div style="color:#4b5563;font-size:11px;text-align:center;padding:24px;font-style:italic;">Пусто</div>';
        return;
    }

    body.innerHTML = filtered.map(function(entry) {
        var senderColor =
            (entry.sender === 'Yuma' || (entry.sender && entry.sender.indexOf('Yuma') === 0)) ? '#a855f7'
            : entry.type === 'system' ? '#f59e0b'
            : entry.type === 'debuff' ? '#ef4444'
            : '#22c55e';

        var text = String(entry.text).replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return '<div class="log-entry" data-type="' + entry.type + '">' +
            '<span class="log-time">' + entry.time + '</span>' +
            '<span class="log-sender" style="color:' + senderColor + ';font-weight:bold;">' + entry.sender + ':</span>' +
            '<span class="log-text">' + text + '</span>' +
            '</div>';
    }).join('');
}

function updateLogCount() {
    var el2 = $el('log-count');
    if (el2) el2.textContent = eventLog.length + ' записей';
}

function clearLog() {
    eventLog = [];
    localStorage.removeItem(STORAGE_KEYS.log);
    renderLog();
    updateLogCount();
    addLog('System', 'Журнал очищен', 'system');
}

function loadLogFromStorage() {
    try {
        var saved = localStorage.getItem(STORAGE_KEYS.log);
        if (saved) {
            eventLog = JSON.parse(saved);
            renderLog();
            updateLogCount();
        }
    } catch(e) { eventLog = []; }
}

// =============================================================================
// 4. СИСТЕМА ДЕБАФОВ
// =============================================================================

function applyDebuff(type) {
    if (state.debuffs[type]) return;
    if (!imgElement) return;

    state.debuffs[type] = { appliedAt: Date.now() };

    var def = DEBUFF_DEFS[type];
    imgElement.classList.add(def.animClass);

    var phrase = randomItem(def.phrases);
    showCatMessage(phrase);
    addLog('Дебаф', '[' + def.label + '] ' + phrase, 'debuff');
    play8BitSound('meow');
    renderDebuffUI();
}

function removeDebuff(type) {
    if (!state.debuffs[type]) return;
    var def = DEBUFF_DEFS[type];
    if (imgElement) imgElement.classList.remove(def.animClass);
    delete state.debuffs[type];
    addLog('Дебаф', '[' + def.label + '] снят', 'debuff');
    renderDebuffUI();
}

function renderDebuffUI() {
    var activeTypes = Object.keys(state.debuffs);

    // Иконки над котом
    var iconsEl = $el('debuff-icons');
    if (iconsEl) {
        iconsEl.innerHTML = activeTypes.map(function(t) {
            return '<span class="debuff-icon" title="' + DEBUFF_DEFS[t].label + '">' + DEBUFF_DEFS[t].icon + '</span>';
        }).join('');
    }

    // Пилюли вверху
    var barEl = $el('debuff-status-bar');
    if (barEl) {
        barEl.innerHTML = activeTypes.map(function(t) {
            return '<div class="debuff-pill ' + DEBUFF_DEFS[t].pill + '">' + DEBUFF_DEFS[t].icon + ' ' + DEBUFF_DEFS[t].label + '</div>';
        }).join('');
    }

    // Список в попапе
    var listEl = $el('debuff-list-popup');
    if (listEl) {
        if (activeTypes.length === 0) {
            listEl.innerHTML = '<div style="font-size:10px;color:#4b5563;font-style:italic;">Нет дебафов</div>';
        } else {
            listEl.innerHTML = activeTypes.map(function(t) {
                var color = t === 'hungry' ? '#f87171' : t === 'tired' ? '#fbbf24' : '#818cf8';
                return '<div style="font-size:10px;color:' + color + ';">' + DEBUFF_DEFS[t].icon + ' ' + DEBUFF_DEFS[t].label + '</div>';
            }).join('');
        }
    }

    // Статус-лейбл
    var statusLabel = $el('cat-status-label');
    if (statusLabel) {
        if (activeTypes.length === 0) {
            statusLabel.textContent = 'ONLINE';
            statusLabel.style.color = '#4ade80';
        } else {
            statusLabel.textContent = '! ДЕБАФ';
            statusLabel.style.color = '#fbbf24';
        }
    }
}

function checkDebuffs() {
    if (state.hunger < 20)                              applyDebuff('hungry');
    else if (state.hunger > 40 && state.debuffs.hungry) removeDebuff('hungry');

    if (state.mood < 20)                               applyDebuff('sad');
    else if (state.mood > 40 && state.debuffs.sad)     removeDebuff('sad');

    if (state.debuffs.tired) {
        var mins = (Date.now() - state.debuffs.tired.appliedAt) / 60000;
        if (mins >= 5) removeDebuff('tired');
    }
}

function checkAntiSpam() {
    var now = Date.now();

    if (now - state.msgHourStart > 3600000) {
        state.msgCountThisHour = 0;
        state.msgHourStart = now;
    }

    state.msgCountThisHour++;

    if (state.msgCountThisHour > MSG_HOUR_LIMIT && !state.debuffs.tired) {
        applyDebuff('tired');
        return false;
    }

    if (state.debuffs.tired) {
        showCatMessage('Я ещё устала! Подожди немного...');
        return false;
    }

    return true;
}

function checkSadness() {
    var lastSeen  = parseInt(localStorage.getItem(STORAGE_KEYS.lastSeen) || '0');
    var daysSince = (Date.now() - lastSeen) / 86400000;
    if (lastSeen > 0 && daysSince >= 3) applyDebuff('sad');
    trySave(STORAGE_KEYS.lastSeen, Date.now());
}

// =============================================================================
// ЗВУК
// =============================================================================

function initAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function createOscNode() {
    var osc  = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    return { osc: osc, gain: gain };
}

function play8BitSound(type) {
    if (state.isMuted) return;
    try {
        initAudioCtx();
        var now = audioCtx.currentTime;
        if (type === 'eat') { playEatSound(now); return; }
        var fn = SOUND_CONFIGS[type];
        if (!fn) return;
        var nodes = createOscNode();
        var stop = fn(nodes.osc, nodes.gain, now);
        nodes.osc.start(now);
        nodes.osc.stop(stop);
    } catch(e) { /* AudioContext недоступен */ }
}

function playEatSound(now) {
    var n1 = createOscNode();
    n1.osc.type = 'square';
    n1.osc.frequency.setValueAtTime(100, now);
    n1.osc.frequency.linearRampToValueAtTime(500, now + 0.1);
    n1.gain.gain.setValueAtTime(0.05, now);
    n1.gain.gain.linearRampToValueAtTime(0, now + 0.1);
    n1.osc.start(now); n1.osc.stop(now + 0.1);

    var n2 = createOscNode();
    n2.osc.type = 'square';
    n2.osc.frequency.setValueAtTime(200, now + 0.15);
    n2.gain.gain.setValueAtTime(0.05, now + 0.15);
    n2.gain.gain.linearRampToValueAtTime(0, now + 0.2);
    n2.osc.start(now + 0.15); n2.osc.stop(now + 0.2);
}

function toggleSound() {
    state.isMuted = !state.isMuted;
    var btn = $el('btn-sound');
    if (!btn) return;
    if (state.isMuted) {
        btn.classList.remove('active');
        btn.innerHTML = '<i data-lucide="volume-x" class="w-4 h-4"></i>';
    } else {
        btn.classList.add('active');
        btn.innerHTML = '<i data-lucide="volume-2" class="w-4 h-4"></i>';
        play8BitSound('notification');
    }
    lucide.createIcons();
    initAudioCtx();
}

// =============================================================================
// АНИМАЦИИ КОТА
// =============================================================================

function setAnimClass(cls) {
    if (!imgElement) return;
    imgElement.classList.remove.apply(imgElement.classList, CAT_BASE_ANIM);
    void imgElement.offsetWidth;
    if (cls) imgElement.classList.add(cls);
}

function triggerAnimation(animClass) {
    setAnimClass(animClass);
    if (animClass === 'anim-sleeping') return;
    setTimeout(function() {
        if (!imgElement) return;
        imgElement.classList.remove(animClass);
        imgElement.classList.add(state.isSleeping ? 'anim-sleeping' : 'cat-idle-img');
    }, 2000);
}

// =============================================================================
// ДЕЙСТВИЯ С КОТОМ
// =============================================================================

function getCatSkin()   { return localStorage.getItem(STORAGE_KEYS.skin)  || 'cat.png'; }
function getSleepSkin() { return localStorage.getItem(STORAGE_KEYS.sleep) || 'sleep.png'; }

function wakeUp() {
    state.isSleeping = false;
    if (imgElement) imgElement.src = getCatSkin();
    setAnimClass('cat-idle-img');
    if (state.debuffs.tired) removeDebuff('tired');
}

function performAction(action) {
    var actions = {
        feed: function() {
            state.hunger = Math.min(100, state.hunger + 30);
            state.mood   = Math.min(100, state.mood + 5);
            if (state.debuffs.hungry) removeDebuff('hungry');
            showCatMessage('Вкусно!'); triggerAnimation('anim-eating'); play8BitSound('eat');
        },
        pet: function() {
            state.energy = Math.min(100, state.energy + 5);
            state.mood   = Math.min(100, state.mood + 15);
            if (state.debuffs.sad) removeDebuff('sad');
            showCatMessage('Муррр...'); triggerAnimation('anim-petting'); play8BitSound('purr');
        },
        play: function() {
            state.hunger = Math.max(0, state.hunger - 10);
            state.mood   = Math.min(100, state.mood + 10);
            showCatMessage('Тыгыдык!'); triggerAnimation('anim-playing'); play8BitSound('meow');
        },
        sleep: function() {
            state.isSleeping = true;
            if (imgElement) imgElement.src = getSleepSkin();
            showCatMessage('Zzz...'); triggerAnimation('anim-sleeping');
        },
    };

    if (!actions[action]) return;
    if (action !== 'sleep' && state.isSleeping) wakeUp();
    actions[action]();
    updateStatUI();
    checkDebuffs();
}

function decayStats() {
    if (!state.isSleeping) {
        state.hunger -= 2;
        state.energy -= 1;
        state.mood   -= 0.5;
    } else {
        state.energy += 5;
        state.hunger -= 1;
    }
    state.hunger = Math.max(0, Math.min(100, state.hunger));
    state.energy = Math.max(0, Math.min(100, state.energy));
    state.mood   = Math.max(0, Math.min(100, state.mood));
    updateStatUI();
    checkDebuffs();
}

function statClass(v, warn, bad) {
    if (warn === undefined) warn = 60;
    if (bad  === undefined) bad  = 30;
    if (v < bad)  return 'fill-bad';
    if (v < warn) return 'fill-warn';
    return 'fill-good';
}

function updateStatUI() {
    var hBar = $el('bar-hunger');
    var eBar = $el('bar-energy');
    var mBar = $el('bar-mood');
    if (!hBar || !eBar || !mBar) return;

    hBar.style.width = state.hunger + '%';
    eBar.style.width = state.energy + '%';
    mBar.style.width = state.mood   + '%';

    hBar.className = 'stat-bar-fill ' + statClass(state.hunger);
    eBar.className = 'stat-bar-fill ' + statClass(state.energy, 9999, 30);
    mBar.className = 'stat-bar-fill ' + statClass(state.mood);
}

// =============================================================================
// ПОЗИЦИЯ КОТА
// =============================================================================

function updateCatPosition(x, y) {
    state.x = x; state.y = y;
    if (!cat) return;
    cat.style.left = x + '%';
    cat.style.top  = y + '%';
}

function clamp(v, min, max) {
    if (min === undefined) min = 0;
    if (max === undefined) max = 95;
    return Math.max(min, Math.min(max, v));
}

function setFlip(dx) {
    var vc = $el('visual-container');
    if (vc) vc.style.transform = 'scaleX(' + (dx < 0 ? -1 : 1) + ')';
}

// =============================================================================
// ДВИЖЕНИЕ КОТА
// =============================================================================

function autonomousMove() {
    if (state.isChatting || state.isSleeping || state.isDragging || state.isLaserOn) return;
    if (Math.random() > 0.7) return;

    var nx = Math.floor(Math.random() * 80) + 10;
    var ny = Math.floor(Math.random() * 65) + 10;

    setFlip(nx - state.x);
    state.isMoving = true;
    setAnimClass('cat-walking-img');

    if (!cat) return;
    cat.classList.remove('no-transition');

    var speedMult    = state.debuffs.tired ? DEBUFF_DEFS.tired.speedMult : 1;
    var moveDuration = config.moveSpeed * speedMult;
    cat.style.transition = 'left ' + moveDuration + 's linear, top ' + moveDuration + 's linear';
    updateCatPosition(nx, ny);

    setTimeout(function() {
        state.isMoving = false;
        if (!state.isSleeping) setAnimClass('cat-idle-img');
    }, moveDuration * 1000);
}

// =============================================================================
// ЛАЗЕР
// =============================================================================

function toggleLaser() {
    state.isLaserOn = !state.isLaserOn;
    var btn = $el('laser-btn');
    var dot = $el('laser-dot');
    if (!btn || !dot) return;

    if (state.isLaserOn) {
        btn.classList.add('active');
        dot.style.display = 'block';
        state.isMoving = false;
        if (cat) cat.classList.add('no-transition');
        play8BitSound('laser');
        chaseFrame = requestAnimationFrame(chaseLoop);
        addLog('System', 'Лазер включён', 'system');
    } else {
        btn.classList.remove('active');
        dot.style.display = 'none';
        if (cat) cat.classList.remove('no-transition');
        cancelAnimationFrame(chaseFrame);
        setAnimClass('cat-idle-img');
    }
}

function handleMouseMove(e) {
    if (!state.isLaserOn) return;
    state.targetX = e.clientX;
    state.targetY = e.clientY;
    state.laserX  = (e.clientX / window.innerWidth)  * 100;
    state.laserY  = (e.clientY / window.innerHeight) * 100;
}

function chaseLoop() {
    if (!state.isLaserOn) return;

    var dot = $el('laser-dot');
    if (dot) { dot.style.left = state.targetX + 'px'; dot.style.top = state.targetY + 'px'; }

    var dx   = state.laserX - state.x;
    var dy   = state.laserY - state.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1) {
        var speed = 0.5 * (dist > 5 ? 1.5 : 1);
        state.x += dx * 0.08 * speed;
        state.y += dy * 0.08 * speed;
        setFlip(dx);
        if (imgElement && !imgElement.classList.contains('cat-chasing-img')) {
            imgElement.classList.remove('cat-idle-img', 'cat-walking-img', 'anim-sleeping');
            imgElement.classList.add('cat-chasing-img');
        }
        updateCatPosition(state.x, state.y);
    } else {
        setAnimClass('cat-idle-img');
    }

    chaseFrame = requestAnimationFrame(chaseLoop);
}

// =============================================================================
// ПЕРЕТАСКИВАНИЕ
// =============================================================================

function startDrag(e) {
    if (e.target.tagName === 'BUTTON' || e.target.classList.contains('close-btn-mini')) return;
    e.preventDefault();
    state.isDragging = true;
    state.isMoving   = false;
    if (cat) cat.classList.add('dragging');
    var r = cat.getBoundingClientRect();
    dragOffsetX = e.clientX - (r.left + r.width  / 2);
    dragOffsetY = e.clientY - (r.top  + r.height / 2);
    play8BitSound('meow');
    if (state.isSleeping) wakeUp();
}

function drag(e) {
    if (!state.isDragging) return;
    e.preventDefault();
    var xp = ((e.clientX - dragOffsetX) / window.innerWidth)  * 100;
    var yp = ((e.clientY - dragOffsetY) / window.innerHeight) * 100;
    updateCatPosition(clamp(xp), clamp(yp));
}

function endDrag() {
    if (!state.isDragging) return;
    state.isDragging = false;
    if (cat) cat.classList.remove('dragging');
    if (!state.isLaserOn) showChat();
}

// =============================================================================
// ЧАТ (баббл над котом)
// =============================================================================

function showChat() {
    var chatEl = $el('cat-chat');
    if (!chatEl) return;
    chatEl.classList.add('visible');
    chatEl.style.left      = '50%';
    chatEl.style.transform = 'translate(-50%, 0)';
    state.isChatting = true;
}

function hideChat() {
    var chatEl = $el('cat-chat');
    if (!chatEl) return;
    chatEl.classList.remove('visible');
    state.isChatting = false;
    setTimeout(function() {
        var ab = $el('action-buttons');
        var ub = $el('chat-bubble-input');
        if (ab) ab.classList.remove('hidden');
        if (ub) ub.classList.add('hidden');
    }, 300);
}

function toggleChatInput() {
    var ab = $el('action-buttons');
    var ub = $el('chat-bubble-input');
    var bm = $el('bubble-msg');
    if (ab) ab.classList.add('hidden');
    if (ub) ub.classList.remove('hidden');
    if (bm) bm.focus();
}

function showCatMessage(text) {
    var content = $el('chat-content');
    if (content) content.innerText = text;
    showChat();
    showToggleBadge();
}

function finalizeReply(text) {
    var content = $el('chat-content');
    if (content) content.innerText = text;
    setTimeout(hideChat, 8000);
}

async function handleBubbleResponse(txt) {
    if (!txt.trim()) return;
    if (!checkAntiSpam()) return;

    var content = $el('chat-content');
    if (content) content.innerHTML = '<span style="opacity:0.6">Думаю...</span>';
    addLog(config.userName || 'Вы', txt, 'chat');

    var reply;
    if (config.apiKey) {
        reply = await callAI(txt);
    } else {
        await delay(600);
        reply = randomItem(['Мяу! (нет ключа API)', '*мурчит молча*', 'Пррр...']);
    }

    finalizeReply(reply);
    addLog('Yuma', reply, 'chat');
    play8BitSound('notification');
}

// =============================================================================
// АВТОНОМНЫЙ РАЗГОВОР
// =============================================================================

async function autonomousTalk() {
    if (state.isSleeping || state.isLaserOn || state.isChatting) return;
    if (Math.random() > 0.7) return;

    var msg;
    var activeDebuffs = Object.keys(state.debuffs);

    if (config.apiKey && Math.random() > 0.3) {
        var debuffCtx = activeDebuffs.length > 0
            ? ' У тебя сейчас дебаф: ' + activeDebuffs.map(function(d) { return DEBUFF_DEFS[d].label; }).join(', ') + '.'
            : '';
        msg = await callAI('Придумай короткую фразу (1 предложение) для начала разговора с хозяином ' + config.userName + '.' + debuffCtx);
    } else if (activeDebuffs.length > 0) {
        msg = randomItem(DEBUFF_DEFS[activeDebuffs[0]].phrases);
    } else {
        msg = AUTO_PHRASES[Math.floor(Math.random() * AUTO_PHRASES.length)].replace('{{name}}', config.userName);
    }

    if (msg && msg.length > 1) {
        showCatMessage(msg);
        play8BitSound('meow');
        addLog('Yuma (Auto)', msg, 'chat');
        setTimeout(function() {
            var ub = $el('chat-bubble-input');
            if (state.isChatting && ub && ub.classList.contains('hidden')) {
                hideChat();
            }
        }, 6000);
    }
}

// =============================================================================
// AI
// =============================================================================

async function callAI(prompt) {
    if (config.provider !== 'openrouter') return 'Gemini пока в бета-тесте.';
    try {
        var systemMsg = config.systemPrompt + '. Пользователя зовут ' + config.userName + '. Говори на русском. Отвечай кратко (1-2 предложения).';
        var res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method:  'POST',
            headers: { 'Authorization': 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                model:    config.model,
                messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
            }),
        });
        var data = await res.json();
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Ошибка API';
    } catch(e) {
        return 'Ошибка сети';
    }
}

// =============================================================================
// СТАТУС-ПОПАП
// =============================================================================

function toggleStats() {
    var popup = $el('stats-popup');
    var btn   = $el('btn-stats');
    if (!popup || !btn) return;
    popup.classList.toggle('visible');
    btn.classList.toggle('active', popup.classList.contains('visible'));
    renderDebuffUI();
}

// =============================================================================
// НАСТРОЙКИ
// =============================================================================

function toggleSettings() {
    var modal = $el('settings-modal');
    if (!modal) return;
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) syncSettingsUI();
}

function syncSettingsUI() {
    function safe(id, val) { var e = $el(id); if (e) e.value = val; }
    function safeText(id, val) { var e = $el(id); if (e) e.innerText = val; }

    updateProviderUI();
    safe('user-name-input',  config.userName);
    safe('cat-prompt-input', config.systemPrompt);
    safe('scale-input',      config.catScale);
    safeText('scale-val',    config.catScale);
    safe('font-input',       config.fontSize);
    safeText('font-val',     config.fontSize);
    safe('provider-select',  config.provider);
    safe('model-name',       config.model);
    safe('api-key',          config.apiKey);
    safe('speed-input',      config.moveSpeed);
}

function updateProviderUI() {
    var mc = $el('model-container');
    var ps = $el('provider-select');
    if (!mc || !ps) return;
    mc.style.display = ps.value === 'openrouter' ? 'block' : 'none';
}

function saveSettings() {
    function val(id) { var e = $el(id); return e ? e.value : ''; }

    config.apiKey       = val('api-key');
    config.provider     = val('provider-select');
    config.model        = val('model-name');
    config.moveSpeed    = parseFloat(val('speed-input'));
    config.userName     = val('user-name-input');
    config.systemPrompt = val('cat-prompt-input');
    config.catScale     = parseFloat(val('scale-input'));
    config.fontSize     = parseInt(val('font-input'));

    trySave(STORAGE_KEYS.apiKey,   config.apiKey);
    trySave(STORAGE_KEYS.provider, config.provider);
    trySave(STORAGE_KEYS.model,    config.model);
    trySave(STORAGE_KEYS.speed,    config.moveSpeed);
    trySave(STORAGE_KEYS.userName, config.userName);
    trySave(STORAGE_KEYS.prompt,   config.systemPrompt);
    trySave(STORAGE_KEYS.scale,    config.catScale);
    trySave(STORAGE_KEYS.font,     config.fontSize);

    applyAppearance();
    toggleSettings();
    addLog('System', 'Настройки сохранены', 'system');
}

// =============================================================================
// ВНЕШНОСТЬ / СКИНЫ / ФОН
// =============================================================================

function applyAppearance() {
    if (!cat) return;
    var size = 128 * config.catScale;
    cat.style.width  = size + 'px';
    cat.style.height = size + 'px';
    document.documentElement.style.setProperty('--base-font-size', config.fontSize + 'px');
}

async function handleSkinUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var src = await readFileAsDataURL(file);
    if (!state.isSleeping && imgElement) imgElement.src = src;
    trySave(STORAGE_KEYS.skin, src);
    toggleSettings();
}

function resetSkin() {
    localStorage.removeItem(STORAGE_KEYS.skin);
    location.reload();
}

async function handleSleepUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var src = await readFileAsDataURL(file);
    trySave(STORAGE_KEYS.sleep, src);
    if (state.isSleeping && imgElement) imgElement.src = src;
    toggleSettings();
}

function resetSleep() {
    localStorage.removeItem(STORAGE_KEYS.sleep);
    if (state.isSleeping && imgElement) imgElement.src = 'sleep.png';
    toggleSettings();
}

async function handleBgUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var src = await readFileAsDataURL(file);
    document.body.style.backgroundImage = "url('" + src + "')";
    document.body.classList.add('has-bg');
    trySave(STORAGE_KEYS.bg, src);
    toggleSettings();
}

function resetBackground() {
    document.body.style.backgroundImage = 'none';
    document.body.classList.remove('has-bg');
    localStorage.removeItem(STORAGE_KEYS.bg);
    toggleSettings();
}

// =============================================================================
// ELECTRON MOUSE EVENTS
// =============================================================================

function setupElectronMouseEvents() {
    // Поддержка Electron (текущий) и Tauri (будущий)
    var ipcRenderer = null;
    try {
        if (typeof require !== 'undefined') {
            ipcRenderer = require('electron').ipcRenderer;
        }
    } catch(e) { /* не Electron */ }

    var lastIgnore = null;
    window.addEventListener('mousemove', function(e) {
        if (state.isLaserOn) {
            if (lastIgnore !== false) {
                lastIgnore = false;
                if (ipcRenderer) ipcRenderer.send('set-ignore-mouse-events', false);
            }
            return;
        }
        var elem = document.elementFromPoint(e.clientX, e.clientY);
        // Добавлены новые v2-панели: yuma-calendar, yuma-notes, yuma-log-v2, file-panel, file-preview
        var interactiveIds = [
            'cyber-cat', 'ui-left', 'cat-chat', 'settings-modal',
            'input-dock', 'event-log', 'ui-toggle-btn', 'debuff-status-bar',
            'yuma-calendar', 'yuma-notes', 'yuma-log-v2', 'file-panel', 'file-preview'
        ];
        var isInteractive = state.isDragging || interactiveIds.some(function(id) {
            var el2 = $el(id);
            return el2 && el2.contains(elem);
        });
        // Также проверяем стикеры
        if (!isInteractive) {
            var stickerEl = document.elementFromPoint(e.clientX, e.clientY);
            if (stickerEl && stickerEl.closest && stickerEl.closest('.yuma-sticker')) {
                isInteractive = true;
            }
        }
        if (isInteractive !== !lastIgnore) {
            lastIgnore = !isInteractive;
            if (ipcRenderer) {
                if (lastIgnore) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
                else ipcRenderer.send('set-ignore-mouse-events', false);
            }
        }
    });
}

// =============================================================================
// ЗАГРУЗКА КОНФИГА
// =============================================================================

function loadConfig() {
    function get(k) { return localStorage.getItem(k); }

    if (get(STORAGE_KEYS.apiKey))   config.apiKey       = get(STORAGE_KEYS.apiKey);
    if (get(STORAGE_KEYS.provider)) config.provider     = get(STORAGE_KEYS.provider);
    if (get(STORAGE_KEYS.model))    config.model        = get(STORAGE_KEYS.model);
    if (get(STORAGE_KEYS.speed))    config.moveSpeed    = parseFloat(get(STORAGE_KEYS.speed));
    if (get(STORAGE_KEYS.userName)) config.userName     = get(STORAGE_KEYS.userName);
    if (get(STORAGE_KEYS.prompt))   config.systemPrompt = get(STORAGE_KEYS.prompt);
    if (get(STORAGE_KEYS.scale))    config.catScale     = parseFloat(get(STORAGE_KEYS.scale));
    if (get(STORAGE_KEYS.font))     config.fontSize     = parseInt(get(STORAGE_KEYS.font));

    var savedSkin = get(STORAGE_KEYS.skin);
    var savedBg   = get(STORAGE_KEYS.bg);

    if (savedSkin && imgElement) imgElement.src = savedSkin;
    if (savedBg) {
        document.body.style.backgroundImage = "url('" + savedBg + "')";
        document.body.classList.add('has-bg');
    }

    // Восстанавливаем состояние UI
    if (get(STORAGE_KEYS.uiHidden) === 'true') {
        state.isUIHidden = true;
        var uiLeft = $el('ui-left');
        var dock   = $el('input-dock');
        var tBtn   = $el('ui-toggle-btn');
        if (uiLeft) uiLeft.classList.add('ui-hidden');
        if (dock)   dock.classList.add('ui-hidden');
        if (tBtn)   tBtn.classList.add('visible');
    }
}

// =============================================================================
// ИНИЦИАЛИЗАЦИЯ — ТОЛЬКО ЗДЕСЬ, ПОСЛЕ ЗАГРУЗКИ DOM
// =============================================================================

function init() {
    // Получаем DOM-ссылки
    cat        = $el('cyber-cat');
    imgElement = $el('custom-cat-img');

    if (!cat || !imgElement) {
        console.error('Yuma: не найдены ключевые элементы DOM!');
        return;
    }

    loadConfig();
    loadLogFromStorage();
    syncSettingsUI();
    applyAppearance();
    updateStatUI();
    renderDebuffUI();
    checkSadness();

    // Периодика
    setInterval(autonomousMove, config.moveInterval);
    setInterval(autonomousTalk, config.talkInterval);
    setInterval(decayStats,     60000);
    setInterval(checkDebuffs,   30000);

    // Перетаскивание
    cat.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', drag);
    window.addEventListener('mouseup',   endDrag);

    // Лазер
    window.addEventListener('mousemove', handleMouseMove);

    // Глобальный клик
    window.addEventListener('click', function(e) {
        initAudioCtx();
        if (state.isLaserOn && !e.target.closest('#laser-btn')) toggleLaser();
        if (!e.target.closest('#event-log') && !e.target.closest('#btn-log')) {
            var logEl = $el('event-log');
            var logBtn = $el('btn-log');
            if (logEl) logEl.classList.remove('visible');
            if (logBtn) logBtn.classList.remove('active');
        }
    });

    // Чат-баббл: Enter
    var bubbleMsg = $el('bubble-msg');
    if (bubbleMsg) {
        bubbleMsg.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleBubbleResponse(e.target.value);
                e.target.value = '';
            }
        });
    }

    // Загрузка файлов (скины, фон)
    var skinInput  = $el('custom-skin-input');
    var sleepInput = $el('custom-sleep-input');
    var bgInput    = $el('custom-bg-input');
    if (skinInput)  skinInput.addEventListener('change',  handleSkinUpload);
    if (sleepInput) sleepInput.addEventListener('change', handleSleepUpload);
    if (bgInput)    bgInput.addEventListener('change',    handleBgUpload);

    // UI Toggle кнопка разворота
    var toggleBtn = $el('ui-toggle-btn');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleUI);

    // Input Dock
    initInputDock();

    // Electron
    setupElectronMouseEvents();

    addLog('System', 'Юма запущена', 'system');
}

// Запуск ТОЛЬКО через window.onload
window.onload = init;
