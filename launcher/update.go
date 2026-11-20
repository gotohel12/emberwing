package main

// The update engine: check → download (staging, resume, retry, limits) → verify → install (journaled, rollback) → verify again → clean up.
// The installed game is never left half-updated: either the previous files are restored or the new ones are complete.

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxAttempts   = 8
	stallTimeout  = 45 * time.Second
	diskMargin    = 32 << 20
	lockStale     = 2 * time.Minute
	gameAliveSecs = 15
)

var (
	errPaused  = errors.New("paused")
	errStalled = errors.New("stalled")
)

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

// ----------------------------------------------------------------- manifest fetch (validated + signature checked)
func (a *App) fetchManifest() (*Manifest, string, error) {
	var m Manifest
	if err := a.getJSON("/launcher/manifest.json?channel="+a.settings.Channel, &m); err != nil {
		return nil, "", err
	}
	if err := m.validate(); err != nil {
		return nil, "", err
	}
	sig, err := a.verifySignature(&m)
	if err != nil {
		return nil, "", err
	}
	return &m, sig, nil
}

// changed returns the files that must be downloaded. full=true hashes every file on disk (verify / repair).
func (a *App) changed(m *Manifest, full bool, onFile func(string, int, int)) (need []ManifestFile, bad []string) {
	for i, f := range m.Files {
		if onFile != nil {
			onFile(f.Path, i, len(m.Files))
		}
		p := filepath.Join(a.settings.InstallDir, filepath.FromSlash(f.Path))
		if !full && a.installed != nil && a.installed.Files[f.Path] == f.SHA256 {
			if st, err := os.Stat(p); err == nil && st.Size() == f.Size {
				continue // known-good, unchanged in this release
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

// ----------------------------------------------------------------- install lock (one update per install directory)
type lockInfo struct {
	PID       int   `json:"pid"`
	Heartbeat int64 `json:"heartbeat"`
}

func (a *App) lockPath() string { return filepath.Join(a.settings.InstallDir, ".arvex", "update.lock") }
func (a *App) acquireLock() (release func(), err error) {
	p := a.lockPath()
	os.MkdirAll(filepath.Dir(p), 0o755)
	write := func() { b, _ := json.Marshal(lockInfo{os.Getpid(), time.Now().Unix()}); os.WriteFile(p, b, 0o644) }
	f, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if e != nil {
		var li lockInfo
		if b, re := os.ReadFile(p); re == nil {
			json.Unmarshal(b, &li)
		}
		if li.PID != os.Getpid() && processAlive(li.PID) && time.Since(time.Unix(li.Heartbeat, 0)) < lockStale { // a dead or silent owner does not hold the lock
			return nil, coded("U004", nil, "another ARVEX launcher (process %d) is updating this folder", li.PID)
		}
		a.log.Warn("taking over a stale update lock left by process %d", li.PID)
	} else {
		f.Close()
	}
	write()
	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				write()
			}
		}
	}()
	return func() { close(stop); os.Remove(p) }, nil
}

// ----------------------------------------------------------------- journal: lets the next start undo an install that was cut short
type journal struct {
	Op      string   `json:"op"`
	BuildID string   `json:"buildId"`
	Version string   `json:"version"`
	Phase   string   `json:"phase"` // committing
	Started int64    `json:"started"`
	Replace []string `json:"replace"` // files moved into the install dir
	Remove  []string `json:"remove"`  // files of the old release that the new one drops
}

func (a *App) journalPath() string {
	return filepath.Join(a.settings.InstallDir, ".arvex", "journal.json")
}
func (a *App) backupDir() string { return filepath.Join(a.settings.InstallDir, ".arvex", "backup") }

// restoreBackup puts every backed-up file back and removes files the interrupted install had added
func (a *App) restoreBackup(j *journal) {
	inst, backup := a.settings.InstallDir, a.backupDir()
	known := map[string]bool{}
	if a.installed != nil {
		for p := range a.installed.Files {
			known[p] = true
		}
	}
	for _, p := range append(append([]string{}, j.Replace...), j.Remove...) {
		dst, b := filepath.Join(inst, filepath.FromSlash(p)), filepath.Join(backup, filepath.FromSlash(p))
		if _, err := os.Stat(b); err == nil {
			os.Remove(dst)
			os.MkdirAll(filepath.Dir(dst), 0o755)
			os.Rename(b, dst)
		} else if !known[p] {
			os.Remove(dst) // a file the new release added
		}
	}
	os.RemoveAll(backup)
	os.Remove(a.journalPath())
}

// recoverInterrupted runs at start-up and before every operation
func (a *App) recoverInterrupted() bool {
	b, err := os.ReadFile(a.journalPath())
	if err != nil {
		return false
	}
	var j journal
	if json.Unmarshal(b, &j) != nil {
		os.Remove(a.journalPath())
		return false
	}
	a.log.Warn("found an interrupted %s to %s (build %s); restoring the previous files", j.Op, j.Version, j.BuildID)
	a.restoreBackup(&j)
	a.loadInstalled()
	a.mu.Lock()
	a.recovered = fmt.Sprintf("%s → %s", j.Op, j.Version)
	a.mu.Unlock()
	a.report("launcher", map[string]any{"code": "ARVEX-U010", "message": "recovered an interrupted " + j.Op, "severity": "low"})
	return true
}

// ----------------------------------------------------------------- operations
func (a *App) setProg(fn func(p *Progress)) {
	a.mu.Lock()
	fn(&a.prog)
	a.mu.Unlock()
	a.broadcastState()
}
func (a *App) gameRunning() bool { return time.Now().Unix()-a.lastPing.Load() < gameAliveSecs }

// start claims the single operation slot and runs install|update|repair|verify in the background.
// The slot and the "checking" state are set before it returns, so the very next state read already shows the operation.
func (a *App) start(op string) bool {
	if !a.busy.CompareAndSwap(false, true) {
		return false
	}
	a.setProg(func(p *Progress) { *p = Progress{Phase: "checking", Op: op} })
	go a.run(op)
	return true
}

func (a *App) run(op string) {
	defer func() { a.busy.Store(false); a.broadcastState() }()
	ctx, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	a.cancel = cancel
	from := ""
	if a.installed != nil {
		from = a.installed.Version
	}
	a.mu.Unlock()
	a.paused.Store(false)
	a.log.Info("%s started (installed %q)", op, from)
	var err error
	for attempt := 0; attempt < 3; attempt++ { // a release published mid-download restarts the run with the new manifest
		err = a.doRun(ctx, op)
		var ce *CodedError
		if errors.As(err, &ce) && ce.Code == "ARVEX-U008" {
			a.log.Warn("release changed during %s, restarting with the new manifest", op)
			continue
		}
		break
	}
	cancel()
	to := ""
	a.mu.Lock()
	if a.installed != nil {
		to = a.installed.Version
	}
	a.mu.Unlock()
	a.mu.Lock()
	result, phase := a.prog.Result, a.prog.Phase
	a.mu.Unlock()
	switch {
	case err == nil:
		a.log.Info("%s finished (%s)", op, result)
		if op != "verify" && phase == "done" {
			a.report("update", map[string]any{"ok": true, "op": op, "from": from, "to": to, "version": to})
		}
	case errors.Is(err, context.Canceled):
		a.log.Info("%s cancelled by the user", op)
		a.setProg(func(p *Progress) { *p = Progress{Phase: "idle", Message: "cancelled"} })
	default:
		ce := asCoded(err)
		a.log.Error("%s failed: %s", op, ce.Error())
		a.setProg(func(p *Progress) { p.Phase = "error"; p.Error = ce; p.Speed = 0 })
		a.report("update", map[string]any{"ok": false, "op": op, "from": from, "to": to, "code": ce.Code, "message": ce.Detail, "severity": "medium"})
	}
}

func (a *App) doRun(ctx context.Context, op string) error {
	a.setProg(func(p *Progress) { *p = Progress{Phase: "checking", Op: op} })
	if op != "verify" && a.gameRunning() {
		return coded("U007", nil, "close the game before updating its files")
	}
	a.recoverInterrupted()
	m, sig, err := a.fetchManifest()
	if err != nil {
		ce := asCoded(err)
		if ce.Code[:7] == "ARVEX-N" {
			a.mu.Lock()
			a.online = false
			a.mu.Unlock()
			a.setProg(func(p *Progress) { p.Phase = "offline"; p.Error = ce })
			return nil
		}
		return err
	}
	a.mu.Lock()
	a.latest, a.sigState, a.online = m, sig, true
	a.mu.Unlock()
	full := op == "verify" || op == "repair"
	if full {
		a.setProg(func(p *Progress) { p.Phase = "verifying"; p.FilesTotal = len(m.Files) })
	}
	need, bad := a.changed(m, full, func(f string, i, n int) {
		if full && i%4 == 0 {
			a.setProg(func(p *Progress) { p.File = f; p.FilesDone = i; p.FilesTotal = n })
		}
	})
	if op == "verify" {
		res := "verify_ok"
		if len(bad) > 0 {
			res = "verify_bad"
		}
		a.log.Info("verify: %d of %d files need repair", len(bad), len(m.Files))
		a.setProg(func(p *Progress) { p.Phase = "done"; p.Result = res; p.Bad = bad; p.FilesDone = len(m.Files) })
		return nil
	}
	release, err := a.acquireLock()
	if err != nil {
		return err
	}
	defer release()
	var total, unpacked int64
	for _, f := range need {
		_, sz, _ := f.transfer()
		total += sz
		unpacked += f.Size
	}
	// disk space: compressed parts + unpacked staging + a backup of what gets replaced, plus a margin
	stage := a.stagingDir()
	os.MkdirAll(stage, 0o755)
	os.MkdirAll(a.settings.InstallDir, 0o755)
	required := uint64(total + unpacked*2 + diskMargin)
	for _, dir := range []string{stage, a.settings.InstallDir} {
		if free, _, ok := diskFree(dir); ok && free < required {
			ce := coded("F002", nil, "not enough free disk space in %s", dir)
			ce.Data = map[string]any{"required": required, "available": free, "path": dir}
			return ce
		}
	}
	a.setProg(func(p *Progress) {
		p.Phase, p.Total, p.Downloaded, p.FilesTotal, p.FilesDone, p.Bad = "downloading", total, 0, len(need), 0, bad
	})
	a.mu.Lock()
	a.speedWin = nil
	workers := a.settings.Concurrent
	a.mu.Unlock()
	if err := a.downloadAll(ctx, need, stage, workers); err != nil {
		return err
	}
	// every staged file has been hashed; now install with a journal + backup so a crash or failure can be undone
	a.setProg(func(p *Progress) {
		p.Phase = "installing"
		p.FilesDone = len(need)
		p.Speed = 0
		p.ETA = 0
		p.File = ""
	})
	if a.gameRunning() {
		return coded("U007", nil, "close the game before installing the update")
	}
	if err := a.commit(m, need, op); err != nil {
		return err
	}
	res := map[string]string{"install": "download_complete", "update": "update_complete", "repair": "repair_complete"}[op]
	a.setProg(func(p *Progress) { p.Phase = "done"; p.Result = res; p.Downloaded = p.Total; p.File = "" })
	return nil
}

// ----------------------------------------------------------------- downloads
type limiter struct {
	mu   sync.Mutex
	next time.Time
}

// wait paces all workers together so the user's limit is the total, not per connection
func (l *limiter) wait(n int, kbps int64) {
	if kbps <= 0 || n <= 0 {
		return
	}
	l.mu.Lock()
	now := time.Now()
	if l.next.Before(now) {
		l.next = now
	}
	l.next = l.next.Add(time.Duration(float64(n) / float64(kbps*1024) * float64(time.Second)))
	d := l.next.Sub(now)
	l.mu.Unlock()
	if d > 0 {
		time.Sleep(d)
	}
}

func (a *App) downloadAll(ctx context.Context, need []ManifestFile, stage string, workers int) error {
	if workers < 1 {
		workers = 1
	}
	if workers > 6 {
		workers = 6
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan ManifestFile)
	var wg sync.WaitGroup
	var firstErr error
	var once sync.Once
	var done atomic.Int32
	lim := &limiter{}
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range jobs {
				if ctx.Err() != nil {
					continue
				}
				if err := a.fetchFile(ctx, f, filepath.Join(stage, filepath.FromSlash(f.Path)), lim); err != nil {
					once.Do(func() { firstErr = err; cancel() })
					continue
				}
				n := int(done.Add(1))
				a.setProg(func(p *Progress) { p.FilesDone = n })
			}
		}()
	}
	for _, f := range need {
		select {
		case jobs <- f:
		case <-ctx.Done():
		}
	}
	close(jobs)
	wg.Wait()
	return firstErr
}

