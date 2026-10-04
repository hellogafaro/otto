package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	auth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	log "github.com/sirupsen/logrus"
)

const testModel = "gpt-5.4"

func testJWT(id, stage string) string {
	raw, _ := json.Marshal(map[string]any{"synthetic": stage, "email": "synthetic@example.invalid", "https://api.openai.com/auth": map[string]string{"chatgpt_account_id": id, "chatgpt_plan_type": "plus"}})
	return "synthetic." + base64.RawURLEncoding.EncodeToString(raw) + ".synthetic"
}
func testCredential(id string) credential {
	return credential{Provider: "codex", AccountID: id, AccessToken: testJWT(id, "initial"), RefreshToken: "synthetic-refresh-" + id, Expired: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}
}

type fixture struct {
	mu                                       sync.Mutex
	credentials                              map[string]credential
	generation                               map[string]int
	refresh                                  map[string]int
	models                                   map[string]int
	mode                                     string
	putFail                                  bool
	lostAck                                  bool
	revoked                                  bool
	puts                                     int
	refreshGate                              chan struct{}
	modelsGate                               chan struct{}
	entered                                  chan struct{}
	stopped                                  chan struct{}
	wrongModel                               bool
	authenticatedAt                          string
	cacheKey, nativeSession, reasoningEffort string
}

func (f *fixture) store(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer synthetic-store-key" {
		w.WriteHeader(401)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/internal/gateway/accounts/")
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.revoked {
		w.WriteHeader(403)
		return
	}
	c, ok := f.credentials[id]
	if !ok {
		w.WriteHeader(404)
		return
	}
	if r.Method == "PUT" {
		f.puts++
		var put struct {
			Expected        string     `json:"expectedFingerprint"`
			AuthenticatedAt string     `json:"expectedAuthenticatedAt"`
			Credential      credential `json:"credential"`
		}
		if json.NewDecoder(r.Body).Decode(&put) != nil || put.Expected != fingerprint(c) || put.AuthenticatedAt != f.authenticatedAt {
			w.WriteHeader(409)
			return
		}
		if f.putFail {
			w.WriteHeader(503)
			return
		}
		f.credentials[id] = put.Credential
		c = put.Credential
		if f.lostAck {
			w.WriteHeader(503)
			return
		}
	}
	json.NewEncoder(w).Encode(savedCredential{Credential: c, Fingerprint: fingerprint(c), AuthenticatedAt: f.authenticatedAt})
}
func (f *fixture) peer(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/oauth/token" {
		r.ParseForm()
		id := strings.TrimPrefix(r.Form.Get("refresh_token"), "synthetic-refresh-")
		f.mu.Lock()
		f.refresh[id]++
		mode := f.mode
		gate := f.refreshGate
		f.mu.Unlock()
		f.entered <- struct{}{}
		if gate != nil {
			select {
			case <-gate:
			case <-r.Context().Done():
				return
			}
		}
		if mode == "invalid" {
			w.WriteHeader(400)
			io.WriteString(w, `{"error":"invalid_grant","message":"synthetic-sensitive-marker"}`)
			return
		}
		if mode == "foreign" {
			id = "B"
		}
		json.NewEncoder(w).Encode(map[string]any{"access_token": testJWT(id, "rotated"), "refresh_token": "synthetic-refresh-" + id, "expires_in": 3600})
		return
	}
	id := r.Header.Get("Chatgpt-Account-Id")
	if accountID(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) != id {
		w.WriteHeader(401)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/models") {
		f.mu.Lock()
		f.models[id]++
		gate := f.modelsGate
		f.mu.Unlock()
		if gate != nil {
			f.entered <- struct{}{}
			select {
			case <-gate:
			case <-r.Context().Done():
				return
			}
		}
		models := []map[string]string{{"slug": testModel}}
		if id == "B" {
			models = append(models, map[string]string{"slug": "B-only"})
		}
		json.NewEncoder(w).Encode(map[string]any{"models": models})
		return
	}
	var body struct {
		Model     string `json:"model"`
		CacheKey  string `json:"prompt_cache_key"`
		Reasoning struct {
			Effort string `json:"effort"`
		} `json:"reasoning"`
		Tools []struct {
			Type string `json:"type"`
		} `json:"tools"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	for _, tool := range body.Tools {
		if tool.Type != "function" {
			w.WriteHeader(400)
			return
		}
	}
	if body.Model != testModel {
		w.WriteHeader(400)
		return
	}
	f.mu.Lock()
	f.cacheKey = body.CacheKey
	f.nativeSession = r.Header.Get("Session-Id")
	f.reasoningEffort = body.Reasoning.Effort
	f.generation[id]++
	mode := f.mode
	wrong := f.wrongModel
	f.mu.Unlock()
	if strings.HasPrefix(mode, "hold-B/") {
		if id == "B" {
			mode = "hang"
		} else {
			mode = strings.TrimPrefix(mode, "hold-B/")
		}
	}
	if mode == "429" {
		w.WriteHeader(429)
		io.WriteString(w, `{"error":{"message":"fixture rate limit"}}`)
		return
	}
	if mode == "401" || mode == "invalid" || mode == "foreign" {
		if strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") == testJWT("A", "initial") {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":{"message":"synthetic-sensitive-marker"}}`)
			return
		}
	}
	w.Header().Set("Content-Type", "text/event-stream")
	if mode == "flood" {
		payload, _ := json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": strings.Repeat("x", 64<<10)})
		f.entered <- struct{}{}
		for {
			if _, e := fmt.Fprintf(w, "data: %s\n\n", payload); e != nil {
				f.stopped <- struct{}{}
				return
			}
			w.(http.Flusher).Flush()
			select {
			case <-r.Context().Done():
				f.stopped <- struct{}{}
				return
			default:
			}
		}
	}
	if mode == "hang" {
		io.WriteString(w, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"synthetic\"}}\n\n")
		w.(http.Flusher).Flush()
		f.entered <- struct{}{}
		select {
		case <-r.Context().Done():
			f.stopped <- struct{}{}
		case <-time.After(2 * time.Second):
		}
		return
	}
	if mode == "huge" {
		io.WriteString(w, "data: "+strings.Repeat("x", maxFrameBytes+1)+"\n\n")
		return
	}
	served := testModel
	if wrong {
		served = "foreign-model"
	}
	payload, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": "synthetic-response", "object": "response", "status": "completed", "model": served, "output": []any{}, "usage": map[string]int{"input_tokens": 7, "output_tokens": 3, "total_tokens": 10}}})
	if mode == "sse-events" || mode == "sse-crlf" {
		delimiter := "\n"
		if mode == "sse-crlf" {
			delimiter = "\r\n"
		}
		fmt.Fprintf(w, ": synthetic keepalive%s%s", delimiter, delimiter)
		fmt.Fprintf(w, "event: response.created%sdata: {\"type\":\"response.created\",\"response\":{\"id\":\"synthetic-response\",\"model\":\"%s\"}}%s%s", delimiter, testModel, delimiter, delimiter)
		tool, _ := json.Marshal(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "function_call", "id": "synthetic-fc", "call_id": "synthetic-call", "name": "scoped_tool", "arguments": ""}})
		fmt.Fprintf(w, "event: response.output_item.added%sdata: %s%s%s", delimiter, tool, delimiter, delimiter)
		arguments, _ := json.Marshal(map[string]any{"type": "response.function_call_arguments.delta", "item_id": "synthetic-fc", "output_index": 0, "delta": `{"synthetic":true}`})
		fmt.Fprintf(w, "event: response.function_call_arguments.delta%sdata: %s%s%s", delimiter, arguments, delimiter, delimiter)
		fmt.Fprintf(w, "event: response.output_text.delta%sdata: {\"type\":\"response.output_text.delta\",\"delta\":\"synthetic text\"}%s%s", delimiter, delimiter, delimiter)
		fmt.Fprintf(w, "event: response.completed%sdata: %s%s%s", delimiter, payload, delimiter, delimiter)
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", payload)
}

