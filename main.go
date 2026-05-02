package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"sync"

	"github.com/ryan-truman/uke/internal/shopify"
)

//go:embed frontend/dist
var frontend embed.FS

var (
	clientCacheMu sync.Mutex
	clientCache   = map[string]*shopify.Client{}
)

func getClient(shop, clientID, clientSecret string) *shopify.Client {
	key := shop + "\x00" + clientID
	clientCacheMu.Lock()
	defer clientCacheMu.Unlock()
	if c, ok := clientCache[key]; ok {
		return c
	}
	c := shopify.NewClient(shop, shopify.NewTokenManager(shop, clientID, clientSecret))
	clientCache[key] = c
	return c
}

func main() {
	port := flag.Int("port", 8080, "port to listen on")
	open := flag.Bool("open", true, "open browser on startup")
	flag.Parse()

	dist, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/orders", ordersHandler)
	mux.Handle("/", http.FileServer(http.FS(dist)))

	url := fmt.Sprintf("http://localhost:%d", *port)
	if *open {
		go openBrowser(url)
	}
	log.Printf("listening on %s", url)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", *port), mux))
}

func ordersHandler(w http.ResponseWriter, r *http.Request) {
	shop := r.Header.Get("X-Shopify-Shop")
	clientID := r.Header.Get("X-Shopify-Client-Id")
	clientSecret := r.Header.Get("X-Shopify-Client-Secret")
	if shop == "" || clientID == "" || clientSecret == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing credentials"})
		return
	}

	client := getClient(shop, clientID, clientSecret)
	summary, err := client.FetchSummary(r.Context(), parseDays(r))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

// parseDays reads the `days` query param. Defaults to 7 (past week).
// 0 means no date filter (all time).
func parseDays(r *http.Request) int {
	s := r.URL.Query().Get("days")
	if s == "" {
		return 7
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 7
	}
	return n
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func openBrowser(url string) {
	for _, browser := range []string{
		"google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	} {
		if err := exec.Command(browser, "--app="+url).Start(); err == nil {
			return
		}
	}
	switch runtime.GOOS {
	case "darwin":
		exec.Command("open", url).Start()
	case "linux":
		exec.Command("xdg-open", url).Start()
	}
}
