// Display page JavaScript - Optimized for Busy Queue Scenarios

let eventSource = null;
let audioContext = null;
let audioEnabled = false;
let lastQueueCalled = null;
let sseConnected = false;

// Configuration (will be loaded from settings)
let MAX_RECENT_CALLS = 6;       // Multi-call display cards
let MAX_HISTORY = 15;           // History list items
const CALL_HIGHLIGHT_DURATION = 5000; // How long to highlight new calls

// Settings from server
let displaySettings = {};
let TTS_RATE = 0.6;
let TICKER_SPEED = 45;
let SOUND_ENABLED = true;

// Audio persistence key
const AUDIO_STORAGE_KEY = 'display_audio_enabled';
let audioInitialized = false;

// Check if a date string is from today
function isToday(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
}

// Data stores
let recentCalls = [];           // For multi-call display
let callHistory = [];           // For history section
let counterStatus = {};         // Track each counter's current queue
let queueTypesCache = [];       // Cache queue types
let countersCache = [];         // Cache counters

// Audio queue system
let audioQueue = [];
let isPlayingAudio = false;

// Update ticker speed dynamically
function updateTickerSpeed() {
    const tickerItem = document.querySelector('.ticker-item');
    if (tickerItem) {
        tickerItem.style.animationDuration = TICKER_SPEED + 's';
    }
}

// Initialize
document.addEventListener("DOMContentLoaded", function () {
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Load all initial data
    loadInitialData();
    loadQueueTypes();
    loadCounters();
    loadSettings();
    loadCalledQueues();
    connectSSE();

    // Auto-refresh stats every 5 seconds
    setInterval(loadInitialData, 5000);

    // Refresh counter status every 5 seconds
    setInterval(loadCalledQueues, 5000);

    // Polling fallback - check for updates every 2 seconds if SSE is down
    setInterval(pollForUpdates, 2000);

    // Initialize auto-enable audio system
    initAutoAudio();
});

// Update date time
function updateDateTime() {
    const now = new Date();
    const options = {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    };
    document.getElementById("datetime").textContent = now.toLocaleDateString("id-ID", options);
}

// Load initial data (stats)
async function loadInitialData() {
    try {
        const response = await fetch("/api/stats");
        const stats = await response.json();

        // Update stats in header
        document.getElementById("stat-waiting").textContent = stats.waiting_queues || 0;
        document.getElementById("stat-called").textContent = stats.called_queues || 0;
        document.getElementById("stat-completed").textContent = stats.completed_queues || 0;
    } catch (error) {
        console.error("Failed to load stats:", error);
    }
}

// Load all counters
async function loadCounters() {
    try {
        const response = await fetch("/api/counters");
        const counters = await response.json();

        if (counters && counters.length > 0) {
            // Sort counters numerically by counter_number
            counters.sort((a, b) => {
                const numA = parseInt(a.counter_number) || 0;
                const numB = parseInt(b.counter_number) || 0;
                return numA - numB;
            });

            countersCache = counters;
            renderCounterGrid();
        }
    } catch (error) {
        console.error("Failed to load counters:", error);
    }
}

// Load currently called queues to initialize counter status (only today's queues)
async function loadCalledQueues() {
    try {
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        const response = await fetch(`/api/queues?status=called&date=${today}&limit=50`);
        const result = await response.json();
        const queues = result.queues || [];

        // Reset counter status
        counterStatus = {};

        // Map called queues to their counters
        queues.forEach(q => {
            if (q.counter_id) {
                counterStatus[q.counter_id] = {
                    queue_number: q.queue_number,
                    queue_type: q.queue_type,
                    called_at: q.called_at
                };
            }
        });

        // Update counter grid display
        updateCounterGridStatus();
    } catch (error) {
        console.error("Failed to load called queues:", error);
    }
}

