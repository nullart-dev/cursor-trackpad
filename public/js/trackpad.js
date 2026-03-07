class Trackpad {
    constructor() {
        // Elements
        this.trackpad = document.getElementById('trackpad');
        this.touchIndicator = document.getElementById('touch-indicator');
        this.statusEl = document.getElementById('connection-status');
        this.btnLeft = document.getElementById('btn-left');
        this.btnRight = document.getElementById('btn-right');
        this.sensitivityInput = document.getElementById('sensitivity');
        this.sensitivityValue = document.getElementById('sensitivity-value');

        // State
        this.sensitivity = 1.5;
        this.lastX = 0;
        this.lastY = 0;
        this.touchStartTime = 0;
        this.lastTouchEnd = 0;
        this.touchCount = 0;
        this.isScrolling = false;
        this.lastScrollY = 0;
        this.lastScrollX = 0;

        // Smooth scroll tracking
        this.scrollSamples = [];
        this.maxScrollSamples = 5;

        // WebSocket
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;

        // Throttling for performance
        this.lastMoveTime = 0;
        this.moveThrottle = 16; // ~60fps

        this.init();
    }

    init() {
        this.connectWebSocket();
        this.bindEvents();
        this.loadSettings();
    }

    // ==================== WebSocket ====================

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to server');
            this.reconnectAttempts = 0;
            this.updateStatus(true);

            // Register as trackpad
            this.send({
                type: 'register',
                clientType: 'trackpad'
            });
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.updateStatus(false);
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'registered') {
                console.log('Registered as trackpad');
            }
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 5000);
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            setTimeout(() => this.connectWebSocket(), delay);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    updateStatus(connected) {
        this.statusEl.className = connected ? 'connected' : 'disconnected';
    }

    // ==================== Event Binding ====================

    bindEvents() {
        // Touch events on trackpad
        this.trackpad.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.trackpad.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.trackpad.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.trackpad.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

        // Mouse buttons
        this.btnLeft.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.send({ type: 'click', button: 'left' });
            this.vibrateShort();
        });

        this.btnRight.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.send({ type: 'click', button: 'right' });
            this.vibrateShort();
        });

        // Settings
        this.sensitivityInput.addEventListener('input', (e) => {
            this.sensitivity = parseFloat(e.target.value);
            this.sensitivityValue.textContent = this.sensitivity.toFixed(1);
            this.saveSettings();
        });

        // Prevent context menu and other default behaviors
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ==================== Touch Handling ====================

    handleTouchStart(e) {
        e.preventDefault();

        const touches = e.touches;
        this.touchCount = touches.length;
        this.touchStartTime = Date.now();

        if (touches.length === 1) {
            // Single finger
            const touch = touches[0];
            this.lastX = touch.clientX;
            this.lastY = touch.clientY;
            this.isScrolling = false;

            // Update visual indicator
            this.updateTouchIndicator(touch.clientX, touch.clientY);
            this.trackpad.classList.add('touching');

        } else if (touches.length === 2) {
            // Two fingers - prepare for scroll
            this.isScrolling = true;
            this.lastScrollY = (touches[0].clientY + touches[1].clientY) / 2;
            this.lastScrollX = (touches[0].clientX + touches[1].clientX) / 2;
            this.scrollSamples = []; // Reset scroll samples
        }
    }

    handleTouchMove(e) {
        e.preventDefault();

        const touches = e.touches;
        const now = Date.now();

        if (touches.length === 1 && !this.isScrolling) {
            // Throttle move events for performance
            if (now - this.lastMoveTime < this.moveThrottle) {
                return;
            }
            this.lastMoveTime = now;

            // Single finger move - cursor movement
            const touch = touches[0];

            const deltaX = (touch.clientX - this.lastX) * this.sensitivity;
            const deltaY = (touch.clientY - this.lastY) * this.sensitivity;

            this.lastX = touch.clientX;
            this.lastY = touch.clientY;

            // Send movement
            this.send({
                type: 'move',
                deltaX: deltaX,
                deltaY: deltaY
            });

            // Update visual indicator
            this.updateTouchIndicator(touch.clientX, touch.clientY);

        } else if (touches.length === 2) {
            // Two finger scroll with smoothing
            const avgY = (touches[0].clientY + touches[1].clientY) / 2;
            const avgX = (touches[0].clientX + touches[1].clientX) / 2;
            
            const rawDeltaY = (avgY - this.lastScrollY);
            const rawDeltaX = (avgX - this.lastScrollX);
            
            this.lastScrollY = avgY;
            this.lastScrollX = avgX;

            // Add to samples for smoothing
            this.scrollSamples.push({ x: rawDeltaX, y: rawDeltaY, time: now });
            
            // Keep only recent samples
            while (this.scrollSamples.length > this.maxScrollSamples) {
                this.scrollSamples.shift();
            }

            // Calculate smoothed delta
            const smoothed = this.getSmoothedScroll();

            // Apply sensitivity and send
            this.send({
                type: 'scroll',
                deltaX: smoothed.x * this.sensitivity * 0.5,
                deltaY: -smoothed.y * this.sensitivity * 0.5 // Invert for natural scrolling
            });
        }
    }

    getSmoothedScroll() {
        if (this.scrollSamples.length === 0) {
            return { x: 0, y: 0 };
        }

        // Weighted average - more recent samples have higher weight
        let totalX = 0;
        let totalY = 0;
        let totalWeight = 0;

        this.scrollSamples.forEach((sample, index) => {
            const weight = index + 1; // Later samples get higher weight
            totalX += sample.x * weight;
            totalY += sample.y * weight;
            totalWeight += weight;
        });

        return {
            x: totalX / totalWeight,
            y: totalY / totalWeight
        };
    }

    handleTouchEnd(e) {
        e.preventDefault();

        const touchDuration = Date.now() - this.touchStartTime;
        const timeSinceLastTap = Date.now() - this.lastTouchEnd;

        // Detect taps
        if (touchDuration < 200) {
            if (this.touchCount === 1) {
                // Single tap - check for double tap
                if (timeSinceLastTap < 300) {
                    // Double tap
                    this.send({ type: 'doubleclick' });
                    this.vibrateLong();
                } else {
                    // Single tap = left click
                    this.send({ type: 'click', button: 'left' });
                    this.vibrateShort();
                }
            } else if (this.touchCount === 2) {
                // Two finger tap = right click
                this.send({ type: 'click', button: 'right' });
                this.vibrateShort();
            }
        }

        this.lastTouchEnd = Date.now();

        // Reset state if all fingers lifted
        if (e.touches.length === 0) {
            this.trackpad.classList.remove('touching');
            this.touchCount = 0;
            this.isScrolling = false;
            this.scrollSamples = [];
        }
    }

    // ==================== Visual Feedback ====================

    updateTouchIndicator(x, y) {
        const rect = this.trackpad.getBoundingClientRect();
        const relX = x - rect.left;
        const relY = y - rect.top;

        this.touchIndicator.style.left = `${relX}px`;
        this.touchIndicator.style.top = `${relY}px`;

        // Update CSS custom properties for gradient effect
        const percentX = (relX / rect.width) * 100;
        const percentY = (relY / rect.height) * 100;
        this.trackpad.style.setProperty('--touch-x', `${percentX}%`);
        this.trackpad.style.setProperty('--touch-y', `${percentY}%`);
    }

    // ==================== Haptic Feedback ====================

    vibrateShort() {
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }

    vibrateLong() {
        if (navigator.vibrate) {
            navigator.vibrate(30);
        }
    }

    // ==================== Settings ====================

    loadSettings() {
        const saved = localStorage.getItem('trackpad-settings');
        if (saved) {
            const settings = JSON.parse(saved);
            this.sensitivity = settings.sensitivity || 1.5;
            this.sensitivityInput.value = this.sensitivity;
            this.sensitivityValue.textContent = this.sensitivity.toFixed(1);
        }
    }

    saveSettings() {
        localStorage.setItem('trackpad-settings', JSON.stringify({
            sensitivity: this.sensitivity
        }));
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new Trackpad();
});
