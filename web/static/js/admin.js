// Admin panel JavaScript

let currentFilter = '';
let currentPage = 1;
let currentDate = '';
let currentType = '';

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('filter-date').value = today;
    currentDate = today;

    loadStats();
    loadQueueTypes();
    loadQueueTypesFilter();
    loadCounters();
    loadQueues();
    loadSettings();

    // Setup status filter buttons
    document.querySelectorAll('.status-filters .btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.status-filters .btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.filter;
            currentPage = 1;
            loadQueues();
        });
    });

    // Auto refresh stats
    setInterval(loadStats, 10000);
});

// Apply filters
function applyFilters() {
    currentDate = document.getElementById('filter-date').value;
    currentType = document.getElementById('filter-type').value;
    currentPage = 1;
    loadQueues();
}

// Load queue types for filter dropdown
async function loadQueueTypesFilter() {
    try {
        const response = await fetch('/api/queue-types');
        const types = await response.json();

        const select = document.getElementById('filter-type');
        select.innerHTML = '<option value="">Semua Jenis</option>';
        types.forEach(type => {
            select.innerHTML += `<option value="${type.code}">${type.prefix} - ${type.name}</option>`;
        });
    } catch (error) {
        console.error('Failed to load queue types for filter:', error);
    }
}

// Load stats
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();

        document.getElementById('stat-total').textContent = stats.total_queues;
        document.getElementById('stat-waiting').textContent = stats.waiting_queues;
        document.getElementById('stat-called').textContent = stats.called_queues;
        document.getElementById('stat-completed').textContent = stats.completed_queues;
        document.getElementById('stat-counters').textContent = stats.active_counters;
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load queue types
async function loadQueueTypes() {
    try {
        const response = await fetch('/api/queue-types');
        const types = await response.json();

        const container = document.getElementById('queue-types-list');

        if (types.length === 0) {
            container.innerHTML = '<p style="color: #6b7280;">Belum ada jenis antrian. Klik tombol "Tambah Jenis" untuk membuat jenis antrian baru.</p>';
            return;
        }

        container.innerHTML = types.map(type => `
            <div class="queue-type-card ${type.is_active ? '' : 'inactive'}" onclick="showEditQueueTypeModal(${type.id})">
                <div class="queue-type-prefix">${type.prefix}</div>
                <div class="queue-type-info">
                    <h3>${type.name}</h3>
                    <p>Kode: ${type.code}</p>
                </div>
                <span class="queue-type-status ${type.is_active ? 'active' : 'inactive'}">
                    ${type.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load queue types:', error);
    }
}

// Check if a date string is from today
function isToday(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
}

// Get current queue display (only show if from today)
function getCurrentQueueDisplay(counter) {
    if (!counter.current_queue) return '';

    // Check if the queue is from today (using called_at or created_at)
    const queueDate = counter.current_queue.called_at || counter.current_queue.created_at;
    if (!isToday(queueDate)) return '';

    return `<p style="color: #2563eb;">Antrian: ${counter.current_queue.queue_number}</p>`;
}

// Load counters
async function loadCounters() {
    try {
        const response = await fetch('/api/counters');
        const counters = await response.json();

        const container = document.getElementById('counters-list');

        if (counters.length === 0) {
            container.innerHTML = '<p style="color: #6b7280;">Belum ada loket. Klik tombol "Tambah Loket" untuk membuat loket baru.</p>';
            return;
        }

        // Sort counters numerically by counter_number
        counters.sort((a, b) => {
            const numA = parseInt(a.counter_number, 10) || 0;
            const numB = parseInt(b.counter_number, 10) || 0;
            return numA - numB;
        });

        container.innerHTML = counters.map(counter => `
            <div class="counter-card">
                <div class="counter-info">
                    <h3>${counter.counter_name}</h3>
                    <p>Loket ${counter.counter_number}</p>
                    ${getCurrentQueueDisplay(counter)}
                </div>
                <div class="counter-actions">
                    <span class="counter-status ${counter.is_active ? 'active' : 'inactive'}">
                        ${counter.is_active ? 'Aktif' : 'Tidak Aktif'}
                    </span>
                    <a href="/counter/${counter.id}" class="btn btn-sm" style="margin-left: 0.5rem;">Buka</a>
                    <button class="btn btn-sm btn-danger btn-icon" onclick="deleteCounter(${counter.id}, '${counter.counter_name}')" style="margin-left: 0.5rem;" title="Hapus Loket">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load counters:', error);
    }
}

// Load queues with pagination
async function loadQueues() {
    try {
        let url = `/api/queues?page=${currentPage}&per_page=20`;
        if (currentFilter) {
            url += `&status=${currentFilter}`;
        }
        if (currentDate) {
            url += `&date=${currentDate}`;
        }
        if (currentType) {
            url += `&type=${currentType}`;
        }

        const response = await fetch(url);
        const result = await response.json();

        const tbody = document.getElementById('queues-list');

        if (!result.queues || result.queues.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6b7280;">Tidak ada data antrian</td></tr>';
            document.getElementById('pagination').innerHTML = '';
            return;
        }

        tbody.innerHTML = result.queues.map(queue => {
            const statusClass = `status-${queue.status}`;
            const statusText = {
                'waiting': 'Menunggu',
                'called': 'Dipanggil',
                'completed': 'Selesai',
                'cancelled': 'Dibatalkan'
            }[queue.status] || queue.status;

            return `
                <tr>
                    <td><strong>${queue.queue_number}</strong></td>
                    <td>${queue.queue_type}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>${queue.counter_id ? `Loket ${queue.counter_id}` : '-'}</td>
                    <td>${formatDateTime(queue.created_at)}</td>
                    <td>${queue.called_at ? formatDateTime(queue.called_at) : '-'}</td>
                </tr>
            `;
        }).join('');

        // Render pagination
        renderPagination(result);
    } catch (error) {
        console.error('Failed to load queues:', error);
    }
}

// Render pagination controls
function renderPagination(result) {
    const container = document.getElementById('pagination');

    if (result.total_pages <= 1) {
        container.innerHTML = `<div class="pagination-info">Menampilkan ${result.queues.length} dari ${result.total} antrian</div>`;
        return;
    }

    let html = '<div class="pagination-controls">';

    // Previous button
    html += `<button class="btn btn-sm" ${result.page <= 1 ? 'disabled' : ''} onclick="goToPage(${result.page - 1})">&#8592; Prev</button>`;

    // Page numbers
    html += '<div class="page-numbers">';
    const maxVisible = 5;
    let startPage = Math.max(1, result.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(result.total_pages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
        html += `<button class="btn btn-sm" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) {
            html += '<span class="page-ellipsis">...</span>';
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="btn btn-sm ${i === result.page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    if (endPage < result.total_pages) {
        if (endPage < result.total_pages - 1) {
            html += '<span class="page-ellipsis">...</span>';
        }
        html += `<button class="btn btn-sm" onclick="goToPage(${result.total_pages})">${result.total_pages}</button>`;
    }
    html += '</div>';

    // Next button
    html += `<button class="btn btn-sm" ${result.page >= result.total_pages ? 'disabled' : ''} onclick="goToPage(${result.page + 1})">Next &#8594;</button>`;

    html += '</div>';
    html += `<div class="pagination-info">Halaman ${result.page} dari ${result.total_pages} (${result.total} antrian)</div>`;

    container.innerHTML = html;
}

// Go to specific page
function goToPage(page) {
    currentPage = page;
    loadQueues();
}

// Format date time
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format time only
function formatTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// Show add queue type modal
function showAddQueueTypeModal() {
    document.getElementById('add-queue-type-modal').classList.add('show');
    document.getElementById('queue-type-code').focus();
}

// Show edit queue type modal
async function showEditQueueTypeModal(id) {
    try {
        const response = await fetch(`/api/queue-type/${id}`);
        const type = await response.json();

        document.getElementById('edit-queue-type-id').value = type.id;
        document.getElementById('edit-queue-type-name').value = type.name;
        document.getElementById('edit-queue-type-prefix').value = type.prefix;
        document.getElementById('edit-queue-type-active').checked = type.is_active;

        document.getElementById('edit-queue-type-modal').classList.add('show');
    } catch (error) {
        console.error('Failed to load queue type:', error);
    }
}

// Add queue type
async function addQueueType(event) {
    event.preventDefault();

    const code = document.getElementById('queue-type-code').value.toUpperCase();
    const name = document.getElementById('queue-type-name').value;
    const prefix = document.getElementById('queue-type-prefix').value.toUpperCase();

    try {
        const response = await fetch('/api/queue-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, name, prefix })
        });

        if (!response.ok) {
            throw new Error('Failed to create queue type');
        }

        closeModal('add-queue-type-modal');
        loadQueueTypes();
        loadQueueTypesFilter();
    } catch (error) {
        console.error('Failed to add queue type:', error);
        alert('Gagal menambahkan jenis antrian. Pastikan kode unik.');
    }
}

// Update queue type
async function updateQueueType(event) {
    event.preventDefault();

    const id = document.getElementById('edit-queue-type-id').value;
    const name = document.getElementById('edit-queue-type-name').value;
    const prefix = document.getElementById('edit-queue-type-prefix').value.toUpperCase();
    const isActive = document.getElementById('edit-queue-type-active').checked;

    try {
        const response = await fetch(`/api/queue-type/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, prefix, is_active: isActive, sort_order: 0 })
        });

        if (!response.ok) {
            throw new Error('Failed to update queue type');
        }

        closeModal('edit-queue-type-modal');
        loadQueueTypes();
        loadQueueTypesFilter();
    } catch (error) {
        console.error('Failed to update queue type:', error);
        alert('Gagal mengupdate jenis antrian.');
    }
}

// Delete queue type
async function deleteQueueType() {
    const id = document.getElementById('edit-queue-type-id').value;

    if (!confirm('Yakin ingin menghapus jenis antrian ini?')) {
        return;
    }

    try {
        const response = await fetch(`/api/queue-type/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete queue type');
        }

        closeModal('edit-queue-type-modal');
        loadQueueTypes();
        loadQueueTypesFilter();
    } catch (error) {
        console.error('Failed to delete queue type:', error);
        alert('Gagal menghapus jenis antrian.');
    }
}

// Show add counter modal
function showAddCounterModal() {
    document.getElementById('add-counter-modal').classList.add('show');
    document.getElementById('counter-number').focus();
}

// Close modal
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
}

// Add counter
async function addCounter(event) {
    event.preventDefault();

    const counterNumber = document.getElementById('counter-number').value;
    const counterName = document.getElementById('counter-name').value;

    try {
        const response = await fetch('/api/counters', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                counter_number: counterNumber,
                counter_name: counterName
            })
        });

        if (!response.ok) {
            throw new Error('Failed to create counter');
        }

        closeModal('add-counter-modal');
        loadCounters();
        loadStats();
    } catch (error) {
        console.error('Failed to add counter:', error);
        alert('Gagal menambahkan loket. Pastikan nomor loket unik.');
    }
}

