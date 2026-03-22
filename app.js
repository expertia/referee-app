// === iOS Keyboard: adjust modals to visible viewport ===
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        document.documentElement.style.setProperty(
            '--vh', window.visualViewport.height + 'px'
        );
    });
    document.documentElement.style.setProperty(
        '--vh', window.visualViewport.height + 'px'
    );
}

// === Data Store ===
const Store = {
    get(key) {
        try {
            return JSON.parse(localStorage.getItem(key));
        } catch { return null; }
    },
    set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
};

// === State ===
let matches = Store.get('matches') || [];
let roster = Store.get('roster') || [];
let currentMatchId = null;
let timerInterval = null;
let timerStartedAt = null;   // timestamp when timer was started
let timerElapsedBase = 0;    // elapsed seconds before current start
let goalModalTeam = null;
let goalModalPlayerId = null;
let editingPlayerId = null;
let confirmCallback = null;
let statsFilter = 'all'; // 'all' or category name

const MY_TEAM = 'Čechie Uhříněves';

// === Helpers ===
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function saveMatches() {
    Store.set('matches', matches);
}

function saveRoster() {
    Store.set('roster', roster);
}

function getCurrentMatch() {
    return matches.find(m => m.id === currentMatchId);
}

function formatTime(totalSeconds) {
    const min = Math.floor(totalSeconds / 60);
    const sec = totalSeconds % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function getCurrentMinute(match) {
    let elapsed = timerElapsedBase;
    if (timerStartedAt) {
        elapsed += Math.floor((Date.now() - timerStartedAt) / 1000);
    }
    const minute = Math.floor(elapsed / 60) + 1;
    const offset = match.half === 2 ? match.halfDuration : 0;
    return Math.min(minute + offset, match.halfDuration * 2);
}

function getDisplayElapsed() {
    let elapsed = timerElapsedBase;
    if (timerStartedAt) {
        elapsed += Math.floor((Date.now() - timerStartedAt) / 1000);
    }
    return elapsed;
}

function getPlayerById(id) {
    return roster.find(p => p.id === id);
}

function getPlayerGoals(playerId) {
    let goals = 0;
    matches.forEach(m => {
        if (m.status === 'finished' || m.status === 'live') {
            m.events.forEach(e => {
                if (e.type === 'goal' && e.playerId === playerId) goals++;
            });
        }
    });
    return goals;
}

function getPlayerName(event) {
    if (event.playerId) {
        const player = getPlayerById(event.playerId);
        if (player) return `${player.name} (#${event.jersey})`;
    }
    return `#${event.jersey}`;
}

function getCategories() {
    const cats = new Set();
    matches.forEach(m => { if (m.category) cats.add(m.category); });
    return [...cats].sort();
}

// === Navigation ===
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');

    // Update tab bar
    const tabScreens = ['matches-screen', 'roster-screen', 'stats-screen'];
    if (tabScreens.includes(screenId)) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === screenId);
        });
        document.getElementById('tab-bar').style.display = 'flex';
    } else {
        document.getElementById('tab-bar').style.display = 'none';
    }

    // Render appropriate screen
    if (screenId === 'matches-screen') renderMatchList();
    if (screenId === 'roster-screen') renderRoster();
    if (screenId === 'stats-screen') renderStats();
    if (screenId === 'match-detail-screen') renderMatchDetail();
}

