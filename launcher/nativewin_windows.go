//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

var (
	user32                 = syscall.NewLazyDLL("user32.dll")
	procShowWindow         = user32.NewProc("ShowWindow")
	procGetWindowLongPtr   = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr   = user32.NewProc("SetWindowLongPtrW")
	procMonitorFromWindow  = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfo     = user32.NewProc("GetMonitorInfoW")
	procSetWindowPos       = user32.NewProc("SetWindowPos")
	procGetWindowPlacement = user32.NewProc("GetWindowPlacement")
	procSetWindowPlacement = user32.NewProc("SetWindowPlacement")
	procIsZoomed           = user32.NewProc("IsZoomed")
	procSetForegroundWin   = user32.NewProc("SetForegroundWindow")
	procSetDpiContext      = user32.NewProc("SetProcessDpiAwarenessContext")
	procSetDPIAware        = user32.NewProc("SetProcessDPIAware")
	procGetDpiForSystem    = user32.NewProc("GetDpiForSystem")
)

// winFull is the game window's borderless-fullscreen state. HTML fullscreen inside WebView2 only fills the
// control, the window keeps its title bar and the taskbar stays visible, so the window itself is switched:
// caption and frame removed, stretched over the whole monitor it is on; the old placement is kept to go back.
type winFull struct {
	on      bool
	style   uintptr
	exStyle uintptr
	place   [44]byte // WINDOWPLACEMENT
}

const (
	gwlStyle   = ^uintptr(15) // GWL_STYLE (-16)
	gwlExStyle = ^uintptr(19) // GWL_EXSTYLE (-20)
	wsPopup    = 0x80000000
	wsVisible  = 0x10000000
	wsFrame    = 0x00C00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000 // caption, thick frame, system menu, minimise and maximise boxes
	wsExEdges  = 0x00000001 | 0x00000100 | 0x00000200 | 0x00020000              // dialog frame, window edge, client edge, static edge
)

// dpiAware makes the window process per-monitor DPI aware. Without it Windows draws the window at 96 DPI and stretches the
// picture on any display scaled above 100 %: the game came out blurred and below the screen's real resolution.
func dpiAware() {
	if procSetDpiContext.Find() == nil {
		if ok, _, _ := procSetDpiContext.Call(^uintptr(3)); ok != 0 { // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
			return
		}
	}
	if procSetDPIAware.Find() == nil {
		procSetDPIAware.Call()
	}
}

func (f *winFull) set(hwnd uintptr, on bool) bool {
	if hwnd == 0 || on == f.on {
		return f.on
	}
	if on {
		f.style, _, _ = procGetWindowLongPtr.Call(hwnd, gwlStyle)
		f.exStyle, _, _ = procGetWindowLongPtr.Call(hwnd, gwlExStyle)
		*(*uint32)(unsafe.Pointer(&f.place[0])) = uint32(len(f.place))
		procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&f.place[0])))
		// a maximised window stays clamped to the work area (the taskbar keeps showing), so it is restored first;
		// the saved placement still remembers that it was maximised, for the way back
		if z, _, _ := procIsZoomed.Call(hwnd); z != 0 {
			procShowWindow.Call(hwnd, 9) // SW_RESTORE
		}
		var mi [40]byte // MONITORINFO: cbSize, rcMonitor (left, top, right, bottom), rcWork, dwFlags
		*(*uint32)(unsafe.Pointer(&mi[0])) = uint32(len(mi))
		mon, _, _ := procMonitorFromWindow.Call(hwnd, 2) // MONITOR_DEFAULTTONEAREST
		if ok, _, _ := procGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&mi[0]))); ok == 0 {
			procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&f.place[0])))
			return false
		}
		l, t := *(*int32)(unsafe.Pointer(&mi[4])), *(*int32)(unsafe.Pointer(&mi[8]))
		r, b := *(*int32)(unsafe.Pointer(&mi[12])), *(*int32)(unsafe.Pointer(&mi[16]))
		procSetWindowLongPtr.Call(hwnd, gwlStyle, (f.style&^wsFrame)|wsPopup|wsVisible)
		procSetWindowLongPtr.Call(hwnd, gwlExStyle, f.exStyle&^wsExEdges)
		procSetWindowPos.Call(hwnd, 0, uintptr(l), uintptr(t), uintptr(r-l), uintptr(b-t), 0x0020|0x0040|0x0200) // HWND_TOP · FRAMECHANGED | SHOWWINDOW | NOOWNERZORDER
		procSetForegroundWin.Call(hwnd)
	} else {
		procSetWindowLongPtr.Call(hwnd, gwlStyle, f.style)
		procSetWindowLongPtr.Call(hwnd, gwlExStyle, f.exStyle)
		procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&f.place[0])))
		procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, 0x0001|0x0002|0x0004|0x0020|0x0200) // NOSIZE | NOMOVE | NOZORDER | FRAMECHANGED | NOOWNERZORDER
	}
	f.on = on
	return f.on
}

