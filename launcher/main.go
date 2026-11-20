// ARVEX SURVIVAL — official launcher
// A real installer/updater: downloads the game from the ARVEX server using a SHA-256 manifest, resumes partial
// downloads (HTTP Range), supports pause/resume/retry, a speed limit, incremental updates (only changed files),
// verify + repair, safe staged installs with rollback, news, settings, and launches the game in an app window.
// UI is served locally and shown in a chromeless Edge/Chrome window (no runtime to install).
package main

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed ui
var uiFS embed.FS

const (
	launcherVersion = "1.0.0"
	uiAddr          = "127.0.0.1:47330"
	gameAddr        = "127.0.0.1:47331"
	defaultServer   = "https://emberwing.onrender.com"
)

// ----------------------------------------------------------------- data types
type ManifestFile struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
	URL      string `json:"url"`
	Required bool   `json:"required"`
}
type Manifest struct {
	Product    string         `json:"product"`
	Version    string         `json:"version"`
	MinVersion string         `json:"minVersion"`
	Required   bool           `json:"required"`
	Total      int64          `json:"total"`
	Files      []ManifestFile `json:"files"`
	Entry      string         `json:"entry"`
	SHA        string         `json:"sha256"`
}
type Settings struct {
	InstallDir   string `json:"installDir"`
	DownloadDir  string `json:"downloadDir"`
	SpeedLimit   int64  `json:"speedLimitKB"` // 0 = unlimited
	AutoUpdate   bool   `json:"autoUpdate"`
	StartWithWin bool   `json:"startWithWindows"`
	Language     string `json:"language"`
	Server       string `json:"server"`
	CloseOnPlay  bool   `json:"closeOnPlay"`
}
type Progress struct {
	Phase      string  `json:"phase"` // idle|checking|downloading|paused|verifying|installing|done|error|offline
	Op         string  `json:"op"`    // install|update|repair|verify
	File       string  `json:"file"`
	Downloaded int64   `json:"downloaded"`
	Total      int64   `json:"total"`
	Speed      float64 `json:"speed"` // bytes/s
	ETA        float64 `json:"eta"`   // seconds
	FilesDone  int     `json:"filesDone"`
	FilesTotal int     `json:"filesTotal"`
	Message    string  `json:"message"`
	Error      string  `json:"error"`
	Result     string  `json:"result"` // download_complete|update_complete|repair_complete|verify_ok|verify_bad
	Bad        []string `json:"bad,omitempty"`
}
type Installed struct {
	Version string            `json:"version"`
	Files   map[string]string `json:"files"` // path -> sha256
	At      int64             `json:"at"`
}

// ----------------------------------------------------------------- state
type App struct {
	mu        sync.Mutex
	dataDir   string
	settings  Settings
	installed *Installed
	latest    *Manifest
	online    bool
	lastErr   string
	prog      Progress
	busy      atomic.Bool
	paused    atomic.Bool
	cancel    context.CancelFunc
	subs      map[chan []byte]bool
	speedWin  []sample
	news      json.RawMessage
	servers   json.RawMessage
	gameSrv   *http.Server
	lastPing  atomic.Int64
	noWindow  bool
	lastBroadcast time.Time
}
type sample struct {
	t time.Time
	n int64
}

func main() {
	noWin := flag.Bool("nowindow", false, "serve the UI without opening a window (testing)")
	dataFlag := flag.String("data", "", "data directory override")
	flag.Parse()
	if c, err := net.DialTimeout("tcp", uiAddr, 300*time.Millisecond); err == nil { // single instance
		c.Close()
		if !*noWin {
			openWindow("http://"+uiAddr+"/", "launcher", 1280, 780)
		}
		return
	}
	a := &App{subs: map[chan []byte]bool{}, noWindow: *noWin}
	a.dataDir = *dataFlag
	if a.dataDir == "" {
		a.dataDir = filepath.Join(userData(), "ARVEX")
	}
	os.MkdirAll(a.dataDir, 0o755)
	a.loadSettings()
	a.loadInstalled()
	a.prog.Phase = "idle"
	ln, err := net.Listen("tcp", uiAddr)
	if err != nil {
		fmt.Println("launcher already running")
		return
	}
	go http.Serve(ln, a.routes())
	go a.refresh(true)
	if !*noWin {
		openWindow("http://"+uiAddr+"/", "launcher", 1280, 780)
	}
	fmt.Println("ARVEX launcher", launcherVersion, "on http://"+uiAddr, "data:", a.dataDir)
	select {}
}

