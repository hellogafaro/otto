// Otto's private Codex gateway. Product authorization remains in the Otto server.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	api "github.com/router-for-me/CLIProxyAPI/v8/sdk/api"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	sdkAuth "github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	proxy "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	auth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	executor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	sdkLogging "github.com/router-for-me/CLIProxyAPI/v8/sdk/logging"
	_ "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator/builtin"
	log "github.com/sirupsen/logrus"
)

const maxRequestBytes = 1 << 20
const maxResponseBytes = 8 << 20
const maxFrameBytes = 256 << 10
const requestTimeout = 5 * time.Minute

var errUnavailable = errors.New("accepted account request unavailable")
var errCancelledRead = errors.New("account store read cancelled")

type credential struct {
	Provider     string `json:"provider"`
	AccountID    string `json:"accountId"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	IDToken      string `json:"idToken,omitempty"`
	Expired      string `json:"expired"`
	PlanType     string `json:"planType,omitempty"`
}
type savedCredential struct {
	Credential      credential `json:"credential"`
	Fingerprint     string     `json:"fingerprint"`
	AuthenticatedAt string     `json:"authenticatedAt"`
}

func fingerprint(c credential) string {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	encoder.Encode([]string{c.AccountID, c.AccessToken, c.RefreshToken, c.IDToken, c.Expired})
	// Match JSON.stringify, which keeps U+2028/U+2029 literal. Preserve escaped
	// backslashes, including a token containing the literal text "\\u2028".
	data := bytes.TrimSuffix(encoded.Bytes(), []byte("\n"))
	raw := make([]byte, 0, len(data))
	for i := 0; i < len(data); i++ {
		if data[i] == '\\' && i+1 < len(data) {
			if i+6 <= len(data) && (string(data[i:i+6]) == "\\u2028" || string(data[i:i+6]) == "\\u2029") {
				raw = append(raw, []byte(string(rune(0x2028+int(data[i+5]-'8'))))...)
				i += 5
				continue
			}
			raw = append(raw, data[i], data[i+1])
			i++
			continue
		}
		raw = append(raw, data[i])
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func accountID(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	raw, e := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if e != nil {
		return ""
	}
	var claims struct {
		Auth struct {
			ID string `json:"chatgpt_account_id"`
		} `json:"https://api.openai.com/auth"`
	}
	if json.Unmarshal(raw, &claims) != nil {
		return ""
	}
	return claims.Auth.ID
}
func (c credential) valid() bool {
	_, e := time.Parse(time.RFC3339Nano, c.Expired)
	return e == nil && c.Provider == "codex" && validID(c.AccountID) && c.AccessToken != "" && c.RefreshToken != "" && accountID(c.AccessToken) == c.AccountID && (c.IDToken == "" || accountID(c.IDToken) == c.AccountID)
}
func credentialFromAuth(a *auth.Auth) credential {
	m := a.Metadata
	get := func(k string) string { v, _ := m[k].(string); return v }
	return credential{Provider: a.Provider, AccountID: get("account_id"), AccessToken: get("access_token"), RefreshToken: get("refresh_token"), IDToken: get("id_token"), Expired: get("expired"), PlanType: get("plan_type")}
}
func (c credential) auth(id string) *auth.Auth {
	return &auth.Auth{ID: id, Provider: "codex", Status: auth.StatusActive, Metadata: map[string]any{"account_id": c.AccountID, "access_token": c.AccessToken, "refresh_token": c.RefreshToken, "id_token": c.IDToken, "expired": c.Expired, "plan_type": c.PlanType}, Attributes: map[string]string{"auth_kind": "oauth"}}
}

// Callback requests stay private and values never reach ordinary files or logs.
// Each request reads current storage; only acknowledged CAS writes are accepted.
type accountBlock struct {
	accountID       string
	authenticatedAt string
}

type accountStore struct {
	base    string
	key     string
	client  *http.Client
	mu      sync.Mutex
	saved   map[string]savedCredential
	blocked map[string]accountBlock
}

func (s *accountStore) List(context.Context) ([]*auth.Auth, error) { return nil, nil }
func (s *accountStore) Delete(context.Context, string) error       { return errUnavailable }
func (s *accountStore) callback(ctx context.Context, method, id string, body any) (savedCredential, error) {
	var out savedCredential
	var raw []byte
	var e error
	if body != nil {
		raw, e = json.Marshal(body)
		if e != nil {
			return out, errUnavailable
		}
	}
	req, e := http.NewRequestWithContext(ctx, method, s.base+"/internal/gateway/accounts/"+url.PathEscape(id), bytes.NewReader(raw))
	if e != nil {
		return out, errUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", "application/json")
	resp, e := s.client.Do(req)
	if e != nil {
		// No answer was received: a failure whose cause is this request's own cancellation or deadline is not
		// evidence about the account. An unrelated transport error that merely races the cancel still is.
		if ctx.Err() != nil && (errors.Is(e, context.Canceled) || errors.Is(e, context.DeadlineExceeded)) {
			return out, errCancelledRead
		}
		return out, errUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return out, errUnavailable
	}
	data, e := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if e != nil || json.Unmarshal(data, &out) != nil {
		return out, errUnavailable
	}
	return out, nil
}
func (s *accountStore) read(ctx context.Context, id string) (savedCredential, error) {
	out, e := s.callback(ctx, "GET", id, nil)
	// Only a transport failure with no store answer, caused by this request's own cancellation or deadline, says
	// nothing about the account: refuse the request without blocking later ones. Any received answer (non-200,
	// malformed, invalid credential) still blocks until fresh authentication, even if the context is cancelled too.
	if errors.Is(e, errCancelledRead) {
		return savedCredential{}, errUnavailable
	}
	if e != nil || !out.Credential.valid() || out.Fingerprint != fingerprint(out.Credential) {
		s.block(id)
		return savedCredential{}, errUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	authenticated, e := time.Parse(time.RFC3339Nano, out.AuthenticatedAt)
	if e != nil {
		return savedCredential{}, errUnavailable
	}
	if blocked, ok := s.blocked[id]; ok {
		previous, _ := time.Parse(time.RFC3339Nano, blocked.authenticatedAt)
		if !authenticated.After(previous) || (blocked.accountID != "" && blocked.accountID != out.Credential.AccountID) {
			return savedCredential{}, errUnavailable
		}
		delete(s.blocked, id)
	}
	if len(s.blocked) >= 256 {
		return savedCredential{}, errUnavailable
	}
	s.saved[id] = out
	return out, nil
}
func (s *accountStore) block(id string) {
	s.mu.Lock()
	_, blocked := s.blocked[id]
	if !blocked && len(s.blocked) < 256 {
		previous := s.saved[id]
		s.blocked[id] = accountBlock{accountID: previous.Credential.AccountID, authenticatedAt: previous.AuthenticatedAt}
	}
	s.mu.Unlock()
}
func (s *accountStore) Save(ctx context.Context, a *auth.Auth) (string, error) {
	next := credentialFromAuth(a)
	if !next.valid() {
		s.block(a.ID)
		return "", errUnavailable
	}
	s.mu.Lock()
	previous, ok := s.saved[a.ID]
	_, blocked := s.blocked[a.ID]
	s.mu.Unlock()
	if !ok || blocked || previous.Credential.AccountID != next.AccountID {
		return "", errUnavailable
	}
	hash := fingerprint(next)
	if hash == previous.Fingerprint {
		return "", nil
	}
	out, e := s.callback(ctx, "PUT", a.ID, map[string]any{"expectedFingerprint": previous.Fingerprint, "expectedAuthenticatedAt": previous.AuthenticatedAt, "credential": next})
	if e != nil || out.Fingerprint != hash {
		s.block(a.ID)
		return "", errUnavailable
	}
	s.mu.Lock()
	s.saved[a.ID] = savedCredential{Credential: next, Fingerprint: hash, AuthenticatedAt: previous.AuthenticatedAt}
	s.mu.Unlock()
	return "infisical:" + a.ID, nil
}
func (s *accountStore) matches(ctx context.Context, a *auth.Auth) bool {
	out, e := s.read(ctx, a.ID)
	return e == nil && out.Fingerprint == fingerprint(credentialFromAuth(a)) && out.AuthenticatedAt == a.Metadata["authenticated_at"]
}

// No auto-refresh or service reload mutates this manager. The outer per-account
// request lock joins streams before another request/refresh can use the account.
type codexExecutor struct {
	auth.ProviderExecutor
	store *accountStore
	work  *nativeWork
}

func (e *codexExecutor) Execute(ctx context.Context, a *auth.Auth, r executor.Request, o executor.Options) (executor.Response, error) {
	finish, ok := e.work.begin()
	if !ok {
		return executor.Response{}, errUnavailable
	}
	defer finish()
	if !e.store.matches(ctx, a) {
		return executor.Response{}, errUnavailable
	}
	return e.ProviderExecutor.Execute(ctx, a, r, o)
}
func (e *codexExecutor) ExecuteStream(ctx context.Context, a *auth.Auth, r executor.Request, o executor.Options) (*executor.StreamResult, error) {
	finish, ok := e.work.begin()
	if !ok {
		return nil, errUnavailable
	}
	if !e.store.matches(ctx, a) {
		finish()
		return nil, errUnavailable
	}
	result, err := e.ProviderExecutor.ExecuteStream(ctx, a, r, o)
	if err != nil || result == nil {
		finish()
		return result, err
	}
	// BaseAPIHandler channels may close before the native executor has stopped.
	// Drain its own channel to completion, even after the caller cancels.
	out := make(chan executor.StreamChunk)
	wrapped := *result
	wrapped.Chunks = out
	go func() {
		defer finish()
		defer close(out)
		for chunk := range result.Chunks {
			select {
			case out <- chunk:
			case <-ctx.Done():
			}
		}
	}()
	return &wrapped, nil
}
func (e *codexExecutor) Refresh(ctx context.Context, a *auth.Auth) (*auth.Auth, error) {
	finish, ok := e.work.begin()
	if !ok {
		return nil, errUnavailable
	}
	defer finish()
	if !e.store.matches(ctx, a) {
		return nil, errUnavailable
	}
	updated, err := e.ProviderExecutor.Refresh(ctx, a.Clone())
	if err != nil {
		e.store.block(a.ID)
		return nil, errUnavailable
	}
	if updated == nil || updated.ID != a.ID || accountID(credentialFromAuth(updated).AccessToken) != credentialFromAuth(a).AccountID || credentialFromAuth(updated).AccountID != credentialFromAuth(a).AccountID {
		e.store.block(a.ID)
		return nil, errUnavailable
	}
	if _, err = e.store.Save(ctx, updated); err != nil {
		return nil, errUnavailable
	}
	return updated, nil
}

// Counts actual provider work, not the SDK's cancellation-facing channels.
// Sealing denies new work; completion includes every body Read and Close.
type nativeWork struct {
	mu      sync.Mutex
	pending int
	sealed  bool
	done    chan struct{}
}
type nativeWorkKey struct{}

func (w *nativeWork) begin() (func(), bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.sealed {
		return nil, false
	}
	w.pending++
	return func() {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.pending--
		if w.sealed && w.pending == 0 {
			close(w.done)
		}
	}, true
}
func (w *nativeWork) seal() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.sealed = true
	if w.pending == 0 {
		close(w.done)
	}
}

type nativeBody struct {
	io.ReadCloser
	work   *nativeWork
	finish func()
	once   sync.Once
	err    error
}

func (b *nativeBody) Read(p []byte) (int, error) {
	finish, ok := b.work.begin()
	if !ok {
		return 0, errUnavailable
	}
	defer finish()
	return b.ReadCloser.Read(p)
}
func (b *nativeBody) Close() error {
	b.once.Do(func() { b.err = b.ReadCloser.Close(); b.finish() })
	return b.err
}

type limitedBody struct {
	io.ReadCloser
	left int
}

func (b *limitedBody) Read(p []byte) (int, error) {
	if b.left <= 0 {
		return 0, errUnavailable
	}
	if len(p) > b.left {
		p = p[:b.left]
	}
	n, e := b.ReadCloser.Read(p)
	b.left -= n
	return n, e
}

// Bound native HTTP bodies before upstream's scanner/io.ReadAll. Pin response
// model assertions at this raw seam, before upstream response rewriting.
type modelBody struct {
	body    io.ReadCloser
	reader  *bufio.Reader
	pending []byte
	model   string
	total   int
}

func (b *modelBody) Close() error { return b.body.Close() }
func (b *modelBody) Read(p []byte) (int, error) {
	if len(b.pending) == 0 {
		line, e := b.reader.ReadSlice('\n')
		if errors.Is(e, bufio.ErrBufferFull) {
			return 0, errUnavailable
		}
		if e != nil && len(line) == 0 {
			return 0, e
		}
		b.total += len(line)
		if len(line) > maxFrameBytes || b.total > maxResponseBytes {
			return 0, errUnavailable
		}
		if bytes.HasPrefix(line, []byte("data:")) {
			data := bytes.TrimSpace(line[5:])
			if !bytes.Equal(data, []byte("[DONE]")) {
				if !validModelEvent(data, b.model, true) {
					return 0, errUnavailable
				}
			}
		}
		b.pending = line
	}
	n := copy(p, b.pending)
	b.pending = b.pending[n:]
	return n, nil
}

// Inspect only the two model-bearing objects of Responses events. Reject
// duplicate model/response keys before Go and native gjson can disagree.
func validModelEvent(data []byte, model string, event bool) bool {
	d := json.NewDecoder(bytes.NewReader(data))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return false
	}
	seenModel, seenResponse := false, false
	for d.More() {
		key, err := d.Token()
		if err != nil {
			return false
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return false
		}
		switch key {
		case "model":
			var asserted string
			if seenModel || json.Unmarshal(value, &asserted) != nil || asserted != model {
				return false
			}
			seenModel = true
		case "response":
			if event {
				if seenResponse || !validModelEvent(value, model, false) {
					return false
				}
				seenResponse = true
			}
		}
	}
	if token, err = d.Token(); err != nil || token != json.Delim('}') {
		return false
	}
	return d.Decode(new(any)) == io.EOF
}

type boundedTransport struct {
	base  http.RoundTripper
	model string
}

func (t boundedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	var finish func()
	work, _ := r.Context().Value(nativeWorkKey{}).(*nativeWork)
	if work != nil {
		var ok bool
		finish, ok = work.begin()
		if !ok {
			return nil, errUnavailable
		}
	}
	resp, e := t.base.RoundTrip(r)
	if e != nil {
		if finish != nil {
			finish()
		}
		return nil, errUnavailable
	}
	if work != nil {
		resp.Body = &nativeBody{ReadCloser: resp.Body, work: work, finish: finish}
	}
	body := &limitedBody{resp.Body, maxResponseBytes}
	resp.Body = body
	if t.model != "" && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		media, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
		if err != nil || media != "text/event-stream" {
			resp.Body.Close()
			return nil, errUnavailable
		}
		resp.Body = &modelBody{body: body, reader: bufio.NewReaderSize(body, maxFrameBytes), model: t.model}
	}
	return resp, nil
}

type accountTransport struct{ transport http.RoundTripper }

func (t accountTransport) RoundTripperFor(*auth.Auth) http.RoundTripper { return t.transport }

type accountLock struct {
	gate       chan struct{}
	users      int
	manager    *auth.Manager
	unfinished bool
}

type gateway struct {
	key       string
	store     *accountStore
	native    auth.ProviderExecutor
	cfg       *config.Config
	transport http.RoundTripper
	upstream  string
	lockMu    sync.Mutex
	locks     map[string]*accountLock
	slots     chan struct{}
	ready     bool
	timeout   time.Duration
}

func validID(id string) bool {
	if len(id) < 1 || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
func (g *gateway) serve(c *gin.Context) {
	// No CORS/browser-facing auth. Otto replaces all incoming routing headers.
	header := c.GetHeader("Authorization")
	token, bearer := strings.CutPrefix(header, "Bearer ")
	if !bearer || subtle.ConstantTimeCompare([]byte(token), []byte(g.key)) != 1 {
		c.AbortWithStatus(401)
		return
	}
	if c.Request.URL.RawQuery != "" {
		c.AbortWithStatus(400)
		return
	}
	if c.Request.URL.Path == "/otto/ready" {
		if !g.ready {
			c.AbortWithStatus(503)
		} else {
			c.Status(204)
		}
		return
	}
	id := c.GetHeader("X-Otto-Subscription-Id")
	acceptedAccount := c.GetHeader("X-Otto-Account-Id")
	acceptedModel := c.GetHeader("X-Otto-Model")
	attempt := c.GetHeader("X-Otto-Attempt-Id")
	acceptedSession := c.GetHeader("X-Otto-Session-Id")
	if !g.ready || !validID(id) || !validID(attempt) || len(acceptedAccount) == 0 || len(acceptedAccount) > 256 {
		c.AbortWithStatus(400)
		return
	}
	select {
	case g.slots <- struct{}{}:
	default:
		c.AbortWithStatus(429)
		return
	}
	g.lockMu.Lock()
	entry := g.locks[id]
	if entry != nil && entry.unfinished {
		g.lockMu.Unlock()
		<-g.slots
		c.AbortWithStatus(503)
		return
	}
	if entry == nil {
		entry = &accountLock{gate: make(chan struct{}, 1)}
		g.locks[id] = entry
	}
	entry.users++
	g.lockMu.Unlock()
	var manager *auth.Manager
	locked, retained := false, false
	release := func() {
		if locked {
			if manager != nil {
				manager.Remove(context.Background(), id)
			}
			proxy.GlobalModelRegistry().UnregisterClient(id)
			g.store.mu.Lock()
			delete(g.store.saved, id)
			g.store.mu.Unlock()
			g.lockMu.Lock()
			entry.manager = nil
			entry.unfinished = false
			g.lockMu.Unlock()
			<-entry.gate
		}
		g.lockMu.Lock()
		entry.users--
		if entry.users == 0 {
			delete(g.locks, id)
		}
		g.lockMu.Unlock()
		<-g.slots
	}
	defer func() {
		if !retained {
			release()
		}
	}()
	lock := entry.gate
	// Context bounds include waiting on another stream's account lock.
	ctx, cancel := context.WithTimeout(c.Request.Context(), g.timeout)
	defer cancel()
	// Context cancellation alone cannot interrupt a blocked socket read/write.
	// Gin's public Unwrap seam exposes the native net/http response controller.
	controller := http.NewResponseController(c.Writer)
	if native, ok := c.Get("otto.response-controller"); ok {
		controller = native.(*http.ResponseController)
	}
	deadline, _ := ctx.Deadline()
	for _, set := range []func(time.Time) error{controller.SetReadDeadline, controller.SetWriteDeadline} {
		if e := set(deadline); e != nil {
			c.AbortWithStatus(503)
			return
		}
	}
	defer controller.SetReadDeadline(time.Time{})
	defer controller.SetWriteDeadline(time.Time{})
	select {
	case lock <- struct{}{}:
		locked = true
	case <-ctx.Done():
		return
	}
	work := &nativeWork{done: make(chan struct{})}
	ctx = context.WithValue(ctx, nativeWorkKey{}, work)
	defer func() {
		cancel()
		work.seal()
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case <-work.done:
		case <-timer.C:
			// Keep the slot, account gate, manager and material until actual I/O
			// joins. A fresh authentication event cannot bypass this gate.
			retained = true
			g.lockMu.Lock()
			entry.unfinished = true
			g.lockMu.Unlock()
			go func() { <-work.done; release() }()
		}
	}()
	saved, e := g.store.read(ctx, id)
	if e != nil || saved.Credential.AccountID != acceptedAccount {
		c.AbortWithStatus(403)
		return
	}
	a := saved.Credential.auth(id)
	a.Metadata["authenticated_at"] = saved.AuthenticatedAt
	// Native Remove preserves tombstones. A joined request owns one manager;
	// discarding it bounds those private records without resetting stale fences.
	manager = auth.NewManager(g.store, nil, nil)
	manager.SetConfig(g.cfg)
	manager.SetRetryConfig(0, 0, 1)
	manager.RegisterExecutor(&codexExecutor{ProviderExecutor: g.native, store: g.store, work: work})
	manager.Register(auth.WithSkipPersist(ctx), a)
	g.lockMu.Lock()
	entry.manager = manager
	g.lockMu.Unlock()
	handler := handlers.NewBaseAPIHandlers(&g.cfg.SDKConfig, manager)
	// Expired tokens must refresh and persist before discovery or generation.
	expiry, _ := time.Parse(time.RFC3339Nano, saved.Credential.Expired)
	if time.Until(expiry) < time.Minute {
		if _, e = manager.ForceRefreshAuth(ctx, id); e != nil {
			c.AbortWithStatus(403)
			return
		}
		a, _ = manager.GetByID(id)
	}
	models, e := g.models(ctx, a)
	if e != nil || !g.current(ctx, manager, id, acceptedAccount) {
		c.AbortWithStatus(502)
		return
	}
	if c.Request.Method == "GET" {
		data := make([]map[string]string, 0, len(models))
		for _, m := range models {
			data = append(data, map[string]string{"id": m.ID, "object": "model"})
		}
		c.JSON(200, gin.H{"object": "list", "data": data})
		return
	}
	if len(acceptedModel) == 0 || len(acceptedModel) > 128 {
		c.AbortWithStatus(400)
		return
	}
	found := false
	for _, m := range models {
		if m.ID == acceptedModel {
			found = true
		}
	}
	if !found {
		c.AbortWithStatus(403)
		return
	}
	raw, e := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBytes))
	if e != nil {
		c.AbortWithStatus(413)
		return
	}
	var body map[string]json.RawMessage
	if json.Unmarshal(raw, &body) != nil {
		c.AbortWithStatus(400)
		return
	}
	var requested string
	json.Unmarshal(body["model"], &requested)
	if requested != acceptedModel {
		c.AbortWithStatus(403)
		return
	}
	allowed := map[string]bool{"model": true, "input": true, "instructions": true, "stream": true, "tools": true, "tool_choice": true, "parallel_tool_calls": true, "reasoning": true, "max_output_tokens": true, "text": true, "include": true, "store": true, "prompt_cache_key": true}
	for k := range body {
		if !allowed[k] {
			c.AbortWithStatus(400)
			return
		}
	}
	if cacheRaw, ok := body["prompt_cache_key"]; ok {
		var cache string
		if json.Unmarshal(cacheRaw, &cache) != nil {
			c.AbortWithStatus(400)
			return
		}
		if !validID(acceptedSession) || len(acceptedSession) > 64 || cache != acceptedSession {
			c.AbortWithStatus(403)
			return
		}
	}

	// Only Pi/Otto function tools are supported; provider-hosted tools could start
	// unaccepted models or a separate billing operation.
	if toolsRaw, ok := body["tools"]; ok {
		var tools []map[string]any
		if json.Unmarshal(toolsRaw, &tools) != nil || len(tools) > 128 {
			c.AbortWithStatus(400)
			return
		}
		for _, tool := range tools {
			if tool["type"] != "function" {
				c.AbortWithStatus(400)
				return
			}
		}
		body["tools"], _ = json.Marshal(tools)
	}
	if choiceRaw, ok := body["tool_choice"]; ok {
		var choice any
		if json.Unmarshal(choiceRaw, &choice) != nil {
			c.AbortWithStatus(400)
			return
		}
		switch value := choice.(type) {
		case string:
			if value != "auto" && value != "none" && value != "required" {
				c.AbortWithStatus(400)
				return
			}
		case map[string]any:
			if value["type"] != "function" {
				c.AbortWithStatus(400)
				return
			}
		default:
			c.AbortWithStatus(400)
			return
		}
		body["tool_choice"], _ = json.Marshal(choice)
	}
	var stream bool
	if streamRaw, ok := body["stream"]; ok && json.Unmarshal(streamRaw, &stream) != nil {
		c.AbortWithStatus(400)
		return
	}
	// Canonicalize duplicate object keys so validation and native decoding agree.
	raw, e = json.Marshal(body)
	if e != nil {
		c.AbortWithStatus(400)
		return
	}
	c.Request.Header = http.Header{"Content-Type": []string{"application/json"}}
	ctx = handlers.WithExecutionSessionID(handlers.WithPinnedAuthID(ctx, id), attempt)
	// Request-scoped transport preserves the accepted model before translation.
	ctx = context.WithValue(ctx, "cliproxy.roundtripper", boundedTransport{base: g.transport, model: acceptedModel})
	proxy.GlobalModelRegistry().RegisterClient(id, "codex", models)
	if !stream {
		data, _, failure := handler.ExecuteWithAuthManager(ctx, "openai-response", acceptedModel, raw, "")
		if failure != nil || !g.current(ctx, manager, id, acceptedAccount) {
			status := 502
			if failure != nil && (failure.StatusCode == 401 || failure.StatusCode == 403 || failure.StatusCode == 429) {
				status = failure.StatusCode
			}
			c.JSON(status, gin.H{"error": "accepted request unavailable"})
			return
		}
		var response struct {
			Model string `json:"model"`
		}
		if len(data) > maxResponseBytes || json.Unmarshal(data, &response) != nil || response.Model != acceptedModel {
			c.AbortWithStatus(502)
			return
		}
		c.Data(200, "application/json", data)
		return
	}
	baseFinish, _ := work.begin()
	data, _, failures := handler.ExecuteStreamWithAuthManager(ctx, "openai-response", acceptedModel, raw, "")
	defer func() {
		cancel()
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		for data != nil || failures != nil {
			select {
			case _, ok := <-data:
				if !ok {
					data = nil
				}
			case _, ok := <-failures:
				if !ok {
					failures = nil
				}
			case <-timer.C:
				go func() {
					for data != nil || failures != nil {
						select {
						case _, ok := <-data:
							if !ok {
								data = nil
							}
						case _, ok := <-failures:
							if !ok {
								failures = nil
							}
						}
					}
					baseFinish()
				}()
				return
			}
		}
		baseFinish()
	}()
	total := 0
	for data != nil || failures != nil {
		select {
		case <-ctx.Done():
			return
		case failure, ok := <-failures:
			if !ok {
				failures = nil
				continue
			}
			if failure != nil {
				if !c.Writer.Written() {
					status := 502
					if failure.StatusCode == 401 || failure.StatusCode == 403 || failure.StatusCode == 429 {
						status = failure.StatusCode
					}
					c.JSON(status, gin.H{"error": "accepted request unavailable"})
				}
				return
			}
		case chunk, ok := <-data:
			if !ok {
				data = nil
				continue
			}
			// The pinned Codex executor emits scanner lines, not SSE frames.
			// Empty delimiter lines are dropped by the SDK base handler. Restore
			// the event/data association and dispatch each complete data event.
			chunk = bytes.TrimRight(chunk, "\r\n")
			if len(chunk) == 0 {
				continue
			}
			suffix := []byte("\n")
			if bytes.HasPrefix(chunk, []byte("data:")) {
				suffix = []byte("\n\n")
			}
			total += len(chunk) + len(suffix)
			if len(chunk)+len(suffix) > maxFrameBytes || total > maxResponseBytes || !g.current(ctx, manager, id, acceptedAccount) {
				cancel()
				return
			}
			chunk = append(chunk, suffix...)
			c.Header("Content-Type", "text/event-stream")
			if n, e := c.Writer.Write(chunk); e != nil || n != len(chunk) {
				cancel()
				return
			}
			c.Writer.Flush()
		}
	}
}
func (g *gateway) current(ctx context.Context, manager *auth.Manager, id, account string) bool {
	saved, e := g.store.read(ctx, id)
	a, ok := manager.GetByID(id)
	return e == nil && ok && saved.Credential.AccountID == account && saved.Fingerprint == fingerprint(credentialFromAuth(a)) && saved.AuthenticatedAt == a.Metadata["authenticated_at"]
}
func (g *gateway) models(ctx context.Context, a *auth.Auth) ([]*proxy.ModelInfo, error) {
	if !g.store.matches(ctx, a) {
		return nil, errUnavailable
	}
	req, e := http.NewRequestWithContext(ctx, "GET", g.upstream+"/models?client_version=0.140.0", nil)
	if e != nil {
		return nil, errUnavailable
	}
	req.Header.Set("Chatgpt-Account-Id", credentialFromAuth(a).AccountID)
	req.Header.Set("Accept", "application/json")
	ctx = context.WithValue(ctx, "cliproxy.roundtripper", boundedTransport{base: g.transport})
	resp, e := g.native.HttpRequest(ctx, a, req)
	if e != nil {
		return nil, errUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, errUnavailable
	}
	data, e := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if e != nil {
		return nil, errUnavailable
	}
	var catalog struct {
		Models []struct {
			Slug string `json:"slug"`
		} `json:"models"`
	}
	if json.Unmarshal(data, &catalog) != nil || len(catalog.Models) == 0 || len(catalog.Models) > 256 {
		return nil, errUnavailable
	}
	out := []*proxy.ModelInfo{}
	seen := map[string]bool{}
	for _, m := range catalog.Models {
		if m.Slug == "" || m.Slug == "auto" || m.Slug == "default" || len(m.Slug) > 128 || seen[m.Slug] || strings.ContainsAny(m.Slug, "()/ ") {
			return nil, errUnavailable
		}
		seen[m.Slug] = true
		out = append(out, &proxy.ModelInfo{ID: m.Slug, Object: "model", OwnedBy: "openai", Type: "codex", UserDefined: true})
	}
	return out, nil
}

func startGateway(ctx context.Context, g *gateway, cfg *config.Config, root string) (*proxy.Service, error) {
	bootstrap := auth.NewManager(nil, nil, nil)
	// Disable native automatic image tool injection through the public config
	// decoder, as its enum constants are intentionally internal to the SDK.
	if e := json.Unmarshal([]byte("true"), &cfg.DisableImageGeneration); e != nil {
		return nil, e
	}
	if g.timeout <= 0 {
		g.timeout = requestTimeout
	}
	g.slots = make(chan struct{}, 16)
	g.locks = map[string]*accountLock{}
	service, e := proxy.NewBuilder().WithConfig(cfg).WithConfigPath(filepath.Join(root, "config.yaml")).WithCoreAuthManager(bootstrap).WithAuthManager(sdkAuth.NewManager(nil)).WithWatcherFactory(func(string, string, func(*config.Config)) (*proxy.WatcherWrapper, error) {
		return &proxy.WatcherWrapper{}, nil
	}).WithServerOptions(api.WithEngineConfigurator(func(engine *gin.Engine) {
		// Capture Gin's native writer before mandatory CPA trace middleware wraps
		// it without Unwrap; no private upstream symbols or fork are needed.
		engine.Use(func(c *gin.Context) { c.Set("otto.response-controller", http.NewResponseController(c.Writer)) })
	}), api.WithRequestLoggerFactory(func(*config.Config, string) sdkLogging.RequestLogger { return nil }), api.WithMiddleware(func(c *gin.Context) {
		if !strings.HasPrefix(c.Request.URL.Path, "/otto/") {
			c.AbortWithStatus(404)
		}
	}), api.WithRouterConfigurator(func(engine *gin.Engine, _ *handlers.BaseAPIHandler, _ *config.Config) {
		engine.POST("/otto/v1/responses", g.serve)
		engine.GET("/otto/v1/models", g.serve)
		engine.GET("/otto/ready", g.serve)
	})).WithHooks(proxy.Hooks{OnBeforeStart: func(*config.Config) {
		bootstrap.StopAutoRefresh()
		g.native, _ = bootstrap.Executor("codex")
		g.cfg = cfg
		g.ready = g.native != nil
	}}).Build()
	if e != nil {
		return nil, e
	}
	return service, nil
}
func main() {
	// Upstream logs/stdout may include provider errors. Our HTTP errors are fixed.
	log.SetOutput(io.Discard)
	sink, e := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if e != nil {
		os.Exit(1)
	}
	os.Stdout = sink
	gin.SetMode(gin.ReleaseMode)
	key := os.Getenv("OTTO_GATEWAY_KEY")
	storeKey := os.Getenv("OTTO_GATEWAY_STORE_KEY")
	storeURL := strings.TrimRight(os.Getenv("OTTO_GATEWAY_STORE_URL"), "/")
	if key == "" || storeKey == "" || storeURL == "" {
		os.Exit(1)
	}
	parsed, e := url.Parse(storeURL)
	if e != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		os.Exit(1)
	}
	root, e := os.MkdirTemp("", "otto-gateway-")
	if e != nil {
		os.Exit(1)
	}
	defer os.RemoveAll(root)
	if os.WriteFile(filepath.Join(root, "config.yaml"), []byte("{}\n"), 0600) != nil {
		os.Exit(1)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.MaxResponseHeaderBytes = 64 << 10
	http.DefaultTransport = boundedTransport{base: transport}
	store := &accountStore{base: storeURL, key: storeKey, client: &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, saved: map[string]savedCredential{}, blocked: map[string]accountBlock{}}
	g := &gateway{key: key, store: store, transport: transport, upstream: "https://chatgpt.com/backend-api/codex"}
	cfg := &config.Config{Host: "0.0.0.0", Port: 8317, AuthDir: filepath.Join(root, "auth")}
	cfg.RemoteManagement.DisableControlPanel = true
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	service, e := startGateway(ctx, g, cfg, root)
	if e != nil {
		os.Exit(1)
	}
	if e = service.Run(ctx); e != nil && !errors.Is(e, context.Canceled) {
		fmt.Fprintln(os.Stderr, "gateway stopped")
		os.Exit(1)
	}
}