// === Match List ===
function renderMatchList() {
    const container = document.getElementById('match-list');
    if (matches.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Zatím žádné zápasy.<br>Vytvoř nový zápas.</p></div>';
        return;
    }
    // Sort: live first, then by date desc
    const sorted = [...matches].sort((a, b) => {
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (b.status === 'live' && a.status !== 'live') return 1;
        return new Date(b.date) - new Date(a.date);
    });

    container.innerHTML = sorted.map(m => {
        const homeGoals = m.events.filter(e => e.type === 'goal' && e.team === 'home').length;
        const awayGoals = m.events.filter(e => e.type === 'goal' && e.team === 'away').length;
        const liveTag = m.status === 'live' ? '<span class="match-item-live">LIVE</span>' : '';
        const score = m.status === 'created' ? '-:-' : `${homeGoals}:${awayGoals}`;
        const dateStr = new Date(m.date).toLocaleDateString('cs-CZ');
        const meta = [dateStr, m.category, m.competition].filter(Boolean).join(' | ');

        return `
            <div class="list-item" data-match-id="${m.id}">
                <div class="match-item-header">
                    <span class="match-item-teams">${m.homeTeam} - ${m.awayTeam}</span>
                    <span class="match-item-score">${score}${liveTag}</span>
                </div>
                <div class="match-item-meta">${meta}</div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.list-item').forEach(item => {
        item.addEventListener('click', () => {
            const match = matches.find(m => m.id === item.dataset.matchId);
            if (match.status === 'live') {
                openLiveMatch(match.id);
            } else if (match.status === 'finished') {
                currentMatchId = match.id;
                showScreen('match-detail-screen');
            } else {
                openLiveMatch(match.id);
            }
        });
    });
}

// === New Match ===
document.getElementById('btn-new-match').addEventListener('click', () => {
    document.getElementById('match-date').value = new Date().toISOString().split('T')[0];
    // Pre-fill home team with MY_TEAM
    document.getElementById('home-team').value = MY_TEAM;
    document.getElementById('away-team').value = '';
    document.getElementById('half-duration').value = '35';
    document.getElementById('match-category').value = '';
    document.getElementById('match-competition').value = '';
    // Render category suggestions
    const cats = getCategories();
    const sugContainer = document.getElementById('category-suggestions');
    if (cats.length > 0) {
        sugContainer.innerHTML = cats.map(c =>
            `<button type="button" class="suggestion-btn" data-cat="${c}">${c}</button>`
        ).join('');
        sugContainer.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('match-category').value = btn.dataset.cat;
            });
        });
    } else {
        sugContainer.innerHTML = '';
    }
    showScreen('new-match-screen');
});

document.getElementById('new-match-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const match = {
        id: generateId(),
        homeTeam: document.getElementById('home-team').value.trim(),
        awayTeam: document.getElementById('away-team').value.trim(),
        halfDuration: parseInt(document.getElementById('half-duration').value),
        date: document.getElementById('match-date').value,
        category: document.getElementById('match-category').value.trim() || null,
        competition: document.getElementById('match-competition').value.trim(),
        status: 'created', // created, live, finished
        half: 1,
        events: [],
        lineup: [], // [{playerId, jersey}]
        timerState: null // saved timer state for resuming
    };
    matches.push(match);
    saveMatches();
    openLiveMatch(match.id);
});

// === Live Match ===
function openLiveMatch(matchId) {
    currentMatchId = matchId;
    const match = getCurrentMatch();

    document.getElementById('live-match-title').textContent =
        `${match.homeTeam} vs ${match.awayTeam}`;
    document.getElementById('live-home-name').textContent = match.homeTeam;
    document.getElementById('live-away-name').textContent = match.awayTeam;
    document.getElementById('goal-home-name').textContent = match.homeTeam;
    document.getElementById('goal-away-name').textContent = match.awayTeam;

    // Restore timer state
    if (match.timerState) {
        timerElapsedBase = match.timerState.elapsed;
        timerStartedAt = match.timerState.running ? Date.now() - 0 : null;
        // Adjust if timer was running when page was left
        if (match.timerState.running && match.timerState.lastTimestamp) {
            timerElapsedBase += Math.floor((Date.now() - match.timerState.lastTimestamp) / 1000);
        }
    } else {
        timerElapsedBase = 0;
        timerStartedAt = null;
    }

    updateLiveUI();
    showScreen('live-match-screen');

    // Restart interval if timer was running
    if (match.timerState && match.timerState.running) {
        timerStartedAt = Date.now();
        startTimerInterval();
    }
}

function updateLiveUI() {
    const match = getCurrentMatch();
    if (!match) return;

    const homeGoals = match.events.filter(e => e.type === 'goal' && e.team === 'home').length;
    const awayGoals = match.events.filter(e => e.type === 'goal' && e.team === 'away').length;

    document.getElementById('live-home-goals').textContent = homeGoals;
    document.getElementById('live-away-goals').textContent = awayGoals;

    // Half indicator
    const halfText = match.status === 'finished' ? 'Konec' :
        match.half === 1 ? '1. poločas' : '2. poločas';
    document.getElementById('half-indicator').textContent = halfText;

    // Timer display
    const elapsed = getDisplayElapsed();
    const offset = match.half === 2 ? match.halfDuration * 60 : 0;
    document.getElementById('timer-display').textContent = formatTime(elapsed + offset);

    // Button states
    const isRunning = timerStartedAt !== null;
    const isFinished = match.status === 'finished';

    document.getElementById('btn-start-timer').disabled = isRunning || isFinished;
    document.getElementById('btn-stop-timer').disabled = !isRunning || isFinished;
    document.getElementById('btn-goal-home').disabled = !isRunning;
    document.getElementById('btn-goal-away').disabled = !isRunning;
    document.getElementById('btn-end-half').disabled = isRunning || isFinished;
    document.getElementById('btn-end-half').style.display = isFinished ? 'none' : '';

    // Show end-half only when timer has been stopped and has elapsed time
    if (timerElapsedBase > 0 && !isRunning && !isFinished) {
        document.getElementById('btn-end-half').disabled = false;
        if (match.half === 1) {
            document.getElementById('btn-end-half').textContent = 'Ukončit 1. poločas';
        } else {
            document.getElementById('btn-end-half').textContent = 'Ukončit 2. poločas';
        }
    }

    document.getElementById('btn-end-match').style.display =
        (match.half === 2 && !isRunning && timerElapsedBase > 0 && !isFinished) ? '' : 'none';

    // Lineup section
    renderLineupSection(match);

    // Event log
    renderEventLog(match);
}

function renderLineupSection(match) {
    const section = document.getElementById('lineup-section');
    const isMyTeam = match.homeTeam === MY_TEAM || match.awayTeam === MY_TEAM;

    if (!isMyTeam || roster.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    const display = document.getElementById('lineup-display');

    if (!match.lineup || match.lineup.length === 0) {
        display.innerHTML = '<span style="color:var(--text-dim);font-size:13px">Žádná nominace</span>';
    } else {
        display.innerHTML = match.lineup
            .sort((a, b) => (a.jersey || 99) - (b.jersey || 99))
            .map(entry => {
                const player = getPlayerById(entry.playerId);
                const name = player ? player.name.split(' ').pop() : '?';
                return `<span class="lineup-chip"><span class="chip-jersey">${entry.jersey}</span><span class="chip-name">${name}</span></span>`;
            }).join('');
    }
}

function openLineupModal() {
    const match = getCurrentMatch();
    if (!match) return;

    const container = document.getElementById('lineup-player-list');
    const lineup = match.lineup || [];

    container.innerHTML = roster
        .sort((a, b) => (a.defaultJersey || 99) - (b.defaultJersey || 99))
        .map(p => {
            const entry = lineup.find(l => l.playerId === p.id);
            const checked = entry ? 'checked' : '';
            const jersey = entry ? entry.jersey : (p.defaultJersey || '');
            return `
                <label class="lineup-row ${checked ? 'checked' : ''}" data-player-id="${p.id}">
                    <input type="checkbox" ${checked}>
                    <span class="lineup-player-name">${p.name}</span>
                    <input type="number" min="0" max="99" value="${jersey}" placeholder="#" inputmode="numeric">
                </label>
            `;
        }).join('');

    // Toggle checked class on checkbox change
    container.querySelectorAll('.lineup-row input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            cb.closest('.lineup-row').classList.toggle('checked', cb.checked);
        });
    });

    document.getElementById('lineup-modal').style.display = 'flex';
}

function saveLineup() {
    const match = getCurrentMatch();
    if (!match) return;

    const rows = document.querySelectorAll('#lineup-player-list .lineup-row');
    match.lineup = [];

    rows.forEach(row => {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb.checked) {
            const playerId = row.dataset.playerId;
            const jersey = parseInt(row.querySelector('input[type="number"]').value) || 0;
            match.lineup.push({ playerId, jersey });
        }
    });

    saveMatches();
    document.getElementById('lineup-modal').style.display = 'none';
    updateLiveUI();
}

document.getElementById('btn-edit-lineup').addEventListener('click', openLineupModal);
document.getElementById('btn-lineup-save').addEventListener('click', saveLineup);
document.getElementById('btn-lineup-cancel').addEventListener('click', () => {
    document.getElementById('lineup-modal').style.display = 'none';
});

function renderEventLog(match) {
    const container = document.getElementById('event-log');
    if (match.events.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:16px"><p>Zatím žádné události</p></div>';
        return;
    }

    const sorted = [...match.events].sort((a, b) => a.minute - b.minute);
    let lastHalf = 0;

    container.innerHTML = sorted.map(e => {
        let halfSep = '';
        const eventHalf = e.minute <= match.halfDuration ? 1 : 2;
        if (eventHalf !== lastHalf) {
            lastHalf = eventHalf;
            halfSep = `<div style="font-size:12px;color:var(--text-dim);padding:8px 0 4px;font-weight:600">${eventHalf}. poločas</div>`;
        }

        const side = e.team === 'home' ? 'home' : 'away';
        const teamName = e.team === 'home' ? match.homeTeam : match.awayTeam;
        const playerName = getPlayerName(e);

        return `${halfSep}<div class="event-item ${side}">
            <span class="event-minute">${e.minute}'</span>
            <div class="event-detail">
                <span class="event-player">${playerName}</span>
                <span class="event-team">${teamName}</span>
            </div>
            ${match.status !== 'finished' ? `<button class="event-delete" data-event-id="${e.id}">&times;</button>` : ''}
        </div>`;
    }).join('');

    container.querySelectorAll('.event-delete').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const eventId = btn.dataset.eventId;
            showConfirm('Smazat gól?', 'Opravdu chceš smazat tento gól?', () => {
                match.events = match.events.filter(e => e.id !== eventId);
                saveMatches();
                updateLiveUI();
            });
        });
    });
}

// Timer controls
document.getElementById('btn-start-timer').addEventListener('click', () => {
    const match = getCurrentMatch();
    if (!match) return;
    match.status = 'live';
    timerStartedAt = Date.now();
    saveTimerState(match);
    saveMatches();
    startTimerInterval();
    updateLiveUI();
});

document.getElementById('btn-stop-timer').addEventListener('click', () => {
    const match = getCurrentMatch();
    if (!match) return;
    stopTimer();
    saveTimerState(match);
    saveMatches();
    updateLiveUI();
});

function startTimerInterval() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const match = getCurrentMatch();
        if (!match) return;
        const elapsed = getDisplayElapsed();
        const offset = match.half === 2 ? match.halfDuration * 60 : 0;
        document.getElementById('timer-display').textContent = formatTime(elapsed + offset);
    }, 200);
}

function stopTimer() {
    if (timerStartedAt) {
        timerElapsedBase += Math.floor((Date.now() - timerStartedAt) / 1000);
        timerStartedAt = null;
    }
    clearInterval(timerInterval);
}

function saveTimerState(match) {
    match.timerState = {
        elapsed: timerElapsedBase + (timerStartedAt ? Math.floor((Date.now() - timerStartedAt) / 1000) : 0),
        running: timerStartedAt !== null,
        lastTimestamp: Date.now()
    };
}

// End half
document.getElementById('btn-end-half').addEventListener('click', () => {
    const match = getCurrentMatch();
    if (!match) return;

    if (match.half === 1) {
        showConfirm('Konec 1. poločasu', 'Ukončit první poločas?', () => {
            match.half = 2;
            timerElapsedBase = 0;
            timerStartedAt = null;
            clearInterval(timerInterval);
            saveTimerState(match);
            saveMatches();
            updateLiveUI();
        });
    } else {
        endMatch();
    }
});

document.getElementById('btn-end-match').addEventListener('click', endMatch);

function endMatch() {
    const match = getCurrentMatch();
    if (!match) return;
    showConfirm('Konec zápasu', 'Ukončit zápas?', () => {
        match.status = 'finished';
        stopTimer();
        match.timerState = null;
        saveMatches();
        currentMatchId = match.id;
        showScreen('match-detail-screen');
    });
}

// === Goal Recording ===
document.getElementById('btn-goal-home').addEventListener('click', () => openGoalModal('home'));
document.getElementById('btn-goal-away').addEventListener('click', () => openGoalModal('away'));

function openGoalModal(team) {
    const match = getCurrentMatch();
    if (!match) return;

    goalModalTeam = team;
    goalModalPlayerId = null;
    const teamName = team === 'home' ? match.homeTeam : match.awayTeam;
    const minute = getCurrentMinute(match);

    document.getElementById('goal-modal-title').textContent = `Gól - ${teamName}`;
    document.getElementById('goal-modal-minute').textContent = `${minute}. minuta`;
    document.getElementById('goal-jersey').value = '';

    // Show roster quick-select if this is our team
    const isMyTeam = (team === 'home' && match.homeTeam === MY_TEAM) ||
                     (team === 'away' && match.awayTeam === MY_TEAM);
    const rosterSection = document.getElementById('goal-roster-section');
    const rosterList = document.getElementById('goal-roster-list');

    if (isMyTeam && roster.length > 0) {
        rosterSection.style.display = '';

        // Use lineup if available, otherwise full roster
        const hasLineup = match.lineup && match.lineup.length > 0;
        const players = hasLineup
            ? match.lineup
                .sort((a, b) => (a.jersey || 99) - (b.jersey || 99))
                .map(entry => ({
                    id: entry.playerId,
                    name: getPlayerById(entry.playerId)?.name || '?',
                    jersey: entry.jersey
                }))
            : roster
                .sort((a, b) => (a.defaultJersey || 99) - (b.defaultJersey || 99))
                .map(p => ({ id: p.id, name: p.name, jersey: p.defaultJersey }));

        rosterList.innerHTML = players.map(p => `
                <button class="roster-quick-btn" data-player-id="${p.id}" data-jersey="${p.jersey || ''}">
                    <span class="jersey-num">${p.jersey || '?'}</span>
                    <span class="player-short-name">${p.name}</span>
                </button>
            `).join('');

        rosterList.querySelectorAll('.roster-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                rosterList.querySelectorAll('.roster-quick-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                goalModalPlayerId = btn.dataset.playerId;
                const jersey = btn.dataset.jersey;
                if (jersey) {
                    document.getElementById('goal-jersey').value = jersey;
                }
            });
        });
    } else {
        rosterSection.style.display = 'none';
    }

    document.getElementById('goal-modal').style.display = 'flex';
    // Only focus jersey input if no roster shown (opponent team)
    if (!isMyTeam || roster.length === 0) {
        document.getElementById('goal-jersey').focus();
    }
}

document.getElementById('btn-goal-cancel').addEventListener('click', closeGoalModal);

document.getElementById('btn-goal-confirm').addEventListener('click', () => {
    const jersey = document.getElementById('goal-jersey').value;
    if (!jersey) {
        document.getElementById('goal-jersey').style.borderColor = 'var(--danger)';
        return;
    }
    // Use pre-selected player from roster, or try to match by jersey
    let playerId = goalModalPlayerId;
    if (!playerId) {
        const match = getCurrentMatch();
        const isMyTeam = (goalModalTeam === 'home' && match.homeTeam === MY_TEAM) ||
                         (goalModalTeam === 'away' && match.awayTeam === MY_TEAM);
        if (isMyTeam) {
            const player = roster.find(p => p.defaultJersey === parseInt(jersey));
            if (player) playerId = player.id;
        }
    }
    recordGoal(playerId);
});

// Allow enter key in jersey input
document.getElementById('goal-jersey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-goal-confirm').click();
    }
});

function recordGoal(playerId) {
    const match = getCurrentMatch();
    if (!match) return;

    const jersey = document.getElementById('goal-jersey').value;
    if (!jersey && !playerId) return;

    const minute = getCurrentMinute(match);
    const event = {
        id: generateId(),
        type: 'goal',
        team: goalModalTeam,
        jersey: parseInt(jersey) || (playerId ? (getPlayerById(playerId)?.defaultJersey || 0) : 0),
        minute: minute,
        playerId: playerId || null,
        timestamp: Date.now()
    };

    match.events.push(event);
    saveMatches();
    closeGoalModal();
    updateLiveUI();

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);
}

function closeGoalModal() {
    document.getElementById('goal-modal').style.display = 'none';
    document.getElementById('goal-jersey').style.borderColor = '';
    goalModalTeam = null;
}

// === Match Detail ===
function renderMatchDetail() {
    const match = getCurrentMatch();
    if (!match) return;

    const homeGoals = match.events.filter(e => e.type === 'goal' && e.team === 'home');
    const awayGoals = match.events.filter(e => e.type === 'goal' && e.team === 'away');
    const dateStr = new Date(match.date).toLocaleDateString('cs-CZ', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const renderGoalList = (goals) => {
        if (goals.length === 0) return '<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Žádné góly</div>';

        // Group goals by player (by playerId if available, otherwise by jersey)
        const grouped = {};
        goals.sort((a, b) => a.minute - b.minute).forEach(g => {
            const key = g.playerId || `jersey-${g.jersey}`;
            if (!grouped[key]) {
                grouped[key] = { name: getPlayerName(g), minutes: [] };
            }
            grouped[key].minutes.push(g.minute);
        });

        return Object.values(grouped).map(g => `
            <div class="detail-goal-item">
                <span class="detail-goal-player">${g.name}</span>
                <span class="detail-goal-minutes">${g.minutes.map(m => m + "'").join(', ')}</span>
            </div>
        `).join('');
    };

    document.getElementById('match-detail-content').innerHTML = `
        <div class="detail-header">
            <div class="detail-teams">${match.homeTeam} - ${match.awayTeam}</div>
            <div class="detail-score">
                <span class="home-score">${homeGoals.length}</span>
                <span style="color:var(--text-dim)"> : </span>
                <span class="away-score">${awayGoals.length}</span>
            </div>
            <div class="detail-meta">${dateStr}${match.category ? ' | ' + match.category : ''}${match.competition ? ' | ' + match.competition : ''}</div>
            <div class="detail-meta">${match.halfDuration} + ${match.halfDuration} min</div>
        </div>

        <div class="detail-goals">
            <div class="detail-goals-column home">
                <h3>${match.homeTeam}</h3>
                ${renderGoalList(homeGoals)}
            </div>
            <div class="detail-goals-column away">
                <h3>${match.awayTeam}</h3>
                ${renderGoalList(awayGoals)}
            </div>
        </div>

        <div class="detail-actions">
            ${match.status === 'finished' ? `<button class="btn-secondary" id="btn-reopen-match">Znovu otevřít</button>` : ''}
            <button class="btn-danger" id="btn-delete-match">Smazat zápas</button>
        </div>
    `;

    document.getElementById('btn-delete-match')?.addEventListener('click', () => {
        showConfirm('Smazat zápas', 'Opravdu chceš smazat tento zápas? Tato akce je nevratná.', () => {
            matches = matches.filter(m => m.id !== match.id);
            saveMatches();
            showScreen('matches-screen');
        });
    });

    document.getElementById('btn-reopen-match')?.addEventListener('click', () => {
        showConfirm('Znovu otevřít', 'Chceš znovu otevřít tento zápas?', () => {
            match.status = 'live';
            match.timerState = { elapsed: 0, running: false, lastTimestamp: Date.now() };
            saveMatches();
            openLiveMatch(match.id);
        });
    });
}

// === Back from live match ===
document.getElementById('btn-back-live').addEventListener('click', () => {
    const match = getCurrentMatch();
    if (match && match.status === 'live') {
        // Save timer state before leaving
        saveTimerState(match);
        saveMatches();
    }
    clearInterval(timerInterval);
    showScreen('matches-screen');
});

// === Roster ===
function renderRoster() {
    const container = document.getElementById('roster-list');
    if (roster.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Zatím žádní hráči.<br>Přidej hráče svého týmu.</p></div>';
        return;
    }

    const sorted = [...roster].sort((a, b) => (a.defaultJersey || 99) - (b.defaultJersey || 99));
    container.innerHTML = sorted.map(p => {
        const goals = getPlayerGoals(p.id);
        return `
            <div class="list-item" data-player-id="${p.id}">
                <div class="roster-item">
                    <div class="roster-jersey">${p.defaultJersey || '?'}</div>
                    <div class="roster-info">
                        <div class="roster-name">${p.name}</div>
                        <div class="roster-stats">${goals} ${goals === 1 ? 'gól' : goals >= 2 && goals <= 4 ? 'góly' : 'gólů'}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.list-item').forEach(item => {
        item.addEventListener('click', () => {
            editPlayer(item.dataset.playerId);
        });
    });
}