type fixtureTransport struct {
	base   http.RoundTripper
	peer   *url.URL
	denied atomic.Int32
}

func (t *fixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	q := r.Clone(r.Context())
	u := *r.URL
	q.URL = &u
	if r.URL.Host == "auth.openai.com" && r.URL.Path == "/oauth/token" || r.URL.Host == "chatgpt.com" && strings.HasPrefix(r.URL.Path, "/backend-api/codex/") {
		q.URL.Scheme = t.peer.Scheme
		q.URL.Host = t.peer.Host
		q.Host = t.peer.Host
	}
	if q.URL.Hostname() != "127.0.0.1" {
		t.denied.Add(1)
		return nil, errors.New("nonfixture network denied")
	}
	return t.base.RoundTrip(q)
}

type running struct {
	peer   string
	g      *gateway
	f      *fixture
	url    string
	client *http.Client
}

func setup(t *testing.T) *running { return setupTimeout(t, requestTimeout) }
func setupTimeout(t *testing.T, timeout time.Duration) *running {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)
	log.SetOutput(io.Discard)
	f := &fixture{authenticatedAt: "2026-10-03T09:00:00.000Z", credentials: map[string]credential{"sub-A": testCredential("A"), "sub-B": testCredential("B")}, generation: map[string]int{}, refresh: map[string]int{}, models: map[string]int{}, entered: make(chan struct{}, 8), stopped: make(chan struct{}, 8)}
	peer := httptest.NewServer(http.HandlerFunc(f.peer))
	storeServer := httptest.NewServer(http.HandlerFunc(f.store))
	t.Cleanup(storeServer.Close)
	t.Cleanup(peer.Close)
	u, _ := url.Parse(peer.URL)
	old := http.DefaultTransport
	transport := &fixtureTransport{base: old, peer: u}
	http.DefaultTransport = boundedTransport{base: transport}
	t.Cleanup(func() {
		http.DefaultTransport = old
		if transport.denied.Load() != 0 {
			t.Errorf("unexpected external requests %d", transport.denied.Load())
		}
	})
	s := &accountStore{base: storeServer.URL, key: "synthetic-store-key", client: &http.Client{Transport: transport, Timeout: time.Second}, saved: map[string]savedCredential{}, blocked: map[string]accountBlock{}}
	g := &gateway{timeout: timeout, key: "synthetic-gateway-key", store: s, transport: transport, upstream: "https://chatgpt.com/backend-api/codex"}
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "config.yaml"), []byte("{}\n"), 0600)
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	cfg := &config.Config{Host: "127.0.0.1", Port: port, AuthDir: filepath.Join(root, "auth")}
	cfg.RemoteManagement.DisableControlPanel = true
	ctx, cancel := context.WithCancel(context.Background())
	svc, e := startGateway(ctx, g, cfg, root)
	if e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() { done <- svc.Run(ctx) }()
	result := &running{peer: peer.URL, g: g, f: f, url: fmt.Sprintf("http://127.0.0.1:%d", port), client: &http.Client{Transport: transport, Timeout: 4 * time.Second}}
	deadline := time.Now().Add(3 * time.Second)
	for {
		req, _ := http.NewRequest("GET", result.url+"/otto/ready", nil)
		req.Header.Set("Authorization", "Bearer synthetic-gateway-key")
		resp, e := result.client.Do(req)
		if e == nil {
			resp.Body.Close()
			if resp.StatusCode == 204 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("gateway readiness timeout")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("gateway did not stop")
		}
		filepath.Walk(root, func(p string, info os.FileInfo, e error) error {
			if e == nil && !info.IsDir() {
				data, _ := os.ReadFile(p)
				if bytes.Contains(data, []byte("synthetic-refresh")) {
					t.Error("credential written to ordinary file")
				}
			}
			return nil
		})
	})
	return result
}
func (r *running) request(t *testing.T, id, path, body string, stream bool) (int, []byte) {
	t.Helper()
	method := "POST"
	if strings.Contains(path, "models") {
		method = "GET"
	}
	req, _ := http.NewRequest(method, r.url+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer synthetic-gateway-key")
	req.Header.Set("X-Otto-Subscription-Id", "sub-"+id)
	req.Header.Set("X-Otto-Account-Id", id)
	req.Header.Set("X-Otto-Model", testModel)
	req.Header.Set("X-Otto-Attempt-Id", "synthetic-attempt-"+id)
	req.Header.Set("X-Pinned-Auth-Id", "B")
	req.Header.Set("Chatgpt-Account-Id", "B")
	resp, e := r.client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}
func input(stream bool) string {
	return fmt.Sprintf(`{"model":"%s","input":[{"role":"user","content":"synthetic hello"}],"stream":%t}`, testModel, stream)
}
func TestExactAccountRefreshAndModel(t *testing.T) {
	for _, mode := range []string{"success", "429", "401", "invalid", "foreign"} {
		t.Run(mode, func(t *testing.T) {
			r := setup(t)
			r.f.mu.Lock()
			r.f.mode = mode
			r.f.mu.Unlock()
			status, raw := r.request(t, "A", "/otto/v1/responses", input(false), false)
			r.f.mu.Lock()
			defer r.f.mu.Unlock()
			if (mode == "success" || mode == "401") && status != 200 {
				t.Fatalf("status %d", status)
			}
			if mode != "success" && mode != "401" && status == 200 {
				t.Fatal("accepted failure")
			}
			if r.f.generation["B"] != 0 || r.f.refresh["B"] != 0 || r.f.models["B"] != 0 {
				t.Fatal("account fallback")
			}
			if bytes.Contains(raw, []byte("synthetic-sensitive-marker")) || bytes.Contains(raw, []byte("synthetic-refresh")) {
				t.Fatal("unsafe error exposure")
			}
			t.Logf("mode=%s status=%d A_generation=%d A_refresh=%d B_generation=%d B_refresh=%d", mode, status, r.f.generation["A"], r.f.refresh["A"], r.f.generation["B"], r.f.refresh["B"])
		})
	}
}
func TestModelDiscoveryAndSpoofing(t *testing.T) {
	r := setup(t)
	for _, id := range []string{"A", "B"} {
		status, body := r.request(t, id, "/otto/v1/models", "", false)
		if status != 200 || bytes.Contains(body, []byte("B-only")) != (id == "B") {
			t.Fatalf("catalog scope %s status=%d", id, status)
		}
	}
	for _, body := range []string{`{"model":"B-only"}`, `{"model":"auto"}`, `{"model":"gpt-5.4(high)"}`, `{"model":"gpt-5.4","metadata":{"account_id":"B"}}`} {
		s, _ := r.request(t, "A", "/otto/v1/responses", body, false)
		if s == 200 {
			t.Fatal("spoof body accepted")
		}
	}
	for _, path := range []string{"/v1/responses", "/v0/management/auth-files", "/otto/v1/responses?account=B"} {
		s, _ := r.request(t, "A", path, input(false), false)
		if s == 200 {
			t.Fatal("bypass route")
		}
	}
	s, _ := r.request(t, "unknown", "/otto/v1/responses", input(false), false)
	if s == 200 {
		t.Fatal("unknown account accepted")
	}
	s, _ = r.request(t, "A", "/otto/v1/responses", input(false), false)
	if s != 200 {
		t.Fatalf("header spoof guard broke valid request %d", s)
	}
	t.Log("account-scoped fake model discovery; spoof/body/alias/unknown account denied; ignored caller routing headers")
}
func TestRawServedModelMismatch(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			r := setup(t)
			r.f.mu.Lock()
			r.f.wrongModel = true
			r.f.mu.Unlock()
			s, body := r.request(t, "A", "/otto/v1/responses", input(stream), stream)
			if s == 200 || bytes.Contains(body, []byte("foreign-model")) {
				t.Fatalf("mismatched model escaped %d", s)
			}
			t.Logf("stream=%t foreign served model rejected status=%d", stream, s)
		})
	}
}
func TestRotationStoreFailureAndLostAck(t *testing.T) {
	for _, lost := range []bool{false, true} {
		t.Run(fmt.Sprint(lost), func(t *testing.T) {
			r := setup(t)
			r.f.mu.Lock()
			r.f.mode = "401"
			r.f.putFail = !lost
			r.f.lostAck = lost
			r.f.mu.Unlock()
			s, _ := r.request(t, "A", "/otto/v1/responses", input(false), false)
			if s == 200 {
				t.Fatal("rotation failure accepted")
			}
			if manager := r.activeManager("sub-A"); manager != nil {
				t.Fatal("credential retained after request")
			}
			r.f.mu.Lock()
			defer r.f.mu.Unlock()
			if r.f.generation["A"] != 1 || r.f.refresh["A"] != 1 || r.f.generation["B"] != 0 {
				t.Fatal("rotation failure retried or fell back")
			}
			t.Logf("lostAck=%t status=%d generation=%d refresh=%d puts=%d; no rotated token installed", lost, s, r.f.generation["A"], r.f.refresh["A"], r.f.puts)
		})
	}
}
func TestConcurrentRevokeDuringRefresh(t *testing.T) {
	r := setup(t)
	r.f.mu.Lock()
	r.f.mode = "401"
	r.f.refreshGate = make(chan struct{})
	gate := r.f.refreshGate
	r.f.mu.Unlock()
	done := make(chan int, 1)
	go func() { s, _ := r.request(t, "A", "/otto/v1/responses", input(false), false); done <- s }()
	select {
	case <-r.f.entered:
	case <-time.After(time.Second):
		t.Fatal("not refreshing")
	}
	r.f.mu.Lock()
	r.f.revoked = true
	r.f.mu.Unlock()
	close(gate)
	if s := <-done; s == 200 {
		t.Fatal("revoked refresh succeeded")
	}
	r.f.mu.Lock()
	defer r.f.mu.Unlock()
	if r.f.generation["A"] != 1 || r.f.generation["B"] != 0 {
		t.Fatal("revocation admitted retry")
	}
	t.Log("revoke during refresh prevents CAS/install and next upstream generation")
}
func TestCASRejectsConcurrentReauth(t *testing.T) {
	r := setup(t)
	r.f.mu.Lock()
	r.f.mode = "401"
	r.f.refreshGate = make(chan struct{})
	gate := r.f.refreshGate
	r.f.mu.Unlock()
	done := make(chan int, 1)
	go func() { s, _ := r.request(t, "A", "/otto/v1/responses", input(false), false); done <- s }()
	select {
	case <-r.f.entered:
	case <-time.After(time.Second):
		t.Fatal("not refreshing")
	}
	r.f.mu.Lock()
	next := r.f.credentials["sub-A"]
	next.AccessToken = testJWT("A", "reauth")
	r.f.credentials["sub-A"] = next
	r.f.mu.Unlock()
	close(gate)
	if s := <-done; s == 200 {
		t.Fatal("stale refresh overwrote reauth")
	}
	r.f.mu.Lock()
	defer r.f.mu.Unlock()
	if r.f.credentials["sub-A"].AccessToken != testJWT("A", "reauth") || r.f.generation["A"] != 1 {
		t.Fatal("reauth lost")
	}
	t.Log("concurrent reauth CAS409 preserved newer durable credential; no stale retry")
}
func TestStreamCancellationBoundsAndUsage(t *testing.T) {
	r := setup(t)
	s, raw := r.request(t, "A", "/otto/v1/responses", input(true), true)
	if s != 200 || !bytes.Contains(raw, []byte(`"total_tokens":10`)) {
		t.Fatalf("native usage missing %d", s)
	}
	r.f.mu.Lock()
	r.f.mode = "huge"
	r.f.mu.Unlock()
	s, raw = r.request(t, "A", "/otto/v1/responses", input(true), true)
	if s == 200 || len(raw) > maxFrameBytes {
		t.Fatal("oversize frame escaped")
	}
	r = setup(t)
	r.f.mu.Lock()
	r.f.mode = "hang"
	r.f.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "POST", r.url+"/otto/v1/responses", strings.NewReader(input(true)))
	for k, v := range map[string]string{"Authorization": "Bearer synthetic-gateway-key", "X-Otto-Subscription-Id": "sub-A", "X-Otto-Account-Id": "A", "X-Otto-Model": testModel, "X-Otto-Attempt-Id": "synthetic-attempt"} {
		req.Header.Set(k, v)
	}
	resp, e := r.client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	select {
	case <-r.f.entered:
	case <-time.After(time.Second):
		t.Fatal("not streaming")
	}
	at := time.Now()
	cancel()
	resp.Body.Close()
	select {
	case <-r.f.stopped:
		t.Logf("cancel joined upstream in %v; completed native usage=10; oversized frame rejected", time.Since(at))
	case <-time.After(time.Second):
		t.Fatal("peer did not stop")
	}
}
func TestReadinessAndAuthorization(t *testing.T) {
	r := setup(t)
	resp, e := r.client.Get(r.url + "/otto/ready")
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatal("private readiness without trusted caller")
	}
	a := testCredential("A").auth("sub-A")
	if _, e = r.g.store.Save(context.Background(), a); e == nil {
		t.Fatal("create-overwrite permitted outside loaded exact account")
	}
	t.Log("private readiness requires Otto bearer; unloaded Store save denied")
}
func TestCredentialFingerprint(t *testing.T) {
	// Expected digest executed with Bun's JSON.stringify and node:crypto.
	wire := credential{AccountID: "A", AccessToken: "synthetic<&>\u2028\u2029", RefreshToken: "synthetic\\u2028", Expired: "2026-10-03T00:00:00Z"}
	if fingerprint(wire) != "381de17cbe0a9f779078d364147f61b1137feefd3c3ad756bf32949ab5d63401" {
		t.Fatal("fingerprint differs from TypeScript Store callback")
	}
	c := testCredential("A")
	if !c.valid() {
		t.Fatal("valid fixture rejected")
	}
	c.AccountID = "B"
	if c.valid() {
		t.Fatal("JWT/account mismatch accepted")
	}
	a := c.auth("sub-A")
	a.Metadata["account_id"] = "A"
	if credentialFromAuth(a).AccountID != "A" {
		t.Fatal("mapping failed")
	}
	_ = auth.StatusActive
}
func TestSameIDReauthenticationRecovery(t *testing.T) {
	r := setup(t)
	r.f.mu.Lock()
	r.f.mode = "401"
	r.f.lostAck = true
	r.f.mu.Unlock()
	status, _ := r.request(t, "A", "/otto/v1/responses", input(false), false)
	if status == 200 {
		t.Fatal("lost ack accepted")
	}
	r.f.mu.Lock()
	calls := r.f.generation["A"]
	r.f.mode = "success"
	r.f.lostAck = false
	r.f.mu.Unlock()
	status, _ = r.request(t, "A", "/otto/v1/responses", input(false), false)
	// An intervening revoked/unavailable read must preserve the original fault
	// marker after inactive credentials have been released.
	r.f.mu.Lock()
	r.f.revoked = true
	r.f.mu.Unlock()
	r.request(t, "A", "/otto/v1/responses", input(false), false)
	r.f.mu.Lock()
	r.f.revoked = false
	r.f.mu.Unlock()
	status, _ = r.request(t, "A", "/otto/v1/responses", input(false), false)
	r.f.mu.Lock()
	if status == 200 || r.f.generation["A"] != calls {
		t.Fatal("uncertain rotation silently recovered")
	}
	r.f.authenticatedAt = "2026-10-03T10:00:00.000Z"
	next := r.f.credentials["sub-A"]
	next.AccessToken = testJWT("A", "reauth")
	r.f.credentials["sub-A"] = next
	r.f.mu.Unlock()
	status, _ = r.request(t, "A", "/otto/v1/responses", input(false), false)
	if status != 200 {
		t.Fatalf("same-ID confirmed reauth failed %d", status)
	}
	status, _ = r.request(t, "B", "/otto/v1/responses", input(false), false)
	if status != 200 {
		t.Fatal("other account failed during recovery")
	}
	t.Log("lost-ack rotation stays denied; later server-authenticated login event restores same-ID A without restarting B")
}
func TestInactiveStateCleanup(t *testing.T) {
	r := setup(t)
	r.request(t, "A", "/otto/v1/responses", input(false), false)
	deadline := time.Now().Add(time.Second)
	for {
		r.g.lockMu.Lock()
		locks := len(r.g.locks)
		r.g.lockMu.Unlock()
		r.g.store.mu.Lock()
		saved := len(r.g.store.saved)
		r.g.store.mu.Unlock()
		if locks == 0 && saved == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("retained state locks=%d saved=%d", locks, saved)
		}
		time.Sleep(time.Millisecond)
	}
	for i := 0; i < 300; i++ {
		r.g.store.block(fmt.Sprintf("sub-failure-%d", i))
	}
	r.g.store.mu.Lock()
	blocked := len(r.g.store.blocked)
	r.g.store.mu.Unlock()
	if blocked != 256 {
		t.Fatalf("fault markers unbounded %d", blocked)
	}
	t.Log("inactive lock/credential/Auth/model records released; failure markers cap=256; inflight slots=16")
}

