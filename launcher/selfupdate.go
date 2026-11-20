package main

// Launcher 1.1: survives the server's cold start, re-checks for game updates on a timer,
// and replaces itself when the server publishes a newer launcher.

import (
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var uiListener net.Listener

func verNewer(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x > y
		}
	}
	return false
}

// bootRefresh keeps trying while the hosting wakes up (free instances can take ~1 minute), then keeps checking every few minutes.
func (a *App) bootRefresh() {
	for i := 0; i < 8; i++ {
		a.refresh(true)
		a.mu.Lock()
		on := a.online
		a.mu.Unlock()
		if on {
			break
		}
		time.Sleep(8 * time.Second)
	}
	a.checkSelfUpdate()
	for {
		time.Sleep(3 * time.Minute)
		if !a.busy.Load() {
			a.refresh(true)
			a.checkSelfUpdate()
		}
	}
}

func (a *App) checkSelfUpdate() {
	if runtime.GOOS != "windows" || a.noWindow || a.busy.Load() {
		return
	}
	var v struct {
		Launcher struct {
			Version string `json:"version"`
			URL     string `json:"url"`
		} `json:"launcher"`
	}
	if a.getJSON("/api/versions", &v) != nil || v.Launcher.URL == "" || !verNewer(v.Launcher.Version, launcherVersion) {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	exe, _ = filepath.EvalSymlinks(exe)
	tmp := exe + ".new"
	cl := &http.Client{Timeout: 10 * time.Minute}
	req, _ := http.NewRequest("GET", a.settings.Server+v.Launcher.URL, nil)
	req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
	r, err := cl.Do(req)
	if err != nil {
		return
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return
	}
	f, err := os.Create(tmp)
	if err != nil {
		return
	}
	n, err := io.Copy(f, io.LimitReader(r.Body, 200<<20))
	f.Close()
	head := make([]byte, 2)
	if g, e := os.Open(tmp); e == nil {
		g.Read(head)
		g.Close()
	}
	if err != nil || n < 1<<20 || string(head) != "MZ" {
		os.Remove(tmp)
		return
	}
	old := exe + ".old"
	os.Remove(old)
	if os.Rename(exe, old) != nil { // a running exe can be renamed on Windows, not overwritten
		os.Remove(tmp)
		return
	}
	if os.Rename(tmp, exe) != nil {
		os.Rename(old, exe)
		return
	}
	if uiListener != nil {
		uiListener.Close() // free the UI port so the new launcher can take over; the open window reconnects to it
	}
	exec.Command(exe, "-updated").Start()
	os.Exit(0)
}

func cleanupOldExe() {
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe + ".old")
	}
}
