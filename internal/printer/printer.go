package printer

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// ESC/POS Commands
var (
	ESC          = byte(0x1B)
	GS           = byte(0x1D)
	INIT         = []byte{ESC, '@'}        // Initialize printer
	ALIGN_CENTER = []byte{ESC, 'a', 1}     // Center alignment
	ALIGN_LEFT   = []byte{ESC, 'a', 0}     // Left alignment
	BOLD_ON      = []byte{ESC, 'E', 1}     // Bold on
	BOLD_OFF     = []byte{ESC, 'E', 0}     // Bold off
	DOUBLE_ON    = []byte{GS, '!', 0x11}   // Double width & height
	DOUBLE_OFF   = []byte{GS, '!', 0x00}   // Normal size
	FONT_B       = []byte{ESC, 'M', 1}     // Small font
	FONT_A       = []byte{ESC, 'M', 0}     // Normal font
	CUT          = []byte{GS, 'V', 66, 3}  // Partial cut with feed
	FEED_LINE    = []byte{ESC, 'd', 1}     // Feed 1 line
	FEED_LINES   = []byte{ESC, 'd', 3}     // Feed 3 lines
)

// PrinterConfig holds printer configuration
type PrinterConfig struct {
	PrinterName string // Windows printer name (e.g., "ECO80")
	Enabled     bool
}

// TicketTemplate holds the ticket design template
type TicketTemplate struct {
	Header        string
	Subheader     string
	Title         string
	Footer1       string
	Footer2       string
	Thanks        string
	ShowSubheader bool
	ShowType      bool
	ShowDatetime  bool
	ShowFooter    bool
	ShowThanks    bool
}

// DefaultTemplate returns the default ticket template
func DefaultTemplate() TicketTemplate {
	return TicketTemplate{
		Header:        "SISTEM ANTRIAN",
		Subheader:     "",
		Title:         "NOMOR ANTRIAN ANDA",
		Footer1:       "Mohon menunggu hingga",
		Footer2:       "nomor Anda dipanggil",
		Thanks:        "Terima kasih",
		ShowSubheader: true,
		ShowType:      true,
		ShowDatetime:  true,
		ShowFooter:    true,
		ShowThanks:    true,
	}
}

// Printer handles thermal printing
type Printer struct {
	config PrinterConfig
}

// New creates a new printer instance
func New(config PrinterConfig) *Printer {
	return &Printer{config: config}
}

// TicketData holds the data for printing a ticket
type TicketData struct {
	QueueNumber string
	TypeName    string
	DateTime    string
}

// PrintTicket prints a queue ticket to the thermal printer
func (p *Printer) PrintTicket(data TicketData, template TicketTemplate) error {
	if !p.config.Enabled {
		return fmt.Errorf("printer is disabled")
	}

	// Build ESC/POS commands
	var buf bytes.Buffer

	// Initialize printer
	buf.Write(INIT)

	// Header - Center aligned, bold
	buf.Write(ALIGN_CENTER)
	buf.Write(BOLD_ON)
	header := template.Header
	if header == "" {
		header = "SISTEM ANTRIAN"
	}
	buf.WriteString(header + "\n")
	buf.Write(BOLD_OFF)

	// Subheader (optional)
	if template.ShowSubheader && template.Subheader != "" {
		buf.Write(FONT_B)
		buf.WriteString(template.Subheader + "\n")
		buf.Write(FONT_A)
	}

	// Dashed line
	buf.WriteString("--------------------------------\n")

	// Title
	buf.Write(FONT_B)
	title := template.Title
	if title == "" {
		title = "NOMOR ANTRIAN ANDA"
	}
	buf.WriteString(title + "\n")
	buf.Write(FONT_A)

	// Queue number - Large & bold
	buf.Write(FEED_LINE)
	buf.Write(DOUBLE_ON)
	buf.Write(BOLD_ON)
	buf.WriteString(data.QueueNumber + "\n")
	buf.Write(BOLD_OFF)
	buf.Write(DOUBLE_OFF)

	// Type name (optional)
	if template.ShowType {
		buf.Write(FEED_LINE)
		buf.Write(BOLD_ON)
		buf.WriteString(data.TypeName + "\n")
		buf.Write(BOLD_OFF)
	}

	// Dashed line
	buf.WriteString("--------------------------------\n")

	// DateTime (optional)
	if template.ShowDatetime {
		buf.Write(FONT_B)
		buf.WriteString(data.DateTime + "\n")
		buf.Write(FONT_A)
	}

	// Footer (optional)
	if template.ShowFooter {
		// Dashed line
		buf.WriteString("--------------------------------\n")

		buf.Write(FONT_B)
		footer1 := template.Footer1
		if footer1 == "" {
			footer1 = "Mohon menunggu hingga"
		}
		buf.WriteString(footer1 + "\n")

		footer2 := template.Footer2
		if footer2 == "" {
			footer2 = "nomor Anda dipanggil"
		}
		buf.WriteString(footer2 + "\n")
		buf.Write(FONT_A)
	}

	// Thanks message (optional)
	if template.ShowThanks {
		buf.WriteString("\n")
		buf.Write(FONT_B)
		thanks := template.Thanks
		if thanks == "" {
			thanks = "Terima kasih"
		}
		buf.WriteString(thanks + "\n")
		buf.Write(FONT_A)
	}

	// Feed and cut
	buf.Write(FEED_LINES)
	buf.Write(CUT)

	// Send to printer
	return p.sendToPrinter(buf.Bytes())
}

