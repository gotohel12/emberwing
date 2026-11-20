//go:build !windows

package main

import (
	"encoding/base64"
	"os"
	"strconv"
	"syscall"
)

// diskFree returns the bytes available to the current user on the volume that holds path.
// ARVEX_FAKE_FREE_BYTES lets the test suite simulate a full disk.
func diskFree(path string) (free, total uint64, ok bool) {
	if v := os.Getenv("ARVEX_FAKE_FREE_BYTES"); v != "" {
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			return n, n * 10, true
		}
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, false
	}
	return uint64(st.Bavail) * uint64(st.Bsize), uint64(st.Blocks) * uint64(st.Bsize), true
}

// testHook lets the test suite kill the process at a precise point (ARVEX_TEST_CRASH=commit:2 dies after the third file is moved).
// It exists only in non-Windows builds, which are never shipped to players.
func testHook(name string, i int) {
	if v := os.Getenv("ARVEX_TEST_CRASH"); v == name+":"+strconv.Itoa(i) {
		os.Exit(137)
	}
}

// testSigningKey lets the test suite pin its own throw-away key (ARVEX_TEST_SIGN_PUB). Not present in Windows builds.
func testSigningKey() []byte {
	if v := os.Getenv("ARVEX_TEST_SIGN_PUB"); v != "" {
		if b, err := base64.StdEncoding.DecodeString(v); err == nil && len(b) == 32 {
			return b
		}
	}
	return nil
}

// processAlive reports whether a process with this id is still running
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