document.getElementById('btn-add-player').addEventListener('click', () => {
    editingPlayerId = null;
    document.getElementById('player-modal-title').textContent = 'Nový hráč';
    document.getElementById('player-name').value = '';
    document.getElementById('player-default-jersey').value = '';
    document.getElementById('btn-player-delete').style.display = 'none';
    document.getElementById('player-modal').style.display = 'flex';
    document.getElementById('player-name').focus();
});

function editPlayer(playerId) {
    const player = getPlayerById(playerId);
    if (!player) return;
    editingPlayerId = playerId;
    document.getElementById('player-modal-title').textContent = 'Upravit hráče';
    document.getElementById('player-name').value = player.name;
    document.getElementById('player-default-jersey').value = player.defaultJersey || '';
    document.getElementById('btn-player-delete').style.display = '';
    document.getElementById('player-modal').style.display = 'flex';
}

document.getElementById('btn-player-save').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) {
        document.getElementById('player-name').style.borderColor = 'var(--danger)';
        return;
    }
    const jersey = document.getElementById('player-default-jersey').value;

    if (editingPlayerId) {
        const player = getPlayerById(editingPlayerId);
        if (player) {
            player.name = name;
            player.defaultJersey = jersey ? parseInt(jersey) : null;
        }
    } else {
        roster.push({
            id: generateId(),
            name: name,
            defaultJersey: jersey ? parseInt(jersey) : null
        });
    }

    saveRoster();
    document.getElementById('player-modal').style.display = 'none';
    document.getElementById('player-name').style.borderColor = '';
    renderRoster();
});

