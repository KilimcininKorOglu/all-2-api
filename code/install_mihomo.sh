#!/bin/bash

# ==============================================================================
# Mihomo (Clash.Meta) Automatic Installation and Configuration Script
#
# Features:
# 1. Automatically detect system architecture (amd64/arm64)
# 2. Download the latest mihomo release from GitHub
# 3. Download the specified Clash subscription configuration file
# 4. Configure and enable systemd service for auto-start on boot
# 5. Start the service and check status
# ==============================================================================

# --- User Configuration ---
# Replace the link below with your Clash subscription link
SUBSCRIPTION_URL="Paste your Clash subscription link here"


# --- Script Constants ---
# Use colored output to improve readability
GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
NC="\e[0m" # No Color

MIHOMO_INSTALL_PATH="/usr/local/bin/mihomo"
MIHOMO_CONFIG_DIR="/etc/mihomo"
MIHOMO_CONFIG_FILE="${MIHOMO_CONFIG_DIR}/config.yaml"
SYSTEMD_SERVICE_FILE="/etc/systemd/system/mihomo.service"

# Exit immediately if any command fails
set -e

# --- Function Definitions (using printf instead of echo) ---

info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$*"
}

warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$*"
}

error() {
    # Output error message to stderr
    printf "${RED}[ERROR]${NC} %s\n" "$*" >&2
    exit 1
}

# --- Main Script ---

# 1. Check environment and permissions
info "Starting Mihomo automatic installation and configuration script..."

if [ "$(id -u)" -ne 0 ]; then
    error "This script requires root privileges. Please use 'sudo ./install_mihomo.sh'."
fi

if [ "$SUBSCRIPTION_URL" = "Paste your Clash subscription link here" ] || [ -z "$SUBSCRIPTION_URL" ]; then
    error "Please edit this script first and replace the SUBSCRIPTION_URL variable with your valid subscription link."
fi

# Check required commands
for cmd in curl wget gunzip; do
    if ! command -v $cmd > /dev/null 2>&1; then
        error "Command '$cmd' not found. Please install it first (e.g., sudo apt update && sudo apt install $cmd)."
    fi
done

# 2. Install mihomo
info "Step 1: Installing mihomo..."

# Detect system architecture
ARCH=""
case $(uname -m) in
    x86_64) ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *) error "Unsupported system architecture: $(uname -m)" ;;
esac
info "Detected system architecture: ${ARCH}"

# Find local mihomo files (supports .gz archives or extracted binaries)
LOCAL_GZ=$(ls mihomo-linux-${ARCH}-*.gz 2>/dev/null | head -n 1)
LOCAL_BIN=$(ls mihomo-linux-${ARCH}-* 2>/dev/null | grep -v '\.gz$' | head -n 1)

if [ -n "$LOCAL_GZ" ]; then
    info "Detected local file: ${LOCAL_GZ}, installing from local file..."
    gunzip -f "$LOCAL_GZ"
    LOCAL_BIN=$(ls mihomo-linux-${ARCH}-* 2>/dev/null | grep -v '\.gz$' | head -n 1)
    chmod +x "$LOCAL_BIN"
    mv "$LOCAL_BIN" "$MIHOMO_INSTALL_PATH"
elif [ -n "$LOCAL_BIN" ]; then
    info "Detected local file: ${LOCAL_BIN}, installing from local file..."
    chmod +x "$LOCAL_BIN"
    mv "$LOCAL_BIN" "$MIHOMO_INSTALL_PATH"
else
    info "No local file detected, downloading from GitHub..."
    # Get the latest version from GitHub API
    LATEST_TAG=$(curl -sL "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$LATEST_TAG" ]; then
        error "Failed to get the latest version from GitHub API. Please check your network connection or API limits."
    fi
    info "Latest version found: ${LATEST_TAG}"

    FILENAME="mihomo-linux-${ARCH}-${LATEST_TAG}.gz"

    # Build download URL and download
    MIHOMO_DOWNLOAD_URL="https://github.com/MetaCubeX/mihomo/releases/download/${LATEST_TAG}/${FILENAME}"
    info "Downloading from: ${MIHOMO_DOWNLOAD_URL}"
    wget -q -O mihomo.gz "$MIHOMO_DOWNLOAD_URL"

    info "Download complete, extracting..."
    gunzip -f mihomo.gz
    chmod +x mihomo
    mv mihomo "$MIHOMO_INSTALL_PATH"
fi

# Verify installation
if [ ! -x "$MIHOMO_INSTALL_PATH" ]; then
    error "mihomo installation failed, file not found or no execute permission."
fi
info "mihomo installed successfully! Version info:"
"$MIHOMO_INSTALL_PATH" -v
echo ""


# 3. Download Clash subscription configuration
info "Step 2: Downloading subscription configuration file..."

info "Creating configuration directory: ${MIHOMO_CONFIG_DIR}"
mkdir -p "$MIHOMO_CONFIG_DIR"

info "Downloading subscription file to ${MIHOMO_CONFIG_FILE}..."
wget -q -O "$MIHOMO_CONFIG_FILE" "$SUBSCRIPTION_URL"

if [ ! -s "$MIHOMO_CONFIG_FILE" ]; then
    error "Subscription file download failed or file is empty. Please check if your subscription link is correct and network is accessible."
fi
info "Subscription file downloaded successfully."
echo ""


# 4. Configure mihomo as a service
info "Step 3: Creating and configuring systemd service..."

if command -v systemctl > /dev/null 2>&1 && [ -d /run/systemd/system ]; then
	info "Detected systemd environment, configuring as systemd service"

	cat << EOF > "$SYSTEMD_SERVICE_FILE"
[Unit]
Description=Mihomo Daemon, A Clash Premium core implementation
After=network.target

[Service]
Type=simple
User=root
ExecStart=${MIHOMO_INSTALL_PATH} -d ${MIHOMO_CONFIG_DIR}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

	info "systemd service file created: ${SYSTEMD_SERVICE_FILE}"
	echo ""


	# 5. Start the service
	info "Step 4: Starting mihomo service..."

	info "Reloading systemd configuration..."
	systemctl daemon-reload

	info "Enabling mihomo auto-start on boot..."
	systemctl enable mihomo

	info "Starting mihomo service..."
	systemctl start mihomo

	# Wait a moment for the service to start
	sleep 2

	info "Script execution complete! Checking service status..."
	echo "=========================================================="
	systemctl status mihomo --no-pager
	echo "=========================================================="
	echo ""
	
	info "Mihomo has been successfully installed and started!"
	warn "To view live logs, run: journalctl -u mihomo -f"
	warn "To stop the service, run: sudo systemctl stop mihomo"
	warn "To restart the service, run: sudo systemctl restart mihomo"
else
	warn "systemd not detected, automatically switching to nohup background startup mode."
    nohup ${MIHOMO_INSTALL_PATH} -d ${MIHOMO_CONFIG_DIR} > /var/log/mihomo.log 2>&1 &
    info "Started mihomo using nohup, logs output to /var/log/mihomo.log"
    info "Mihomo has been installed and started in the background!"
    warn "To view logs, run: tail -f /var/log/mihomo.log"
    warn "To stop, use: pkill -f '${MIHOMO_INSTALL_PATH} -d ${MIHOMO_CONFIG_DIR}'"
fi
