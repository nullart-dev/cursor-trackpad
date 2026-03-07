const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Environment
const isProd = process.env.NODE_ENV === 'production';

// CORS for production
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint for DigitalOcean
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Track connected clients
const clients = {
    trackpads: new Set(),
    displays: new Set()
};

// Get local IP address for easy connection
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

wss.on('connection', (ws, req) => {
    console.log('New connection established');
    
    let clientType = null;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // Handle registration
            if (message.type === 'register') {
                clientType = message.clientType;
                
                if (clientType === 'trackpad') {
                    clients.trackpads.add(ws);
                    console.log(`Trackpad connected. Total trackpads: ${clients.trackpads.size}`);
                } else if (clientType === 'display') {
                    clients.displays.add(ws);
                    console.log(`Display connected. Total displays: ${clients.displays.size}`);
                }
                
                // Send confirmation
                ws.send(JSON.stringify({ 
                    type: 'registered', 
                    clientType,
                    timestamp: Date.now()
                }));
                
                return;
            }
            
            // Forward trackpad messages to all displays
            if (clientType === 'trackpad') {
                const messageStr = JSON.stringify(message);
                clients.displays.forEach(display => {
                    if (display.readyState === 1) { // WebSocket.OPEN
                        display.send(messageStr);
                    }
                });
            }
            
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        if (clientType === 'trackpad') {
            clients.trackpads.delete(ws);
            console.log(`Trackpad disconnected. Total trackpads: ${clients.trackpads.size}`);
        } else if (clientType === 'display') {
            clients.displays.delete(ws);
            console.log(`Display disconnected. Total displays: ${clients.displays.size}`);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// API endpoint to check server status
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        trackpads: clients.trackpads.size,
        displays: clients.displays.size
    });
});

const PORT = process.env.PORT || 3000;
const IP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('   Cursor Trackpad Server Running');
    console.log('========================================\n');
    console.log(`Local:    http://localhost:${PORT}`);
    console.log(`Network:  http://${IP}:${PORT}\n`);
    console.log('Open on your devices:');
    console.log(`  Trackpad: http://${IP}:${PORT}/trackpad.html`);
    console.log(`  Display:  http://${IP}:${PORT}/display.html`);
    console.log('\n========================================\n');
});
