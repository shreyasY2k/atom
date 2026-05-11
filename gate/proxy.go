package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

// newReverseProxy creates a reverse proxy to targetURL.
// FlushInterval=-1 enables immediate per-chunk flushing, required for SSE.
func newReverseProxy(targetURL string) *httputil.ReverseProxy {
	target, _ := url.Parse(targetURL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1 // flush each chunk immediately (SSE-safe)
	proxy.Transport = &http.Transport{
		ResponseHeaderTimeout: 120 * time.Second,
	}
	// Preserve the original request path; do not rewrite.
	orig := proxy.Director
	proxy.Director = func(req *http.Request) {
		orig(req)
		req.Host = target.Host
	}
	return proxy
}
