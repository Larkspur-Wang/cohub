package process

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"sync"
	"time"

	"github.com/google/uuid"
)

type ManagedProcess struct {
	ID     string
	Cmd    *exec.Cmd
	Cancel context.CancelFunc
}

type Manager struct {
	mu        sync.Mutex
	processes map[string]*ManagedProcess
	logger    *slog.Logger
}

func NewManager(logger *slog.Logger) *Manager {
	return &Manager{
		processes: make(map[string]*ManagedProcess),
		logger:    logger,
	}
}

func (m *Manager) Start(command string, cwd string, timeoutSecs int) (string, io.ReadCloser, io.ReadCloser, <-chan *int, error) {
	ctx := context.Background()
	var cancel context.CancelFunc
	if timeoutSecs > 0 {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(timeoutSecs)*time.Second)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}

	cmd := exec.CommandContext(ctx, "bash", "-lc", command)
	cmd.Dir = cwd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return "", nil, nil, nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return "", nil, nil, nil, fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return "", nil, nil, nil, fmt.Errorf("start command: %w", err)
	}

	processID := uuid.NewString()
	managed := &ManagedProcess{ID: processID, Cmd: cmd, Cancel: cancel}

	m.mu.Lock()
	m.processes[processID] = managed
	m.mu.Unlock()

	exitCh := make(chan *int, 1)
	go func() {
		defer close(exitCh)
		err := cmd.Wait()
		var exitCode *int
		if err == nil && cmd.ProcessState != nil {
			code := cmd.ProcessState.ExitCode()
			exitCode = &code
		} else if cmd.ProcessState != nil {
			code := cmd.ProcessState.ExitCode()
			exitCode = &code
		}

		m.mu.Lock()
		delete(m.processes, processID)
		m.mu.Unlock()
		cancel()
		exitCh <- exitCode
	}()

	return processID, stdout, stderr, exitCh, nil
}

func (m *Manager) Abort(processID string) error {
	m.mu.Lock()
	managed, ok := m.processes[processID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("process not found")
	}

	managed.Cancel()
	if managed.Cmd.Process != nil {
		if err := managed.Cmd.Process.Kill(); err != nil {
			return fmt.Errorf("kill process: %w", err)
		}
	}
	return nil
}

func StreamLines(reader io.Reader, onLine func(string)) error {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		onLine(scanner.Text())
	}
	return scanner.Err()
}
