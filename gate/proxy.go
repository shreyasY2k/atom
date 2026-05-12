package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

// newReverseProxy creates a reverse proxy to targetURL.
// FlushInterval=-1 enables immediate per-chunk flushing, required for SSE.
// responseHeaderTimeout controls how long to wait for the backend to start
// responding — use a long value for builder ops (codegen + Docker build can
// take 3-5 min) and a shorter one for the workflow surface (run starts async).
func newReverseProxy(targetURL string, responseHeaderTimeout time.Duration) *httputil.ReverseProxy {
	target, _ := url.Parse(targetURL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1 // flush each chunk immediately (SSE-safe)
	proxy.Transport = &http.Transport{
		ResponseHeaderTimeout: responseHeaderTimeout,
	}
	// Preserve the original request path; do not rewrite.
	orig := proxy.Director
	proxy.Director = func(req *http.Request) {
		orig(req)
		req.Host = target.Host
	}
	return proxy
}
