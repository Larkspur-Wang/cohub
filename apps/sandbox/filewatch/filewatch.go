package filewatch

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Change struct {
	Path     string `json:"path,omitempty"`
	OldPath  string `json:"oldPath,omitempty"`
	Kind     string `json:"kind"`
	NodeType string `json:"nodeType,omitempty"`
	MtimeMs  int64  `json:"mtimeMs,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

type Batch struct {
	Seq     int64    `json:"seq"`
	Resync  bool     `json:"resync,omitempty"`
	Changes []Change `json:"changes"`
}

type Handler func(Batch)

const (
	debounceWindow = 250 * time.Millisecond
	maxBatchSize   = 500
)

var defaultIgnore = []string{
	".git", "node_modules", ".pnpm-store", "dist", "build", ".next", ".svelte-kit", ".vite", "coverage", ".cache", "tmp",
}

type Watcher struct {
	root    string
	logger  *slog.Logger
	handler Handler
	watcher *fsnotify.Watcher

	mu      sync.Mutex
	pending map[string]Change
	resync  bool
	seq     int64
	timer   *time.Timer
	ignored []string
	closed  chan struct{}
}

func Start(root string, logger *slog.Logger, handler Handler) (*Watcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		root:    filepath.Clean(root),
		logger:  logger,
		handler: handler,
		watcher: fw,
		pending: make(map[string]Change),
		ignored: buildIgnoreList(),
		closed:  make(chan struct{}),
	}
	go w.loop()
	go w.repairLoop()
	go func() {
		w.addRecursiveBestEffort(w.root)
		// Watch start may have missed bootstrap writes. Ask clients to resync once.
		time.Sleep(1 * time.Second)
		w.enqueueResync()
	}()
	return w, nil
}

func buildIgnoreList() []string {
	items := make([]string, 0, len(defaultIgnore)+8)
	for _, raw := range defaultIgnore {
		if v := sanitizeIgnorePattern(raw); v != "" {
			items = append(items, v)
		}
	}
	for _, raw := range strings.Split(os.Getenv("FS_WATCH_IGNORE"), ",") {
		if v := sanitizeIgnorePattern(raw); v != "" {
			items = append(items, v)
		}
	}
	return items
}

func sanitizeIgnorePattern(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" || strings.Contains(v, "\x00") || filepath.IsAbs(v) {
		return ""
	}
	v = strings.Trim(strings.ReplaceAll(v, "\\", "/"), "/")
	if v == "" || strings.Contains(v, "..") {
		return ""
	}
	return v
}

func (w *Watcher) Close() error {
	close(w.closed)
	w.mu.Lock()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.mu.Unlock()
	return w.watcher.Close()
}

func (w *Watcher) loop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			w.handleEvent(event)
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			w.logger.Warn("file watcher error", slog.String("error", err.Error()))
		case <-w.closed:
			return
		}
	}
}

func (w *Watcher) repairLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			w.addRecursiveBestEffort(w.root)
		case <-w.closed:
			return
		}
	}
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	rel, ok := w.relative(event.Name)
	if !ok || w.isIgnored(rel) {
		return
	}

	kind := "modify"
	if event.Has(fsnotify.Create) {
		kind = "create"
	} else if event.Has(fsnotify.Remove) {
		kind = "delete"
	} else if event.Has(fsnotify.Rename) {
		kind = "delete"
	}

	nodeType := "unknown"
	var size int64
	var mtimeMs int64
	if info, err := os.Lstat(event.Name); err == nil {
		if info.IsDir() {
			nodeType = "dir"
			if event.Has(fsnotify.Create) {
				w.addRecursiveBestEffort(event.Name)
			}
		} else {
			nodeType = "file"
		}
		size = info.Size()
		mtimeMs = info.ModTime().UnixMilli()
	}

	w.enqueue(Change{Path: rel, Kind: kind, NodeType: nodeType, Size: size, MtimeMs: mtimeMs})
}

func (w *Watcher) addRecursiveBestEffort(root string) {
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d == nil || !d.IsDir() {
			return nil
		}
		rel, ok := w.relative(path)
		if ok && rel != "" && w.isIgnored(rel) {
			return filepath.SkipDir
		}
		if err := w.watcher.Add(path); err != nil && !os.IsNotExist(err) {
			w.logger.Debug("failed to add file watcher", slog.String("path", path), slog.String("error", err.Error()))
		}
		return nil
	})
}

func (w *Watcher) relative(path string) (string, bool) {
	rel, err := filepath.Rel(w.root, filepath.Clean(path))
	if err != nil || rel == ".." || strings.HasPrefix(rel, "../") || filepath.IsAbs(rel) {
		return "", false
	}
	if rel == "." {
		return "", true
	}
	return filepath.ToSlash(rel), true
}

func (w *Watcher) isIgnored(rel string) bool {
	rel = strings.Trim(rel, "/")
	for _, item := range w.ignored {
		item = strings.Trim(item, "/")
		if rel == item || strings.HasPrefix(rel, item+"/") {
			return true
		}
	}
	return false
}

func (w *Watcher) enqueue(change Change) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.resync {
		w.ensureTimerLocked()
		return
	}
	if len(w.pending) >= maxBatchSize {
		w.pending = make(map[string]Change)
		w.resync = true
		w.ensureTimerLocked()
		return
	}
	if previous, ok := w.pending[change.Path]; ok {
		change = mergeChange(previous, change)
	}
	w.pending[change.Path] = change
	w.ensureTimerLocked()
}

func (w *Watcher) enqueueResync() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pending = make(map[string]Change)
	w.resync = true
	w.ensureTimerLocked()
}

func (w *Watcher) ensureTimerLocked() {
	if w.timer != nil {
		return
	}
	w.timer = time.AfterFunc(debounceWindow, w.flush)
}

func (w *Watcher) flush() {
	w.mu.Lock()
	changes := make([]Change, 0, len(w.pending))
	for _, change := range w.pending {
		changes = append(changes, change)
	}
	resync := w.resync
	w.pending = make(map[string]Change)
	w.resync = false
	w.timer = nil
	if !resync && len(changes) == 0 {
		w.mu.Unlock()
		return
	}
	w.seq++
	seq := w.seq
	w.mu.Unlock()

	w.handler(Batch{Seq: seq, Resync: resync, Changes: changes})
}

func mergeChange(a, b Change) Change {
	if a.Kind == "delete" || b.Kind == "delete" {
		b.Kind = "delete"
		return b
	}
	if a.Kind == "create" {
		b.Kind = "create"
		return b
	}
	return b
}