// PrintTicketSimple prints a ticket with default template (for backward compatibility)
func (p *Printer) PrintTicketSimple(data TicketData) error {
	return p.PrintTicket(data, DefaultTemplate())
}

// sendToPrinter sends raw data to the Windows printer using PowerShell
func (p *Printer) sendToPrinter(data []byte) error {
	printerName := p.config.PrinterName
	if printerName == "" {
		printerName = "ECO80"
	}

	// Create temp file with raw print data
	tempDir := os.TempDir()
	tempFile := filepath.Join(tempDir, fmt.Sprintf("ticket_%d.bin", time.Now().UnixNano()))

	if err := os.WriteFile(tempFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}
	defer os.Remove(tempFile)

	// Use PowerShell to send raw data to printer
	// This is the most reliable method for Windows
	psScript := fmt.Sprintf(`
$printerName = '%s'
$filePath = '%s'

# Get printer
$printer = Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Name='$printerName'" -ErrorAction SilentlyContinue

if ($printer -eq $null) {
    # Try without exact match
    $printer = Get-WmiObject -Query "SELECT * FROM Win32_Printer WHERE Name LIKE '%%$printerName%%'" -ErrorAction SilentlyContinue
}

if ($printer -eq $null) {
    Write-Error "Printer '$printerName' not found"
    exit 1
}

# Get printer port
$portName = $printer.PortName

# Read file content as bytes
$bytes = [System.IO.File]::ReadAllBytes($filePath)

# Try direct port write first (works for USB printers)
try {
    $port = [System.IO.Ports.SerialPort]::GetPortNames() | Where-Object { $_ -eq $portName }
    if ($port) {
        $serialPort = New-Object System.IO.Ports.SerialPort $portName, 9600
        $serialPort.Open()
        $serialPort.Write($bytes, 0, $bytes.Length)
        $serialPort.Close()
        exit 0
    }
} catch {}

# Fallback: Use raw print job via .NET
Add-Type -AssemblyName System.Drawing

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName

# For raw printing, we use RawPrinterHelper
$helper = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", CharSet = CharSet.Ansi, SetLastError = true)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", CharSet = CharSet.Ansi, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes)
    {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Queue Ticket";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
                if (StartPagePrinter(hPrinter))
                {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten;
                    WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
            return true;
        }
        return false;
    }
}
"@

Add-Type -TypeDefinition $helper -Language CSharp -ErrorAction SilentlyContinue

[RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
`, printerName, escapeForPS(tempFile))

	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("print failed: %v, output: %s", err, string(output))
	}

	return nil
}

// escapeForPS escapes a string for use in PowerShell
func escapeForPS(s string) string {
	// Replace backslashes for PowerShell path
	result := ""
	for _, c := range s {
		if c == '\\' {
			result += "\\\\"
		} else if c == '\'' {
			result += "''"
		} else {
			result += string(c)
		}
	}
	return result
}

// TestPrint sends a test print to verify printer connection
func (p *Printer) TestPrint() error {
	var buf bytes.Buffer

	buf.Write(INIT)
	buf.Write(ALIGN_CENTER)
	buf.Write(BOLD_ON)
	buf.WriteString("=== TEST PRINT ===\n")
	buf.Write(BOLD_OFF)
	buf.WriteString("\n")
	buf.WriteString("Printer: " + p.config.PrinterName + "\n")
	buf.WriteString("Time: " + time.Now().Format("02/01/2006 15:04:05") + "\n")
	buf.WriteString("\n")
	buf.WriteString("Jika Anda melihat ini,\n")
	buf.WriteString("printer berfungsi dengan baik!\n")
	buf.Write(FEED_LINES)
	buf.Write(CUT)

	return p.sendToPrinter(buf.Bytes())
}

// IsEnabled returns whether printing is enabled
func (p *Printer) IsEnabled() bool {
	return p.config.Enabled
}

// GetPrinterName returns the configured printer name
func (p *Printer) GetPrinterName() string {
	return p.config.PrinterName
}
