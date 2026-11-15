// boardload exercises a throwaway backend. It leaves its users, guild and board
// behind for inspection. Example: go run ./cmd/boardload -users 5 -duration 10s
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type config struct {
	base, db, scenario string
	users              int
	rate               float64
	duration, interval time.Duration
}

type user struct {
	id, name, token                      string
	events, bytes, allBytes, disconnects atomic.Int64
	recording                            atomic.Bool
	conn                                 *websocket.Conn
}

type sample struct {
	statuses map[int]int64 // status 0 means a transport/read failure
	latency  []time.Duration
	success  int64
}

type metrics struct {
	mu     sync.Mutex
	groups map[string]*sample
}

func (m *metrics) add(group string, status int, elapsed time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.groups[group]
	if s == nil {
		s = &sample{statuses: make(map[int]int64)}
		m.groups[group] = s
	}
	s.statuses[status]++
	s.latency = append(s.latency, elapsed)
	if status >= 200 && status < 300 {
		s.success++
	}
}

type runner struct {
	cfg    config
	client *http.Client
	stats  metrics
}

type response struct {
	status int
	body   []byte
	retry  time.Duration
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// The frontend uses a 1s fallback and caps Retry-After at 10s.
func retryAfter(value string) time.Duration {
	d := time.Second
	if seconds, err := strconv.ParseFloat(value, 64); err == nil && seconds > 0 && !math.IsInf(seconds, 0) {
		d = time.Duration(math.Min(seconds, 10) * float64(time.Second))
	} else if date, err := http.ParseTime(value); err == nil && time.Until(date) > 0 {
		d = time.Until(date)
	}
	if d > 10*time.Second {
		d = 10 * time.Second
	}
	return d
}

// Measurements are per HTTP attempt, including 429s, excluding backoff sleeps.
// Retry the identical bytes/opId on 429, never create a replacement command.
func (r *runner) request(ctx context.Context, group, method, path, token string, body []byte, retry bool) (response, error) {
	for {
		req, err := http.NewRequestWithContext(ctx, method, r.cfg.base+path, bytes.NewReader(body))
		if err != nil {
			return response{}, err
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		start := time.Now()
		res, err := r.client.Do(req)
		out := response{}
		if err == nil {
			out.status = res.StatusCode
			out.retry = retryAfter(res.Header.Get("Retry-After"))
			out.body, err = io.ReadAll(res.Body)
			res.Body.Close()
		}
		status := out.status
		if err != nil {
			status = 0
		}
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		r.stats.add(group, status, time.Since(start))
		if err != nil {
			return out, err
		}
		if out.status != http.StatusTooManyRequests || !retry {
			return out, nil
		}
		if group == "setup" {
			fmt.Printf("setup: %s rate limited; retry in %s\n", path, out.retry)
		}
		if !sleep(ctx, out.retry) {
			return out, ctx.Err()
		}
	}
}

func encode(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func (r *runner) setupCall(ctx context.Context, method, path, token string, body any, dest any) error {
	var raw []byte
	if body != nil {
		raw = encode(body)
	}
	res, err := r.request(ctx, "setup", method, path, token, raw, true)
	if err != nil {
		return err
	}
	if res.status < 200 || res.status >= 300 {
		return fmt.Errorf("%s %s: HTTP %d: %.500s", method, path, res.status, res.body)
	}
	if dest != nil {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(res.body, &envelope); err != nil {
			return err
		}
		return json.Unmarshal(envelope.Data, dest)
	}
	return nil
}

func (r *runner) setup(ctx context.Context) ([]*user, string, error) {
	prefix := "bl" + strconv.FormatInt(time.Now().UnixMilli(), 36) + strings.ReplaceAll(uuid(), "-", "")[:6]
	password := "Boardload" + uuid()
	users := make([]*user, r.cfg.users)
	var db *pgx.Conn
	defer func() {
		if db != nil {
			_ = db.Close(context.Background())
		}
	}()
	var hash []byte
	dbUsers := 0
	for i := range users {
		name := fmt.Sprintf("%su%d", prefix, i)
		email := name + "@boardload.invalid"
		registration := encode(map[string]any{"username": name, "email": email, "password": password})
		res, err := r.request(ctx, "setup", "POST", "/auth/register", "", registration, false)
		if err != nil {
			return nil, "", err
		}
		if res.status == 429 && r.cfg.db != "" {
			// Only registration is bypassed, and only after the API rate limit fires.
			if db == nil {
				db, err = pgx.Connect(ctx, r.cfg.db)
				if err != nil {
					return nil, "", fmt.Errorf("registration rate limited; DB fallback: %w", err)
				}
				hash, err = bcrypt.GenerateFromPassword([]byte(password), 12)
				if err != nil {
					return nil, "", err
				}
			}
			_, err = db.Exec(ctx, "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)", name, email, string(hash))
			if err != nil {
				return nil, "", fmt.Errorf("create rate-limited user: %w", err)
			}
			dbUsers++
		} else if res.status == 429 {
			if !sleep(ctx, res.retry) {
				return nil, "", ctx.Err()
			}
			if err := r.setupCall(ctx, "POST", "/auth/register", "", json.RawMessage(registration), nil); err != nil {
				return nil, "", err
			}
		} else if res.status < 200 || res.status >= 300 {
			return nil, "", fmt.Errorf("register: HTTP %d: %.500s", res.status, res.body)
		}
		var auth struct {
			AccessToken string `json:"accessToken"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		}
		if err := r.setupCall(ctx, "POST", "/auth/login", "", map[string]any{"email": email, "password": password, "rememberMe": true}, &auth); err != nil {
			return nil, "", err
		}
		if auth.AccessToken == "" || auth.User.ID == "" {
			return nil, "", fmt.Errorf("login returned missing token/user ID")
		}
		users[i] = &user{id: auth.User.ID, name: name, token: auth.AccessToken}
	}
	fmt.Printf("setup: prefix=%s users=%d direct DB user inserts=%d (all users logged in via HTTP)\n", prefix, len(users), dbUsers)
	var guild, channel struct {
		ID string `json:"id"`
	}
	if err := r.setupCall(ctx, "POST", "/guilds", users[0].token, map[string]string{"name": prefix}, &guild); err != nil {
		return nil, "", err
	}
	var invite struct {
		Code string `json:"code"`
	}
	if err := r.setupCall(ctx, "POST", "/guilds/"+guild.ID+"/invites", users[0].token, map[string]any{}, &invite); err != nil {
		return nil, "", err
	}
	for _, u := range users[1:] {
		if err := r.setupCall(ctx, "POST", "/invites/"+invite.Code+"/join", u.token, nil, nil); err != nil {
			return nil, "", err
		}
	}
	if err := r.setupCall(ctx, "POST", "/guilds/"+guild.ID+"/channels", users[0].token, map[string]string{"name": "load", "type": "whiteboard"}, &channel); err != nil {
		return nil, "", err
	}
	fmt.Printf("setup: guild=%s channel=%s; resources retained; quota/size rejections are not bypassed\n", guild.ID, channel.ID)
	return users, channel.ID, nil
}

func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

type event struct {
	Op string          `json:"op"`
	D  json.RawMessage `json:"d"`
	S  int64           `json:"s"`
}

// Authentication is the real client's token query parameter, not IDENTIFY
// (this server has no IDENTIFY opcode). HELLO sets the heartbeat interval.
func (r *runner) gateway(ctx context.Context, u *user, channel string, wg *sync.WaitGroup) error {
	endpoint, err := url.Parse(r.cfg.base)
	if err != nil {
		return err
	}
	if endpoint.Scheme == "https" {
		endpoint.Scheme = "wss"
	} else {
		endpoint.Scheme = "ws"
	}
	endpoint.Path = "/gateway"
	q := endpoint.Query()
	q.Set("token", u.token)
	endpoint.RawQuery = q.Encode()
	conn, res, err := websocket.DefaultDialer.DialContext(ctx, endpoint.String(), nil)
	if res != nil && res.Body != nil {
		res.Body.Close()
	}
	if err != nil {
		return fmt.Errorf("gateway dial: %w", err)
	}
	u.conn = conn
	ready := make(chan error, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer conn.Close()
		var writeMu sync.Mutex
		var seq atomic.Int64
		socketCtx, cancel := context.WithCancel(ctx)
		var helpers sync.WaitGroup
		defer func() {
			cancel()
			helpers.Wait()
		}()
		helpers.Add(1)
		go func() { defer helpers.Done(); <-socketCtx.Done(); conn.Close() }()
		send := func(v any) error {
			writeMu.Lock()
			defer writeMu.Unlock()
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			return conn.WriteJSON(v)
		}
		subscribed, heartbeatStarted := false, false
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				if socketCtx.Err() == nil {
					u.disconnects.Add(1)
				}
				if !subscribed {
					select {
					case ready <- fmt.Errorf("gateway read: %w", err):
					default:
					}
				}
				return
			}
			var e event
			if err := json.Unmarshal(raw, &e); err != nil {
				continue
			}
			seq.Store(e.S)
			if u.recording.Load() {
				u.allBytes.Add(int64(len(raw)))
				if strings.HasPrefix(e.Op, "BOARD_") {
					u.events.Add(1)
					u.bytes.Add(int64(len(raw)))
				}
			}
			switch e.Op {
			case "HELLO":
				if heartbeatStarted {
					continue
				}
				heartbeatStarted = true
				var hello struct {
					Interval int `json:"heartbeatInterval"`
				}
				_ = json.Unmarshal(e.D, &hello)
				if hello.Interval <= 0 {
					hello.Interval = 30000
				}
				helpers.Add(1)
				go func(interval time.Duration) {
					defer helpers.Done()
					ticker := time.NewTicker(interval)
					defer ticker.Stop()
					for {
						select {
						case <-socketCtx.Done():
							return
						case <-ticker.C:
							if err := send(map[string]any{"op": "HEARTBEAT", "s": seq.Load()}); err != nil {
								conn.Close()
								return
							}
						}
					}
				}(time.Duration(hello.Interval) * time.Millisecond)
			case "READY":
				if err := send(map[string]any{"op": "BOARD_SUBSCRIBE", "d": map[string]string{"channelId": channel}}); err != nil {
					ready <- err
					return
				}
			case "BOARD_SUBSCRIBED":
				if !subscribed {
					subscribed = true
					ready <- nil
				}
			}
		}
	}()
	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	select {
	case err := <-ready:
		return err
	case <-ctx.Done():
		conn.Close()
		return ctx.Err()
	case <-timer.C:
		conn.Close()
		return fmt.Errorf("gateway subscription timeout for %s", u.name)
	}
}

func command(u *user, paste bool, serial int) []byte {
	count := 1
	if paste {
		count = 500
	}
	changes := make([]any, 0, count)
	for i := 0; i < count; i++ {
		id := uuid()
		body := map[string]any{"id": id, "version": 0, "createdBy": u.id, "rank": "1:a0", "x": (serial*31 + i*37) % 2000, "y": (serial*17 + i*29) % 2000, "w": 120, "h": 80}
		if paste {
			body["kind"] = "rect"
			body["style"] = map[string]string{"colour": "blue", "weight": "thin", "fill": "tint"}
		} else {
			n := 50 + serial%151
			points := make([]map[string]float64, n)
			minY, maxY := math.Inf(1), math.Inf(-1)
			for j := range points {
				t := float64(j) / float64(n-1)
				y := math.Sin(t*math.Pi*3+float64(serial)) * 30
				minY = math.Min(minY, y)
				maxY = math.Max(maxY, y)
				points[j] = map[string]float64{"x": math.Round(t*120*100) / 100, "y": y, "pressure": 0.4 + 0.3*math.Sin(t*math.Pi)}
			}
			for _, p := range points {
				p["y"] -= minY
			}
			body["h"] = maxY - minY
			body["kind"], body["preset"], body["points"] = "stroke", "pen", points
			body["style"] = map[string]string{"colour": "ink", "weight": "thin"}
		}
		changes = append(changes, map[string]any{"id": id, "action": "create", "expectedVersion": 0, "body": body})
	}
	return encode(map[string]any{"opId": uuid(), "changes": changes})
}

func (r *runner) workload(ctx context.Context, u *user, channel, scenario string) {
	path := "/channels/" + channel + "/board"
	if scenario == "reconnect" {
		for ctx.Err() == nil {
			_, err := r.request(ctx, "snapshot", "GET", path, u.token, nil, true)
			if err != nil && !sleep(ctx, time.Second) {
				return
			}
		}
		return
	}
	interval := time.Duration(float64(time.Second) / r.cfg.rate)
	if scenario == "paste" {
		interval = r.cfg.interval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for serial := 0; ctx.Err() == nil; serial++ {
		_, err := r.request(ctx, "ops", "POST", path+"/ops", u.token, command(u, scenario == "paste", serial), true)
		if err != nil && !sleep(ctx, time.Second) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func percentiles(values []time.Duration) string {
	if len(values) == 0 {
		return "n=0"
	}
	sorted := append([]time.Duration(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	p := func(q float64) time.Duration {
		return sorted[int(math.Ceil(q*float64(len(sorted))))-1].Round(time.Microsecond)
	}
	return fmt.Sprintf("n=%d p50=%s p95=%s p99=%s max=%s", len(sorted), p(.5), p(.95), p(.99), sorted[len(sorted)-1].Round(time.Microsecond))
}

func (r *runner) report(elapsed time.Duration, users []*user, final bool) {
	r.stats.mu.Lock()
	defer r.stats.mu.Unlock()
	label := "progress"
	if final {
		label = "final"
	}
	var commands, snapshots int64
	if s := r.stats.groups["ops"]; s != nil {
		commands = s.success
	}
	if s := r.stats.groups["snapshot"]; s != nil {
		snapshots = s.success
	}
	var events, received int64
	for _, u := range users {
		events += u.events.Load()
		received += u.bytes.Load()
	}
	fmt.Printf("%s elapsed=%.2fs commands=%d achieved=%.2f commands/s snapshots=%d (%.2f/s) board_events=%d board_MB=%.3f\n", label, elapsed.Seconds(), commands, float64(commands)/elapsed.Seconds(), snapshots, float64(snapshots)/elapsed.Seconds(), events, float64(received)/1e6)
	for _, group := range []string{"setup", "ops", "snapshot", "probe"} {
		s := r.stats.groups[group]
		if s == nil {
			continue
		}
		if group == "setup" && !final {
			continue
		}
		keys := make([]int, 0, len(s.statuses))
		for status := range s.statuses {
			keys = append(keys, status)
		}
		sort.Ints(keys)
		fmt.Printf("  %s statuses:", group)
		var other int64
		for _, status := range keys {
			fmt.Printf(" %d=%d", status, s.statuses[status])
			if status < 200 || status >= 300 {
				if status != 413 && status != 422 && status != 429 {
					other += s.statuses[status]
				}
			}
		}
		fmt.Printf(" | 413=%d 422=%d 429=%d other_errors=%d | latency %s\n", s.statuses[413], s.statuses[422], s.statuses[429], other, percentiles(s.latency))
	}
	if final {
		for i, u := range users {
			fmt.Printf("  gateway user=%d name=%s board_events=%d board_MB=%.3f total_MB=%.3f disconnects=%d\n", i, u.name, u.events.Load(), float64(u.bytes.Load())/1e6, float64(u.allBytes.Load())/1e6, u.disconnects.Load())
		}
		fmt.Println("latencies include response body reads, exclude 429 backoff; MB=1,000,000 decoded websocket payload bytes; setup excluded from throughput/fanout")
	}
}

func run() error {
	var cfg config
	flag.StringVar(&cfg.base, "base-url", "http://localhost:8090", "throwaway HTTP backend")
	flag.StringVar(&cfg.db, "db-url", "postgres://postgres:wbtest@127.0.0.1:55439/wbtest?sslmode=disable", "registration-429-only DB fallback; empty disables")
	flag.IntVar(&cfg.users, "users", 20, "number of users")
	flag.StringVar(&cfg.scenario, "scenario", "draw", "draw, paste, reconnect, mixed")
	flag.Float64Var(&cfg.rate, "rate", 5, "draw commands per second per user")
	flag.DurationVar(&cfg.duration, "duration", 60*time.Second, "measurement duration, excluding setup")
	flag.DurationVar(&cfg.interval, "interval", 5*time.Second, "paste interval per user")
	flag.Parse()
	cfg.base = strings.TrimRight(cfg.base, "/")
	parsed, err := url.Parse(cfg.base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("invalid base-url")
	}
	if cfg.users < 1 || cfg.duration <= 0 || cfg.interval <= 0 || math.IsNaN(cfg.rate) || math.IsInf(cfg.rate, 0) || cfg.rate <= 0 || cfg.rate > float64(time.Second) {
		return fmt.Errorf("users, duration, interval and rate must be positive (rate <= 1e9)")
	}
	switch cfg.scenario {
	case "draw", "paste", "reconnect", "mixed":
	default:
		return fmt.Errorf("unknown scenario %q", cfg.scenario)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = cfg.users*3 + 10
	transport.MaxIdleConnsPerHost = cfg.users*3 + 10
	defer transport.CloseIdleConnections()
	r := &runner{cfg: cfg, client: &http.Client{Transport: transport, Timeout: 30 * time.Second}, stats: metrics{groups: make(map[string]*sample)}}
	setupCtx, setupCancel := context.WithTimeout(ctx, 30*time.Minute)
	defer setupCancel()
	users, channel, err := r.setup(setupCtx)
	if err != nil {
		return fmt.Errorf("setup: %w", err)
	}
	socketCtx, closeSockets := context.WithCancel(ctx)
	var sockets sync.WaitGroup
	defer func() { closeSockets(); sockets.Wait() }()
	for _, u := range users {
		if err := r.gateway(socketCtx, u, channel, &sockets); err != nil {
			return err
		}
		// Real initial recovery sequence: subscribe, wait for acknowledgement, GET.
		if err := r.setupCall(setupCtx, "GET", "/channels/"+channel+"/board", u.token, nil, nil); err != nil {
			return err
		}
	}
	draw, paste := cfg.users, 0
	if cfg.scenario == "mixed" {
		draw = int(math.Round(float64(cfg.users) * .7))
		paste = int(math.Round(float64(cfg.users) * .2))
		if draw+paste > cfg.users {
			paste = cfg.users - draw
		}
	}
	fmt.Printf("run scenario=%s users=%d duration=%s rate=%.2f interval=%s", cfg.scenario, cfg.users, cfg.duration, cfg.rate, cfg.interval)
	if cfg.scenario == "mixed" {
		fmt.Printf(" allocation draw=%d paste=%d reconnect=%d", draw, paste, cfg.users-draw-paste)
	}
	fmt.Println()
	runCtx, stop := context.WithTimeout(ctx, cfg.duration)
	defer stop()
	for _, u := range users {
		u.recording.Store(true)
	}
	start := time.Now()
	var workers sync.WaitGroup
	for i, u := range users {
		scenario := cfg.scenario
		if scenario == "mixed" {
			scenario = "reconnect"
			if i < draw {
				scenario = "draw"
			} else if i < draw+paste {
				scenario = "paste"
			}
		}
		workers.Add(1)
		go func(u *user, scenario string) { defer workers.Done(); r.workload(runCtx, u, channel, scenario) }(u, scenario)
	}
	workers.Add(1)
	go func() {
		defer workers.Done()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
				_, _ = r.request(runCtx, "probe", "GET", "/users/me/guilds", users[0].token, nil, true)
			}
		}
	}()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for running := true; running; {
		select {
		case <-runCtx.Done():
			running = false
		case <-ticker.C:
			r.report(time.Since(start), users, false)
		}
	}
	workers.Wait()
	elapsed := time.Since(start)
	// Allow already-committed fanout a short bounded drain, outside measured time.
	_ = sleep(ctx, 250*time.Millisecond)
	for _, u := range users {
		u.recording.Store(false)
	}
	closeSockets()
	sockets.Wait()
	r.report(elapsed, users, true)
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "boardload:", err)
		os.Exit(1)
	}
}
