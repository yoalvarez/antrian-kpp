// Counter page JavaScript

let eventSource = null;
let hasCurrentQueue = false;
let selectedQueueType = null;
let sseConnected = false;

// Check if a date string is from today
function isToday(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadCounterData();
    loadStatsByType();
    connectSSE();

    // Polling fallback - update every 3 seconds if SSE is disconnected
    setInterval(() => {
        if (!sseConnected) loadCounterData();
    }, 3000);
    
    setInterval(() => {
        if (!sseConnected) loadStatsByType();
    }, 3000);
});

// Select queue type
function selectQueueType(typeCode) {
    selectedQueueType = typeCode;

    // Update button states
    document.querySelectorAll('.queue-type-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.querySelector(`.queue-type-btn[data-type="${typeCode}"]`).classList.add('selected');

    // Enable call next button
    document.getElementById('btn-next').disabled = false;
}

// Load stats by type
async function loadStatsByType() {
    try {
        const response = await fetch('/api/stats/by-type');
        const counts = await response.json();

        // Update all count displays
        document.querySelectorAll('.type-count').forEach(el => {
            const typeCode = el.id.replace('count-', '');
            el.textContent = counts[typeCode] || 0;
        });
    } catch (error) {
        console.error('Failed to load stats by type:', error);
    }
}

// Load counter data
async function loadCounterData() {
    try {
        const response = await fetch(`/api/counter/${COUNTER_ID}`);
        const counter = await response.json();
        updateCounterUI(counter);
    } catch (error) {
        console.error('Failed to load counter data:', error);
    }
}

// Update counter UI
function updateCounterUI(counter) {
    const currentQueue = document.getElementById('current-queue');
    const queueStatus = document.getElementById('queue-status');
    const btnRecall = document.getElementById('btn-recall');
    const btnComplete = document.getElementById('btn-complete');
    const btnCancel = document.getElementById('btn-cancel');

    // Check if current_queue exists and is from today
    const queueDate = counter.current_queue?.called_at || counter.current_queue?.created_at;
    const hasValidQueue = counter.current_queue && isToday(queueDate);

    if (hasValidQueue) {
        hasCurrentQueue = true;
        currentQueue.textContent = counter.current_queue.queue_number;
        queueStatus.textContent = 'Sedang Dilayani';
        queueStatus.classList.add('active');

        btnRecall.disabled = false;
        btnComplete.disabled = false;
        btnCancel.disabled = false;
    } else {
        hasCurrentQueue = false;
        currentQueue.textContent = '---';
        queueStatus.textContent = 'Tidak Ada Antrian';
        queueStatus.classList.remove('active');

        btnRecall.disabled = true;
        btnComplete.disabled = true;
        btnCancel.disabled = true;
    }
}

// Connect to SSE
function connectSSE() {
    if (eventSource) {
        eventSource.close();
    }

    try {
        eventSource = new EventSource(`/api/sse/counter/${COUNTER_ID}`);

        eventSource.onopen = function(e) {
            console.log('SSE connection opened');
            updateConnectionStatus(true);
        };

        eventSource.addEventListener('connected', function(e) {
            console.log('SSE connected event:', e.data);
            updateConnectionStatus(true);
        });

        eventSource.addEventListener('message', function(e) {
            console.log('SSE message:', e.data);
            try {
                const event = JSON.parse(e.data);
                handleEvent(event);
            } catch (err) {
                console.error('Failed to parse SSE message:', err);
            }
        });

        eventSource.onerror = function(e) {
            console.error('SSE error:', e);
            updateConnectionStatus(false);
            eventSource.close();
            // Reconnect after 3 seconds
            setTimeout(connectSSE, 3000);
        };
    } catch (error) {
        console.error('Failed to create EventSource:', error);
        updateConnectionStatus(false);
    }
}

// Update connection status
function updateConnectionStatus(connected) {
    sseConnected = connected;
    const status = document.getElementById('connection-status');
    if (connected) {
        status.textContent = 'Terhubung';
        status.classList.add('connected');
        status.classList.remove('disconnected');
    } else {
        status.textContent = 'Polling Mode';
        status.classList.remove('connected');
        status.classList.add('disconnected');
    }
}

// Handle SSE events
function handleEvent(event) {
    console.log('Handling event:', event);
    switch (event.type) {
        case 'queue_updated':
        case 'queue_added':
            loadStatsByType();
            loadCounterData();
            break;
    }
}

// Call next queue
async function callNext() {
    if (!selectedQueueType) {
        alert('Silakan pilih jenis antrian terlebih dahulu.');
        return;
    }

    const btn = document.getElementById('btn-next');
    btn.disabled = true;

    try {
        const response = await fetch(`/api/counter/${COUNTER_ID}/call-next?type=${selectedQueueType}`, {
            method: 'POST'
        });

        if (response.status === 404) {
            alert(`Tidak ada antrian jenis ${selectedQueueType} yang menunggu.`);
            loadCounterData();
            loadStatsByType();
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to call next');
        }

        const counter = await response.json();
        updateCounterUI(counter);

        // Flash effect
        document.getElementById('current-queue').style.animation = 'none';
        void document.getElementById('current-queue').offsetWidth;
        document.getElementById('current-queue').style.animation = 'pulse 0.5s ease 2';

    } catch (error) {
        console.error('Failed to call next:', error);
        alert('Gagal memanggil antrian. Silakan coba lagi.');
    } finally {
        btn.disabled = selectedQueueType === null;
        loadCounterData();
        loadStatsByType();
    }
}

// Recall current queue
async function recall() {
    if (!hasCurrentQueue) return;

    const btn = document.getElementById('btn-recall');
    btn.disabled = true;

    try {
        const response = await fetch(`/api/counter/${COUNTER_ID}/recall`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to recall');
        }

        // Flash effect
        document.getElementById('current-queue').style.animation = 'none';
        void document.getElementById('current-queue').offsetWidth;
        document.getElementById('current-queue').style.animation = 'pulse 0.5s ease 2';

    } catch (error) {
        console.error('Failed to recall:', error);
        alert('Gagal memanggil ulang. Silakan coba lagi.');
    } finally {
        btn.disabled = false;
    }
}

// Complete current queue
async function complete() {
    if (!hasCurrentQueue) return;

    const btn = document.getElementById('btn-complete');
    btn.disabled = true;

    try {
        const response = await fetch(`/api/counter/${COUNTER_ID}/complete`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to complete');
        }

        const counter = await response.json();
        updateCounterUI(counter);

    } catch (error) {
        console.error('Failed to complete:', error);
        alert('Gagal menyelesaikan antrian. Silakan coba lagi.');
    } finally {
        btn.disabled = false;
        loadCounterData();
        loadStatsByType();
    }
}

// Cancel current queue
async function cancel() {
    if (!hasCurrentQueue) return;

    if (!confirm('Yakin ingin melewati antrian ini?')) {
        return;
    }

    const btn = document.getElementById('btn-cancel');
    btn.disabled = true;

    try {
        const response = await fetch(`/api/counter/${COUNTER_ID}/cancel`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to cancel');
        }

        const counter = await response.json();
        updateCounterUI(counter);

    } catch (error) {
        console.error('Failed to cancel:', error);
        alert('Gagal membatalkan antrian. Silakan coba lagi.');
    } finally {
        btn.disabled = false;
        loadCounterData();
        loadStatsByType();
    }
}

// Add pulse animation
const style = document.createElement('style');
style.textContent = `
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
    }
`;
document.head.appendChild(style);
