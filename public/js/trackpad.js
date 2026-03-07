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

        // Scroll smoothing
        this.scrollAccumX = 0;
        this.scrollAccumY = 0;
        this.lastScrollTime = 0;
        this.scrollThrottleMs = 16; // ~60fps

        // WebSocket
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;

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
            this.lastScrollX = (touches[0].clientX + touches[1].clientX) / 2;
            this.lastScrollY = (touches[0].clientY + touches[1].clientY) / 2;
            this.scrollAccumX = 0;
            this.scrollAccumY = 0;
            this.lastScrollTime = Date.now();
        }
    }

    handleTouchMove(e) {
        e.preventDefault();

        const touches = e.touches;

        if (touches.length === 1 && !this.isScrolling) {
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
            // Two finger scroll - Apple-like smooth scrolling
            const avgX = (touches[0].clientX + touches[1].clientX) / 2;
            const avgY = (touches[0].clientY + touches[1].clientY) / 2;

            const deltaX = (avgX - this.lastScrollX) * this.sensitivity * 0.5;
            const deltaY = (avgY - this.lastScrollY) * this.sensitivity * 0.5;

            this.lastScrollX = avgX;
            this.lastScrollY = avgY;

            // Accumulate scroll deltas
            this.scrollAccumX += deltaX;
            this.scrollAccumY += deltaY;

            // Throttle sends for smoother feel
            const now = Date.now();
            if (now - this.lastScrollTime >= this.scrollThrottleMs) {
                this.send({
                    type: 'scroll',
                    deltaX: 0,
                    deltaY: -this.scrollAccumY // Invert for natural scrolling
                });

                this.scrollAccumX = 0;
                this.scrollAccumY = 0;
                this.lastScrollTime = now;
            }
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();

        const touchDuration = Date.now() - this.touchStartTime;
        const timeSinceLastTap = Date.now() - this.lastTouchEnd;

        // Send scroll end for momentum
        if (this.isScrolling && this.touchCount === 2) {
            // Send any remaining accumulated scroll
            if (Math.abs(this.scrollAccumX) > 0.1 || Math.abs(this.scrollAccumY) > 0.1) {
                this.send({
                    type: 'scroll',
                    deltaX: 0,
                    deltaY: -this.scrollAccumY
                });
            }
            
            // Signal scroll ended (display will continue momentum)
            this.send({ type: 'scrollEnd' });
        }

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
            this.scrollAccumX = 0;
            this.scrollAccumY = 0;
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
