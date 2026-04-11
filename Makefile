.PHONY: dev dev-mock build frontend clean

dev: frontend
	npm --prefix frontend run watch &
	go run . -open=true

dev-mock: frontend
	npm --prefix frontend run watch &
	go run . -open=true -mock

build: frontend
	mkdir -p dist
	GOOS=darwin GOARCH=arm64 go build -o dist/uke-arm64 .
	GOOS=darwin GOARCH=amd64 go build -o dist/uke-amd64 .
	lipo -create -output dist/uke dist/uke-arm64 dist/uke-amd64
	rm dist/uke-arm64 dist/uke-amd64
	@echo "Built dist/uke (universal)"

frontend:
	npm --prefix frontend install --prefer-offline
	npm --prefix frontend run build
	cp frontend/index.html frontend/style.css frontend/manifest.json frontend/icon.svg frontend/sw.js frontend/logo.png frontend/dist/

clean:
	rm -rf frontend/dist dist
