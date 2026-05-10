package filewatch

import (
	"reflect"
	"testing"
)

func TestBuildIgnoreListDeduplicatesDefaultsAndEnv(t *testing.T) {
	t.Setenv("FS_WATCH_IGNORE", "node_modules, .idea ,../bad,/abs/path,,custom/cache,custom/cache")

	items := buildIgnoreList()

	assertContains(t, items, ".git")
	assertContains(t, items, "node_modules")
	assertContains(t, items, ".idea")
	assertContains(t, items, "custom/cache")
	assertNotContains(t, items, "../bad")
	assertNotContains(t, items, "/abs/path")

	counts := map[string]int{}
	for _, item := range items {
		counts[item]++
	}
	if counts["node_modules"] != 1 {
		t.Fatalf("node_modules should only appear once, got %d in %v", counts["node_modules"], items)
	}
	if counts["custom/cache"] != 1 {
		t.Fatalf("custom/cache should only appear once, got %d in %v", counts["custom/cache"], items)
	}
}

func TestIsIgnoredMatchesDirectoryNameAtAnyDepth(t *testing.T) {
	w := &Watcher{ignored: []string{".git", "node_modules", ".cache"}}

	ignored := []string{
		".git/config",
		"packages/app/.git/index",
		"node_modules/pkg/index.js",
		"apps/web/node_modules/pkg/index.js",
		"packages/a/.cache/vite",
	}
	for _, rel := range ignored {
		if !w.isIgnored(rel) {
			t.Fatalf("expected %q to be ignored", rel)
		}
	}

	allowed := []string{
		"src/git/config",
		"src/node_modules_file.js",
		"cache/.gitignore",
	}
	for _, rel := range allowed {
		if w.isIgnored(rel) {
			t.Fatalf("expected %q to be allowed", rel)
		}
	}
}

func TestIsIgnoredSupportsScopedRelativePatterns(t *testing.T) {
	w := &Watcher{ignored: []string{"apps/web/dist", "generated/cache"}}

	ignored := []string{"apps/web/dist", "apps/web/dist/assets/app.js", "generated/cache/file"}
	for _, rel := range ignored {
		if !w.isIgnored(rel) {
			t.Fatalf("expected %q to be ignored", rel)
		}
	}

	allowed := []string{"dist/assets/app.js", "apps/api/dist/app.js", "other/generated/cache/file"}
	for _, rel := range allowed {
		if w.isIgnored(rel) {
			t.Fatalf("expected %q to be allowed", rel)
		}
	}
}

func TestSanitizeIgnorePattern(t *testing.T) {
	cases := map[string]string{
		" .idea ":    ".idea",
		"foo\\bar/":  "foo/bar",
		"":           "",
		"../secrets": "",
		"foo/../bar": "",
		"/absolute":  "",
		"foo\x00bar": "",
	}

	for input, expected := range cases {
		if got := sanitizeIgnorePattern(input); !reflect.DeepEqual(got, expected) {
			t.Fatalf("sanitizeIgnorePattern(%q) = %q, expected %q", input, got, expected)
		}
	}
}

func assertContains(t *testing.T, items []string, want string) {
	t.Helper()
	for _, item := range items {
		if item == want {
			return
		}
	}
	t.Fatalf("expected %q in %v", want, items)
}

func assertNotContains(t *testing.T, items []string, want string) {
	t.Helper()
	for _, item := range items {
		if item == want {
			t.Fatalf("expected %q not to be in %v", want, items)
		}
	}
}
