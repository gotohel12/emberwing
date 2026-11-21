//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"

	webview2 "github.com/jchv/go-webview2"
)

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	procShowWindow = user32.NewProc("ShowWindow")
)

// runNativeWindow opens a real Win32 window hosting WebView2 (no browser UI, own icon/title/taskbar entry).
// Returns 3 when WebView2 is unavailable so the caller can fall back to the browser app window.
func runNativeWindow(url, profile, title string, w, h int, maximized bool) int {
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
