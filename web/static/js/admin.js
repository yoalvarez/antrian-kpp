// Admin panel JavaScript

let currentFilter = '';
let currentPage = 1;
let currentDate = '';
let currentType = '';
let currentAdminPage = 'dashboard';

// Page titles mapping
const pageTitles = {
    'dashboard': 'Dashboard',
    'management': 'Kelola Antrian',
    'display-settings': 'Pengaturan Display',
    'ticket-settings': 'Pengaturan Tiket',
    'system-settings': 'Pengaturan Sistem',
    'reports': 'Laporan & Statistik'
};

// Show specific page
function showPage(pageName) {
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageName) {
            item.classList.add('active');
        }
    });

    // Show/hide page sections
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.remove('active');
    });
    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update page title
    const titleEl = document.getElementById('page-title');
    if (titleEl && pageTitles[pageName]) {
        titleEl.textContent = pageTitles[pageName];
    }

    // Save current page to localStorage
    localStorage.setItem('admin_current_page', pageName);
    currentAdminPage = pageName;

    // Close mobile sidebar if open
    closeMobileSidebar();

    return false; // Prevent default link behavior
}

// Toggle sidebar collapse
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        sidebar.classList.toggle('mobile-open');
        toggleOverlay(sidebar.classList.contains('mobile-open'));
    } else {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('admin_sidebar_collapsed', sidebar.classList.contains('collapsed'));
    }
}

// Close mobile sidebar
function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('mobile-open');
    toggleOverlay(false);
}

// Toggle overlay for mobile
function toggleOverlay(show) {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay && show) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = closeMobileSidebar;
        document.body.appendChild(overlay);
    }
    if (overlay) {
        overlay.classList.toggle('show', show);
    }
}

// Restore sidebar state
function restoreSidebarState() {
    const sidebar = document.getElementById('sidebar');
    const isCollapsed = localStorage.getItem('admin_sidebar_collapsed') === 'true';
    if (isCollapsed && window.innerWidth > 768) {
        sidebar.classList.add('collapsed');
    }
}

// Restore current page
function restoreCurrentPage() {
    const savedPage = localStorage.getItem('admin_current_page');
    if (savedPage && pageTitles[savedPage]) {
        showPage(savedPage);
    }
}

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

    // Restore sidebar and page state
    restoreSidebarState();
    restoreCurrentPage();

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

// Get current queue display
function getCurrentQueueDisplay(counter) {
    if (!counter.current_queue || !counter.current_queue.queue_number) return '';
    return `<p style="color: #2563eb;">Antrian: ${counter.current_queue.queue_number}</p>`;
}

// Auto-generate counter name based on number
function autoGenerateCounterName() {
    const numberInput = document.getElementById('counter-number');
    const nameInput = document.getElementById('counter-name');

    if (numberInput.value && !nameInput.dataset.userEdited) {
        nameInput.placeholder = `Otomatis: Loket ${numberInput.value}`;
    }
}

// Mark name input as user-edited when user types
document.addEventListener('DOMContentLoaded', function() {
    const nameInput = document.getElementById('counter-name');
    if (nameInput) {
        nameInput.addEventListener('input', function() {
            this.dataset.userEdited = this.value ? 'true' : '';
        });
    }
});

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

        container.innerHTML = counters.map(counter => {
            const hasQueue = counter.current_queue && counter.current_queue.queue_number;

            return `
                <div class="counter-card ${hasQueue ? 'has-queue' : ''} ${!counter.is_active ? 'inactive-counter' : ''}" data-counter-id="${counter.id}">
                    <div class="counter-card-header">
                        <div class="counter-info">
                            <div class="counter-number-badge">${counter.counter_number}</div>
                            <div class="counter-details">
                                <h3>${counter.counter_name}</h3>
                                <span class="counter-status-badge ${counter.is_active ? 'active' : 'inactive'}">
                                    ${counter.is_active ? 'Aktif' : 'Nonaktif'}
                                </span>
                            </div>
                        </div>
                        <div class="counter-icon-actions">
                            <button class="icon-btn" onclick="showEditCounterModal(${counter.id})" title="Edit Loket">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                            <button class="icon-btn icon-btn-danger" onclick="deleteCounter(${counter.id}, '${counter.counter_name}')" title="Hapus Loket">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="counter-card-body">
                        ${hasQueue
                            ? `<div class="queue-serving">
                                <span class="label">Melayani</span>
                                <span class="queue-number">${counter.current_queue.queue_number}</span>
                               </div>`
                            : `<div class="queue-empty">Tidak ada antrian</div>`
                        }
                    </div>
                    <div class="counter-card-footer">
                        <a href="/counter/${counter.id}" class="btn btn-sm btn-primary btn-block">Buka Loket</a>
                    </div>
                </div>
            `;
        }).join('');
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

