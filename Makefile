.PHONY: build build-prod run clean install test

# Variables
BINARY_NAME=queue-system
BUILD_DIR=bin
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME=$(shell date -u '+%Y-%m-%d_%H:%M:%S')
LDFLAGS=-ldflags "-s -w -X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME)"

# Default target
all: build

# Build for development
build:
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(BINARY_NAME) .
	@echo "Build complete: $(BUILD_DIR)/$(BINARY_NAME)"

# Build optimized for production
build-prod:
	@echo "Building $(BINARY_NAME) for production..."
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=1 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) .
	@echo "Production build complete: $(BUILD_DIR)/$(BINARY_NAME)"

# Build for Windows
build-windows:
	@echo "Building $(BINARY_NAME) for Windows..."
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=1 GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME).exe .
	@echo "Windows build complete: $(BUILD_DIR)/$(BINARY_NAME).exe"

# Run the application
run:
	@echo "Starting $(BINARY_NAME)..."
	go run . -config configs/config.yaml

# Run with default config
run-default:
	@echo "Starting $(BINARY_NAME) with default config..."
	go run .

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@rm -rf $(BUILD_DIR)
	@rm -rf data/queue.db
	@echo "Clean complete"

# Run tests
test:
	go test -v ./...

# Download dependencies
deps:
	go mod download
	go mod tidy

# Install to system (Linux only)
install: build-prod
	@echo "Installing $(BINARY_NAME)..."
	@sudo cp $(BUILD_DIR)/$(BINARY_NAME) /usr/local/bin/
	@sudo chmod +x /usr/local/bin/$(BINARY_NAME)
	@echo "Install complete"

# Create systemd service file (Linux only)
install-service:
	@echo "Creating systemd service..."
	@sudo cp scripts/queue-system.service /etc/systemd/system/
	@sudo systemctl daemon-reload
	@echo "Service created. Use 'sudo systemctl start queue-system' to start"

# Help
help:
	@echo "Available targets:"
	@echo "  build        - Build for development"
	@echo "  build-prod   - Build optimized for production"
	@echo "  build-windows- Build for Windows"
	@echo "  run          - Run the application"
	@echo "  run-default  - Run with default config"
	@echo "  clean        - Clean build artifacts"
	@echo "  test         - Run tests"
	@echo "  deps         - Download dependencies"
	@echo "  install      - Install to system (Linux)"
	@echo "  help         - Show this help"