type failWriter struct{ header http.Header }

func (w *failWriter) Header() http.Header { return w.header }
func (w *failWriter) WriteHeader(int)     {}
func (w *failWriter) Write([]byte) (int, error) {
	return 0, errors.New("synthetic disconnected writer")
}
func (w *failWriter) Flush()                           {}
func (w *failWriter) SetReadDeadline(time.Time) error  { return nil }
func (w *failWriter) SetWriteDeadline(time.Time) error { return nil }
func TestStreamWriteFailureJoinsCancel(t *testing.T) {
	r := setup(t)
	r.f.mu.Lock()
	r.f.mode = "hang"
	r.f.mu.Unlock()
	engine := gin.New()
	engine.POST("/otto/v1/responses", r.g.serve)
	req := httptest.NewRequest("POST", "/otto/v1/responses", strings.NewReader(input(true)))
	for k, v := range map[string]string{"Authorization": "Bearer synthetic-gateway-key", "X-Otto-Subscription-Id": "sub-A", "X-Otto-Account-Id": "A", "X-Otto-Model": testModel, "X-Otto-Attempt-Id": "synthetic-attempt"} {
		req.Header.Set(k, v)
	}
	done := make(chan struct{})
	go func() { engine.ServeHTTP(&failWriter{header: http.Header{}}, req); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("failed downstream write not joined")
	}
	select {
	case <-r.f.stopped:
	case <-time.After(time.Second):
		t.Fatal("upstream not canceled on failed write")
	}
	t.Log("downstream write failure cancels actual upstream stream before account reuse")
}
func TestNoProviderHostedToolOrDuplicateKeyBypass(t *testing.T) {
	r := setup(t)
	for _, body := range []string{`{"model":"gpt-5.4","tools":[{"type":"image_generation"}]}`, `{"model":"gpt-5.4","tools":[{"type":"function","type":"code_interpreter"}]}`, `{"model":"gpt-5.4","tool_choice":{"type":"image_generation"}}`, `{"model":"gpt-5.4","stream":"true"}`} {
		s, _ := r.request(t, "A", "/otto/v1/responses", body, false)
		if s == 200 {
			t.Fatal("unaccepted provider operation")
		}
	}
	s, _ := r.request(t, "A", "/otto/v1/responses", `{"model":"B-only","model":"gpt-5.4","tools":[{"type":"image_generation","type":"function","name":"scoped_tool","parameters":{"type":"object"}}],"input":[],"stream":false}`, false)
	if s != 200 {
		t.Fatalf("canonical validated function request rejected %d", s)
	}
	r.f.mu.Lock()
	defer r.f.mu.Unlock()
	if r.f.generation["A"] != 1 || r.f.generation["B"] != 0 {
		t.Fatal("invalid tool request contacted upstream")
	}
	t.Log("provider image/code/search tools denied; duplicate keys canonicalized; only scoped function protocol reaches selected model")
}
func TestProductionDeadlineCancelsPeer(t *testing.T) {
	r := setupTimeout(t, 100*time.Millisecond)
	r.f.mu.Lock()
	r.f.mode = "hang"
	r.f.mu.Unlock()
	at := time.Now()
	r.request(t, "A", "/otto/v1/responses", input(true), true)
	select {
	case <-r.f.stopped:
	case <-time.After(time.Second):
		t.Fatal("deadline not joined")
	}
	if time.Since(at) > time.Second {
		t.Fatal("deadline excessive")
	}
	t.Logf("configured production deadline canceled fake upstream in %v", time.Since(at))
}
func TestGatewayProcessHelper(t *testing.T) {
	if os.Getenv("OTTO_FIXTURE_CHILD") != "1" {
		return
	}
	gin.SetMode(gin.ReleaseMode)
	log.SetOutput(io.Discard)
	sink, _ := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	os.Stdout = sink
	peer, _ := url.Parse(os.Getenv("OTTO_FIXTURE_PEER"))
	base := http.DefaultTransport
	transport := &fixtureTransport{base: base, peer: peer}
	http.DefaultTransport = boundedTransport{base: transport}
	store := &accountStore{base: os.Getenv("OTTO_FIXTURE_STORE"), key: "synthetic-store-key", client: &http.Client{Transport: transport, Timeout: time.Second}, saved: map[string]savedCredential{}, blocked: map[string]accountBlock{}}
	g := &gateway{key: "synthetic-gateway-key", store: store, transport: transport, upstream: "https://chatgpt.com/backend-api/codex"}
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "config.yaml"), []byte("{}\n"), 0600)
	port, _ := strconv.Atoi(os.Getenv("OTTO_FIXTURE_PORT"))
	cfg := &config.Config{Host: "127.0.0.1", Port: port, AuthDir: filepath.Join(root, "auth")}
	cfg.RemoteManagement.DisableControlPanel = true
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer cancel()
	svc, e := startGateway(ctx, g, cfg, root)
	if e != nil {
		t.Fatal(e)
	}
	if e = svc.Run(ctx); e != nil && !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if transport.denied.Load() != 0 {
		t.Fatal("nonfixture traffic attempted")
	}
}
func TestFreshProcessAfterPersistenceFailure(t *testing.T) {
	r := setup(t)
	r.f.mu.Lock()
	r.f.mode = "401"
	r.f.putFail = true
	r.f.mu.Unlock()
	s, _ := r.request(t, "A", "/otto/v1/responses", input(false), false)
	if s == 200 {
		t.Fatal("first persistence failure accepted")
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	command := exec.Command(os.Args[0], "-test.run=^TestGatewayProcessHelper$")
	command.Env = append(os.Environ(), "OTTO_FIXTURE_CHILD=1", "OTTO_FIXTURE_PEER="+r.peer, "OTTO_FIXTURE_STORE="+r.g.store.base, fmt.Sprintf("OTTO_FIXTURE_PORT=%d", port))
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if e = command.Start(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		command.Process.Signal(syscall.SIGTERM)
		if e := command.Wait(); e != nil {
			t.Errorf("fixture child failed: %v %s", e, output.String())
		}
	})
	child := *r
	child.url = fmt.Sprintf("http://127.0.0.1:%d", port)
	deadline := time.Now().Add(3 * time.Second)
	for {
		req, _ := http.NewRequest("GET", child.url+"/otto/ready", nil)
		req.Header.Set("Authorization", "Bearer synthetic-gateway-key")
		resp, e := child.client.Do(req)
		if e == nil {
			resp.Body.Close()
			if resp.StatusCode == 204 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("fresh process not ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
	s, _ = child.request(t, "A", "/otto/v1/responses", input(false), false)
	if s == 200 {
		t.Fatal("fresh process bypassed required rotation save")
	}
	r.f.mu.Lock()
	defer r.f.mu.Unlock()
	if r.f.generation["A"] != 2 || r.f.refresh["A"] != 2 || r.f.generation["B"] != 0 || r.f.refresh["B"] != 0 {
		t.Fatalf("unexpected new-process traffic %v %v", r.f.generation, r.f.refresh)
	}
	t.Log("fresh OS process rechecks persisted record; each failed save yields one A request/refresh, no retry and zero B traffic")
}

func TestSlowClientSocketDeadlines(t *testing.T) {
	for _, mode := range []string{"body", "stream"} {
		t.Run(mode, func(t *testing.T) {
			r := setupTimeout(t, 100*time.Millisecond)
			if mode == "stream" {
				r.f.mu.Lock()
				r.f.mode = "flood"
				r.f.mu.Unlock()
			}
			u, _ := url.Parse(r.url)
			conn, e := net.Dial("tcp", u.Host)
			if e != nil {
				t.Fatal(e)
			}
			defer conn.Close()
			conn.(*net.TCPConn).SetReadBuffer(1024)
			body := input(true)
			size := len(body)
			if mode == "body" {
				size = 1 << 20
				body = ""
			}
			fmt.Fprintf(conn, "POST /otto/v1/responses HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer synthetic-gateway-key\r\nX-Otto-Subscription-Id: sub-A\r\nX-Otto-Account-Id: A\r\nX-Otto-Model: %s\r\nX-Otto-Attempt-Id: synthetic-attempt\r\nContent-Length: %d\r\n\r\n%s", u.Host, testModel, size, body)
			started := time.Now()
			if mode == "stream" {
				select {
				case <-r.f.entered:
				case <-time.After(time.Second):
					t.Fatal("peer not streaming")
				}
			}
			// Keep this TCP peer open without sending its body or reading output.
			// The production response controller must release the account itself.
			deadline := time.Now().Add(3 * time.Second)
			for {
				r.g.lockMu.Lock()
				remaining := len(r.g.locks)
				r.g.lockMu.Unlock()
				if time.Since(started) > 50*time.Millisecond && remaining == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("slow socket retained account")
				}
				time.Sleep(time.Millisecond)
			}
			if mode == "stream" {
				select {
				case <-r.f.stopped:
				case <-time.After(time.Second):
					t.Fatal("slow write did not cancel actual upstream")
				}
			}
			t.Logf("open slow %s socket released account in %v", mode, time.Since(started))
		})
	}
}

func TestRevokedModelDiscoveryIsNotPublished(t *testing.T) {
	r := setup(t)
	gate := make(chan struct{})
	r.f.mu.Lock()
	r.f.modelsGate = gate
	r.f.mu.Unlock()
	done := make(chan int, 1)
	go func() { status, _ := r.request(t, "A", "/otto/v1/models", "", false); done <- status }()
	select {
	case <-r.f.entered:
	case <-time.After(time.Second):
		t.Fatal("discovery not pending")
	}
	r.f.mu.Lock()
	r.f.revoked = true
	r.f.mu.Unlock()
	close(gate)
	select {
	case status := <-done:
		if status == 200 {
			t.Fatal("revoked discovery published")
		}
	case <-time.After(time.Second):
		t.Fatal("discovery not joined")
	}
	t.Log("revocation during selected-account catalog request prevents stale publication")
}

func TestPinnedAccountWhileOtherAccountIsActive(t *testing.T) {
	for _, failure := range []string{"429", "401"} {
		t.Run(failure, func(t *testing.T) {
			r := setup(t)
			r.f.mu.Lock()
			r.f.mode = "hold-B/" + failure
			r.f.mu.Unlock()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			req, _ := http.NewRequestWithContext(ctx, "POST", r.url+"/otto/v1/responses", strings.NewReader(input(true)))
			for k, v := range map[string]string{"Authorization": "Bearer synthetic-gateway-key", "X-Otto-Subscription-Id": "sub-B", "X-Otto-Account-Id": "B", "X-Otto-Model": testModel, "X-Otto-Attempt-Id": "synthetic-other-attempt"} {
				req.Header.Set(k, v)
			}
			resp, e := r.client.Do(req)
			if e != nil {
				t.Fatal(e)
			}
			defer resp.Body.Close()
			select {
			case <-r.f.entered:
			case <-time.After(time.Second):
				t.Fatal("B stream not active")
			}
			if manager := r.activeManager("sub-B"); manager == nil {
				t.Fatal("B not eligible in dispatch manager")
			}
			status, _ := r.request(t, "A", "/otto/v1/responses", input(false), false)
			if failure == "429" && status != 429 || failure == "401" && status != 200 {
				t.Fatalf("A status %d", status)
			}
			r.f.mu.Lock()
			b, br := r.f.generation["B"], r.f.refresh["B"]
			r.f.mu.Unlock()
			if b != 1 || br != 0 {
				t.Fatal("A traffic fell back to active B")
			}
			cancel()
			resp.Body.Close()
			select {
			case <-r.f.stopped:
			case <-time.After(time.Second):
				t.Fatal("B cancel not joined")
			}
			t.Logf("A %s stayed exact while eligible B streamed: B generation=1 refresh=0", failure)
		})
	}
}

func (r *running) activeManager(id string) *auth.Manager {
	r.g.lockMu.Lock()
	defer r.g.lockMu.Unlock()
	if entry := r.g.locks[id]; entry != nil {
		return entry.manager
	}
	return nil
}

// Holds actual native body cleanup after cancellation, beyond the SDK-facing
// channel closure. The independently reproduced reviewer fixture used this seam.
type heldBody struct {
	io.ReadCloser
	gate, entered, closed chan struct{}
	once                  sync.Once
	closeGate             bool
}

func (b *heldBody) Read(p []byte) (int, error) {
	n, e := b.ReadCloser.Read(p)
	if e != nil && !b.closeGate {
		b.once.Do(func() { close(b.entered); <-b.gate })
	}
	return n, e
}
func (b *heldBody) Close() error {
	if b.closeGate {
		b.once.Do(func() { close(b.entered); <-b.gate })
	}
	e := b.ReadCloser.Close()
	close(b.closed)
	return e
}

type heldTransport struct {
	base http.RoundTripper
	mu   sync.Mutex
	body *heldBody
}

func (tr *heldTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, e := tr.base.RoundTrip(r)
	if e != nil {
		return nil, e
	}
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if strings.HasSuffix(r.URL.Path, "/responses") && tr.body != nil {
		b := tr.body
		tr.body = nil
		b.ReadCloser = resp.Body
		resp.Body = b
	}
	return resp, nil
}
func TestNativeCleanupOwnsAccountUntilJoined(t *testing.T) {
	for _, holdClose := range []bool{false, true} {
		t.Run(fmt.Sprint(holdClose), func(t *testing.T) {
			r := setup(t)
			r.f.mu.Lock()
			r.f.mode = "hang"
			r.f.mu.Unlock()
			b := &heldBody{gate: make(chan struct{}), entered: make(chan struct{}), closed: make(chan struct{}), closeGate: holdClose}
			var release sync.Once
			defer release.Do(func() { close(b.gate) })
			r.g.transport = &heldTransport{base: r.g.transport, body: b}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			req, _ := http.NewRequestWithContext(ctx, "POST", r.url+"/otto/v1/responses", strings.NewReader(input(true)))
			for k, v := range map[string]string{"Authorization": "Bearer synthetic-gateway-key", "X-Otto-Subscription-Id": "sub-A", "X-Otto-Account-Id": "A", "X-Otto-Model": testModel, "X-Otto-Attempt-Id": "synthetic-held"} {
				req.Header.Set(k, v)
			}
			resp, e := r.client.Do(req)
			if e != nil {
				t.Fatal(e)
			}
			cancel()
			resp.Body.Close()
			select {
			case <-b.entered:
			case <-time.After(time.Second):
				t.Fatal("native cleanup not held")
			}
			deadline := time.Now().Add(3 * time.Second)
			for {
				r.g.lockMu.Lock()
				entry := r.g.locks["sub-A"]
				unfinished := entry != nil && entry.unfinished
				r.g.lockMu.Unlock()
				if unfinished {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("unfinished I/O fence not retained")
				}
				time.Sleep(time.Millisecond)
			}
			if len(r.g.slots) != 1 || r.activeManager("sub-A") == nil {
				t.Fatal("native work released ownership")
			}
			select {
			case <-b.closed:
				t.Fatal("probe not holding body")
			default:
			}
			r.f.mu.Lock()
			r.f.mode = "success"
			r.f.authenticatedAt = "2026-10-03T12:00:00Z"
			r.f.credentials["sub-A"] = testCredential("A")
			r.f.mu.Unlock()
			status, _ := r.request(t, "A", "/otto/v1/responses", input(false), false)
			if status != 503 {
				t.Fatalf("reauth bypassed unfinished I/O %d", status)
			}
			status, _ = r.request(t, "B", "/otto/v1/responses", input(false), false)
			if status != 200 {
				t.Fatalf("unrelated account blocked %d", status)
			}
			release.Do(func() { close(b.gate) })
			select {
			case <-b.closed:
			case <-time.After(time.Second):
				t.Fatal("body cleanup not completed")
			}
			deadline = time.Now().Add(time.Second)
			for {
				r.g.lockMu.Lock()
				n := len(r.g.locks)
				r.g.lockMu.Unlock()
				if n == 0 && len(r.g.slots) == 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("joined resources not released")
				}
				time.Sleep(time.Millisecond)
			}
			status, _ = r.request(t, "A", "/otto/v1/responses", input(false), false)
			if status != 200 {
				t.Fatalf("joined same-account recovery %d", status)
			}
			t.Logf("held Close=%t: retained slot/manager/account across failed join; newer reauth503, B200, actual join then A200", holdClose)
		})
	}
}

type managerMeasureTransport struct {
	base                      http.RoundTripper
	g                         *gateway
	maxEpochs, maxGenerations int
}

func (tr *managerMeasureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	tr.g.lockMu.Lock()
	for _, entry := range tr.g.locks {
		if entry.manager != nil {
			value := reflect.ValueOf(entry.manager).Elem()
			if n := value.FieldByName("authEpochs").Len(); n > tr.maxEpochs {
				tr.maxEpochs = n
			}
			scheduler := value.FieldByName("scheduler").Elem()
			if tombstones := scheduler.FieldByName("authGenerations"); tombstones.IsValid() {
				if n := tombstones.Len(); n > tr.maxGenerations {
					tr.maxGenerations = n
				}
			}
		}
	}
	tr.g.lockMu.Unlock()
	return tr.base.RoundTrip(r)
}
func TestNativeManagerLifetimeBoundsInactiveMetadata(t *testing.T) {
	r := setup(t)
	tr := &managerMeasureTransport{base: r.g.transport, g: r.g}
	r.g.transport = tr
	for i := 0; i < 80; i++ {
		id := fmt.Sprintf("sub-life-%03d", i)
		r.f.mu.Lock()
		r.f.credentials[id] = testCredential("A")
		r.f.mu.Unlock()
		req, _ := http.NewRequest("POST", r.url+"/otto/v1/responses", strings.NewReader(input(false)))
		for k, v := range map[string]string{"Authorization": "Bearer synthetic-gateway-key", "X-Otto-Subscription-Id": id, "X-Otto-Account-Id": "A", "X-Otto-Model": testModel, "X-Otto-Attempt-Id": "synthetic-life"} {
			req.Header.Set(k, v)
		}
		resp, e := r.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatal(resp.StatusCode)
		}
		deadline := time.Now().Add(time.Second)
		for {
			r.g.lockMu.Lock()
			n := len(r.g.locks)
			r.g.lockMu.Unlock()
			if n == 0 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("manager retained")
			}
			time.Sleep(time.Millisecond)
		}
		if i == 39 || i == 79 {
			t.Logf("requests=%d retained managers=0 max native authEpoch IDs=%d", i+1, tr.maxEpochs)
		}
	}
	if tr.maxEpochs != 1 || tr.maxGenerations != 1 {
		t.Fatalf("native ID lifetime not bounded epochs=%d generations=%d", tr.maxEpochs, tr.maxGenerations)
	}
}