// Render counter grid
function renderCounterGrid() {
    const container = document.getElementById("counter-grid");
    if (!container || countersCache.length === 0) return;

    // Calculate optimal grid columns based on counter count
    const count = countersCache.length;
    let columns;

    if (count <= 4) {
        columns = count; // 1-4 counters: show all in one row
    } else if (count <= 6) {
        columns = 3; // 5-6 counters: 2 rows of 3
    } else if (count <= 8) {
        columns = 4; // 7-8 counters: 2 rows of 4
    } else if (count <= 12) {
        columns = Math.ceil(count / 2); // 9-12 counters: 2 rows
    } else if (count <= 18) {
        columns = Math.ceil(count / 3); // 13-18 counters: 3 rows
    } else {
        columns = Math.ceil(count / 4); // 19+ counters: 4 rows
    }

    // Set grid template with flexible sizing
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

    container.innerHTML = countersCache.map(counter => {
        const status = counterStatus[counter.id];
        const hasStatus = status && status.queue_number;
        const statusClass = hasStatus ? 'active' : 'idle';
        const queueNumber = hasStatus ? status.queue_number : '---';
        const statusText = hasStatus ? 'Melayani' : 'Tidak Aktif';

        return `
            <div class="counter-card ${statusClass}" data-counter-id="${counter.id}">
                <div class="counter-name">${counter.counter_name}</div>
                <div class="counter-number">${queueNumber}</div>
                <div class="counter-status">${statusText}</div>
            </div>
        `;
    }).join('');
}

// Update counter grid status without full re-render
function updateCounterGridStatus() {
    countersCache.forEach(counter => {
        const card = document.querySelector(`.counter-card[data-counter-id="${counter.id}"]`);
        if (!card) return;

        const status = counterStatus[counter.id];
        const numberEl = card.querySelector('.counter-number');
        const statusEl = card.querySelector('.counter-status');

        const hasStatus = status && status.queue_number;

        // Update classes
        card.classList.remove('active', 'calling', 'idle');

        if (hasStatus) {
            card.classList.add('active');
            numberEl.textContent = status.queue_number;
            statusEl.textContent = 'Melayani';
        } else {
            card.classList.add('idle');
            numberEl.textContent = '---';
            statusEl.textContent = 'Tidak Aktif';
        }
    });
}

// Highlight counter when calling
function highlightCounter(counterId) {
    const card = document.querySelector(`.counter-card[data-counter-id="${counterId}"]`);
    if (!card) return;

    card.classList.remove('active', 'idle');
    card.classList.add('calling');

    setTimeout(() => {
        card.classList.remove('calling');
        card.classList.add('active');
    }, CALL_HIGHLIGHT_DURATION);
}

// Load queue types for summary
async function loadQueueTypes() {
    try {
        const response = await fetch("/api/queue-types?active=true");
        const types = await response.json();

        const container = document.getElementById("queue-summary");
        if (!container) return;

        if (types && types.length > 0) {
            queueTypesCache = types;

            container.innerHTML = types.map(type => `
                <div class="summary-card" data-type="${type.code}">
                    <div class="prefix">${type.prefix}</div>
                    <div class="count" id="summary-${type.code}">0 menunggu</div>
                </div>
            `).join('');

            loadQueueTypeCounts(types);
        }
    } catch (error) {
        console.error("Failed to load queue types:", error);
    }
}

// Load queue counts by type (uses backend API with today's date filter)
async function loadQueueTypeCounts(types) {
    try {
        if (!types) types = queueTypesCache;
        if (!types || types.length === 0) return;

        // Use /api/stats/by-type which already filters by today's date in backend
        const response = await fetch("/api/stats/by-type");
        const counts = await response.json();

        // Update UI for each queue type
        types.forEach(type => {
            const el = document.getElementById(`summary-${type.code}`);
            if (el) {
                const count = counts[type.code] || 0;
                el.textContent = `${count} menunggu`;
            }
        });
    } catch (error) {
        console.error("Failed to load queue counts:", error);
    }
}

// Load display settings
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        displaySettings = settings; // Store globally
        updateDisplaySettings(settings);
    } catch (error) {
        console.error("Failed to load settings:", error);
    }
}

