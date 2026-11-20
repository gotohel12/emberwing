package main

// Shared plumbing: error codes, leveled log file with rotation, version comparison, telemetry.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// launcherVersion is stamped at build time from package.json:  -ldflags "-X main.launcherVersion=10.0.0"
var launcherVersion = "0.0.0-dev"

// ----------------------------------------------------------------- error codes (ARVEX-<area><number>)
// L launcher · N network · U update · F files/disk · A access/policy · S support
type CodedError struct {
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
	// values the UI needs to explain the problem (bytes required / available, file name…)
	Data map[string]any `json:"data,omitempty"`
	err  error
}

func (e *CodedError) Error() string {
	if e.Detail != "" {
		return e.Code + ": " + e.Detail
	}
	return e.Code
}
func (e *CodedError) Unwrap() error { return e.err }
func coded(code string, err error, format string, a ...any) *CodedError {
	return &CodedError{Code: "ARVEX-" + code, Detail: fmt.Sprintf(format, a...), err: err}
}
func asCoded(err error) *CodedError {
	var ce *CodedError
	if errors.As(err, &ce) {
		return ce
	}
	return classifyNet(err)
}

// classifyNet maps transport failures onto network error codes
func classifyNet(err error) *CodedError {
	var ne net.Error
	var dns *net.DNSError
	switch {
	case errors.As(err, &dns):
		return coded("N001", err, "server name could not be resolved")
	case errors.As(err, &ne) && ne.Timeout(), errors.Is(err, context.DeadlineExceeded):
		return coded("N002", err, "the server did not answer in time")
	case errors.Is(err, errStalled):
		return coded("N002", err, "the download stopped receiving data")
	default:
		return coded("N001", err, "%s", trimErr(err))
	}
}
func trimErr(err error) string {
	s := err.Error()
	if len(s) > 180 {
		s = s[:180]
	}
	return s
}

type httpStatusError struct{ Status int }

func (e *httpStatusError) Error() string { return "HTTP " + strconv.Itoa(e.Status) }

// retryable: only transient failures are retried; a 4xx is a decision, not a hiccup
func retryable(err error) bool {
	var hs *httpStatusError
	if errors.As(err, &hs) {
		return hs.Status == 408 || hs.Status == 425 || hs.Status == 429 || hs.Status >= 500
	}
	var ce *CodedError
	if errors.As(err, &ce) {
		return ce.Code == "ARVEX-U003" || strings.HasPrefix(ce.Code, "ARVEX-N")
	}
	return !errors.Is(err, context.Canceled)
}
func statusCoded(status int, what string) *CodedError {
	e := &httpStatusError{status}
	switch {
	case status == 429:
		return coded("N004", e, "%s: the server asked us to slow down", what)
	case status == 410:
		return coded("U008", e, "%s: the release changed while downloading", what)
	case status >= 500:
		return coded("N003", e, "%s: server error %d", what, status)
	default:
		return coded("U002", e, "%s: HTTP %d", what, status)
	}
}

// ----------------------------------------------------------------- versions
var semverRe = regexp.MustCompile(`^\d{1,4}\.\d{1,4}(\.\d{1,4})?$`)

func cmpVersion(a, b string) int {
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
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}
func verNewer(a, b string) bool { return cmpVersion(a, b) > 0 }

// ----------------------------------------------------------------- log file (INFO/WARN/ERROR/DEBUG, 1 MB × 3 files)
type Logger struct {
	mu    sync.Mutex
	dir   string
	f     *os.File
	size  int64
	debug bool
}

const logMax = 1 << 20

func newLogger(dir string) *Logger {
	os.MkdirAll(dir, 0o755)
	l := &Logger{dir: dir, debug: os.Getenv("ARVEX_DEBUG") == "1"}
	l.open()
	return l
}
func (l *Logger) open() {
	f, err := os.OpenFile(filepath.Join(l.dir, "launcher.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	st, _ := f.Stat()
	l.f, l.size = f, st.Size()
}
func (l *Logger) write(level, format string, a ...any) {
	if level == "DEBUG" && !l.debug {
		return
	}
	line := time.Now().UTC().Format("2006-01-02T15:04:05.000Z") + " " + level + " " + fmt.Sprintf(format, a...) + "\n"
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return
	}
	if l.size+int64(len(line)) > logMax {
		l.f.Close()
		base := filepath.Join(l.dir, "launcher.log")
		os.Remove(base + ".2")
		os.Rename(base+".1", base+".2")
		os.Rename(base, base+".1")
		l.open()
		if l.f == nil {
			return
		}
	}
	n, _ := l.f.WriteString(line)
	l.size += int64(n)
}
func (l *Logger) Info(f string, a ...any)  { l.write("INFO ", f, a...) }
func (l *Logger) Warn(f string, a ...any)  { l.write("WARN ", f, a...) }
func (l *Logger) Error(f string, a ...any) { l.write("ERROR", f, a...) }
func (l *Logger) Debug(f string, a ...any) { l.write("DEBUG", f, a...) }

// ----------------------------------------------------------------- telemetry (opt-out, no personal data: code, versions, platform)
func (a *App) report(kind string, fields map[string]any) {
	a.mu.Lock()
	on, server := a.settings.SendReports, a.settings.Server
	inst := a.installed
	a.mu.Unlock()
	if !on {
		return
	}
	fields["kind"], fields["launcher"], fields["platform"] = kind, launcherVersion, runtime.GOOS
	if inst != nil {
		if _, ok := fields["version"]; !ok {
			fields["version"] = inst.Version
		}
		fields["build"] = inst.BuildID
	}
	b, _ := json.Marshal(fields)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "POST", server+"/api/telemetry", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "ARVEX-Launcher/"+launcherVersion)
		if r, err := httpc.Do(req); err == nil {
			r.Body.Close()
		}
	}()
}
