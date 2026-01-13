// Display page JavaScript

let eventSource = null;
let recentCalls = [];
const MAX_RECENT = 5;
let audioContext = null;
let audioEnabled = false;
let lastQueueCalled = null;
let sseConnected = false;

// Audio queue system
let audioQueue = [];
let isPlayingAudio = false;

// Initialize
document.addEventListener("DOMContentLoaded", function () {
  updateDateTime();
  setInterval(updateDateTime, 1000);

  loadInitialData();
  connectSSE();
  checkAudioPermission();

  // Polling fallback - check for updates every 2 seconds if SSE is down
  setInterval(pollForUpdates, 2000);
});

// Poll for updates (fallback for SSE)
async function pollForUpdates() {
  if (sseConnected) return;

  try {
    const response = await fetch("/api/queues?status=called&limit=1");
    const queues = await response.json();

    if (queues && queues.length > 0) {
      const latestCalled = queues[0];

      // Check if this is a new call
      if (lastQueueCalled !== latestCalled.queue_number) {
        lastQueueCalled = latestCalled.queue_number;

        // Get counter info
        if (latestCalled.counter_id) {
          const counterResponse = await fetch(
            `/api/counter/${latestCalled.counter_id}`
          );
          const counter = await counterResponse.json();

          showQueueCall({
            queue_number: latestCalled.queue_number,
            counter_number: counter.counter_number,
            counter_name: counter.counter_name,
          });
        }
      }
    }

    // Update stats
    loadInitialData();
  } catch (error) {
    console.error("Poll error:", error);
  }
}

// Check audio permission
function checkAudioPermission() {
  // Show audio enable button
  const container = document.querySelector(".display-header");
  if (container && !audioEnabled) {
    const audioBtn = document.createElement("button");
    audioBtn.id = "enable-audio-btn";
    audioBtn.className = "enable-audio-btn";
    audioBtn.innerHTML = "🔇 Klik untuk Aktifkan Suara";
    audioBtn.style.marginLeft = "auto"; 
    audioBtn.style.marginRight = "1rem";
    audioBtn.onclick = enableAudio;
    
    // Insert before the datetime div or append if simpler
    const datetime = container.querySelector(".datetime");
    if (datetime) {
        container.insertBefore(audioBtn, datetime);
    } else {
        container.appendChild(audioBtn);
    }
  }
}

// Enable audio (requires user interaction)
function enableAudio() {
  try {
    // Initialize AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Test speech synthesis
    if ("speechSynthesis" in window) {
      // Warm up speech synthesis
      const utterance = new SpeechSynthesisUtterance("");
      speechSynthesis.speak(utterance);
    }

    audioEnabled = true;

    // Update button
    const btn = document.getElementById("enable-audio-btn");
    if (btn) {
      btn.innerHTML = "🔊 Suara Aktif";
      btn.classList.add("active");
      btn.onclick = null;

      // Hide after 2 seconds
      setTimeout(() => {
        btn.style.display = "none";
      }, 2000);
    }

    // Play test sound
    playBell();

    console.log("Audio enabled successfully");
  } catch (e) {
    console.error("Failed to enable audio:", e);
  }
}

// Update date time
function updateDateTime() {
  const now = new Date();
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  document.getElementById("datetime").textContent = now.toLocaleDateString(
    "id-ID",
    options
  );
}