// Show add counter modal with auto-suggested counter number
async function showAddCounterModal() {
    document.getElementById('add-counter-modal').classList.add('show');

    // Auto-suggest next available counter number
    try {
        const response = await fetch('/api/counters');
        const counters = await response.json();

        // Get all existing counter numbers as integers
        const existingNumbers = counters
            .map(c => parseInt(c.counter_number, 10))
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);

        // Find the next available number (fill gaps first, otherwise max+1)
        let nextNumber = 1;
        if (existingNumbers.length > 0) {
            // Check for gaps in sequence
            for (let i = 1; i <= existingNumbers[existingNumbers.length - 1] + 1; i++) {
                if (!existingNumbers.includes(i)) {
                    nextNumber = i;
                    break;
                }
            }
        }

        document.getElementById('counter-number').value = nextNumber;
        // Trigger auto-generate counter name
        autoGenerateCounterName();
    } catch (error) {
        console.error('Failed to get counters for suggestion:', error);
    }

    document.getElementById('counter-number').focus();
}

// Close modal
function showModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
}

// Add counter
async function addCounter(event) {
    event.preventDefault();

    const counterNumber = document.getElementById('counter-number').value.trim();
    let counterName = document.getElementById('counter-name').value.trim();

    // Auto-generate name if empty
    if (!counterName) {
        counterName = `Loket ${counterNumber}`;
    }

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
        document.getElementById('add-counter-form').reset();
        loadCounters();
        loadStats();
    } catch (error) {
        console.error('Failed to add counter:', error);
        alert('Gagal menambahkan loket. Pastikan nomor loket unik.');
    }
}

// Delete counter
// Show edit counter modal
async function showEditCounterModal(id) {
    try {
        const response = await fetch(`/api/counter/${id}`);
        if (!response.ok) throw new Error('Failed to fetch counter');

        const counter = await response.json();

        document.getElementById('edit-counter-id').value = counter.id;
        document.getElementById('edit-counter-number').value = counter.counter_number;
        document.getElementById('edit-counter-name').value = counter.counter_name;
        document.getElementById('edit-counter-active').checked = counter.is_active;

        showModal('edit-counter-modal');
    } catch (error) {
        console.error('Failed to load counter:', error);
        alert('Gagal memuat data loket.');
    }
}

