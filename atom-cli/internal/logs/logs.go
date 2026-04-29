package logs

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type logMsg struct {
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
	Source    string `json:"source"`
}

// Stream connects to the atom-studio WebSocket log endpoint and prints
// log lines until the user presses Ctrl-C.
func Stream(studioURL, agentID, token string) error {
	// Convert http(s):// → ws(s)://
	wsBase := strings.TrimRight(studioURL, "/")
	wsBase = strings.Replace(wsBase, "http://", "ws://", 1)
	wsBase = strings.Replace(wsBase, "https://", "wss://", 1)

	u, err := url.Parse(fmt.Sprintf("%s/ws/agents/%s/logs", wsBase, agentID))
	if err != nil {
		return fmt.Errorf("bad URL: %w", err)
	}
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()

	fmt.Fprintf(os.Stderr, "Connecting to %s ...\n", u.String())

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return fmt.Errorf("websocket dial failed: %w", err)
	}
	defer conn.Close()

	fmt.Fprint(os.Stderr, "Connected. Streaming logs (Ctrl-C to stop):\n\n")

	// Handle Ctrl-C gracefully.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		os.Exit(0)
	}()

	_ = conn.SetReadDeadline(time.Time{}) // no deadline — stream indefinitely
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return nil
			}
			return fmt.Errorf("read error: %w", err)
		}

		var msg logMsg
		if jsonErr := json.Unmarshal(raw, &msg); jsonErr != nil {
			fmt.Println(string(raw))
			continue
		}

		ts := msg.Timestamp
		if len(ts) >= 19 {
			ts = ts[11:19] // HH:MM:SS
		}

		src := ""
		if msg.Source == "stderr" {
			src = " \033[31m[err]\033[0m"
		}

		fmt.Printf("\033[90m%s\033[0m%s  %s\n", ts, src, msg.Message)
	}
}