type generationEventTransport struct {
	base      http.RoundTripper
	media     string
	duplicate string
}

func (tr generationEventTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, e := tr.base.RoundTrip(req)
	if e == nil && strings.HasSuffix(req.URL.Path, "/responses") {
		resp.Header.Set("Content-Type", tr.media)
		if tr.duplicate != "" {
			raw, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				return nil, err
			}
			var changed string
			if tr.duplicate == "model" {
				changed = strings.ReplaceAll(string(raw), `"model":"gpt-5.4"`, `"model":"foreign-model","model":"gpt-5.4"`)
			} else {
				changed = strings.ReplaceAll(string(raw), `"response":`, `"response":{"model":"foreign-model"},"response":`)
			}
			resp.Body = io.NopCloser(strings.NewReader(changed))
			resp.ContentLength = int64(len(changed))
		}
	}
	return resp, e
}
func TestGenerationMediaTypeAndDuplicateModels(t *testing.T) {
	for _, stream := range []bool{false, true} {
		for _, media := range []string{"", "application/json", "text/plain", "text/event-stream; charset=utf-8"} {
			t.Run(fmt.Sprintf("%t/%s", stream, media), func(t *testing.T) {
				r := setup(t)
				r.g.transport = generationEventTransport{base: r.g.transport, media: media}
				status, _ := r.request(t, "A", "/otto/v1/responses", input(stream), stream)
				if strings.HasPrefix(media, "text/event-stream") {
					if status != 200 {
						t.Fatal(status)
					}
				} else if status != 502 {
					t.Fatalf("unsupported media accepted %d", status)
				}
			})
		}
	}
	for _, stream := range []bool{false, true} {
		for _, duplicate := range []string{"model", "response"} {
			t.Run(fmt.Sprintf("%t/duplicate-%s", stream, duplicate), func(t *testing.T) {
				r := setup(t)
				r.g.transport = generationEventTransport{base: r.g.transport, media: "text/event-stream", duplicate: duplicate}
				status, body := r.request(t, "A", "/otto/v1/responses", input(stream), stream)
				if status != 502 || bytes.Contains(body, []byte("foreign-model")) {
					t.Fatalf("ambiguous raw assertion escaped %d", status)
				}
			})
		}
	}
}
func TestBearerAndReadinessQueryContract(t *testing.T) {
	r := setup(t)
	for _, test := range []struct {
		path, authorization string
		status              int
	}{{"/otto/ready", "synthetic-gateway-key", 401}, {"/otto/ready?account=B", "Bearer synthetic-gateway-key", 400}, {"/otto/ready", "Bearer synthetic-gateway-key", 204}} {
		req, _ := http.NewRequest("GET", r.url+test.path, nil)
		req.Header.Set("Authorization", test.authorization)
		resp, e := r.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		if resp.StatusCode != test.status {
			t.Fatal(resp.StatusCode)
		}
	}
}

