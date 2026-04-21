package report

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/cohub/apps/sandbox/env"
)

type Client struct {
	cfg        env.Config
	hostname   string
	httpClient *http.Client
}

type Payload struct {
	Status string                 `json:"status"`
	Meta   map[string]interface{} `json:"meta,omitempty"`
}

func NewClient(cfg env.Config, hostname string) *Client {
	return &Client{
		cfg:      cfg,
		hostname: hostname,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *Client) Report(payload Payload) error {
	baseURL := strings.TrimRight(c.cfg.InternalAPIBaseURL, "/")
	if baseURL == "" {
		return fmt.Errorf("INTERNAL_API_BASE_URL is required")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/internal/spaces/%s/sandbox-report", baseURL, c.cfg.SpaceID)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(c.cfg.SandboxReportToken) != "" {
		req.Header.Set("x-sandbox-report-token", c.cfg.SandboxReportToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("sandbox report failed with status %d", resp.StatusCode)
	}
	return nil
}
