package portwatch

import (
	"bufio"
	"context"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Status string

const (
	StatusListening Status = "listening"
	StatusClosed    Status = "closed"
)

type Change struct {
	Port       int
	Protocol   string
	Status     Status
	ObservedAt int64
}

type Batch struct {
	Seq     int64
	Resync  bool
	Changes []Change
}

type Watcher struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func Start(ports []int, logger *slog.Logger, emit func(Batch)) (*Watcher, error) {
	watchPorts := normalizePorts(ports)
	ctx, cancel := context.WithCancel(context.Background())
	w := &Watcher{cancel: cancel, done: make(chan struct{})}
	go w.loop(ctx, watchPorts, logger, emit)
	return w, nil
}

func (w *Watcher) Close() {
	w.cancel()
	<-w.done
}

func (w *Watcher) loop(ctx context.Context, ports []int, logger *slog.Logger, emit func(Batch)) {
	defer close(w.done)
	var seq int64
	previous := map[int]Status{}
	closedMisses := map[int]int{}

	sendSnapshot := func(resync bool) {
		current := readListeningPorts(logger)
		changes := make([]Change, 0, len(ports))
		now := time.Now().UnixMilli()
		for _, port := range ports {
			status := StatusClosed
			if current[port] {
				status = StatusListening
			}
			previous[port] = status
			changes = append(changes, Change{Port: port, Protocol: "tcp", Status: status, ObservedAt: now})
		}
		seq++
		emit(Batch{Seq: seq, Resync: resync, Changes: changes})
	}

	sendSnapshot(true)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			current := readListeningPorts(logger)
			now := time.Now().UnixMilli()
			changes := make([]Change, 0, 2)
			for _, port := range ports {
				currentStatus := StatusClosed
				if current[port] {
					currentStatus = StatusListening
				}
				lastStatus, ok := previous[port]
				if !ok {
					previous[port] = currentStatus
					continue
				}
				if currentStatus == lastStatus {
					if currentStatus == StatusListening {
						closedMisses[port] = 0
					}
					continue
				}
				if currentStatus == StatusClosed {
					closedMisses[port]++
					if closedMisses[port] < 2 {
						continue
					}
				} else {
					closedMisses[port] = 0
				}
				previous[port] = currentStatus
				changes = append(changes, Change{Port: port, Protocol: "tcp", Status: currentStatus, ObservedAt: now})
			}
			if len(changes) == 0 {
				continue
			}
			seq++
			emit(Batch{Seq: seq, Changes: changes})
		}
	}
}

func normalizePorts(ports []int) []int {
	seen := map[int]struct{}{}
	out := make([]int, 0, len(ports))
	for _, port := range ports {
		if port <= 0 || port > 65535 {
			continue
		}
		if _, ok := seen[port]; ok {
			continue
		}
		seen[port] = struct{}{}
		out = append(out, port)
	}
	return out
}

func readListeningPorts(logger *slog.Logger) map[int]bool {
	result := map[int]bool{}
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		if err := readListeningPortsFile(path, result); err != nil && logger != nil {
			logger.Debug("failed to read tcp table", slog.String("path", path), slog.String("error", err.Error()))
		}
	}
	return result
}

func readListeningPortsFile(path string, result map[int]bool) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	first := true
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if first {
			first = false
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 || fields[3] != "0A" {
			continue
		}
		addr := fields[1]
		idx := strings.LastIndex(addr, ":")
		if idx < 0 || idx+1 >= len(addr) {
			continue
		}
		port64, err := strconv.ParseInt(addr[idx+1:], 16, 32)
		if err != nil {
			continue
		}
		result[int(port64)] = true
	}
	return scanner.Err()
}