func userData() string {
	if runtime.GOOS == "windows" {
		if v := os.Getenv("LOCALAPPDATA"); v != "" {
			return v
		}
	}
	if h, err := os.UserHomeDir(); err == nil {
		return filepath.Join(h, ".local", "share")
	}
	return "."
}

// ----------------------------------------------------------------- settings / installed state
func (a *App) loadSettings() {
	s := Settings{InstallDir: filepath.Join(a.dataDir, "Game"), AutoUpdate: true, Language: "ar", Server: defaultServer}
	if b, err := os.ReadFile(filepath.Join(a.dataDir, "settings.json")); err == nil {
		json.Unmarshal(b, &s)
	}
	if env := os.Getenv("ARVEX_SERVER"); env != "" {
		s.Server = env
	}
	s.Server = strings.TrimRight(s.Server, "/")
	if s.InstallDir == "" {
		s.InstallDir = filepath.Join(a.dataDir, "Game")
	}
	a.settings = s
}
func (a *App) saveSettings() { b, _ := json.MarshalIndent(a.settings, "", "  "); writeAtomic(filepath.Join(a.dataDir, "settings.json"), b) }
func (a *App) installedPath() string { return filepath.Join(a.settings.InstallDir, ".arvex", "installed.json") }
func (a *App) loadInstalled() {
	a.installed = nil
	if b, err := os.ReadFile(a.installedPath()); err == nil {
		var in Installed
		if json.Unmarshal(b, &in) == nil && in.Version != "" {
			a.installed = &in
		}
	}
}
func (a *App) stagingDir() string {
	if a.settings.DownloadDir != "" {
		return filepath.Join(a.settings.DownloadDir, "staging")
	}
	return filepath.Join(a.settings.InstallDir, ".arvex", "staging")
}
func writeAtomic(p string, b []byte) error {
	os.MkdirAll(filepath.Dir(p), 0o755)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// ----------------------------------------------------------------- server communication
var httpc = &http.Client{Timeout: 20 * time.Second}

func (a *App) getJSON(path string, v any) error {
	req, _ := http.NewRequest("GET", a.settings.Server+path, nil)
	req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
	r, err := httpc.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", r.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(v)
}

// refresh: latest manifest, news, servers. Works offline from cache.
func (a *App) refresh(boot bool) {
	var m Manifest
	err := a.getJSON("/launcher/manifest.json", &m)
	a.mu.Lock()
	if err != nil {
		a.online = false
		a.lastErr = err.Error()
		if b, e := os.ReadFile(filepath.Join(a.dataDir, "news-cache.json")); e == nil {
			a.news = b
		}
	} else {
		a.online = true
		a.lastErr = ""
		a.latest = &m
	}
	a.mu.Unlock()
	var news, srv json.RawMessage
	if a.getJSON("/api/news", &news) == nil {
		a.mu.Lock()
		a.news = news
		a.mu.Unlock()
		writeAtomic(filepath.Join(a.dataDir, "news-cache.json"), news)
	}
	if a.getJSON("/api/servers", &srv) == nil {
		a.mu.Lock()
		a.servers = srv
		a.mu.Unlock()
	}
	a.broadcastState()
	if boot && err == nil && a.settings.AutoUpdate && a.installed != nil && a.installed.Version != m.Version {
		go a.run("update")
	}
}

// ----------------------------------------------------------------- diffing
func fileSHA(p string) (string, int64, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, err
}

// changed returns files that must be downloaded. full=true hashes every file on disk (verify/repair).
func (a *App) changed(m *Manifest, full bool, onFile func(string, int, int)) (need []ManifestFile, bad []string) {
	for i, f := range m.Files {
		if onFile != nil {
			onFile(f.Path, i, len(m.Files))
		}
		p := filepath.Join(a.settings.InstallDir, filepath.FromSlash(f.Path))
		if !full && a.installed != nil && a.installed.Files[f.Path] == f.SHA256 {
			if st, err := os.Stat(p); err == nil && st.Size() == f.Size {
				continue // known-good, unchanged in this version
			}
		}
		sum, size, err := fileSHA(p)
		if err != nil {
			need = append(need, f)
			bad = append(bad, f.Path+" (missing)")
			continue
		}
		if size != f.Size || sum != f.SHA256 {
			need = append(need, f)
			bad = append(bad, f.Path+" (corrupted)")
		}
	}
	return
}

// ----------------------------------------------------------------- operations
func (a *App) setProg(fn func(p *Progress)) {
	a.mu.Lock()
	fn(&a.prog)
	a.mu.Unlock()
	a.broadcastState()
}

// run executes install|update|repair|verify in the background
func (a *App) run(op string) {
	if !a.busy.CompareAndSwap(false, true) {
		return
	}
	defer a.busy.Store(false)
	ctx, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	a.cancel = cancel
	a.mu.Unlock()
	a.paused.Store(false)
	err := a.doRun(ctx, op)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			a.setProg(func(p *Progress) { p.Phase = "idle"; p.Message = "cancelled"; p.Speed = 0 })
		} else {
			a.setProg(func(p *Progress) { p.Phase = "error"; p.Error = err.Error(); p.Speed = 0 })
		}
	}
}