func TestAcceptedSessionCacheAndPiRequestFields(t *testing.T) {
	r := setup(t)
	// Exact key set captured from published Pi1.0.0's real request by the main
	// composition lane: include,input,max_output_tokens,model,prompt_cache_key,
	// reasoning,store,stream,tools. Its native UUID is mapped to accepted Session.
	body := `{"include":["reasoning.encrypted_content"],"input":[],"max_output_tokens":128,"model":"gpt-5.4","prompt_cache_key":"accepted-session","reasoning":{"effort":"high","summary":"auto"},"store":false,"stream":true,"tools":[{"type":"function","name":"scoped_tool","parameters":{"type":"object"}}]}`
	for _, test := range []struct {
		session, cache string
		status         int
	}{{"", "accepted-session", 403}, {"other-session", "accepted-session", 403}, {"accepted-session", "foreign-session", 403}, {strings.Repeat("x", 65), strings.Repeat("x", 65), 403}, {"accepted-session", "accepted-session", 200}} {
		req, _ := http.NewRequest("POST", r.url+"/otto/v1/responses", strings.NewReader(strings.ReplaceAll(body, "accepted-session", test.cache)))
		for k, v := range map[string]string{"Authorization": "Bearer synthetic-gateway-key", "X-Otto-Subscription-Id": "sub-A", "X-Otto-Account-Id": "A", "X-Otto-Model": testModel, "X-Otto-Attempt-Id": "synthetic-cache-attempt", "X-Otto-Session-Id": test.session, "Session-Id": "spoofed-session"} {
			req.Header.Set(k, v)
		}
		resp, e := r.client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != test.status {
			t.Fatalf("Session/cache contract HTTP %d", resp.StatusCode)
		}
	}
	r.f.mu.Lock()
	defer r.f.mu.Unlock()
	if r.f.generation["A"] != 1 || r.f.generation["B"] != 0 || r.f.cacheKey != "accepted-session" || r.f.nativeSession != "accepted-session" || r.f.reasoningEffort != "high" {
		t.Fatalf("native cache/reasoning scope changed: A=%d B=%d key=%q session=%q reasoning=%q", r.f.generation["A"], r.f.generation["B"], r.f.cacheKey, r.f.nativeSession, r.f.reasoningEffort)
	}
	t.Log("published Pi request field set reaches native exact A/model with high reasoning and trusted Session cache; missing/mismatch/spoof denied")
}