// Load initial data
async function loadInitialData() {
  try {
    const response = await fetch("/api/stats");
    const stats = await response.json();
    document.getElementById("waiting-count").textContent = stats.waiting_queues;
  } catch (error) {
    console.error("Failed to load stats:", error);
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

    eventSource.onopen = function (e) {
      console.log("SSE connection opened");
      sseConnected = true;
    };

    eventSource.addEventListener("connected", function (e) {
      console.log("SSE connected:", e.data);
      sseConnected = true;
    });

    eventSource.addEventListener("message", function (e) {
      console.log("SSE message received:", e.data);
      try {
        const event = JSON.parse(e.data);
        handleEvent(event);
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    });

    eventSource.onerror = function (e) {
      console.error("SSE error:", e);
      sseConnected = false;
      eventSource.close();
      // Reconnect after 5 seconds
      setTimeout(connectSSE, 5000);
    };
  } catch (error) {
    console.error("Failed to create EventSource:", error);
    sseConnected = false;
  }
}

// Handle SSE events
function handleEvent(event) {
  console.log("Handling event:", event);
  switch (event.type) {
    case "queue_called":
      showQueueCall(event.data);
      break;
    case "queue_updated":
    case "queue_added":
      updateWaitingCount(event.data.waiting_count);
      break;
  }
}

// Show queue call - queue for sequential display and audio
function showQueueCall(data) {
  console.log("Showing queue call:", data);

  // Queue for sequential display and audio
  queueAudio(data.queue_number, data.counter_name);

  // Update waiting count
  loadInitialData();
}

// Queue audio for sequential playback
function queueAudio(queueNumber, counterName) {
  audioQueue.push({
    queueNumber: queueNumber,
    counterName: counterName,
  });

  // Start processing queue if not already playing
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

  // Update display NOW when this item starts playing
  updateDisplayForQueue(item.queueNumber, item.counterName);

  // Add to recent calls
  addRecentCall({
    queue_number: item.queueNumber,
    counter_name: item.counterName,
  });

  // Play bell first (if audio enabled)
  if (audioEnabled) {
    playBell();

    // Then announce after bell finishes (500ms for bell)
    setTimeout(() => {
      announceQueue(item.queueNumber, item.counterName, function () {
        // When announcement is complete, process next in queue
        setTimeout(() => {
          processAudioQueue();
        }, 300);
      });
    }, 500);
  } else {
    // If audio not enabled, just wait a bit then process next
    setTimeout(() => {
      processAudioQueue();
    }, 1000);
  }
}

// Update display for current queue
function updateDisplayForQueue(queueNumber, counterName) {
  const callNumber = document.getElementById("call-number");
  const callCounter = document.getElementById("call-counter");

  // Update display
  callNumber.textContent = queueNumber;
  callCounter.textContent = `Menuju ${counterName}`;

  // Add animation
  callNumber.classList.remove("calling");
  void callNumber.offsetWidth; // Trigger reflow
  callNumber.classList.add("calling");
}

// Play bell sound using Web Audio API (single ding)
function playBell() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error("Failed to create AudioContext:", e);
      return;
    }
  }

  // Resume if suspended
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  const now = audioContext.currentTime;

  // Create bell-like sound with multiple harmonics
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

// Announce queue number using Text-to-Speech (single announcement)
function announceQueue(queueNumber, counterName, onComplete) {
  if (!("speechSynthesis" in window)) {
    console.log("Speech synthesis not supported");
    if (onComplete) onComplete();
    return;
  }

  // Format queue number for speech (e.g., "A001" -> "A 0 0 1")
  const formattedNumber = formatQueueNumberForSpeech(queueNumber);

  // Create announcement text
  const text = `Nomor antrian ${formattedNumber}, silakan menuju ${counterName}`;

  // Try to find Indonesian voice
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
  // Split letters and numbers
  const parts = queueNumber.match(/([A-Za-z]+)(\d+)/);
  if (!parts) return queueNumber;

  const letters = parts[1];
  const numbers = parseInt(parts[2]); // Convert to integer to remove leading zeros

  // Spell out letters
  const letterSpoken = letters.split("").join(" ");

  // Convert number to words (terbilang)
  const numberSpoken = terbilang(numbers);

  return `${letterSpoken} ${numberSpoken}`;
}

// Convert number to Indonesian words
function terbilang(n) {
  const satuan = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];

  if (n < 12) {
    return satuan[n];
  } else if (n < 20) {
    return terbilang(n - 10) + " belas";
  } else if (n < 100) {
    return terbilang(Math.floor(n / 10)) + " puluh " + terbilang(n % 10);
  } else if (n < 200) {
    return "seratus " + terbilang(n - 100);
  } else if (n < 1000) {
    return terbilang(Math.floor(n / 100)) + " ratus " + terbilang(n % 100);
  } else if (n < 2000) {
    return "seribu " + terbilang(n - 1000);
  } else if (n < 1000000) {
    return terbilang(Math.floor(n / 1000)) + " ribu " + terbilang(n % 1000);
  }

  // Fallback for very large numbers (read digit by digit)
  return n
    .toString()
    .split("")
    .map((d) => {
      const digitWords = [
        "nol",
        "satu",
        "dua",
        "tiga",
        "empat",
        "lima",
        "enam",
        "tujuh",
        "delapan",
        "sembilan",
      ];
      return digitWords[parseInt(d)];
    })
    .join(" ");
}

// Add to recent calls
function addRecentCall(data) {
  // Avoid duplicates
  if (recentCalls.length > 0 && recentCalls[0].number === data.queue_number) {
    return;
  }

  recentCalls.unshift({
    number: data.queue_number,
    counter: data.counter_name,
  });

  if (recentCalls.length > MAX_RECENT) {
    recentCalls.pop();
  }

  updateRecentList();
}

// Update recent list (grid format)
function updateRecentList() {
  const container = document.getElementById("recent-list");
  container.innerHTML = recentCalls
    .map(
      (call) => `
        <div class="recent-item">
            <span class="number">${call.number}</span>
            <span class="counter">${call.counter}</span>
        </div>
    `
    )
    .join("");
}

// Update waiting count
function updateWaitingCount(count) {
  document.getElementById("waiting-count").textContent = count;
}

// Load voices when available
if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = function () {
    console.log("Voices loaded:", speechSynthesis.getVoices().length);
  };
}
