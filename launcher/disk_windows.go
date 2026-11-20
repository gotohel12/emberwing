//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// diskFree returns the bytes available to the current user on the volume that holds path
func diskFree(path string) (free, total uint64, ok bool) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, false
	}
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")
	var avail, tot, totFree uint64
	r, _, _ := proc.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&avail)), uintptr(unsafe.Pointer(&tot)), uintptr(unsafe.Pointer(&totFree)))
	if r == 0 {
		return 0, 0, false
	}
	return avail, tot, true
}

// testHook is a no-op in shipped builds
func testHook(string, int) {}

// testSigningKey: shipped builds only ever trust the embedded key
func testSigningKey() []byte { return nil }

// processAlive reports whether a process with this id is still running
func processAlive(pid int) bool {
	const queryLimited, stillActive = 0x1000, 259
	h, err := syscall.OpenProcess(queryLimited, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if syscall.GetExitCodeProcess(h, &code) != nil {
		return false
	}
	return code == stillActive
}
