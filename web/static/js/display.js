// Display page JavaScript - Optimized for Busy Queue Scenarios

let eventSource = null;
let audioContext = null;
let audioEnabled = false;
let lastQueueCalled = null;
let sseConnected = false;

// Configuration
const MAX_RECENT_CALLS = 6;      // Multi-call display cards
const MAX_HISTORY = 15;          // History list items
const CALL_HIGHLIGHT_DURATION = 5000; // How long to highlight new calls

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

    // Auto-refresh stats every 10 seconds
    setInterval(loadInitialData, 10000);

    // Refresh counter status every 15 seconds
    setInterval(loadCalledQueues, 15000);

    // Polling fallback - check for updates every 3 seconds if SSE is down
    setInterval(pollForUpdates, 3000);
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

// Load currently called queues to initialize counter status
async function loadCalledQueues() {
    try {
        const response = await fetch("/api/queues?status=called&limit=50");
        const result = await response.json();
        const queues = result.queues || [];

        // Reset counter status
        counterStatus = {};

        // Map called queues to their counters (only if from today)
        queues.forEach(q => {
            if (q.counter_id && isToday(q.called_at || q.created_at)) {
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
        // Only show status if from today
        const isTodayStatus = status && isToday(status.called_at);
        const statusClass = isTodayStatus ? 'active' : 'idle';
        const queueNumber = isTodayStatus ? status.queue_number : '---';
        const statusText = isTodayStatus ? 'Melayani' : 'Tidak Aktif';

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

        // Only show status if from today
        const isTodayStatus = status && isToday(status.called_at);

        // Update classes
        card.classList.remove('active', 'calling', 'idle');

        if (isTodayStatus) {
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

// Load queue counts by type
async function loadQueueTypeCounts(types) {
    try {
        if (!types) types = queueTypesCache;
        if (!types || types.length === 0) return;

        const response = await fetch("/api/queues?status=waiting&limit=1000");
        const result = await response.json();
        const queues = result.queues || [];

        const counts = {};
        types.forEach(t => counts[t.code] = 0);

        queues.forEach(q => {
            const typeCode = q.queue_number.replace(/[0-9]/g, '');
            if (counts[typeCode] !== undefined) {
                counts[typeCode]++;
            }
        });

        Object.keys(counts).forEach(code => {
            const el = document.getElementById(`summary-${code}`);
            if (el) {
                el.textContent = `${counts[code]} menunggu`;
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
        updateDisplaySettings(settings);
    } catch (error) {
        console.error("Failed to load settings:", error);
    }
}

// Update display UI with settings
function updateDisplaySettings(settings) {
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

    if (settings.display_running_text) {
        const ticker = document.getElementById('running-text');
        if (ticker && ticker.textContent !== settings.display_running_text) {
            ticker.textContent = settings.display_running_text;
        }
    }
}

// Enable audio (requires user interaction)
function enableAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        if ("speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance("");
            speechSynthesis.speak(utterance);
        }

        audioEnabled = true;

        const btn = document.getElementById("enable-audio-btn");
        if (btn) {
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

            setTimeout(() => {
                btn.style.display = "none";
            }, 2000);
        }

        playBell();
        console.log("Audio enabled successfully");
    } catch (e) {
        console.error("Failed to enable audio:", e);
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
    if (!("speechSynthesis" in window)) {
        if (onComplete) onComplete();
        return;
    }

    const formattedNumber = formatQueueNumberForSpeech(queueNumber);
    const text = `Nomor antrian ${formattedNumber}, silakan menuju ${counterName}`;

    const voices = speechSynthesis.getVoices();
    const indonesianVoice = voices.find((v) => v.lang.startsWith("id"));

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    utterance.rate = 0.6;
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

    const letterSpoken = letters.split("").join(" ");
    const numberSpoken = terbilang(numbers);

    return `${letterSpoken} ${numberSpoken}`;
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
