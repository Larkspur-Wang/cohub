// Package relay implements the local sandbox dial-out client. In local mode the
// sandbox cannot be reached directly (it lives behind the user's NAT), so it
// dials out to the gateway relay and keeps a long-lived control connection. The
// gateway asks it, over that control channel, to open additional data channels;
// each data channel is then served with the exact same agent-sandbox protocol
// used by the cloud listener, so no agent/protocol changes are required.
package relay

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// SessionServer is satisfied by ws.Server; it serves one protocol session over a
// dialed-out connection and blocks until that connection ends.
type SessionServer interface {
	ServeDialedConn(ctx context.Context, conn *websocket.Conn, remote string)
}

// Options configures the relay client.
type Options struct {
	// RelayURL is the gateway control endpoint, e.g.
	// wss://gateway.cohub.run/sandbox/relay.
	RelayURL string
	// Token is the user's access token, used by the gateway to authorize the
	// caller against the target space.
	Token string
	// SpaceID identifies the space this sandbox serves.
	SpaceID string
	// Server serves each opened data channel.
	Server SessionServer
	Logger *slog.Logger
}

// control frames exchanged on the control channel. Kept intentionally small and
// separate from the agent-sandbox protocol carried on data channels.
type controlFrame struct {
	Type    string `json:"type"`
	SpaceID string `json:"spaceId,omitempty"`
	Token   string `json:"token,omitempty"`
	Channel string `json:"channel,omitempty"`
	Message string `json:"message,omitempty"`
}

const (
	controlPingInterval = 20 * time.Second
	dialTimeout         = 15 * time.Second
)

var reconnectDelays = []time.Duration{
	250 * time.Millisecond,
	time.Second,
	2 * time.Second,
	5 * time.Second,
	10 * time.Second,
	30 * time.Second,
}

// Run maintains the control connection, reconnecting with backoff until ctx is
// cancelled. It never returns until ctx is done.
func Run(ctx context.Context, opts Options) {
	attempt := 0
	for {
		if ctx.Err() != nil {
			return
		}
		start := time.Now()
		if err := connectControl(ctx, opts); err != nil && ctx.Err() == nil {
			opts.Logger.Warn("relay control connection ended", slog.String("error", err.Error()))
		}
		// A connection that stayed up for a while resets the backoff.
		if time.Since(start) > time.Minute {
			attempt = 0
		}
		if ctx.Err() != nil {
			return
		}
		delay := reconnectDelays[min(attempt, len(reconnectDelays)-1)]
		attempt++
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func connectControl(ctx context.Context, opts Options) error {
	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()

	conn, _, err := websocket.Dial(dialCtx, controlURL(opts.RelayURL), &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + opts.Token}},
	})
	if err != nil {
		return fmt.Errorf("dial control: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "closing")
	conn.SetReadLimit(64 * 1024)

	if err := wsjson.Write(ctx, conn, controlFrame{Type: "register", SpaceID: opts.SpaceID, Token: opts.Token}); err != nil {
		return fmt.Errorf("send register: %w", err)
	}

	ctx, cancelLoop := context.WithCancel(ctx)
	defer cancelLoop()
	go controlPingLoop(ctx, conn, opts.Logger)

	for {
		var frame controlFrame
		if err := wsjson.Read(ctx, conn, &frame); err != nil {
			return fmt.Errorf("read control: %w", err)
		}
		switch frame.Type {
		case "registered":
			opts.Logger.Info("relay registered", slog.String("spaceId", opts.SpaceID))
		case "open":
			if frame.Channel == "" {
				opts.Logger.Warn("relay open without channel id")
				continue
			}
			go openDataChannel(ctx, opts, frame.Channel)
		case "error":
			return fmt.Errorf("relay rejected connection: %s", frame.Message)
		case "ping":
			_ = wsjson.Write(ctx, conn, controlFrame{Type: "pong"})
		case "pong":
			// keepalive ack
		default:
			opts.Logger.Warn("unknown control frame", slog.String("type", frame.Type))
		}
	}
}

func controlPingLoop(ctx context.Context, conn *websocket.Conn, logger *slog.Logger) {
	ticker := time.NewTicker(controlPingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := wsjson.Write(ctx, conn, controlFrame{Type: "ping"}); err != nil {
				logger.Debug("relay control ping failed", slog.String("error", err.Error()))
				return
			}
		}
	}
}

// openDataChannel dials a fresh data connection for the given channel id and
// serves it with the standard protocol. Each channel is independent; the
// gateway pipes it transparently to one waiting cloud peer (agent, worker…).
func openDataChannel(ctx context.Context, opts Options, channel string) {
	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	conn, _, err := websocket.Dial(dialCtx, dataURL(opts.RelayURL, channel), &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + opts.Token}},
	})
	cancel()
	if err != nil {
		opts.Logger.Warn("relay data channel dial failed", slog.String("channel", channel), slog.String("error", err.Error()))
		return
	}
	opts.Logger.Info("relay data channel opened", slog.String("channel", channel))
	opts.Server.ServeDialedConn(ctx, conn, "relay:"+channel)
}

func controlURL(base string) string {
	return base
}

func dataURL(base, channel string) string {
	u, err := url.Parse(base)
	if err != nil {
		return fmt.Sprintf("%s/data?channel=%s", base, url.QueryEscape(channel))
	}
	u.Path += "/data"
	q := u.Query()
	q.Set("channel", channel)
	u.RawQuery = q.Encode()
	return u.String()
}