// Update display UI with settings
function updateDisplaySettings(settings) {
    // Apply header branding
    if (settings.display_title) {
        const titleEl = document.getElementById('header-title');
        if (titleEl) titleEl.textContent = settings.display_title;
        document.title = settings.display_title;
    }

    if (settings.display_logo_text) {
        const logoEl = document.getElementById('header-logo');
        if (logoEl) logoEl.textContent = settings.display_logo_text;
    }

    // Update configuration values
    if (settings.display_recent_calls_count) {
        const newCount = parseInt(settings.display_recent_calls_count) || 6;
        if (newCount !== MAX_RECENT_CALLS) {
            MAX_RECENT_CALLS = newCount;
            renderRecentCalls();
        }
    }
    if (settings.display_history_count) {
        const newCount = parseInt(settings.display_history_count) || 15;
        if (newCount !== MAX_HISTORY) {
            MAX_HISTORY = newCount;
            renderCallHistory();
        }
    }
    if (settings.display_tts_rate) {
        TTS_RATE = parseFloat(settings.display_tts_rate) || 0.6;
    }
    if (settings.display_ticker_speed) {
        TICKER_SPEED = parseInt(settings.display_ticker_speed) || 45;
        updateTickerSpeed();
    }

    SOUND_ENABLED = settings.display_sound_enabled !== 'false';

    // Toggle widget visibility
    const videoContainer = document.querySelector('.video-container');
    if (videoContainer) {
        videoContainer.style.display = settings.display_show_video === 'false' ? 'none' : '';
    }

    const statsEl = document.getElementById('header-stats');
    if (statsEl) {
        statsEl.style.display = settings.display_show_stats === 'false' ? 'none' : '';
    }

    const historySection = document.querySelector('.history-section');
    if (historySection) {
        historySection.style.display = settings.display_show_history === 'false' ? 'none' : '';
    }

    const queueSummary = document.querySelector('.queue-summary');
    if (queueSummary) {
        queueSummary.style.display = settings.display_show_queue_summary === 'false' ? 'none' : '';
    }

    // Video URL
    if (settings.display_video_url) {
        let url = settings.display_video_url;
        let videoId = '';

        if (url.includes('youtube.com/watch?v=')) {
            videoId = url.split('v=')[1].split('&')[0];
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1];
        } else {
            videoId = url;
        }

        if (videoId && videoId.length > 5) {
            const iframe = document.getElementById('youtube-player');
            if (iframe) {
                const newSrc = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}`;
                if (iframe.src !== newSrc) {
                    iframe.src = newSrc;
                }
            }
        }
    }

    // Running text
    if (settings.display_running_text) {
        const ticker = document.getElementById('running-text');
        if (ticker && ticker.textContent !== settings.display_running_text) {
            ticker.textContent = settings.display_running_text;
        }
    }
}

// Initialize auto-audio system
function initAutoAudio() {
    const wasEnabled = localStorage.getItem(AUDIO_STORAGE_KEY) === 'true';
    const btn = document.getElementById("enable-audio-btn");

    if (wasEnabled) {
        // User previously enabled audio - show "waiting for interaction" state
        updateAudioButtonState('waiting');

        // Add interaction listeners to auto-enable on any user interaction
        addAutoEnableListeners();
    } else {
        // First time - show normal enable button
        updateAudioButtonState('disabled');
    }
}

// Add listeners to auto-enable audio on any user interaction
function addAutoEnableListeners() {
    const interactionEvents = ['click', 'touchstart', 'keydown'];

    const autoEnableHandler = function(e) {
        // Don't auto-enable if clicking disable button when audio is already active
        if (audioEnabled && audioInitialized) return;

        // Enable audio silently
        enableAudioSilent();

        // Remove all listeners after first interaction
        interactionEvents.forEach(event => {
            document.removeEventListener(event, autoEnableHandler, { capture: true });
        });
    };

    interactionEvents.forEach(event => {
        document.addEventListener(event, autoEnableHandler, { capture: true, once: false });
    });
}

// Enable audio silently (no bell sound)
function enableAudioSilent() {
    if (audioInitialized) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        if ("speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance("");
            speechSynthesis.speak(utterance);
        }

        audioEnabled = true;
        audioInitialized = true;

        // Save preference
        localStorage.setItem(AUDIO_STORAGE_KEY, 'true');

        updateAudioButtonState('enabled');
        console.log("Audio auto-enabled successfully");
    } catch (e) {
        console.error("Failed to auto-enable audio:", e);
    }
}

// Enable audio (manual click - plays bell)
function enableAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        if ("speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance("");
            speechSynthesis.speak(utterance);
        }

        audioEnabled = true;
        audioInitialized = true;

        // Save preference
        localStorage.setItem(AUDIO_STORAGE_KEY, 'true');

        updateAudioButtonState('enabled');

        playBell();
        console.log("Audio enabled successfully");
    } catch (e) {
        console.error("Failed to enable audio:", e);
    }
}

// Disable audio
function disableAudio() {
    audioEnabled = false;
    audioInitialized = false;

    // Clear preference
    localStorage.removeItem(AUDIO_STORAGE_KEY);

    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }

    updateAudioButtonState('disabled');
    console.log("Audio disabled");
}

// Toggle audio state
function toggleAudio() {
    if (audioEnabled) {
        disableAudio();
    } else {
        enableAudio();
    }
}

// Update audio button state
function updateAudioButtonState(state) {
    const btn = document.getElementById("enable-audio-btn");
    if (!btn) return;

    btn.style.display = "flex";

    switch (state) {
        case 'waiting':
            // Waiting for user interaction (previously enabled)
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                </svg>
                <span>Klik untuk Audio</span>
            `;
            btn.style.background = "var(--warning-soft, #fef3c7)";
            btn.style.borderColor = "var(--warning, #f59e0b)";
            btn.style.color = "var(--warning-dark, #92400e)";
            btn.onclick = enableAudio;
            break;

        case 'enabled':
            // Audio is active
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
                <span>Audio Aktif</span>
            `;
            btn.style.background = "var(--success)";
            btn.style.borderColor = "var(--success)";
            btn.style.color = "white";
            btn.onclick = toggleAudio;

            // Hide after 3 seconds but keep it accessible
            setTimeout(() => {
                btn.style.opacity = "0.7";
            }, 3000);
            break;

        case 'disabled':
        default:
            // Audio is off
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
                <span>Aktifkan Audio</span>
            `;
            btn.style.background = "var(--accent-soft)";
            btn.style.borderColor = "var(--accent)";
            btn.style.color = "var(--accent)";
            btn.style.opacity = "1";
            btn.onclick = enableAudio;
            break;
    }
}