// Update counter
async function updateCounter(event) {
    event.preventDefault();

    const id = document.getElementById('edit-counter-id').value;
    const counterName = document.getElementById('edit-counter-name').value.trim();
    const isActive = document.getElementById('edit-counter-active').checked;

    if (!counterName) {
        alert('Nama loket tidak boleh kosong.');
        return;
    }

    try {
        const response = await fetch(`/api/counter/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                counter_name: counterName,
                is_active: isActive
            })
        });

        if (!response.ok) {
            throw new Error('Failed to update counter');
        }

        closeModal('edit-counter-modal');
        loadCounters();
        loadStats();
    } catch (error) {
        console.error('Failed to update counter:', error);
        alert('Gagal memperbarui loket.');
    }
}

// Confirm delete from edit modal
function confirmDeleteCounter() {
    const id = document.getElementById('edit-counter-id').value;
    const name = document.getElementById('edit-counter-name').value;

    if (confirm(`Yakin ingin menghapus loket "${name}"?\n\nPerhatian: Riwayat panggilan di loket ini juga akan dihapus.`)) {
        closeModal('edit-counter-modal');
        deleteCounterById(id);
    }
}

// Delete counter by ID
async function deleteCounterById(id) {
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

// Delete counter (from card button)
async function deleteCounter(id, name) {
    if (!confirm(`Yakin ingin menghapus loket "${name}"?\n\nPerhatian: Riwayat panggilan di loket ini juga akan dihapus.`)) {
        return;
    }

    await deleteCounterById(id);
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

        showToast('Video & running text berhasil disimpan!');
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

        showToast('Desain tiket berhasil disimpan!');
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

// ===================================
// Ticket Appearance Settings
// ===================================

async function loadTicketAppearanceSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();

        if (settings.ticket_page_title) document.getElementById('ticket-page-title').value = settings.ticket_page_title;
        if (settings.ticket_page_subtitle) document.getElementById('ticket-page-subtitle').value = settings.ticket_page_subtitle;
        if (settings.ticket_welcome_text) document.getElementById('ticket-welcome-text').value = settings.ticket_welcome_text;
        if (settings.ticket_instruction_text) document.getElementById('ticket-instruction-text').value = settings.ticket_instruction_text;

        document.getElementById('ticket-auto-print').checked = settings.ticket_auto_print !== 'false';
        document.getElementById('ticket-show-queue-count').checked = settings.ticket_show_queue_count !== 'false';
    } catch (error) {
        console.error('Failed to load ticket appearance settings:', error);
    }
}

async function saveTicketAppearance(event) {
    event.preventDefault();

    const settings = {
        ticket_page_title: document.getElementById('ticket-page-title').value,
        ticket_page_subtitle: document.getElementById('ticket-page-subtitle').value,
        ticket_welcome_text: document.getElementById('ticket-welcome-text').value,
        ticket_instruction_text: document.getElementById('ticket-instruction-text').value,
        ticket_auto_print: document.getElementById('ticket-auto-print').checked.toString(),
        ticket_show_queue_count: document.getElementById('ticket-show-queue-count').checked.toString()
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save');
        showToast('Pengaturan halaman antrian berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save ticket appearance:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// ===================================
// Display Appearance Settings
// ===================================

async function loadDisplayAppearanceSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();

        if (settings.display_title) document.getElementById('display-title').value = settings.display_title;
        if (settings.display_logo_text) document.getElementById('display-logo-text').value = settings.display_logo_text;
        if (settings.display_recent_calls_count) document.getElementById('display-recent-calls-count').value = settings.display_recent_calls_count;
        if (settings.display_history_count) document.getElementById('display-history-count').value = settings.display_history_count;
        if (settings.display_tts_rate) {
            document.getElementById('display-tts-rate').value = settings.display_tts_rate;
            document.getElementById('tts-rate-value').textContent = settings.display_tts_rate;
        }
        if (settings.display_ticker_speed) {
            document.getElementById('display-ticker-speed').value = settings.display_ticker_speed;
            document.getElementById('ticker-speed-value').textContent = settings.display_ticker_speed;
        }

        document.getElementById('display-show-video').checked = settings.display_show_video !== 'false';
        document.getElementById('display-show-stats').checked = settings.display_show_stats !== 'false';
        document.getElementById('display-show-history').checked = settings.display_show_history !== 'false';
        document.getElementById('display-show-queue-summary').checked = settings.display_show_queue_summary !== 'false';
        document.getElementById('display-sound-enabled').checked = settings.display_sound_enabled !== 'false';
    } catch (error) {
        console.error('Failed to load display appearance settings:', error);
    }
}

async function saveDisplayAppearance(event) {
    event.preventDefault();

    const settings = {
        display_title: document.getElementById('display-title').value,
        display_logo_text: document.getElementById('display-logo-text').value,
        display_recent_calls_count: document.getElementById('display-recent-calls-count').value,
        display_history_count: document.getElementById('display-history-count').value,
        display_tts_rate: document.getElementById('display-tts-rate').value,
        display_ticker_speed: document.getElementById('display-ticker-speed').value,
        display_show_video: document.getElementById('display-show-video').checked.toString(),
        display_show_stats: document.getElementById('display-show-stats').checked.toString(),
        display_show_history: document.getElementById('display-show-history').checked.toString(),
        display_show_queue_summary: document.getElementById('display-show-queue-summary').checked.toString(),
        display_sound_enabled: document.getElementById('display-sound-enabled').checked.toString()
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save');
        showToast('Header & branding berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save display appearance:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// Setup range input listeners
function setupRangeInputs() {
    const ttsRate = document.getElementById('display-tts-rate');
    const tickerSpeed = document.getElementById('display-ticker-speed');

    if (ttsRate) {
        ttsRate.addEventListener('input', function() {
            document.getElementById('tts-rate-value').textContent = this.value;
        });
    }

    if (tickerSpeed) {
        tickerSpeed.addEventListener('input', function() {
            document.getElementById('ticker-speed-value').textContent = this.value;
        });
    }
}

// ===================================
// System Settings
// ===================================

async function loadSystemSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();

        if (settings.system_open_time) document.getElementById('system-open-time').value = settings.system_open_time;
        if (settings.system_close_time) document.getElementById('system-close-time').value = settings.system_close_time;
        if (settings.system_max_queue_daily) document.getElementById('system-max-queue-daily').value = settings.system_max_queue_daily;
        if (settings.system_max_queue_per_type) document.getElementById('system-max-queue-per-type').value = settings.system_max_queue_per_type;

        // Operating days
        const days = settings.system_operating_days ? settings.system_operating_days.split(',') : ['mon','tue','wed','thu','fri'];
        document.getElementById('day-mon').checked = days.includes('mon');
        document.getElementById('day-tue').checked = days.includes('tue');
        document.getElementById('day-wed').checked = days.includes('wed');
        document.getElementById('day-thu').checked = days.includes('thu');
        document.getElementById('day-fri').checked = days.includes('fri');
        document.getElementById('day-sat').checked = days.includes('sat');
        document.getElementById('day-sun').checked = days.includes('sun');

        document.getElementById('system-enforce-hours').checked = settings.system_enforce_hours !== 'false';
    } catch (error) {
        console.error('Failed to load system settings:', error);
    }
}

async function saveSystemSettings(event) {
    event.preventDefault();

    const days = [];
    if (document.getElementById('day-mon').checked) days.push('mon');
    if (document.getElementById('day-tue').checked) days.push('tue');
    if (document.getElementById('day-wed').checked) days.push('wed');
    if (document.getElementById('day-thu').checked) days.push('thu');
    if (document.getElementById('day-fri').checked) days.push('fri');
    if (document.getElementById('day-sat').checked) days.push('sat');
    if (document.getElementById('day-sun').checked) days.push('sun');

    const settings = {
        system_open_time: document.getElementById('system-open-time').value,
        system_close_time: document.getElementById('system-close-time').value,
        system_operating_days: days.join(','),
        system_max_queue_daily: document.getElementById('system-max-queue-daily').value,
        system_max_queue_per_type: document.getElementById('system-max-queue-per-type').value,
        system_enforce_hours: document.getElementById('system-enforce-hours').checked.toString()
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save');
        showToast('Jam operasional berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save system settings:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// ===================================
// Reports & Statistics
// ===================================

function initReportDates() {
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    document.getElementById('report-end-date').value = today.toISOString().split('T')[0];
    document.getElementById('report-start-date').value = lastWeek.toISOString().split('T')[0];
}

async function loadReport() {
    const startDate = document.getElementById('report-start-date').value;
    const endDate = document.getElementById('report-end-date').value;

    if (!startDate || !endDate) {
        alert('Silakan pilih rentang tanggal.');
        return;
    }

    try {
        const response = await fetch(`/api/report?start=${startDate}&end=${endDate}`);
        const report = await response.json();

        // Update summary cards
        document.getElementById('report-total').textContent = report.total || 0;
        document.getElementById('report-completed').textContent = report.completed || 0;
        document.getElementById('report-cancelled').textContent = report.cancelled || 0;
        document.getElementById('report-avg-time').textContent = report.avg_wait_time || '-';

        // Render chart
        renderReportChart(report.daily || []);

        // Render by type
        renderReportByType(report.by_type || []);
    } catch (error) {
        console.error('Failed to load report:', error);
        alert('Gagal memuat laporan.');
    }
}

function renderReportChart(dailyData) {
    const container = document.getElementById('report-chart');

    if (!dailyData || dailyData.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Tidak ada data untuk rentang tanggal ini</p>';
        return;
    }

    const maxValue = Math.max(...dailyData.map(d => d.total)) || 1;
    const chartHeight = 150;

    container.innerHTML = dailyData.map(day => {
        const height = (day.total / maxValue) * chartHeight;
        const date = new Date(day.date);
        const dayName = date.toLocaleDateString('id-ID', { weekday: 'short' });
        const dayNum = date.getDate();

        return `
            <div class="chart-bar-container">
                <div class="chart-value">${day.total}</div>
                <div class="chart-bar" style="height: ${height}px;" title="${day.total} antrian"></div>
                <div class="chart-label">${dayName} ${dayNum}</div>
            </div>
        `;
    }).join('');
}

function renderReportByType(byTypeData) {
    const container = document.getElementById('report-by-type');

    if (!byTypeData || byTypeData.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = byTypeData.map(type => `
        <div class="type-report-card">
            <h5>${type.prefix} - ${type.name}</h5>
            <div class="stats">
                <span>Total: <span class="count">${type.total}</span></span>
                <span>Selesai: <span class="count">${type.completed}</span></span>
                <span>Batal: <span class="count">${type.cancelled}</span></span>
            </div>
        </div>
    `).join('');
}

async function exportReport() {
    const startDate = document.getElementById('report-start-date').value;
    const endDate = document.getElementById('report-end-date').value;

    if (!startDate || !endDate) {
        alert('Silakan pilih rentang tanggal terlebih dahulu.');
        return;
    }

    try {
        const response = await fetch(`/api/report/export?start=${startDate}&end=${endDate}`);
        const blob = await response.blob();

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `laporan-antrian-${startDate}-${endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        console.error('Failed to export report:', error);
        alert('Gagal export laporan.');
    }
}

// ===================================
// Split Settings Save Functions
// ===================================

// Save display widgets settings
async function saveDisplayWidgets() {
    const settings = {
        display_show_video: document.getElementById('display-show-video').checked.toString(),
        display_show_stats: document.getElementById('display-show-stats').checked.toString(),
        display_show_history: document.getElementById('display-show-history').checked.toString(),
        display_show_queue_summary: document.getElementById('display-show-queue-summary').checked.toString()
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save');
        showToast('Widget display berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save display widgets:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// Save display sound settings
async function saveDisplaySound() {
    const settings = {
        display_tts_rate: document.getElementById('display-tts-rate').value,
        display_ticker_speed: document.getElementById('display-ticker-speed').value,
        display_sound_enabled: document.getElementById('display-sound-enabled').checked.toString()
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save');
        showToast('Pengaturan suara berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save display sound:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// Save queue limits settings
async function saveQueueLimits() {
    const settings = {
        system_max_queue_daily: document.getElementById('system-max-queue-daily').value,
        system_max_queue_per_type: document.getElementById('system-max-queue-per-type').value
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save');
        showToast('Batas antrian berhasil disimpan!');
    } catch (error) {
        console.error('Failed to save queue limits:', error);
        alert('Gagal menyimpan pengaturan.');
    }
}

// Toast notification helper
function showToast(message) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===================================
// Load All Settings on Page Load
// ===================================

document.addEventListener('DOMContentLoaded', function() {
    // Load all additional settings
    loadTicketAppearanceSettings();
    loadDisplayAppearanceSettings();
    loadSystemSettings();
    setupRangeInputs();
    initReportDates();
});
