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

	"github.com/ryan-truman/uke/internal/shopify"
)

//go:embed frontend/dist
var frontend embed.FS

func main() {
	port := flag.Int("port", 8080, "port to listen on")
	open := flag.Bool("open", true, "open browser on startup")
	mock := flag.Bool("mock", false, "serve fake data without calling Shopify")
	flag.Parse()

	dist, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	if *mock {
		mux.HandleFunc("GET /api/orders", mockOrdersHandler)
		log.Println("mock mode: serving fake data")
	} else {
		mux.HandleFunc("GET /api/orders", ordersHandler)
	}
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
	token := r.Header.Get("X-Shopify-Token")
	if shop == "" || token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing credentials"})
		return
	}

	summary, err := shopify.NewClient(shop, token).FetchSummary(r.Context(), parseDays(r))
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

func mockOrdersHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, shopify.Summary{
		Items: []shopify.Item{
			{Title: "Chicharito", Variant: "250g / Espresso", Quantity: 12},
			{Title: "Chicharito", Variant: "250g / Filter", Quantity: 8},
			{Title: "Chicharito", Variant: "1kg / Whole Bean", Quantity: 4},
			{Title: "Passion", Variant: "200g / Espresso", Quantity: 6},
			{Title: "Passion", Variant: "1kg / Filter", Quantity: 2},
			{Title: "Passion", Variant: "200g / Whole Bean", Quantity: 5},
			{Title: "Dragon Ball", Variant: "250g / Espresso", Quantity: 9},
			{Title: "Dragon Ball", Variant: "250g / Whole Bean", Quantity: 4},
			{Title: "Dragon Ball", Variant: "1kg / Whole Bean", Quantity: 2},
		},
		Orders: []shopify.Order{
			{Number: "#1042", Items: []shopify.Item{
				{Title: "Chicharito", Variant: "250g / Espresso", Quantity: 2},
				{Title: "Passion", Variant: "200g / Whole Bean", Quantity: 1},
			}},
			{Number: "#1043", Items: []shopify.Item{
				{Title: "Dragon Ball", Variant: "1kg / Whole Bean", Quantity: 1},
			}},
			{Number: "#1044", Items: []shopify.Item{
				{Title: "Chicharito", Variant: "250g / Filter", Quantity: 3},
				{Title: "Dragon Ball", Variant: "250g / Espresso", Quantity: 2},
				{Title: "Passion", Variant: "1kg / Filter", Quantity: 1},
			}},
		},
		OrderCount: 3,
	})
}

func openBrowser(url string) {
	// Try Chrome/Chromium in app mode first for a native-feeling window.
	for _, browser := range []string{
		"google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	} {
		if err := exec.Command(browser, "--app="+url).Start(); err == nil {
			return
		}
	}
	// Fallback to default browser.
	switch runtime.GOOS {
	case "darwin":
		exec.Command("open", url).Start()
	case "linux":
		exec.Command("xdg-open", url).Start()
	}
}