func (a *App) doRun(ctx context.Context, op string) error {
	a.setProg(func(p *Progress) { *p = Progress{Phase: "checking", Op: op} })
	var m Manifest
	if err := a.getJSON("/launcher/manifest.json", &m); err != nil {
		a.mu.Lock()
		a.online = false
		a.mu.Unlock()
		a.setProg(func(p *Progress) { p.Phase = "offline"; p.Error = err.Error() })
		return nil
	}
	a.mu.Lock()
	a.latest = &m
	a.online = true
	a.mu.Unlock()
	full := op == "verify" || op == "repair"
	if full {
		a.setProg(func(p *Progress) { p.Phase = "verifying"; p.FilesTotal = len(m.Files) })
	}
	need, bad := a.changed(&m, full, func(f string, i, n int) {
		if full {
			a.setProg(func(p *Progress) { p.File = f; p.FilesDone = i; p.FilesTotal = n })
		}
	})
	if op == "verify" {
		res := "verify_ok"
		if len(bad) > 0 {
			res = "verify_bad"
		}
		a.setProg(func(p *Progress) { p.Phase = "done"; p.Result = res; p.Bad = bad; p.FilesDone = len(m.Files) })
		return nil
	}
	var total int64
	for _, f := range need {
		total += f.Size
	}
	a.setProg(func(p *Progress) {
		p.Phase = "downloading"; p.Total = total; p.Downloaded = 0; p.FilesTotal = len(need); p.FilesDone = 0; p.Bad = bad
	})
	a.speedWin = nil
	stage := a.stagingDir()
	os.MkdirAll(stage, 0o755)
	var done int64
	for i, f := range need {
		if err := ctx.Err(); err != nil {
			return err
		}
		a.setProg(func(p *Progress) { p.File = f.Path; p.FilesDone = i })
		if err := a.fetchFile(ctx, f, filepath.Join(stage, filepath.FromSlash(f.Path)), done); err != nil {
			return err
		}
		done += f.Size
	}
	// every staged file is verified; now install atomically with a backup for rollback
	a.setProg(func(p *Progress) { p.Phase = "installing"; p.FilesDone = len(need); p.Speed = 0; p.ETA = 0 })
	if err := a.commit(&m, need); err != nil {
		return fmt.Errorf("install failed, previous version restored: %w", err)
	}
	res := map[string]string{"install": "download_complete", "update": "update_complete", "repair": "repair_complete"}[op]
	a.setProg(func(p *Progress) { p.Phase = "done"; p.Result = res; p.Downloaded = p.Total; p.File = "" })
	return nil
}