// Parses the actual native listener's bytes using SSE line/blank-line semantics.
// Contains-string checks missed the scanner's discarded delimiters.
func TestNativeSocketSSEFraming(t *testing.T) {
	for _, mode := range []string{"success", "sse-events", "sse-crlf"} {
		t.Run(mode, func(t *testing.T) {
			r := setup(t)
			r.f.mode = mode
			status, raw := r.request(t, "A", "/otto/v1/responses", input(true), true)
			if status != 200 {
				t.Fatalf("status %d", status)
			}
			scanner := bufio.NewScanner(bytes.NewReader(raw))
			var event string
			var data []string
			var types []string
			for scanner.Scan() {
				line := scanner.Text()
				switch {
				case line == "":
					if len(data) != 0 {
						var payload struct {
							Type     string `json:"type"`
							Delta    string `json:"delta"`
							Response struct {
								Model string `json:"model"`
								Usage struct {
									Total int `json:"total_tokens"`
								} `json:"usage"`
							} `json:"response"`
						}
						if e := json.Unmarshal([]byte(strings.Join(data, "\n")), &payload); e != nil {
							t.Fatalf("invalid SSE JSON: %v", e)
						}
						if event != "" && event != payload.Type {
							t.Fatalf("event/data mismatch %q %q", event, payload.Type)
						}
						if payload.Type == "response.function_call_arguments.delta" && payload.Delta != `{"synthetic":true}` {
							t.Fatal("tool arguments corrupted")
						}
						if payload.Type == "response.output_text.delta" && payload.Delta != "synthetic text" {
							t.Fatal("delta corrupted")
						}
						if payload.Type == "response.completed" && (payload.Response.Model != testModel || payload.Response.Usage.Total != 10) {
							t.Fatal("terminal model/usage corrupted")
						}
						types = append(types, payload.Type)
					}
					event, data = "", nil
				case strings.HasPrefix(line, "event:"):
					event = strings.TrimPrefix(line, "event: ")
				case strings.HasPrefix(line, "data:"):
					data = append(data, strings.TrimPrefix(line, "data: "))
				case strings.HasPrefix(line, ":"):
				default:
					t.Fatalf("invalid SSE field %q", line)
				}
			}
			if scanner.Err() != nil || len(data) != 0 {
				t.Fatal("unfinished SSE frame")
			}
			want := []string{"response.completed"}
			if mode != "success" {
				want = []string{"response.created", "response.output_item.added", "response.function_call_arguments.delta", "response.output_text.delta", "response.completed"}
			}
			if !reflect.DeepEqual(types, want) {
				t.Fatalf("parsed SSE types %v, want %v; wire %q", types, want, raw)
			}
			t.Logf("parsed native socket SSE types %v; bytes %d; exact A1/B0", types, len(raw))
			r.f.mu.Lock()
			defer r.f.mu.Unlock()
			if r.f.generation["A"] != 1 || r.f.generation["B"] != 0 {
				t.Fatal("wrong account traffic")
			}
		})
	}
}
