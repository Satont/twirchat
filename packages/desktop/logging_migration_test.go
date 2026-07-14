package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopGoSourceUsesSlogInsteadOfLegacyLog(t *testing.T) {
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		source := string(content)
		if strings.Contains(source, "\"log\"") ||
			strings.Contains(source, "log.Printf") ||
			strings.Contains(source, "log.Fatal") {
			t.Errorf("legacy log usage remains in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk Go sources: %v", err)
	}
}