// Connect to SSE
function connectSSE() {
    if (eventSource) {
        eventSource.close();
        sseConnected = false;
    }

    try {
        eventSource = new EventSource("/api/sse/display");

        eventSource.onopen = function () {
            console.log("SSE connection opened");
            sseConnected = true;
        };

        eventSource.addEventListener("connected", function (e) {
            console.log("SSE connected:", e.data);
            sseConnected = true;
        });

        eventSource.addEventListener("message", function (e) {
            try {
                const event = JSON.parse(e.data);
                handleEvent(event);
            } catch (err) {
                console.error("Failed to parse SSE message:", err);
            }
        });

        eventSource.onerror = function () {
            console.error("SSE error, reconnecting...");
            sseConnected = false;
            eventSource.close();
            setTimeout(connectSSE, 5000);
        };
    } catch (error) {
        console.error("Failed to create EventSource:", error);
        sseConnected = false;
    }
}

// Poll for updates (fallback for SSE)
async function pollForUpdates() {
    if (sseConnected) return;

    try {
        const response = await fetch("/api/queues?status=called&limit=1");
        const result = await response.json();
        const queues = result.queues || [];

        if (queues.length > 0) {
            const latestCalled = queues[0];

            if (lastQueueCalled !== latestCalled.queue_number) {
                lastQueueCalled = latestCalled.queue_number;

                if (latestCalled.counter_id) {
                    const counterResponse = await fetch(`/api/counter/${latestCalled.counter_id}`);
                    const counter = await counterResponse.json();

                    handleQueueCalled({
                        queue_number: latestCalled.queue_number,
                        queue_type: latestCalled.queue_type,
                        counter_id: latestCalled.counter_id,
                        counter_number: counter.counter_number,
                        counter_name: counter.counter_name,
                    });
                }
            }
        }

        loadInitialData();
    } catch (error) {
        console.error("Poll error:", error);
    }
}

// Handle SSE events
function handleEvent(event) {
    switch (event.type) {
        case "queue_called":
            handleQueueCalled(event.data);
            break;
        case "queue_updated":
        case "queue_added":
            loadInitialData();
            loadQueueTypeCounts();
            break;
        case "settings_updated":
            updateDisplaySettings(event.data);
            break;
    }
}

// Handle queue called event
function handleQueueCalled(data) {
    const timestamp = new Date();

    // Update counter status
    if (data.counter_id) {
        counterStatus[data.counter_id] = {
            queue_number: data.queue_number,
            queue_type: data.queue_type,
            called_at: timestamp
        };
        highlightCounter(data.counter_id);
        updateCounterGridStatus();
    }

    // Add to recent calls (multi-call display)
    addRecentCall({
        queue_number: data.queue_number,
        counter_name: data.counter_name,
        counter_id: data.counter_id,
        queue_type: data.queue_type,
        timestamp: timestamp
    });

    // Add to history
    addToHistory({
        queue_number: data.queue_number,
        counter_name: data.counter_name,
        timestamp: timestamp
    });

    // Queue audio announcement
    queueAudio(data.queue_number, data.counter_name, data.queue_type);

    // Refresh stats
    loadInitialData();
    loadQueueTypeCounts();
}

