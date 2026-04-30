.PHONY: dev build frontend clean

dev: frontend
	npm --prefix frontend run watch &
	go run . -open=true

build: frontend
	mkdir -p dist
	GOOS=darwin GOARCH=arm64 go build -o dist/uke .
	@echo "Built dist/uke (Apple Silicon)"

frontend:
	npm --prefix frontend install --prefer-offline
	npm --prefix frontend run build
	cp frontend/index.html frontend/style.css frontend/manifest.json frontend/icon.svg frontend/sw.js frontend/logo.png frontend/dist/

clean:
	rm -rf frontend/dist dist
