.PHONY: dev build frontend clean test

PLAYWRIGHT_CHROMIUM := $(wildcard $(HOME)/.cache/ms-playwright/chromium*/chrome-linux64/chrome)

dev: frontend
	npm --prefix frontend run watch &
	go run . -open=true

build: test frontend
	rm -rf dist/Uke.app dist/Uke.zip
	mkdir -p dist/Uke.app/Contents/MacOS dist/Uke.app/Contents/Resources
	GOOS=darwin GOARCH=arm64 go build -o dist/Uke.app/Contents/MacOS/uke-server .
	cp build/launcher.sh dist/Uke.app/Contents/MacOS/uke
	cp build/Info.plist dist/Uke.app/Contents/Info.plist
	cp frontend/logo.png dist/Uke.app/Contents/Resources/icon.png
	chmod +x dist/Uke.app/Contents/MacOS/uke dist/Uke.app/Contents/MacOS/uke-server
	cd dist && zip -qr Uke.zip Uke.app
	@echo "Built dist/Uke.zip (Apple Silicon)"

frontend:
	@test -f frontend/node_modules/.bin/esbuild || \
		{ echo "error: frontend dependencies not installed. Run: npm --prefix frontend install"; exit 1; }
	npm --prefix frontend run build
	cp frontend/index.html frontend/style.css frontend/manifest.json frontend/icon.svg frontend/sw.js frontend/logo.png frontend/dist/

clean:
	rm -rf frontend/dist dist

test:
	@test -f node_modules/.bin/playwright || \
		{ echo "error: test dependencies not installed. Run: npm install"; exit 1; }
	@test -n "$(PLAYWRIGHT_CHROMIUM)" || \
		{ echo "error: Playwright browser not installed. Run: npx playwright install chromium"; exit 1; }
	npx playwright test
