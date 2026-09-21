//go:build darwin && cgo

package filewatch

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/fsnotify/fsevents"
)

func TestFSEventsBoundedFDAndBackpressureClose(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	before := countOpenFDs(t)
	backend, _, err := newFSEventsBackend(root, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 1024; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprint(i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	// Do not consume output: shutdown must survive a full downstream queue.
	time.Sleep(time.Second)
	after := countOpenFDs(t)
	if after-before > 64 {
		t.Errorf("FD count grew with files: %d -> %d", before, after)
	}
	closed := make(chan struct{})
	go func() { _ = backend.close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("close blocked under backpressure")
	}
}

func TestFSEventsSkipsSpecialFiles(t *testing.T) {
	t.Setenv(filewatchBackendEnv, "fsevents")
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	batches := make(chan Batch, 64)
	w, err := Start(root, slog.New(slog.NewTextHandler(io.Discard, nil)), func(b Batch) { batches <- b })
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if w.backend == nil || w.backend.name() != "fsevents" {
		t.Fatal("native test silently fell back")
	}
	waitForResync(t, batches)
	waitQuiet(t, batches, 700*time.Millisecond)

	pipe := filepath.Join(root, "pipe")
	if err := syscall.Mkfifo(pipe, 0o600); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "regular.txt"), []byte("content"), 0o600); err != nil {
		t.Fatal(err)
	}

	// The regular file must still be reported; the FIFO must never appear.
	deadline := time.After(5 * time.Second)
	seenRegular := false
	for !seenRegular {
		select {
		case batch := <-batches:
			for _, change := range batch.Changes {
				if change.Path == "pipe" {
					t.Fatalf("FIFO reported as a change: %+v", change)
				}
				if change.Path == "regular.txt" {
					seenRegular = true
				}
			}
		case <-deadline:
			t.Fatal("no event for the regular file")
		}
	}
	drainFor(t, batches, 500*time.Millisecond, func(change Change) {
		if change.Path == "pipe" {
			t.Fatalf("FIFO reported as a change: %+v", change)
		}
	})
}

func drainFor(t *testing.T, batches <-chan Batch, window time.Duration, inspect func(Change)) {
	t.Helper()
	timer := time.NewTimer(window)
	defer timer.Stop()
	for {
		select {
		case batch := <-batches:
			for _, change := range batch.Changes {
				inspect(change)
			}
		case <-timer.C:
			return
		}
	}
}

// waitQuiet blocks until no batch arrives for a full window. The native backend
// emits an initial catch-up resync shortly after Start (in addition to the
// watcher's own startup resync), and any change enqueued while that resync is
// still pending is superseded by it. Tests wait for quiescence before triggering
// the change they want to observe. The window must exceed the FSEvents latency
// plus the watcher debounce (250ms + 250ms).
func waitQuiet(t *testing.T, batches <-chan Batch, window time.Duration) {
	t.Helper()
	timer := time.NewTimer(window)
	defer timer.Stop()
	for {
		select {
		case <-batches:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(window)
		case <-timer.C:
			return
		}
	}
}

// countOpenFDs lists the process file descriptors without stat-ing each entry.
// /dev/fd entries can vanish between readdir and lstat, and Go's ReadDir turns
// that race into an EBADF error; Readdirnames is a pure directory read.
func countOpenFDs(t *testing.T) int {
	t.Helper()
	dir, err := os.Open("/dev/fd")
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	names, err := dir.Readdirnames(-1)
	if err != nil {
		t.Fatal(err)
	}
	return len(names)
}

func TestFSEventsFlags(t *testing.T) {
	for _, flags := range []fsevents.EventFlags{fsevents.MustScanSubDirs, fsevents.UserDropped, fsevents.KernelDropped, fsevents.RootChanged, fsevents.ItemRenamed, fsevents.ItemCreated | fsevents.ItemRemoved, fsevents.Mount, fsevents.Unmount} {
		if !mapFSEvent("/workspace", fsevents.Event{Path: "/workspace/file", Flags: flags}).resync {
			t.Fatalf("flags %v must resync", flags)
		}
	}
	if got := mapFSEvent("/workspace", fsevents.Event{Path: "/workspace/file", Flags: fsevents.ItemCreated | fsevents.ItemIsFile}); got.kind != "create" || got.nodeType != "file" {
		t.Fatalf("create: %+v", got)
	}
}

func TestFSEventsNativeWriteAndClose(t *testing.T) {
	t.Setenv(filewatchBackendEnv, "fsevents")
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	batches := make(chan Batch, 32)
	w, err := Start(root, slog.New(slog.NewTextHandler(io.Discard, nil)), func(b Batch) { batches <- b })
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if w.backend == nil || w.backend.name() != "fsevents" {
		t.Fatal("native test silently fell back")
	}
	waitForResync(t, batches)
	waitQuiet(t, batches, 700*time.Millisecond)
	if err := os.WriteFile(filepath.Join(root, "native.txt"), []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case batch := <-batches:
			for _, change := range batch.Changes {
				if change.Path == "native.txt" {
					return
				}
			}
		case <-deadline:
			t.Fatal("no native file event")
		}
	}
}
