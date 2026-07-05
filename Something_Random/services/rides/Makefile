.PHONY: dev build test lint clean

SERVICE_NAME := rides
BINARY := $(SERVICE_NAME)
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

dev:
	go run ./cmd/server/main.go

build:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
		-ldflags="-w -s -X main.version=$(VERSION)" \
		-o bin/$(BINARY) ./cmd/server

test:
	go test ./... -race -coverprofile=coverage.out -covermode=atomic

lint:
	golangci-lint run ./...

clean:
	rm -rf bin/ coverage.out

tidy:
	go mod tidy
	go mod verify