document.getElementById('btn-player-delete').addEventListener('click', () => {
    showConfirm('Smazat hráče', 'Opravdu chceš smazat tohoto hráče? Statistiky zůstanou zachovány.', () => {
        roster = roster.filter(p => p.id !== editingPlayerId);
        saveRoster();
        document.getElementById('player-modal').style.display = 'none';
        renderRoster();
    });
});

document.getElementById('btn-player-cancel').addEventListener('click', () => {
    document.getElementById('player-modal').style.display = 'none';
    document.getElementById('player-name').style.borderColor = '';
});

// === Stats ===
function renderStats() {
    const container = document.getElementById('stats-content');
    const filterBar = document.getElementById('stats-filter');

    // Render category filter
    const cats = getCategories();
    if (cats.length > 0) {
        filterBar.innerHTML = `<button class="filter-pill ${statsFilter === 'all' ? 'active' : ''}" data-filter="all">Vše</button>` +
            cats.map(c => `<button class="filter-pill ${statsFilter === c ? 'active' : ''}" data-filter="${c}">${c}</button>`).join('');
        filterBar.querySelectorAll('.filter-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                statsFilter = btn.dataset.filter;
                renderStats();
            });
        });
        filterBar.style.display = '';
    } else {
        filterBar.innerHTML = '';
        filterBar.style.display = 'none';
    }

    // Filter matches by category
    const filtered = statsFilter === 'all' ? matches : matches.filter(m => m.category === statsFilter);

    // Aggregate goals per player
    const playerGoals = {};
    const playerMatches = {};

    filtered.forEach(m => {
        const matchPlayers = new Set();
        m.events.forEach(e => {
            if (e.type === 'goal' && e.playerId) {
                playerGoals[e.playerId] = (playerGoals[e.playerId] || 0) + 1;
                matchPlayers.add(e.playerId);
            }
        });
        matchPlayers.forEach(pid => {
            playerMatches[pid] = (playerMatches[pid] || 0) + 1;
        });
    });

    // Also count unidentified goals (no playerId but for our team)
    let unidentifiedGoals = 0;
    filtered.forEach(m => {
        m.events.forEach(e => {
            if (e.type === 'goal' && !e.playerId) {
                const isMyTeam = (e.team === 'home' && m.homeTeam === MY_TEAM) ||
                                 (e.team === 'away' && m.awayTeam === MY_TEAM);
                if (isMyTeam) unidentifiedGoals++;
            }
        });
    });

    const entries = Object.entries(playerGoals)
        .map(([id, goals]) => {
            const player = getPlayerById(id);
            return {
                id,
                name: player ? player.name : `Smazaný hráč (${id})`,
                goals,
                matches: playerMatches[id] || 0,
                jersey: player?.defaultJersey
            };
        })
        .sort((a, b) => b.goals - a.goals);

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Zatím žádné statistiky.<br>Statistiky se zobrazí po odehrání zápasů.</p></div>';
        return;
    }

    container.innerHTML = entries.map((e, i) => `
        <div class="list-item">
            <div class="stat-item">
                <span class="stat-rank">${i + 1}.</span>
                <div class="stat-info">
                    <div class="stat-name">${e.name}</div>
                    <div class="stat-detail">${e.jersey ? '#' + e.jersey + ' | ' : ''}${e.matches} ${e.matches === 1 ? 'zápas' : e.matches >= 2 && e.matches <= 4 ? 'zápasy' : 'zápasů'}</div>
                </div>
                <span class="stat-goals">${e.goals}</span>
            </div>
        </div>
    `).join('') + (unidentifiedGoals > 0 ? `
        <div class="list-item" style="opacity:0.6">
            <div class="stat-item">
                <span class="stat-rank">-</span>
                <div class="stat-info">
                    <div class="stat-name">Nepřiřazené góly</div>
                    <div class="stat-detail">Góly bez identifikace hráče</div>
                </div>
                <span class="stat-goals">${unidentifiedGoals}</span>
            </div>
        </div>
    ` : '');
}

// === Confirm Modal ===
function showConfirm(title, text, callback) {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-text').textContent = text;
    confirmCallback = callback;
    document.getElementById('confirm-modal').style.display = 'flex';
}

document.getElementById('btn-confirm-yes').addEventListener('click', () => {
    document.getElementById('confirm-modal').style.display = 'none';
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
});

document.getElementById('btn-confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-modal').style.display = 'none';
    confirmCallback = null;
});

// === Tab Navigation ===
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        showScreen(btn.dataset.screen);
    });
});

// === Back Buttons ===
document.querySelectorAll('.btn-back[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
        showScreen(btn.dataset.back);
    });
});

// === Close modals on backdrop click ===
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});

// === Init ===
showScreen('matches-screen');

// Save timer state periodically for live matches
setInterval(() => {
    const match = getCurrentMatch();
    if (match && match.status === 'live' && timerStartedAt) {
        saveTimerState(match);
        saveMatches();
    }
}, 10000);
