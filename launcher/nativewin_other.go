//go:build !windows

package main

func runNativeWindow(url, profile, title string, w, h int, maximized bool) int { return 3 }
