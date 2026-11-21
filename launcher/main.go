// ARVEX Launcher — a real game manager: knows what is installed, what the server offers, verifies and repairs files,
// downloads updates into staging (resume, retry, limits), installs them with a journal + rollback and only then launches.
// The UI is the shared ARVEX design system rendered in a chromeless Edge/Chrome window and talks to this process over 127.0.0.1.
package main

import (
	"bytes"
	"context"
	"embed"
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
	uiAddr        = "127.0.0.1:47330"
	gameAddr      = "127.0.0.1:47331"
	defaultServer = "https://emberwing.onrender.com"
	checkEvery    = 3 * time.Minute
)

// ----------------------------------------------------------------- data types
type Settings struct {
	InstallDir    string `json:"installDir"`
	DownloadDir   string `json:"downloadDir"`
	SpeedLimit    int64  `json:"speedLimitKB"` // 0 = unlimited
	Concurrent    int    `json:"concurrent"`   // parallel downloads, 1-6
	AutoUpdate    bool   `json:"autoUpdate"`
	AutoRepair    bool   `json:"autoRepair"`
	StartWithWin  bool   `json:"startWithWindows"`
	Language      string `json:"language"`
	Server        string `json:"server"`
	Channel       string `json:"channel"`
	CloseOnPlay   bool   `json:"closeOnPlay"`
	Notifications bool   `json:"notifications"`
	SendReports   bool   `json:"sendReports"`
	ConfigVersion int    `json:"configVersion"`
}

const settingsVersion = 2

type Progress struct {
	Phase      string      `json:"phase"` // idle|checking|downloading|paused|verifying|installing|done|error|offline
	Op         string      `json:"op"`    // install|update|repair|verify
	File       string      `json:"file"`
	Downloaded int64       `json:"downloaded"`
	Total      int64       `json:"total"`
	Speed      float64     `json:"speed"` // bytes/s
	ETA        float64     `json:"eta"`   // seconds
	FilesDone  int         `json:"filesDone"`
	FilesTotal int         `json:"filesTotal"`
	Message    string      `json:"message"`
	Error      *CodedError `json:"error,omitempty"`
	Result     string      `json:"result"` // download_complete|update_complete|repair_complete|verify_ok|verify_bad
	Bad        []string    `json:"bad,omitempty"`
}
type Installed struct {
	Version string            `json:"version"`
	BuildID string            `json:"buildId"`
	Channel string            `json:"channel"`
	Files   map[string]string `json:"files"` // path -> sha256
	At      int64             `json:"at"`
}

// RemoteConfig is the part of /api/config the launcher acts on. It only ever switches behaviour that already exists here.
type RemoteConfig struct {
	Maintenance struct {
		On          bool     `json:"on"`
		Message     []string `json:"message"`
		Until       int64    `json:"until"`
		BlockLaunch bool     `json:"blockLaunch"`
	} `json:"maintenance"`
	MinVersion  string `json:"minVersion"`
	ForceUpdate struct {
		On     bool     `json:"on"`
		Reason []string `json:"reason"`
	} `json:"forceUpdate"`
	Flags    map[string]bool `json:"flags"`
	Channels []string        `json:"channels"`
	Download struct {
		Concurrent int `json:"concurrent"`
	} `json:"download"`
}
type ticketRef struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Subject string `json:"subject"`
	At      int64  `json:"at"`
}

// ----------------------------------------------------------------- state
type App struct {
	mu            sync.Mutex
	dataDir       string
	log           *Logger
	settings      Settings
	installed     *Installed
	latest        *Manifest
	sigState      string // verified|unsigned
	remote        *RemoteConfig
	online        bool
	lastErr       *CodedError
	lastCheck     int64
	recovered     string
	prog          Progress
	busy          atomic.Bool
	paused        atomic.Bool
	cancel        context.CancelFunc
	subs          map[chan []byte]bool
	speedWin      []sample
	news          json.RawMessage
	servers       json.RawMessage
	changelog     json.RawMessage
	gameSrv       *http.Server
	lastPing      atomic.Int64
	noWindow      bool
	lastBroadcast time.Time
}
type sample struct {
	t time.Time
	n int64
}