// Add to recent calls (multi-call display)
function addRecentCall(data) {
    // Check if already exists
    if (recentCalls.length > 0 && recentCalls[0].queue_number === data.queue_number) {
        return;
    }

    recentCalls.unshift(data);

    if (recentCalls.length > MAX_RECENT_CALLS) {
        recentCalls.pop();
    }

    renderRecentCalls();
}

// Render recent calls grid
function renderRecentCalls() {
    const container = document.getElementById("recent-calls-grid");
    if (!container) return;

    if (recentCalls.length === 0) {
        container.innerHTML = `
            <div class="call-card empty">
                <div class="call-number">---</div>
                <div class="call-counter">Menunggu</div>
            </div>
        `;
        return;
    }

    container.innerHTML = recentCalls.map((call, index) => {
        const isLatest = index === 0;
        const timeAgo = getTimeAgo(call.timestamp);

        return `
            <div class="call-card ${isLatest ? 'latest' : ''}">
                <div class="call-number">${call.queue_number}</div>
                <div class="call-counter">${call.counter_name}</div>
                <div class="call-time">${timeAgo}</div>
            </div>
        `;
    }).join('');
}

// Add to history
function addToHistory(data) {
    // Check if already exists
    if (callHistory.length > 0 && callHistory[0].queue_number === data.queue_number) {
        return;
    }

    callHistory.unshift(data);

    if (callHistory.length > MAX_HISTORY) {
        callHistory.pop();
    }

    renderHistory();
}