// fetchFile downloads one file into staging with resume, retry with backoff, pause and the shared speed limit, then verifies its hash
func (a *App) fetchFile(ctx context.Context, f ManifestFile, dst string, lim *limiter) error {
	os.MkdirAll(filepath.Dir(dst), 0o755)
	url, wire, gz := f.transfer()
	if sum, size, err := fileSHA(dst); err == nil && size == f.Size && sum == f.SHA256 {
		a.addBytes(wire)
		return nil // already staged by an interrupted run
	}
	part := dst + ".part"
	var counted int64 // bytes of this file already added to the progress counter
	uncount := func() { a.addBytes(-counted); counted = 0 }
	for attempt := 0; ; attempt++ {
		for a.paused.Load() {
			a.setProg(func(p *Progress) { p.Phase = "paused"; p.Speed = 0 })
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(200 * time.Millisecond):
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		a.setProg(func(p *Progress) { p.Phase = "downloading"; p.Message = ""; p.File = f.Path })
		err := a.download(ctx, url, wire, part, lim, &counted)
		if err == nil {
			err = a.finishPart(part, dst, f, gz)
			if err == nil {
				return nil
			}
			os.Remove(part) // corrupted on the wire or on disk: this file starts again
			uncount()
		}
		if errors.Is(err, context.Canceled) {
			return err
		}
		if errors.Is(err, errPaused) {
			attempt--
			continue
		}
		ce := asCoded(err)
		var hs *httpStatusError
		if errors.As(err, &hs) {
			ce = statusCoded(hs.Status, f.Path)
		}
		if !retryable(ce) || attempt >= maxAttempts-1 {
			ce.Detail = f.Path + ": " + ce.Detail
			return ce
		}
		wait := time.Duration(1<<min(attempt, 4)) * time.Second
		a.log.Warn("download of %s failed (%s), retry %d in %s", f.Path, ce.Error(), attempt+1, wait)
		a.setProg(func(p *Progress) { p.Message = fmt.Sprintf("retry:%d:%d", attempt+1, int(wait.Seconds())); p.Speed = 0 })
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

// finishPart turns a completed .part into the staged file (inflating it when it travelled gzip-compressed) and checks the hash
func (a *App) finishPart(part, dst string, f ManifestFile, gz bool) error {
	tmp := dst + ".tmp"
	if gz {
		in, err := os.Open(part)
		if err != nil {
			return coded("F003", err, "cannot read the downloaded data")
		}
		zr, err := gzip.NewReader(in)
		if err != nil {
			in.Close()
			return coded("U003", err, "compressed data is damaged")
		}
		out, err := os.Create(tmp)
		if err != nil {
			in.Close()
			return coded("F003", err, "cannot write into the download folder")
		}
		_, cerr := io.Copy(out, io.LimitReader(zr, f.Size+1))
		out.Close()
		in.Close()
		if cerr != nil {
			os.Remove(tmp)
			return coded("U003", cerr, "compressed data is damaged")
		}
	} else if err := os.Rename(part, tmp); err != nil {
		return coded("F003", err, "cannot write into the download folder")
	}
	sum, size, err := fileSHA(tmp)
	if err != nil || size != f.Size || sum != f.SHA256 {
		os.Remove(tmp)
		return coded("U003", nil, "the downloaded file does not match its SHA-256")
	}
	if err := os.Rename(tmp, dst); err != nil {
		return coded("F003", err, "cannot write into the download folder")
	}
	if gz {
		os.Remove(part)
	}
	return nil
}

var dlClient = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 60 * time.Second, DisableCompression: true, MaxIdleConnsPerHost: 6}}

func (a *App) download(ctx context.Context, url string, wire int64, part string, lim *limiter, counted *int64) error {
	var have int64
	if st, err := os.Stat(part); err == nil {
		have = st.Size()
	}
	if have > wire {
		os.Remove(part)
		have = 0
	}
	a.addBytes(have - *counted) // a resumed part counts as already downloaded
	*counted = have
	if have == wire {
		return nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", a.settings.Server+url, nil)
	req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
	if have > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", have))
	}
	r, err := dlClient.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	flags := os.O_CREATE | os.O_WRONLY
	switch r.StatusCode {
	case 206:
		flags |= os.O_APPEND
	case 200: // the server ignored the range: start this file over
		flags |= os.O_TRUNC
		a.addBytes(-*counted)
		*counted, have = 0, 0
	case 416:
		os.Remove(part)
		a.addBytes(-*counted)
		*counted = 0
		return &httpStatusError{416}
	default:
		return &httpStatusError{r.StatusCode}
	}
	out, err := os.OpenFile(part, flags, 0o644)
	if err != nil {
		return coded("F003", err, "cannot write into the download folder")
	}
	defer out.Close()
	stalled := atomic.Bool{}
	watchdog := time.AfterFunc(stallTimeout, func() { stalled.Store(true); cancel() }) // no bytes for too long = dead connection
	defer watchdog.Stop()
	buf := make([]byte, 64*1024)
	for {
		if a.paused.Load() {
			return errPaused
		}
		n, rerr := r.Body.Read(buf)
		if n > 0 {
			watchdog.Reset(stallTimeout)
			if _, werr := out.Write(buf[:n]); werr != nil {
				return coded("F002", werr, "writing the download failed (disk full?)")
			}
			have += int64(n)
			*counted += int64(n)
			a.addBytes(int64(n))
			a.mu.Lock()
			kb := a.settings.SpeedLimit
			a.mu.Unlock()
			lim.wait(n, kb)
		}
		if rerr == io.EOF {
			if have != wire {
				return coded("U003", nil, "the server closed the connection early")
			}
			return nil
		}
		if rerr != nil {
			if stalled.Load() {
				return errStalled
			}
			return rerr
		}
	}
}

// addBytes records download progress and keeps a 3-second window for the speed / ETA numbers
func (a *App) addBytes(n int64) {
	a.mu.Lock()
	now := time.Now()
	a.prog.Downloaded += n
	if a.prog.Downloaded < 0 {
		a.prog.Downloaded = 0
	}
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

// ----------------------------------------------------------------- install
// commit moves the verified staged files into the install directory. A journal is written first; if anything fails
// (or the process dies) every touched file is restored from the backup. After the move every file is hashed again.
func (a *App) commit(m *Manifest, need []ManifestFile, op string) error {
	inst, stage, backup := a.settings.InstallDir, a.stagingDir(), a.backupDir()
	os.RemoveAll(backup)
	keep, files := map[string]bool{}, map[string]string{}
	for _, f := range m.Files {
		keep[f.Path], files[f.Path] = true, f.SHA256
	}
	j := journal{Op: op, BuildID: m.BuildID, Version: m.Version, Phase: "committing", Started: time.Now().Unix()}
	for _, f := range need {
		j.Replace = append(j.Replace, f.Path)
	}
	if a.installed != nil {
		for p := range a.installed.Files {
			if !keep[p] {
				j.Remove = append(j.Remove, p)
			}
		}
	}
	jb, _ := json.Marshal(j)
	if err := writeAtomic(a.journalPath(), jb); err != nil {
		return coded("F003", err, "cannot write into the game folder")
	}
	fail := func(code string, err error, format string, args ...any) error {
		a.restoreBackup(&j)
		ce := coded(code, err, format, args...)
		ce.Detail += " — the previous version was restored"
		return ce
	}
	toBackup := func(p string) error {
		dst := filepath.Join(inst, filepath.FromSlash(p))
		if _, err := os.Stat(dst); err != nil {
			return nil
		}
		b := filepath.Join(backup, filepath.FromSlash(p))
		os.MkdirAll(filepath.Dir(b), 0o755)
		return os.Rename(dst, b)
	}
	for i, f := range need {
		src, dst := filepath.Join(stage, filepath.FromSlash(f.Path)), filepath.Join(inst, filepath.FromSlash(f.Path))
		os.MkdirAll(filepath.Dir(dst), 0o755)
		if err := toBackup(f.Path); err != nil {
			return fail("F003", err, "%s is locked or read-only", f.Path)
		}
		if err := os.Rename(src, dst); err != nil {
			if err2 := copyFile(src, dst); err2 != nil {
				return fail("F003", err2, "cannot write %s", f.Path)
			}
		}
		testHook("commit", i)
	}
	for _, p := range j.Remove {
		if err := toBackup(p); err != nil {
			return fail("F003", err, "%s is locked or read-only", p)
		}
	}
	// verify again, in place: what is on disk now must be exactly what the manifest describes
	a.setProg(func(p *Progress) { p.Phase = "verifying"; p.FilesTotal = len(need); p.FilesDone = 0 })
	for i, f := range need {
		sum, size, err := fileSHA(filepath.Join(inst, filepath.FromSlash(f.Path)))
		if err != nil || size != f.Size || sum != f.SHA256 {
			return fail("F004", err, "%s did not verify after installing", f.Path)
		}
		if i%8 == 0 {
			a.setProg(func(p *Progress) { p.File = f.Path; p.FilesDone = i })
		}
	}
	in := &Installed{Version: m.Version, BuildID: m.BuildID, Channel: m.Channel, Files: files, At: time.Now().Unix()}
	b, _ := json.MarshalIndent(in, "", " ")
	if err := writeAtomic(a.installedPath(), b); err != nil {
		return fail("F003", err, "cannot record the installed version")
	}
	a.mu.Lock()
	a.installed = in
	a.mu.Unlock()
	// success: the journal goes first (from here on the new release is the committed state), then the temporary data
	os.Remove(a.journalPath())
	os.RemoveAll(backup)
	os.RemoveAll(stage)
	a.log.Info("installed %s (build %s): %d files written, %d removed", m.Version, m.BuildID, len(need), len(j.Remove))
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