func main() {
	noWin := flag.Bool("nowindow", false, "serve the UI without opening a window (testing)")
	dataFlag := flag.String("data", "", "data directory override")
	updated := flag.Bool("updated", false, "started by the self-updater (the window is already open)")
	winFlag := flag.String("window", "", "internal: run one native window (launcher|game)")
	winURL := flag.String("url", "", "internal: window URL")
	flag.Parse()
	if *winFlag != "" { // child process: one real Win32 window hosting WebView2
		title, w, h, mx := "ARVEX Launcher", 1280, 780, false
		if *winFlag == "game" {
			title, w, h, mx = "ARVEX SURVIVAL", 1600, 900, true
		}
		os.Exit(runNativeWindow(*winURL, *winFlag, title, w, h, mx))
	}
	if c, err := net.DialTimeout("tcp", uiAddr, 300*time.Millisecond); err == nil { // single instance: focus the running one
		c.Close()
		if !*noWin {
			r, err := http.Post("http://"+uiAddr+"/api/show", "application/json", nil)
			if err == nil {
				r.Body.Close()
			}
			if err != nil || r.StatusCode != 200 { // older launcher without /api/show
				openWindow("http://"+uiAddr+"/", "launcher", 1280, 780)
				time.Sleep(3 * time.Second)
			}
		}
		return
	}
	a := &App{subs: map[chan []byte]bool{}, noWindow: *noWin}
	a.dataDir = *dataFlag
	if a.dataDir == "" {
		a.dataDir = filepath.Join(userData(), "ARVEX")
	}
	os.MkdirAll(a.dataDir, 0o755)
	a.log = newLogger(filepath.Join(a.dataDir, "logs"))
	a.loadSettings()
	a.loadInstalled()
	a.prog.Phase = "idle"
	ln, err := net.Listen("tcp", uiAddr)
	if err != nil {
		a.log.Error("ARVEX-L001: cannot open %s: %v", uiAddr, err)
		fmt.Println("launcher already running")
		return
	}
	uiListener = ln
	a.log.Info("ARVEX launcher %s started · %s/%s · data %s · server %s", launcherVersion, runtime.GOOS, runtime.GOARCH, a.dataDir, a.settings.Server)
	a.recoverInterrupted()
	go cleanupOldExe()
	go http.Serve(ln, a.routes())
	go a.bootRefresh()
	if !*noWin && !*updated {
		openWindow("http://"+uiAddr+"/", "launcher", 1280, 780)
	}
	fmt.Println("ARVEX launcher", launcherVersion, "on http://"+uiAddr, "data:", a.dataDir)
	for { // exit once every native window is closed and nothing is downloading
		time.Sleep(2 * time.Second)
		if !*noWin && !*updated && nativeOpened.Load() && liveWindows.Load() == 0 && !a.busy.Load() {
			a.log.Info("all windows closed")
			os.Exit(0)
		}
	}
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
func (a *App) defaultSettings() Settings {
	return Settings{InstallDir: filepath.Join(a.dataDir, "Game"), Concurrent: 3, AutoUpdate: true, AutoRepair: true, Language: "ar", Server: defaultServer, Channel: "stable", Notifications: true, SendReports: true, ConfigVersion: settingsVersion}
}

// loadSettings tolerates a missing, old or corrupt settings file: bad values fall back to defaults, old files are migrated
func (a *App) loadSettings() {
	s := a.defaultSettings()
	if b, err := os.ReadFile(filepath.Join(a.dataDir, "settings.json")); err == nil {
		var raw map[string]json.RawMessage
		if json.Unmarshal(b, &raw) != nil || json.Unmarshal(b, &s) != nil {
			a.log.Warn("settings.json is corrupt; keeping a copy and starting from defaults")
			os.Rename(filepath.Join(a.dataDir, "settings.json"), filepath.Join(a.dataDir, "settings.corrupt.json"))
			s = a.defaultSettings()
		} else if s.ConfigVersion < settingsVersion { // v1 files did not have these keys: give them their defaults instead of zero values
			d := a.defaultSettings()
			for k, set := range map[string]func(){"concurrent": func() { s.Concurrent = d.Concurrent }, "autoRepair": func() { s.AutoRepair = d.AutoRepair }, "channel": func() { s.Channel = d.Channel }, "notifications": func() { s.Notifications = d.Notifications }, "sendReports": func() { s.SendReports = d.SendReports }} {
				if _, ok := raw[k]; !ok {
					set()
				}
			}
			s.ConfigVersion = settingsVersion
			a.log.Info("settings migrated to version %d", settingsVersion)
		}
	}
	if env := os.Getenv("ARVEX_SERVER"); env != "" {
		s.Server = env
	}
	a.settings = sanitizeSettings(s, a.defaultSettings())
}
func sanitizeSettings(s, d Settings) Settings {
	s.Server = strings.TrimRight(strings.TrimSpace(s.Server), "/")
	if !strings.HasPrefix(s.Server, "https://") && !strings.HasPrefix(s.Server, "http://127.0.0.1") && !strings.HasPrefix(s.Server, "http://localhost") {
		s.Server = d.Server // plain HTTP is only accepted for a local test server
	}
	if s.InstallDir == "" || !filepath.IsAbs(s.InstallDir) {
		s.InstallDir = d.InstallDir
	}
	if s.DownloadDir != "" && !filepath.IsAbs(s.DownloadDir) {
		s.DownloadDir = ""
	}
	if s.Concurrent < 1 || s.Concurrent > 6 {
		s.Concurrent = d.Concurrent
	}
	if s.SpeedLimit < 0 {
		s.SpeedLimit = 0
	}
	if s.Channel != "stable" && s.Channel != "beta" {
		s.Channel = "stable"
	}
	if s.Language != "en" {
		s.Language = "ar"
	}
	s.ConfigVersion = settingsVersion
	return s
}
func (a *App) saveSettings() {
	b, _ := json.MarshalIndent(a.settings, "", "  ")
	writeAtomic(filepath.Join(a.dataDir, "settings.json"), b)
}
func (a *App) installedPath() string {
	return filepath.Join(a.settings.InstallDir, ".arvex", "installed.json")
}
func (a *App) loadInstalled() {
	var in *Installed
	if b, err := os.ReadFile(a.installedPath()); err == nil {
		var v Installed
		if json.Unmarshal(b, &v) == nil && v.Version != "" && v.Files != nil {
			in = &v
		}
	}
	a.mu.Lock()
	a.installed = in
	a.mu.Unlock()
}
func (a *App) stagingDir() string {
	if a.settings.DownloadDir != "" {
		return filepath.Join(a.settings.DownloadDir, "arvex-staging")
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
var httpc = &http.Client{Timeout: 75 * time.Second} // a sleeping free-tier server needs about a minute to wake up

func (a *App) getJSON(path string, v any) error {
	req, _ := http.NewRequest("GET", a.settings.Server+path, nil)
	req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
	r, err := httpc.Do(req)
	if err != nil {
		return classifyNet(err)
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return statusCoded(r.StatusCode, path)
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(v); err != nil {
		return coded("U001", err, "%s returned data that is not valid JSON", path)
	}
	return nil
}
func (a *App) cache(name string, b []byte) { writeAtomic(filepath.Join(a.dataDir, "cache", name), b) }
func (a *App) cached(name string) []byte {
	b, _ := os.ReadFile(filepath.Join(a.dataDir, "cache", name))
	return b
}

// refresh asks the server for the release, remote config, news, patch notes and server list. Offline, the last answers are shown
// (clearly marked) but a cached manifest is never used to install anything.
func (a *App) refresh(auto bool) {
	m, sig, err := a.fetchManifest()
	a.mu.Lock()
	a.lastCheck = time.Now().Unix()
	if err != nil {
		ce := asCoded(err)
		a.lastErr = ce
		a.online = strings.HasPrefix(ce.Code, "ARVEX-U") // the server answered, but with something we refuse to use
		if !a.online {
			a.latest = nil
		}
		a.mu.Unlock()
		a.log.Warn("update check failed: %s", ce.Error())
	} else {
		a.online, a.lastErr, a.latest, a.sigState = true, nil, m, sig
		a.mu.Unlock()
	}
	var rc RemoteConfig
	if a.getJSON("/api/config", &rc) == nil {
		a.mu.Lock()
		a.remote = &rc
		a.mu.Unlock()
	}
	for _, src := range []struct {
		path, file string
		dst        *json.RawMessage
	}{{"/api/news", "news.json", &a.news}, {"/api/servers", "", &a.servers}, {"/api/versions", "versions.json", &a.changelog}} {
		var raw json.RawMessage
		if a.getJSON(src.path, &raw) == nil {
			a.mu.Lock()
			*src.dst = raw
			a.mu.Unlock()
			if src.file != "" {
				a.cache(src.file, raw)
			}
		} else if src.file != "" {
			if b := a.cached(src.file); b != nil {
				a.mu.Lock()
				*src.dst = b
				a.mu.Unlock()
			}
		}
	}
	a.broadcastState()
	a.mu.Lock()
	inst, autoUp := a.installed, a.settings.AutoUpdate
	a.mu.Unlock()
	if auto && err == nil && autoUp && inst != nil && inst.BuildID != m.BuildID && !a.gameRunning() {
		a.start("update")
	}
}

// ----------------------------------------------------------------- policy: may the installed game be launched right now?
type block struct {
	Code   string `json:"code"`
	Action string `json:"action"` // update|repair|install|wait|close
}

func (a *App) launchBlock() *block {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.installed == nil {
		return &block{"ARVEX-L002", "install"}
	}
	if a.remote != nil && a.remote.Maintenance.On && a.remote.Maintenance.BlockLaunch {
		return &block{"ARVEX-A001", "wait"}
	}
	if m := a.latest; m != nil && a.installed.BuildID != m.BuildID {
		if m.MinVersion != "" && cmpVersion(a.installed.Version, m.MinVersion) < 0 {
			return &block{"ARVEX-A003", "update"}
		}
		if m.Mandatory {
			return &block{"ARVEX-A002", "update"}
		}
	}
	return nil
}

// essentialsOK is the quick pre-launch check: the files without which the game cannot start must exist and match
func (a *App) essentialsOK() (bad []string) {
	a.mu.Lock()
	in, dir := a.installed, a.settings.InstallDir
	a.mu.Unlock()
	if in == nil {
		return []string{"installed.json"}
	}
	for _, p := range []string{"index.html", "game.js", "build.json", "style.css", "arvex.css"} {
		want, ok := in.Files[p]
		if !ok {
			continue
		}
		if sum, _, err := fileSHA(filepath.Join(dir, filepath.FromSlash(p))); err != nil || sum != want {
			bad = append(bad, p)
		}
	}
	for p := range in.Files { // every other file must at least exist
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(p))); err != nil {
			bad = append(bad, p)
		}
	}
	return
}

// ----------------------------------------------------------------- play: validate, then serve the installed game locally
func (a *App) play() error {
	if b := a.launchBlock(); b != nil {
		return &CodedError{Code: b.Code, Data: map[string]any{"action": b.Action}}
	}
	if a.busy.Load() {
		return coded("U004", nil, "wait for the current operation to finish")
	}
	if bad := a.essentialsOK(); len(bad) > 0 {
		a.log.Warn("launch validation failed: %d file(s), first %s", len(bad), bad[0])
		a.mu.Lock()
		auto := a.settings.AutoRepair && a.online
		a.mu.Unlock()
		ce := coded("F001", nil, "%d game file(s) are missing or damaged", len(bad))
		ce.Data = map[string]any{"action": "repair", "files": len(bad), "autoRepair": auto}
		if auto {
			a.start("repair")
		}
		return ce
	}
	if runtime.GOOS == "windows" && !a.noWindow && findBrowser() == "" {
		return coded("L003", nil, "Microsoft Edge or Google Chrome is required to show the game")
	}
	if a.gameSrv == nil {
		ln, err := net.Listen("tcp", gameAddr)
		if err != nil {
			return coded("L004", err, "the game is already running or port %s is in use", gameAddr)
		}
		mux := http.NewServeMux()
		files := http.FileServer(http.Dir(a.settings.InstallDir))
		mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) { a.lastPing.Store(time.Now().Unix()); w.WriteHeader(204) })
		mux.HandleFunc("/__quit", func(w http.ResponseWriter, r *http.Request) { a.lastPing.Store(0); w.WriteHeader(204) })
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
	a.mu.Lock()
	v, b := a.installed.Version, a.installed.BuildID
	a.mu.Unlock()
	a.log.Info("launching ARVEX %s (build %s)", v, b)
	if !a.noWindow {
		openWindow("http://"+gameAddr+"/index.html", "game", 1600, 900)
	}
	return nil
}

// uninstall removes the game files this launcher installed. Saves and settings live in the launcher's data folder and stay
// unless the user explicitly asks to delete them too.
func (a *App) uninstall(wipeUserData bool) error {
	if a.busy.Load() {
		return coded("U004", nil, "wait for the current operation to finish")
	}
	if a.gameRunning() {
		return coded("U007", nil, "close the game first")
	}
	release, err := a.acquireLock()
	if err != nil {
		return err
	}
	a.mu.Lock()
	in, dir := a.installed, a.settings.InstallDir
	a.mu.Unlock()
	if in != nil {
		for p := range in.Files {
			os.Remove(filepath.Join(dir, filepath.FromSlash(p)))
		}
	}
	release()
	os.RemoveAll(filepath.Join(dir, ".arvex"))
	removeEmptyDirs(dir)
	if wipeUserData {
		os.RemoveAll(filepath.Join(userData(), "ARVEX", "webview-game")) // browser profile that holds the solo saves and game settings
		os.RemoveAll(filepath.Join(userData(), "ARVEX", "wv2-game"))     // the same, for the native window
	}
	a.mu.Lock()
	a.installed = nil
	a.mu.Unlock()
	a.log.Info("game uninstalled from %s (user data wiped: %v)", dir, wipeUserData)
	return nil
}
func removeEmptyDirs(root string) {
	var dirs []string
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			dirs = append(dirs, p)
		}
		return nil
	})
	sort.Sort(sort.Reverse(sort.StringSlice(dirs)))
	for _, d := range dirs {
		os.Remove(d) // only succeeds when empty
	}
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
func findBrowser() string {
	for _, p := range browserPaths() {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

var liveWindows, nativeFailed atomic.Int32
var nativeOpened atomic.Bool

// openWindow opens the launcher or the game in a native window (own icon, title and taskbar entry).
// Falls back to a browser app window when the WebView2 runtime is missing.
func openWindow(url, profile string, w, h int) {
	if runtime.GOOS == "windows" && nativeFailed.Load() == 0 {
		if exe, err := os.Executable(); err == nil {
			cmd := exec.Command(exe, "-window", profile, "-url", url)
			if cmd.Start() == nil {
				done := make(chan int, 1)
				liveWindows.Add(1)
				go func() {
					cmd.Wait()
					liveWindows.Add(-1)
					done <- cmd.ProcessState.ExitCode()
				}()
				select {
				case code := <-done:
					if code != 3 {
						nativeOpened.Store(true)
						return
					}
					nativeFailed.Store(1)
				case <-time.After(2500 * time.Millisecond):
					nativeOpened.Store(true)
					return
				}
			}
		}
	}
	openBrowserWindow(url, profile, w, h)
}

func openBrowserWindow(url, profile string, w, h int) {
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
	blk := a.launchBlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	st := map[string]any{"launcher": launcherVersion, "online": a.online, "settings": a.settings, "progress": a.prog, "busy": a.busy.Load(), "os": runtime.GOOS,
		"gameRunning": a.gameRunning(), "lastCheck": a.lastCheck, "logsDir": filepath.Join(a.dataDir, "logs"), "block": blk, "recovered": a.recovered, "signingPinned": signingKey() != nil}
	if a.lastErr != nil {
		st["error"] = a.lastErr
	}
	if a.installed != nil {
		st["installed"], st["installedBuild"], st["installedAt"] = a.installed.Version, a.installed.BuildID, a.installed.At
	}
	if free, total, ok := diskFree(existingParent(a.settings.InstallDir)); ok {
		st["disk"] = map[string]uint64{"free": free, "total": total}
	}
	if a.remote != nil {
		st["remote"] = a.remote
	}
	if m := a.latest; m != nil {
		st["latest"], st["latestBuild"], st["channel"], st["releaseDate"] = m.Version, m.BuildID, m.Channel, m.ReleaseDate
		st["mandatory"], st["minVersion"], st["gameSize"], st["signature"] = m.Mandatory, m.MinVersion, m.Total, a.sigState
		st["required"] = m.Mandatory // kept for older UI builds
		if m.ReleaseNotes != nil {
			st["releaseNotes"] = m.ReleaseNotes
		}
		// update size = what would travel for files whose hash differs from the installed record (no disk hashing here)
		var wire, full int64
		n := 0
		for _, f := range m.Files {
			if a.installed == nil || a.installed.Files[f.Path] != f.SHA256 {
				_, sz, _ := f.transfer()
				wire += sz
				full += f.Size
				n++
			}
		}
		st["updateSize"], st["updateSizeOnDisk"], st["updateFiles"] = wire, full, n
		st["updateAvailable"] = a.installed != nil && a.installed.BuildID != m.BuildID
	}
	for k, v := range map[string]json.RawMessage{"news": a.news, "servers": a.servers, "versions": a.changelog} {
		if v != nil {
			st[k] = v
		}
	}
	return st
}

// existingParent walks up until a directory exists, so free space can be reported before the first install
func existingParent(p string) string {
	for i := 0; i < 16; i++ {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
		n := filepath.Dir(p)
		if n == p {
			break
		}
		p = n
	}
	return p
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

// ----------------------------------------------------------------- support tickets (stored locally as id + private key)
func (a *App) ticketsPath() string { return filepath.Join(a.dataDir, "tickets.json") }
func (a *App) loadTickets() []ticketRef {
	var t []ticketRef
	if b, err := os.ReadFile(a.ticketsPath()); err == nil {
		json.Unmarshal(b, &t)
	}
	return t
}
func (a *App) serverJSON(method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, method, a.settings.Server+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
	r, err := httpc.Do(req)
	if err != nil {
		return classifyNet(err)
	}
	defer r.Body.Close()
	if r.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
		}
		json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&e)
		if r.StatusCode == 429 {
			return coded("N004", nil, "too many requests, try again in a few minutes")
		}
		return coded("S001", nil, "%s", e.Message)
	}
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(out)
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(uiFS, "ui")
	mux.Handle("/", http.FileServer(http.FS(sub)))
	j := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(v)
	}
	local := func(h http.HandlerFunc) http.HandlerFunc { // only the launcher page itself may drive this API
		return func(w http.ResponseWriter, r *http.Request) {
			if o := r.Header.Get("Origin"); o != "" && o != "http://"+uiAddr {
				http.Error(w, "forbidden", 403)
				return
			}
			if r.Host != uiAddr { // DNS-rebinding guard
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
	act := func(name string, fn func(r *http.Request) (any, error)) {
		mux.HandleFunc("/api/"+name, local(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" {
				http.Error(w, "POST only", 405)
				return
			}
			out, err := fn(r)
			if err != nil {
				ce := asCoded(err)
				if !errors.As(err, new(*CodedError)) {
					ce = coded("L000", err, "%s", trimErr(err))
				}
				w.WriteHeader(400)
				j(w, map[string]any{"error": ce})
				return
			}
			if out == nil {
				out = a.state()
			}
			j(w, out)
		}))
	}
	for _, op := range []string{"install", "update", "repair", "verify"} {
		op := op
		act(op, func(r *http.Request) (any, error) {
			if op != "verify" && a.gameRunning() {
				return nil, coded("U007", nil, "close the game before changing its files")
			}
			if !a.start(op) {
				return nil, coded("U004", nil, "another operation is already running")
			}
			return nil, nil
		})
	}
	act("pause", func(r *http.Request) (any, error) { a.paused.Store(true); return nil, nil })
	act("resume", func(r *http.Request) (any, error) { a.paused.Store(false); return nil, nil })
	act("cancel", func(r *http.Request) (any, error) {
		a.mu.Lock()
		c := a.cancel
		a.mu.Unlock()
		a.paused.Store(false)
		if c != nil {
			c()
		}
		return nil, nil
	})
	act("check", func(r *http.Request) (any, error) { go a.refresh(false); return nil, nil })
	act("play", func(r *http.Request) (any, error) { return nil, a.play() })
	act("show", func(r *http.Request) (any, error) {
		go openWindow("http://"+uiAddr+"/", "launcher", 1280, 780)
		return nil, nil
	})
	act("dismiss", func(r *http.Request) (any, error) {
		a.mu.Lock()
		a.recovered = ""
		a.mu.Unlock()
		a.setProg(func(p *Progress) {
			if p.Phase == "done" || p.Phase == "error" || p.Phase == "offline" || p.Phase == "idle" {
				*p = Progress{Phase: "idle"}
			}
		})
		return nil, nil
	})
	act("settings", func(r *http.Request) (any, error) {
		a.mu.Lock()
		s := a.settings
		a.mu.Unlock()
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&s); err != nil {
			return nil, coded("L005", err, "settings were not understood")
		}
		a.mu.Lock()
		old := a.settings
		a.mu.Unlock()
		if a.busy.Load() && (s.InstallDir != old.InstallDir || s.DownloadDir != old.DownloadDir || s.Channel != old.Channel || s.Server != old.Server) {
			return nil, coded("U004", nil, "wait for the current operation before changing folders, channel or server")
		}
		s = sanitizeSettings(s, a.defaultSettings())
		if s.StartWithWin != old.StartWithWin {
			setStartWithWindows(s.StartWithWin)
		}
		a.mu.Lock()
		a.settings = s
		a.mu.Unlock()
		a.saveSettings()
		a.loadInstalled()
		if s.Channel != old.Channel || s.Server != old.Server || s.InstallDir != old.InstallDir {
			go a.refresh(false)
		}
		a.broadcastState()
		return nil, nil
	})
	act("reset", func(r *http.Request) (any, error) { // back to defaults; the installed game and its saves are not touched
		if a.busy.Load() {
			return nil, coded("U004", nil, "wait for the current operation to finish")
		}
		a.mu.Lock()
		keep := a.settings.InstallDir
		a.settings = a.defaultSettings()
		a.settings.InstallDir = keep
		a.mu.Unlock()
		setStartWithWindows(false)
		a.saveSettings()
		os.RemoveAll(filepath.Join(a.dataDir, "cache"))
		a.log.Info("launcher settings reset to defaults")
		go a.refresh(false)
		return nil, nil
	})
	act("clear-cache", func(r *http.Request) (any, error) {
		if a.busy.Load() {
			return nil, coded("U004", nil, "wait for the current operation to finish")
		}
		os.RemoveAll(a.stagingDir())
		os.RemoveAll(filepath.Join(a.dataDir, "cache"))
		if _, err := os.Stat(a.journalPath()); err != nil { // never drop the backup of an install that still needs recovery
			os.RemoveAll(a.backupDir())
		}
		return nil, nil
	})
	act("uninstall", func(r *http.Request) (any, error) {
		var b struct {
			WipeUserData bool `json:"wipeUserData"`
			Confirm      bool `json:"confirm"`
		}
		json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&b)
		if !b.Confirm {
			return nil, coded("L005", nil, "confirmation is required")
		}
		return nil, a.uninstall(b.WipeUserData)
	})
	act("open-folder", func(r *http.Request) (any, error) { openFolder(a.settings.InstallDir); return nil, nil })
	act("open-logs", func(r *http.Request) (any, error) { openFolder(filepath.Join(a.dataDir, "logs")); return nil, nil })
	act("ticket", func(r *http.Request) (any, error) {
		var b map[string]any
		if json.NewDecoder(io.LimitReader(r.Body, 1<<15)).Decode(&b) != nil {
			return nil, coded("L005", nil, "the form was not understood")
		}
		a.mu.Lock()
		b["launcher"], b["os"] = launcherVersion, runtime.GOOS
		if a.installed != nil {
			b["version"], b["build"] = a.installed.Version, a.installed.BuildID
		}
		if a.prog.Error != nil {
			b["code"] = a.prog.Error.Code
		} else if a.lastErr != nil {
			b["code"] = a.lastErr.Code
		}
		a.mu.Unlock()
		var out ticketRef
		if err := a.serverJSON("POST", "/api/tickets", b, &out); err != nil {
			return nil, err
		}
		out.Subject, _ = b["subject"].(string)
		out.At = time.Now().Unix()
		list := append(a.loadTickets(), out)
		if len(list) > 20 {
			list = list[len(list)-20:]
		}
		tb, _ := json.Marshal(list)
		writeAtomic(a.ticketsPath(), tb)
		return map[string]any{"id": out.ID}, nil
	})
	act("ticket-reply", func(r *http.Request) (any, error) {
		var b struct{ ID, Message string }
		json.NewDecoder(io.LimitReader(r.Body, 1<<15)).Decode(&b)
		for _, t := range a.loadTickets() {
			if t.ID == b.ID {
				var out json.RawMessage
				err := a.serverJSON("POST", "/api/tickets/"+t.ID+"/reply?key="+t.Key, map[string]string{"message": b.Message}, &out)
				return out, err
			}
		}
		return nil, coded("S001", nil, "ticket not found on this computer")
	})
	mux.HandleFunc("/api/tickets", local(func(w http.ResponseWriter, r *http.Request) { // each stored ticket with its current thread
		out := []json.RawMessage{}
		for _, t := range a.loadTickets() {
			var raw json.RawMessage
			if a.serverJSON("GET", "/api/tickets/"+t.ID+"?key="+t.Key, nil, &raw) == nil {
				out = append(out, raw)
			}
		}
		j(w, out)
	}))
	act("quit", func(r *http.Request) (any, error) {
		a.log.Info("launcher closed by the user")
		go func() { time.Sleep(200 * time.Millisecond); os.Exit(0) }()
		return nil, nil
	})
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
