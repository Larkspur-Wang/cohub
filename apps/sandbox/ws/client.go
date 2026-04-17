package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/coder/websocket"
	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/protocol"
	"github.com/cohub/apps/sandbox/rpc"
)

type Client struct {
	cfg        env.Config
	dispatcher *rpc.Dispatcher
	logger     *slog.Logger
	conn       *websocket.Conn
	sendCh     chan interface{}
}

type sender struct {
	sendCh <-chan interface{}
	push   func(interface{}) error
}

func (s sender) SendJSON(v interface{}) error {
	return s.push(v)
}

func NewClient(cfg env.Config, dispatcher *rpc.Dispatcher, logger *slog.Logger) *Client {
	client := &Client{
		cfg:        cfg,
		dispatcher: dispatcher,
		logger:     logger,
		sendCh:     make(chan interface{}, 128),
	}
	dispatcher.SetSender(sender{push: client.enqueue})
	return client
}

func (c *Client) Run() error {
	for {
		if err := c.runOnce(); err != nil {
			c.logger.Error("sandbox ws loop failed", slog.String("error", err.Error()))
		}
		time.Sleep(2 * time.Second)
	}
}

func (c *Client) runOnce() error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn, _, err := websocket.Dial(ctx, c.cfg.SandboxWSURL, nil)
	if err != nil {
		return fmt.Errorf("dial websocket: %w", err)
	}
	defer conn.Close(websocket.StatusInternalError, "closing")
	c.conn = conn

	c.logger.Info("connected to agent ws server", slog.String("url", c.cfg.SandboxWSURL))

	writeDone := make(chan struct{})
	go c.writeLoop(ctx, writeDone)
	go c.heartbeatLoop(ctx)

	if err := c.enqueue(c.buildHello()); err != nil {
		return err
	}

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			cancel()
			<-writeDone
			return fmt.Errorf("read ws message: %w", err)
		}

		var envelope protocol.IncomingEnvelope
		if err := json.Unmarshal(data, &envelope); err != nil {
			c.logger.Warn("failed to parse incoming envelope", slog.String("error", err.Error()))
			continue
		}

		switch envelope.Type {
		case "sandbox.hello_ack":
			c.logger.Info("received sandbox.hello_ack")
		case "rpc.request":
			var request protocol.RPCRequest
			if err := json.Unmarshal(data, &request); err != nil {
				c.logger.Warn("failed to parse rpc.request", slog.String("error", err.Error()))
				continue
			}
			response := c.dispatcher.Handle(request)
			if response != nil {
				if err := c.enqueue(response); err != nil {
					c.logger.Warn("failed to enqueue rpc response", slog.String("error", err.Error()))
				}
			}
		default:
			c.logger.Warn("unknown incoming message type", slog.String("type", envelope.Type))
		}
	}
}

func (c *Client) writeLoop(ctx context.Context, done chan<- struct{}) {
	defer close(done)
	for {
		select {
		case <-ctx.Done():
			return
		case message := <-c.sendCh:
			payload, err := json.Marshal(message)
			if err != nil {
				c.logger.Warn("failed to marshal outgoing message", slog.String("error", err.Error()))
				continue
			}
			if err := c.conn.Write(ctx, websocket.MessageText, payload); err != nil {
				c.logger.Warn("failed to write ws message", slog.String("error", err.Error()))
				return
			}
		}
	}
}

func (c *Client) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(c.cfg.HeartbeatIntervalSecs) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.enqueue(protocol.SandboxHeartbeat{
				Version:   protocol.Version,
				Type:      "sandbox.heartbeat",
				SpaceID:   c.cfg.SpaceID,
				SandboxID: c.cfg.SandboxID,
				Timestamp: time.Now().UnixMilli(),
				Status:    "ready",
			}); err != nil {
				c.logger.Warn("failed to enqueue heartbeat", slog.String("error", err.Error()))
			}
		}
	}
}

func (c *Client) buildHello() protocol.SandboxHello {
	hostname, _ := os.Hostname()
	return protocol.SandboxHello{
		Version:   protocol.Version,
		Type:      "sandbox.hello",
		SpaceID:   c.cfg.SpaceID,
		SandboxID: c.cfg.SandboxID,
		Timestamp: time.Now().UnixMilli(),
		Capabilities: protocol.SandboxCapabilities{
			WorkspacePrepare: true,
			FSRead:           true,
			FSWrite:          true,
			ProcessStart:     true,
			ProcessAbort:     true,
		},
		Metadata: &protocol.SandboxMetadata{
			Hostname:     hostname,
			ImageVersion: c.cfg.ImageVersion,
			StartedAt:    time.Now().Format(time.RFC3339),
		},
	}
}

func (c *Client) enqueue(message interface{}) error {
	select {
	case c.sendCh <- message:
		return nil
	case <-time.After(2 * time.Second):
		return fmt.Errorf("outbound websocket queue is full")
	}
}
