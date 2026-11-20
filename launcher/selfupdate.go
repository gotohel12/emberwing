package main

// Launcher 1.1: survives the server's cold start, re-checks for game updates on a timer,
// and replaces itself when the server publishes a newer launcher.

import (
	"crypto/ed25519"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var uiListener net.Listener

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
		time.Sleep(checkEvery)
		if !a.busy.Load() {
			a.refresh(true)
			a.checkSelfUpdate()
		}
	}
}

// checkSelfUpdate replaces this executable when the server publishes a newer launcher. The download must match the
// SHA-256 the server announces, and when this launcher pins a signing key the announcement itself must be signed.
func (a *App) checkSelfUpdate() {
	if runtime.GOOS != "windows" || a.noWindow || a.busy.Load() {
		return
	}
	var v struct {
		Launcher struct {
			Version string `json:"version"`
			URL     string `json:"url"`
			SHA256  string `json:"sha256"`
			Size    int64  `json:"size"`
			Sig     string `json:"sig"`
		} `json:"launcher"`
	}
	L := &v.Launcher
	if a.getJSON("/api/versions", &v) != nil || L.URL == "" || !semverRe.MatchString(L.Version) || !verNewer(L.Version, launcherVersion) {
		return
	}
	if !hexRe.MatchString(L.SHA256) || !strings.HasPrefix(L.URL, "/download/") {
		a.log.Warn("launcher %s is offered without a usable hash; ignoring it", L.Version)
		return
	}
	if key := signingKey(); key != nil && a.loadTrust().Enforced {
		sig, err := base64.StdEncoding.DecodeString(L.Sig)
		if err != nil || !ed25519.Verify(key, []byte("ARVEX-LAUNCHER-1\n"+L.Version+"\n"+L.SHA256), sig) {
			a.log.Error("ARVEX-U005: launcher %s announcement is not signed correctly; not installing it", L.Version)
			a.report("launcher", map[string]any{"code": "ARVEX-U005", "message": "launcher self-update signature rejected", "severity": "high"})
			return
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	exe, _ = filepath.EvalSymlinks(exe)
	tmp := exe + ".new"
	cl := &http.Client{Timeout: 10 * time.Minute}
	req, _ := http.NewRequest("GET", a.settings.Server+L.URL, nil)
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
	_, err = io.Copy(f, io.LimitReader(r.Body, 200<<20))
	f.Close()
	sum, _, herr := fileSHA(tmp)
	if err != nil || herr != nil || sum != L.SHA256 {
		a.log.Error("ARVEX-U003: downloaded launcher %s does not match its SHA-256; keeping %s", L.Version, launcherVersion)
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
	a.log.Info("launcher updated %s → %s, restarting", launcherVersion, L.Version)
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
