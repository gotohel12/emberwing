// EMBERWING — PC launcher (serves the game locally and opens it in an app window)
// © 2026 Mohsen ~ Danial — جميع الحقوق محفوظة
package main

import (
	"embed"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"time"
)

//go:embed public
var gameFS embed.FS

const addr = "127.0.0.1:47331"
const url = "http://" + addr + "/index.html"

var lastPing atomic.Int64

func browserPaths() []string {
	pf := os.Getenv("ProgramFiles")
	pf86 := os.Getenv("ProgramFiles(x86)")
	lad := os.Getenv("LOCALAPPDATA")
	return []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(lad, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf, `BraveSoftware\Brave-Browser\Application\brave.exe`),
		filepath.Join(lad, `BraveSoftware\Brave-Browser\Application\brave.exe`),
	}
}

func openWindow() {
	profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "EmberWing", "app")
	_ = os.MkdirAll(profile, 0o755)
	for _, p := range browserPaths() {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			cmd := exec.Command(p,
				"--app="+url,
				"--user-data-dir="+profile,
				"--window-size=1366,800", "--start-maximized",
				"--no-first-run", "--no-default-browser-check",
				"--disable-background-timer-throttling",
				"--disable-renderer-backgrounding",
				"--disable-backgrounding-occluded-windows",
				"--autoplay-policy=no-user-gesture-required",
			)
			if cmd.Start() == nil {
				return
			}
		}
	}
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func main() {
	ln, err := net.Listen("tcp", addr)
	if err != nil { // already running: just open another window
		openWindow()
		return
	}
	sub, _ := fs.Sub(gameFS, "public")
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(204)
	})
	mux.HandleFunc("/__quit", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
		go func() { time.Sleep(400 * time.Millisecond); os.Exit(0) }()
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Developers", "Mohsen ~ Danial")
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			b, _ := fs.ReadFile(sub, "index.html")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(b)
			return
		}
		files.ServeHTTP(w, r)
	})
	go http.Serve(ln, mux)
	openWindow()

	start := time.Now()
	for {
		time.Sleep(3 * time.Second)
		lp := lastPing.Load()
		if lp == 0 {
			if time.Since(start) > 3*time.Minute {
				os.Exit(0)
			}
			continue
		}
		if time.Now().Unix()-lp > 25 { // window was closed
			os.Exit(0)
		}
	}
}
