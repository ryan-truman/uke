.PHONY: dev build frontend clean

dev: frontend
	npm --prefix frontend run watch &
	go run . -open=true

build: frontend
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
	npm --prefix frontend install --prefer-offline
	npm --prefix frontend run build
	cp frontend/index.html frontend/style.css frontend/manifest.json frontend/icon.svg frontend/sw.js frontend/logo.png frontend/dist/

clean:
	rm -rf frontend/dist dist