// fetchFile downloads one file into staging with resume, retry, pause and speed limit, then verifies its hash
func (a *App) fetchFile(ctx context.Context, f ManifestFile, dst string, base int64) error {
	os.MkdirAll(filepath.Dir(dst), 0o755)
	if sum, size, err := fileSHA(dst); err == nil && size == f.Size && sum == f.SHA256 {
		a.addBytes(f.Size, base)
		return nil // already staged by an interrupted run
	}
	part := dst + ".part"
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		for a.paused.Load() {
			a.setProg(func(p *Progress) { p.Phase = "paused"; p.Speed = 0 })
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(200 * time.Millisecond):
			}
		}
		a.setProg(func(p *Progress) { p.Phase = "downloading"; p.Message = "" })
		err := a.download(ctx, f, part, base)
		if err == nil {
			sum, size, e := fileSHA(part)
			if e == nil && size == f.Size && sum == f.SHA256 {
				return os.Rename(part, dst)
			}
			os.Remove(part) // corrupted on the wire: start this file again
			err = fmt.Errorf("hash mismatch for %s", f.Path)
		}
		if errors.Is(err, context.Canceled) {
			return err
		}
		if errors.Is(err, errPaused) {
			continue
		}
		if attempt >= 8 {
			return fmt.Errorf("download failed: %s: %v", f.Path, err)
		}
		wait := time.Duration(1<<min(attempt, 4)) * time.Second
		a.setProg(func(p *Progress) {
			p.Message = fmt.Sprintf("reconnecting (%d) in %ds", attempt+1, int(wait.Seconds())); p.Speed = 0
		})
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

var errPaused = errors.New("paused")

func (a *App) download(ctx context.Context, f ManifestFile, part string, base int64) error {
	var have int64
	if st, err := os.Stat(part); err == nil {
		have = st.Size()
	}
	if have > f.Size {
		os.Remove(part)
		have = 0
	}
	a.addBytes(0, base+have)
	if have == f.Size {
		return nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", a.settings.Server+f.URL, nil)
	req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
	if have > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", have))
	}
	cl := &http.Client{} // no overall timeout for big files; stalls are caught below
	r, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	flags := os.O_CREATE | os.O_WRONLY
	switch r.StatusCode {
	case 206:
		flags |= os.O_APPEND
	case 200:
		flags |= os.O_TRUNC
		have = 0
		a.addBytes(0, base)
	default:
		return fmt.Errorf("HTTP %d", r.StatusCode)
	}
	out, err := os.OpenFile(part, flags, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	buf := make([]byte, 32*1024)
	for {
		if a.paused.Load() {
			return errPaused
		}
		n, rerr := r.Body.Read(buf)
		if lim := a.settings.SpeedLimit; lim > 0 && n > 0 { // pace by the bytes actually received
			time.Sleep(time.Duration(float64(n) / float64(lim*1024) * float64(time.Second)))
		}
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				return werr
			}
			have += int64(n)
			a.addBytes(int64(n), -1)
		}
		if rerr == io.EOF {
			return nil
		}
		if rerr != nil {
			return rerr
		}
	}
}

