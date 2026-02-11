# Panduan Instalasi Sistem Antrian KPP

## Persyaratan Sistem

### Komputer Server
- Windows 7/8/10/11 (64-bit)
- RAM minimal 2GB
- Port 8080 tersedia (atau sesuaikan di config)

### Komputer Display/TV
- Windows 7/8/10/11 (64-bit)
- RAM minimal 2GB
- Terhubung ke jaringan yang sama dengan server

---

## Cara Build Release Package

Jalankan script berikut di komputer development:

```bash
build-release.bat
```

Script akan membuat folder `release/` dengan struktur:

```
release/
├── server/                    # Untuk komputer server
│   ├── antrian-kpp.exe        # Executable server
│   ├── start-server.bat       # Script untuk menjalankan
│   ├── config.yaml            # Konfigurasi (jika ada)
│   └── web/                   # Assets web (CSS, JS, templates)
│
├── display/                   # Untuk komputer TV/display
│   ├── Antrian Display*.exe   # Aplikasi Electron
│   ├── config.json            # Konfigurasi (EDIT INI!)
│   └── audio/                 # File suara TTS
│
└── README.txt                 # Panduan singkat
```

---

## Instalasi di Komputer Server

### Langkah 1: Copy File
Copy folder `release/server/` ke komputer server, misalnya ke `C:\AntrianKPP\`

### Langkah 2: Jalankan Server
Double-click `start-server.bat` atau jalankan via command prompt:
```bash
cd C:\AntrianKPP
antrian-kpp.exe
```

### Langkah 3: Buka Firewall
Buka Windows Firewall dan izinkan port 8080 (atau port yang dikonfigurasi).

**Cara buka firewall:**
1. Buka Control Panel > Windows Firewall
2. Klik "Advanced settings"
3. Klik "Inbound Rules" > "New Rule"
4. Pilih "Port" > Next
5. Pilih "TCP" dan masukkan port "8080" > Next
6. Pilih "Allow the connection" > Next
7. Centang semua (Domain, Private, Public) > Next
8. Beri nama "Antrian KPP" > Finish

### Langkah 4: Test Akses
Buka browser dan akses:
- Dari server: `http://localhost:8080`
- Dari komputer lain: `http://[IP_SERVER]:8080`

Untuk mengetahui IP server, jalankan `ipconfig` di command prompt.

### Langkah 5: Auto-start (Opsional)
Untuk menjalankan server otomatis saat Windows start:
1. Tekan `Win+R`, ketik `shell:startup`
2. Copy shortcut `start-server.bat` ke folder tersebut

---

## Instalasi di Komputer Display/TV

### Langkah 1: Copy File
Copy folder `release/display/` ke komputer TV, misalnya ke `C:\AntrianDisplay\`

Struktur folder:
```
C:\AntrianDisplay\
├── Antrian Display 1.0.0.exe
├── config.json
└── audio\
    ├── bell.mp3
    ├── nomor_antrian.mp3
    └── ... (file audio lainnya)
```

### Langkah 2: Edit Konfigurasi
Edit file `config.json` dan ganti `serverUrl` dengan IP komputer server:

```json
{
  "serverUrl": "http://192.168.1.100:8080",
  "displayPath": "/display",
  "fullscreen": true,
  "kiosk": true,
  "devTools": false,
  "useLocalTTS": true
}
```

Ganti `192.168.1.100` dengan IP server yang sebenarnya.

### Langkah 3: Jalankan Aplikasi
Double-click `Antrian Display 1.0.0.exe`

### Langkah 4: Auto-start (Opsional)
Untuk menjalankan display otomatis saat Windows start:
1. Tekan `Win+R`, ketik `shell:startup`
2. Copy shortcut aplikasi ke folder tersebut

---

## Konfigurasi

### Server (config.yaml)
```yaml
server:
  port: 8080
  host: "0.0.0.0"

database:
  path: "data/antrian.db"
```

### Display (config.json)
```json
{
  "serverUrl": "http://IP_SERVER:8080",
  "displayPath": "/display",
  "fullscreen": true,
  "kiosk": true,
  "devTools": false,
  "useLocalTTS": true
}
```

| Parameter | Keterangan |
|-----------|------------|
| serverUrl | URL lengkap ke server antrian |
| displayPath | Path halaman display (biasanya /display) |
| fullscreen | Tampilan fullscreen (true/false) |
| kiosk | Mode kiosk, tidak bisa di-minimize (true/false) |
| devTools | Tampilkan developer tools untuk debugging |
| useLocalTTS | Gunakan audio lokal (true) atau Web Speech API (false) |

---

## Troubleshooting

### Server tidak bisa diakses dari komputer lain
1. Cek firewall sudah dibuka untuk port 8080
2. Cek IP server dengan `ipconfig`
3. Pastikan komputer dalam jaringan yang sama
4. Coba ping dari komputer TV ke server: `ping 192.168.1.100`

### Display tidak ada suara
1. Pastikan folder `audio/` ada dan berisi file MP3
2. Cek volume Windows tidak mute
3. Tekan `Ctrl+Shift+L` untuk test audio
4. Tekan `Ctrl+Shift+D` untuk buka DevTools dan lihat error

### Display layar hitam / tidak konek
1. Tekan `F5` untuk refresh
2. Cek `config.json` apakah IP server sudah benar
3. Pastikan server sedang berjalan
4. Cek koneksi jaringan

### Keyboard Shortcuts Display
| Shortcut | Fungsi |
|----------|--------|
| F5 | Refresh halaman |
| F11 | Toggle fullscreen |
| Ctrl+Shift+D | Buka DevTools |
| Ctrl+Shift+L | Test Local TTS |
| Ctrl+Shift+T | Test Web Speech API |
| Ctrl+Q | Keluar aplikasi |

---

## File Audio

Jika file audio belum ada, generate dengan:
```bash
cd electron-display
node generate-audio.js
```

Atau download `bell.mp3` dari https://freesound.org/ dan tambahkan manual.

---

## Kontak & Support

Jika ada masalah, hubungi tim IT.