// runNativeWindow opens a real Win32 window hosting WebView2 (no browser UI, own icon/title/taskbar entry).
// Returns 3 when WebView2 is unavailable so the caller can fall back to the browser app window.
func runNativeWindow(url, profile, title string, w, h int, maximized bool) int {
	dpiAware()
	if procGetDpiForSystem.Find() == nil { // sizes are given for a 100 % display: keep the window the same visible size on a scaled one
		if dpi, _, _ := procGetDpiForSystem.Call(); dpi > 96 && dpi <= 480 {
			w, h = w*int(dpi)/96, h*int(dpi)/96
		}
	}
	dir := filepath.Join(userData(), "ARVEX", "wv2-"+profile)
	os.MkdirAll(dir, 0o755)
	migrateBrowserProfile(filepath.Join(userData(), "ARVEX", "webview-"+profile), filepath.Join(dir, "EBWebView"))
	// same performance switches the old browser window had: no throttling, strong GPU, sound without a click
	os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-background-timer-throttling --disable-renderer-backgrounding "+
		"--disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required --force_high_performance_gpu "+
		"--ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --disable-features=CalculateNativeWinOcclusion")
	wv := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  dir,
		WindowOptions: webview2.WindowOptions{
			Title:  title,
			Width:  uint(w),
			Height: uint(h),
			IconId: 1, // arvex.ico from arvex.rc
			Center: true,
		},
	})
	if wv == nil {
		return 3
	}
	defer wv.Destroy()
	if maximized {
		procShowWindow.Call(uintptr(wv.Window()), 3) // SW_MAXIMIZE
	}
	if profile == "game" { // the game page asks for real fullscreen through these (settings button, F11, start-up preference)
		full := &winFull{}
		wv.Bind("arvexFullscreen", func(on bool) bool { return full.set(uintptr(wv.Window()), on) })
		wv.Bind("arvexIsFullscreen", func() bool { return full.on })
	}
	wv.Navigate(url)
	wv.Run()
	return 0
}

// migrateBrowserProfile carries the solo saves and game settings (localStorage / IndexedDB) from the old
// Edge app-window profile into the WebView2 profile, once. Caches are skipped.
func migrateBrowserProfile(from, to string) {
	if _, err := os.Stat(to); err == nil {
		return
	}
	if _, err := os.Stat(filepath.Join(from, "Default")); err != nil {
		return
	}
	skip := map[string]bool{"Cache": true, "Code Cache": true, "GPUCache": true, "GrShaderCache": true, "ShaderCache": true, "DawnCache": true, "Crashpad": true}
	filepath.Walk(from, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && skip[info.Name()] {
			return filepath.SkipDir
		}
		rel, _ := filepath.Rel(from, p)
		dst := filepath.Join(to, rel)
		if info.IsDir() {
			os.MkdirAll(dst, 0o755)
			return nil
		}
		if info.Name() == "SingletonLock" || info.Name() == "lockfile" || strings.HasSuffix(info.Name(), ".lock") {
			return nil
		}
		if b, e := os.ReadFile(p); e == nil {
			os.WriteFile(dst, b, 0o644)
		}
		return nil
	})
}