// addBytes records progress; abs >= 0 sets the absolute downloaded counter (resume)
func (a *App) addBytes(n int64, abs int64) {
	a.mu.Lock()
	now := time.Now()
	if abs >= 0 {
		a.prog.Downloaded = abs
	}
	a.prog.Downloaded += n
	if n > 0 {
		a.speedWin = append(a.speedWin, sample{now, n})
	}
	cut := now.Add(-3 * time.Second)
	i := 0
	for i < len(a.speedWin) && a.speedWin[i].t.Before(cut) {
		i++
	}
	a.speedWin = a.speedWin[i:]
	var sum int64
	for _, s := range a.speedWin {
		sum += s.n
	}
	if len(a.speedWin) > 0 {
		span := now.Sub(a.speedWin[0].t).Seconds()
		if span < 0.5 {
			span = 0.5
		}
		a.prog.Speed = float64(sum) / span
	}
	if a.prog.Speed > 0 {
		a.prog.ETA = float64(a.prog.Total-a.prog.Downloaded) / a.prog.Speed
	}
	last := a.lastBroadcast
	a.mu.Unlock()
	if time.Since(last) > 150*time.Millisecond {
		a.broadcastState()
	}
}

// commit moves verified staged files into the install dir; on any failure every replaced file is restored
func (a *App) commit(m *Manifest, need []ManifestFile) error {
	inst, stage := a.settings.InstallDir, a.stagingDir()
	backup := filepath.Join(inst, ".arvex", "backup")
	os.RemoveAll(backup)
	var moved []string
	rollback := func() {
		for _, p := range moved {
			dst := filepath.Join(inst, filepath.FromSlash(p))
			os.Remove(dst)
			b := filepath.Join(backup, filepath.FromSlash(p))
			if _, err := os.Stat(b); err == nil {
				os.Rename(b, dst)
			}
		}
	}
	for _, f := range need {
		src := filepath.Join(stage, filepath.FromSlash(f.Path))
		dst := filepath.Join(inst, filepath.FromSlash(f.Path))
		os.MkdirAll(filepath.Dir(dst), 0o755)
		if _, err := os.Stat(dst); err == nil {
			b := filepath.Join(backup, filepath.FromSlash(f.Path))
			os.MkdirAll(filepath.Dir(b), 0o755)
			if err := os.Rename(dst, b); err != nil {
				rollback()
				return err
			}
		}
		if err := os.Rename(src, dst); err != nil {
			if err2 := copyFile(src, dst); err2 != nil {
				rollback()
				return err2
			}
		}
		moved = append(moved, f.Path)
	}
	// remove files that belonged to the previous version and are no longer shipped
	keep := map[string]bool{}
	files := map[string]string{}
	for _, f := range m.Files {
		keep[f.Path] = true
		files[f.Path] = f.SHA256
	}
	if a.installed != nil {
		for p := range a.installed.Files {
			if !keep[p] {
				os.Remove(filepath.Join(inst, filepath.FromSlash(p)))
			}
		}
	}
	in := &Installed{Version: m.Version, Files: files, At: time.Now().Unix()}
	b, _ := json.MarshalIndent(in, "", " ")
	if err := writeAtomic(a.installedPath(), b); err != nil {
		rollback()
		return err
	}
	a.mu.Lock()
	a.installed = in
	a.mu.Unlock()
	os.RemoveAll(backup)
	os.RemoveAll(stage)
	return nil
}
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// ----------------------------------------------------------------- play: serve the installed game locally
func (a *App) play() error {
	if a.installed == nil {
		return errors.New("not installed")
	}
	if a.gameSrv == nil {
		ln, err := net.Listen("tcp", gameAddr)
		if err == nil {
			mux := http.NewServeMux()
			files := http.FileServer(http.Dir(a.settings.InstallDir))
			mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) { a.lastPing.Store(time.Now().Unix()); w.WriteHeader(204) })
			mux.HandleFunc("/__quit", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
			mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/.arvex") {
					http.NotFound(w, r)
					return
				}
				w.Header().Set("Cache-Control", "no-cache")
				files.ServeHTTP(w, r)
			})
			a.gameSrv = &http.Server{Handler: mux}
			go a.gameSrv.Serve(ln)
		}
	}
	if !a.noWindow {
		openWindow("http://"+gameAddr+"/index.html", "game", 1600, 900)
	}
	return nil
}

