#!/bin/bash

# ==========================================
# DigitalOcean Droplet Setup Script
# Run as root on fresh Ubuntu 22.04
# ==========================================

set -e

echo "🚀 Setting up Cursor Trackpad Server..."

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 for process management
npm install -g pm2

# Install nginx for reverse proxy
apt install -y nginx

# Create app directory
mkdir -p /var/www/cursor-trackpad
cd /var/www/cursor-trackpad

# Clone your repo (replace with your repo URL)
# git clone https://github.com/YOUR_USERNAME/cursor-trackpad.git .

echo "📁 Upload your project files to /var/www/cursor-trackpad"
echo "   Or clone from git"

# Create nginx config
cat > /etc/nginx/sites-available/cursor-trackpad << 'EOF'
server {
    listen 80;
    server_name _;  # Replace with your domain if you have one

    # Serve static files
    location / {
        root /var/www/cursor-trackpad/public;
        try_files $uri $uri/ @backend;
    }

    # Proxy to Node.js for API and WebSocket
    location @backend {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket endpoint
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/cursor-trackpad /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
nginx -t && systemctl reload nginx

# Firewall
ufw allow 22
ufw allow 80
ufw allow 443
ufw --force enable

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Upload your project to /var/www/cursor-trackpad"
echo "2. cd /var/www/cursor-trackpad/server"
echo "3. npm install"
echo "4. pm2 start server.js --name cursor-trackpad"
echo "5. pm2 save && pm2 startup"
echo ""
echo "Your app will be at: http://YOUR_DROPLET_IP"