// Render history list
function renderHistory() {
    const container = document.getElementById("history-list");
    if (!container) return;

    if (callHistory.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = callHistory.map((item, index) => {
        const timeStr = formatTime(item.timestamp);

        return `
            <div class="history-item">
                <span class="number">${item.queue_number}</span>
                <div class="details">
                    <span class="counter">${item.counter_name}</span>
                    <span class="time">${timeStr}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Get relative time string
function getTimeAgo(timestamp) {
    if (!timestamp) return '';

    const now = new Date();
    const diff = Math.floor((now - new Date(timestamp)) / 1000);

    if (diff < 10) return 'Baru saja';
    if (diff < 60) return `${diff} detik`;
    if (diff < 3600) return `${Math.floor(diff / 60)} menit`;
    return `${Math.floor(diff / 3600)} jam`;
}

// Format time
function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// Queue audio for sequential playback
function queueAudio(queueNumber, counterName, queueType) {
    audioQueue.push({
        queueNumber: queueNumber,
        counterName: counterName,
        queueType: queueType || ''
    });

    if (!isPlayingAudio) {
        processAudioQueue();
    }
}

// Process audio queue sequentially
function processAudioQueue() {
    if (audioQueue.length === 0) {
        isPlayingAudio = false;
        return;
    }

    isPlayingAudio = true;
    const item = audioQueue.shift();

    if (audioEnabled) {
        playBell();

        setTimeout(() => {
            announceQueue(item.queueNumber, item.counterName, function () {
                setTimeout(processAudioQueue, 300);
            });
        }, 500);
    } else {
        setTimeout(processAudioQueue, 500);
    }
}

// Play bell sound
function playBell() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("Failed to create AudioContext:", e);
            return;
        }
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }

    const now = audioContext.currentTime;
    const frequencies = [830, 1245, 1661, 2093];
    const gains = [1, 0.6, 0.4, 0.3];

    frequencies.forEach((freq, i) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(freq, now);

        gainNode.gain.setValueAtTime(0.3 * gains[i], now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 1);
    });
}

// Announce queue number using TTS
function announceQueue(queueNumber, counterName, onComplete) {
    // Check if sound is enabled
    if (!SOUND_ENABLED) {
        if (onComplete) onComplete();
        return;
    }

    if (!("speechSynthesis" in window)) {
        if (onComplete) onComplete();
        return;
    }

    const formattedNumber = formatQueueNumberForSpeech(queueNumber);
    const formattedCounter = formatCounterNameForSpeech(counterName);
    const text = `Nomor antrian ${formattedNumber}, silakan menuju ${formattedCounter}`;

    const voices = speechSynthesis.getVoices();
    const indonesianVoice = voices.find((v) => v.lang.startsWith("id"));

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    utterance.rate = TTS_RATE; // Use configurable rate
    utterance.pitch = 1;
    utterance.volume = 1;
    if (indonesianVoice) {
        utterance.voice = indonesianVoice;
    }

    utterance.onend = function () {
        if (onComplete) onComplete();
    };

    utterance.onerror = function () {
        if (onComplete) onComplete();
    };

    speechSynthesis.speak(utterance);
}

// Format queue number for speech
function formatQueueNumberForSpeech(queueNumber) {
    const parts = queueNumber.match(/([A-Za-z]+)(\d+)/);
    if (!parts) return queueNumber;

    const letters = parts[1];
    const numbers = parseInt(parts[2]);

    // Map letters to clearer Indonesian pronunciation
    const letterMap = {
        'A': 'A',
        'B': 'B',
        'C': 'C',
        'D': 'D',
        'E': 'E',
        'F': 'F',
        'G': 'G',
        'H': 'H',
        'I': 'I',
        'J': 'J',
        'K': 'K',
        'L': 'L',
        'M': 'M',
        'N': 'N',
        'O': 'O',
        'P': 'P',
        'Q': 'Q',
        'R': 'R',
        'S': 'S',
        'T': 'T',
        'U': 'U',
        'V': 'V',
        'W': 'W',
        'X': 'X',
        'Y': 'Y',
        'Z': 'Z'
    };

    const letterSpoken = letters.toUpperCase().split("").map(l => letterMap[l] || l).join(", ");
    const numberSpoken = terbilang(numbers);

    return `${letterSpoken}, ${numberSpoken}`;
}

// Format counter name for speech (e.g., "Loket A 1" -> "Loket AA satu")
function formatCounterNameForSpeech(counterName) {
    if (!counterName) return counterName;

    // Map letters to clearer Indonesian pronunciation
    const letterMap = {
         'A': 'A',
        'B': 'B',
        'C': 'C',
        'D': 'D',
        'E': 'E',
        'F': 'F',
        'G': 'G',
        'H': 'H',
        'I': 'I',
        'J': 'J',
        'K': 'K',
        'L': 'L',
        'M': 'M',
        'N': 'N',
        'O': 'O',
        'P': 'P',
        'Q': 'Q',
        'R': 'R',
        'S': 'S',
        'T': 'T',
        'U': 'U',
        'V': 'V',
        'W': 'W',
        'X': 'X',
        'Y': 'Y',
        'Z': 'Z'
    };

    // Replace standalone letters and numbers in counter name
    // Supports: "Loket A 1", "Loket A1", "A 1", "A1"

    // Pattern 1: "Loket A 1" or "Loket A1" (prefix + letter + optional space + number)
    let result = counterName.replace(/([A-Za-z]+)\s+([A-Za-z])\s*(\d+)/gi, (match, prefix, letter, num) => {
        const spokenLetter = letterMap[letter.toUpperCase()] || letter;
        const spokenNumber = terbilang(parseInt(num));
        return `${prefix} ${spokenLetter} ${spokenNumber}`;
    });

    // Pattern 2: "A1" or "A 1" at the start (letter + optional space + number, no prefix)
    // Only apply if the previous pattern didn't match
    if (result === counterName) {
        result = counterName.replace(/^([A-Za-z])\s*(\d+)$/gi, (match, letter, num) => {
            const spokenLetter = letterMap[letter.toUpperCase()] || letter;
            const spokenNumber = terbilang(parseInt(num));
            return `${spokenLetter} ${spokenNumber}`;
        });
    }

    return result;
}

// Convert number to Indonesian words
function terbilang(n) {
    const satuan = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

    if (n < 12) return satuan[n];
    if (n < 20) return terbilang(n - 10) + " belas";
    if (n < 100) return terbilang(Math.floor(n / 10)) + " puluh " + terbilang(n % 10);
    if (n < 200) return "seratus " + terbilang(n - 100);
    if (n < 1000) return terbilang(Math.floor(n / 100)) + " ratus " + terbilang(n % 100);
    if (n < 2000) return "seribu " + terbilang(n - 1000);
    if (n < 1000000) return terbilang(Math.floor(n / 1000)) + " ribu " + terbilang(n % 1000);

    return n.toString().split("").map((d) => {
        const digitWords = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];
        return digitWords[parseInt(d)];
    }).join(" ");
}

// Update time ago displays periodically
setInterval(() => {
    renderRecentCalls();
}, 30000);

// Load voices when available
if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = function () {
        console.log("Voices loaded:", speechSynthesis.getVoices().length);
    };
}