// ----------------------------------------------------------------- windows integration
func browserPaths() []string {
	pf, pf86, lad := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	return []string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`), filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`), filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`), filepath.Join(lad, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf, `BraveSoftware\Brave-Browser\Application\brave.exe`), filepath.Join(lad, `BraveSoftware\Brave-Browser\Application\brave.exe`),
	}
}
func openWindow(url, profile string, w, h int) {
	dir := filepath.Join(userData(), "ARVEX", "webview-"+profile)
	os.MkdirAll(dir, 0o755)
	args := []string{"--app=" + url, "--user-data-dir=" + dir, fmt.Sprintf("--window-size=%d,%d", w, h), "--no-first-run", "--no-default-browser-check",
		"--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--autoplay-policy=no-user-gesture-required"}
	if profile == "game" {
		args = append(args, "--start-maximized", "--disable-backgrounding-occluded-windows")
	}
	if runtime.GOOS == "windows" {
		for _, p := range browserPaths() {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				if exec.Command(p, args...).Start() == nil {
					return
				}
			}
		}
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
		return
	}
	for _, b := range []string{"microsoft-edge", "google-chrome", "chromium", "chromium-browser"} {
		if p, err := exec.LookPath(b); err == nil {
			if exec.Command(p, args...).Start() == nil {
				return
			}
		}
	}
	exec.Command("xdg-open", url).Start()
}
func setStartWithWindows(on bool) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	exe, _ := os.Executable()
	key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	if on {
		return exec.Command("reg", "add", key, "/v", "ARVEX", "/t", "REG_SZ", "/d", `"`+exe+`"`, "/f").Run()
	}
	exec.Command("reg", "delete", key, "/v", "ARVEX", "/f").Run()
	return nil
}
func openFolder(p string) {
	os.MkdirAll(p, 0o755)
	switch runtime.GOOS {
	case "windows":
		exec.Command("explorer", p).Start()
	case "darwin":
		exec.Command("open", p).Start()
	default:
		exec.Command("xdg-open", p).Start()
	}
}

// ----------------------------------------------------------------- state API + server-sent events
func (a *App) state() map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	st := map[string]any{"launcher": launcherVersion, "online": a.online, "error": a.lastErr, "settings": a.settings, "progress": a.prog, "busy": a.busy.Load(), "os": runtime.GOOS}
	if a.installed != nil {
		st["installed"] = a.installed.Version
	}
	if a.latest != nil {
		st["latest"] = a.latest.Version
		st["required"] = a.latest.Required
		st["gameSize"] = a.latest.Total
		// update size = bytes of files whose hash differs from the installed record (no disk hashing here)
		var upd int64
		n := 0
		for _, f := range a.latest.Files {
			if a.installed == nil || a.installed.Files[f.Path] != f.SHA256 {
				upd += f.Size
				n++
			}
		}
		st["updateSize"] = upd
		st["updateFiles"] = n
	}
	if a.news != nil {
		st["news"] = a.news
	}
	if a.servers != nil {
		st["servers"] = a.servers
	}
	return st
}
func (a *App) broadcastState() {
	b, _ := json.Marshal(a.state())
	a.mu.Lock()
	a.lastBroadcast = time.Now()
	for ch := range a.subs {
		select {
		case ch <- b:
		default:
		}
	}
	a.mu.Unlock()
}
func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(uiFS, "ui")
	mux.Handle("/", http.FileServer(http.FS(sub)))
	j := func(w http.ResponseWriter, v any) { w.Header().Set("Content-Type", "application/json"); w.Header().Set("Cache-Control", "no-store"); json.NewEncoder(w).Encode(v) }
	local := func(h http.HandlerFunc) http.HandlerFunc { // only the launcher page may drive the API
		return func(w http.ResponseWriter, r *http.Request) {
			if o := r.Header.Get("Origin"); o != "" && o != "http://"+uiAddr {
				http.Error(w, "forbidden", 403)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/api/state", local(func(w http.ResponseWriter, r *http.Request) { j(w, a.state()) }))
	mux.HandleFunc("/api/events", local(func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "no stream", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		ch := make(chan []byte, 8)
		a.mu.Lock()
		a.subs[ch] = true
		a.mu.Unlock()
		defer func() { a.mu.Lock(); delete(a.subs, ch); a.mu.Unlock() }()
		b, _ := json.Marshal(a.state())
		fmt.Fprintf(w, "data: %s\n\n", b)
		fl.Flush()
		tick := time.NewTicker(10 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case b := <-ch:
				fmt.Fprintf(w, "data: %s\n\n", b)
				fl.Flush()
			case <-tick.C:
				fmt.Fprint(w, ": keepalive\n\n")
				fl.Flush()
			}
		}
	}))
	act := func(name string, fn func(r *http.Request) error) {
		mux.HandleFunc("/api/"+name, local(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" {
				http.Error(w, "POST only", 405)
				return
			}
			if err := fn(r); err != nil {
				w.WriteHeader(400)
				j(w, map[string]string{"error": err.Error()})
				return
			}
			j(w, a.state())
		}))
	}
	for _, op := range []string{"install", "update", "repair", "verify"} {
		op := op
		act(op, func(r *http.Request) error {
			if a.busy.Load() {
				return errors.New("busy")
			}
			go a.run(op)
			return nil
		})
	}
	act("pause", func(r *http.Request) error { a.paused.Store(true); return nil })
	act("resume", func(r *http.Request) error { a.paused.Store(false); return nil })
	act("cancel", func(r *http.Request) error {
		a.mu.Lock()
		c := a.cancel
		a.mu.Unlock()
		a.paused.Store(false)
		if c != nil {
			c()
		}
		return nil
	})
	act("check", func(r *http.Request) error { go a.refresh(false); return nil })
	act("play", func(r *http.Request) error { return a.play() })
	act("dismiss", func(r *http.Request) error {
		a.setProg(func(p *Progress) {
			if p.Phase == "done" || p.Phase == "error" || p.Phase == "offline" {
				*p = Progress{Phase: "idle"}
			}
		})
		return nil
	})
	act("settings", func(r *http.Request) error {
		var s Settings
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&s); err != nil {
			return err
		}
		if a.busy.Load() && s.InstallDir != a.settings.InstallDir {
			return errors.New("can't move the install while downloading")
		}
		if s.InstallDir == "" {
			s.InstallDir = a.settings.InstallDir
		}
		if s.Server == "" {
			s.Server = a.settings.Server
		}
		s.Server = strings.TrimRight(s.Server, "/")
		if s.StartWithWin != a.settings.StartWithWin {
			setStartWithWindows(s.StartWithWin)
		}
		a.mu.Lock()
		a.settings = s
		a.mu.Unlock()
		a.saveSettings()
		a.loadInstalled()
		a.broadcastState()
		return nil
	})
	act("clear-cache", func(r *http.Request) error {
		if a.busy.Load() {
			return errors.New("busy")
		}
		os.RemoveAll(a.stagingDir())
		os.Remove(filepath.Join(a.dataDir, "news-cache.json"))
		os.RemoveAll(filepath.Join(a.settings.InstallDir, ".arvex", "backup"))
		return nil
	})
	act("open-folder", func(r *http.Request) error { openFolder(a.settings.InstallDir); return nil })
	act("quit", func(r *http.Request) error { go func() { time.Sleep(200 * time.Millisecond); os.Exit(0) }(); return nil })
	mux.HandleFunc("/api/files", local(func(w http.ResponseWriter, r *http.Request) { // used by the Download page file list
		a.mu.Lock()
		m := a.latest
		a.mu.Unlock()
		if m == nil {
			j(w, []any{})
			return
		}
		list := append([]ManifestFile(nil), m.Files...)
		sort.Slice(list, func(i, k int) bool { return list[i].Size > list[k].Size })
		j(w, list)
	}))
	return mux
}