// Delete counter
async function deleteCounter(id, name) {
    if (!confirm(`Yakin ingin menghapus loket "${name}"?\n\nPerhatian: Riwayat panggilan di loket ini juga akan dihapus.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/counter/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete counter');
        }

        loadCounters();
        loadStats();
        alert('Loket berhasil dihapus.');
    } catch (error) {
        console.error('Failed to delete counter:', error);
        alert('Gagal menghapus loket.');
    }
}

// Close modal on escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.show').forEach(m => {
            closeModal(m.id);
        });
    }
});

// Close modal on outside click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
        if (e.target === this) {
            closeModal(this.id);
        }
    });
});

// Show reset confirmation modal
async function showResetModal() {
    // Load pilihan jenis antrian ke dropdown
    try {
        const response = await fetch('/api/queue-types');
        const types = await response.json();

        const select = document.getElementById('reset-queue-type');
        select.innerHTML = '<option value="">Semua Jenis Antrian</option>';
        types.forEach(type => {
            if (type.is_active) {
                select.innerHTML += `<option value="${type.code}">${type.prefix} - ${type.name}</option>`;
            }
        });
    } catch (error) {
        console.error('Failed to load queue types for reset:', error);
    }

    document.getElementById('reset-modal').classList.add('show');
}

// Load display settings
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();

        if (settings.display_video_url) {
            document.getElementById('setting-video-url').value = settings.display_video_url;
        }
        if (settings.display_running_text) {
            document.getElementById('setting-running-text').value = settings.display_running_text;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save display settings
async function saveSettings(event) {
    event.preventDefault();

    const videoUrl = document.getElementById('setting-video-url').value;
    const runningText = document.getElementById('setting-running-text').value;

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                display_video_url: videoUrl,
                display_running_text: runningText
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save settings');
        }

        alert('Pengaturan berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save settings:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// Reset queues
async function resetQueues() {
    const queueType = document.getElementById('reset-queue-type').value;

    try {
        let url = '/api/admin/reset-queues';
        if (queueType) {
            url += `?type=${queueType}`;
        }

        const response = await fetch(url, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to reset queues');
        }

        const result = await response.json();
        alert(result.message);

        closeModal('reset-modal');
        loadStats();
        loadQueues();
    } catch (error) {
        console.error('Failed to reset queues:', error);
        alert('Gagal mereset antrian.');
    }
}

// ===================================
// Ticket Design Functions
// ===================================

// Initialize ticket design on page load
document.addEventListener('DOMContentLoaded', function() {
    loadTicketDesign();
    setupTicketPreview();
});

// Setup live preview for ticket design
function setupTicketPreview() {
    // Text inputs
    const textInputs = [
        'ticket-header',
        'ticket-subheader',
        'ticket-title',
        'ticket-footer1',
        'ticket-footer2',
        'ticket-thanks'
    ];

    textInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', updateTicketPreview);
        }
    });

    // Checkboxes
    const checkboxes = [
        'ticket-show-subheader',
        'ticket-show-type',
        'ticket-show-datetime',
        'ticket-show-footer',
        'ticket-show-thanks'
    ];

    checkboxes.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.addEventListener('change', updateTicketPreview);
        }
    });
}

// Update ticket preview
function updateTicketPreview() {
    // Update text content
    const header = document.getElementById('ticket-header').value || 'SISTEM ANTRIAN';
    const subheader = document.getElementById('ticket-subheader').value || 'KPP PRATAMA';
    const title = document.getElementById('ticket-title').value || 'NOMOR ANTRIAN ANDA';
    const footer1 = document.getElementById('ticket-footer1').value || 'Mohon menunggu hingga';
    const footer2 = document.getElementById('ticket-footer2').value || 'nomor Anda dipanggil';
    const thanks = document.getElementById('ticket-thanks').value || 'Terima kasih';

    document.getElementById('preview-header').textContent = header;
    document.getElementById('preview-subheader').textContent = subheader;
    document.getElementById('preview-title').textContent = title;
    document.getElementById('preview-footer1').textContent = footer1;
    document.getElementById('preview-footer2').textContent = footer2;
    document.getElementById('preview-thanks').textContent = thanks;

    // Update visibility
    const showSubheader = document.getElementById('ticket-show-subheader').checked;
    const showType = document.getElementById('ticket-show-type').checked;
    const showDatetime = document.getElementById('ticket-show-datetime').checked;
    const showFooter = document.getElementById('ticket-show-footer').checked;
    const showThanks = document.getElementById('ticket-show-thanks').checked;

    document.getElementById('preview-subheader').classList.toggle('hidden', !showSubheader);
    document.getElementById('preview-type-label').classList.toggle('hidden', !showType);
    document.getElementById('preview-datetime').classList.toggle('hidden', !showDatetime);
    document.getElementById('preview-footer').classList.toggle('hidden', !showFooter);
    document.getElementById('preview-thanks').classList.toggle('hidden', !showThanks);
}

// Load ticket design settings
async function loadTicketDesign() {
    try {
        const response = await fetch('/api/settings?keys=ticket_header,ticket_subheader,ticket_title,ticket_footer1,ticket_footer2,ticket_thanks,ticket_show_subheader,ticket_show_type,ticket_show_datetime,ticket_show_footer,ticket_show_thanks');
        const settings = await response.json();

        // Set text values
        if (settings.ticket_header) document.getElementById('ticket-header').value = settings.ticket_header;
        if (settings.ticket_subheader) document.getElementById('ticket-subheader').value = settings.ticket_subheader;
        if (settings.ticket_title) document.getElementById('ticket-title').value = settings.ticket_title;
        if (settings.ticket_footer1) document.getElementById('ticket-footer1').value = settings.ticket_footer1;
        if (settings.ticket_footer2) document.getElementById('ticket-footer2').value = settings.ticket_footer2;
        if (settings.ticket_thanks) document.getElementById('ticket-thanks').value = settings.ticket_thanks;

        // Set checkbox values (default to true if not set)
        document.getElementById('ticket-show-subheader').checked = settings.ticket_show_subheader !== 'false';
        document.getElementById('ticket-show-type').checked = settings.ticket_show_type !== 'false';
        document.getElementById('ticket-show-datetime').checked = settings.ticket_show_datetime !== 'false';
        document.getElementById('ticket-show-footer').checked = settings.ticket_show_footer !== 'false';
        document.getElementById('ticket-show-thanks').checked = settings.ticket_show_thanks !== 'false';

        // Update preview
        updateTicketPreview();
    } catch (error) {
        console.error('Failed to load ticket design:', error);
    }
}

// Save ticket design
async function saveTicketDesign(event) {
    event.preventDefault();

    const settings = {
        ticket_header: document.getElementById('ticket-header').value,
        ticket_subheader: document.getElementById('ticket-subheader').value,
        ticket_title: document.getElementById('ticket-title').value,
        ticket_footer1: document.getElementById('ticket-footer1').value,
        ticket_footer2: document.getElementById('ticket-footer2').value,
        ticket_thanks: document.getElementById('ticket-thanks').value,
        ticket_show_subheader: document.getElementById('ticket-show-subheader').checked.toString(),
        ticket_show_type: document.getElementById('ticket-show-type').checked.toString(),
        ticket_show_datetime: document.getElementById('ticket-show-datetime').checked.toString(),
        ticket_show_footer: document.getElementById('ticket-show-footer').checked.toString(),
        ticket_show_thanks: document.getElementById('ticket-show-thanks').checked.toString()
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            throw new Error('Failed to save ticket design');
        }

        alert('Desain tiket berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save ticket design:', error);
        alert('Gagal menyimpan desain tiket.');
    }
}

// Test print ticket
async function testPrintTicket() {
    try {
        const response = await fetch('/api/printer/test', {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Print failed');
        }

        alert('Test print berhasil dikirim ke printer!');
    } catch (error) {
        console.error('Failed to test print:', error);
        alert('Gagal test print: ' + error.message);
    }
}
