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
        this.expandToggle = document.getElementById('expand-toggle');
        this.settingsPanel = document.getElementById('settings');
        this.appEl = document.getElementById('app');

        // Settings
        this.sensitivity = 5;
        this.settingsExpanded = false;

        // ==================== State Machine ====================
        // States: idle | pendingTap | dragging | twoFingerPending | scrolling
        this.state = 'idle';

        // Configurable thresholds
        this.TAP_MOVE_THRESHOLD = 5;      // px — movement below this counts as a tap, not a drag
        this.TAP_MAX_DURATION = 200;       // ms — touch longer than this can't be a tap
        this.DOUBLE_TAP_WINDOW = 300;      // ms — max gap between taps for a double-tap
        this.SCROLL_MOVE_THRESHOLD = 8;    // px — two-finger movement below this stays as pending (could be a tap)
        this.LONG_PRESS_DURATION = 500;    // ms — hold longer than this = long press (future use)

        // Touch tracking
        this.startX = 0;             // finger position at touchstart
        this.startY = 0;
        this.lastX = 0;              // previous frame position (for deltas)
        this.lastY = 0;
        this.totalMovement = 0;      // accumulated distance from start (for dead zone)
        this.touchStartTime = 0;
        this.touchCount = 0;         // current number of fingers down

        // Two-finger tracking
        this.scrollStartMidX = 0;
        this.scrollStartMidY = 0;
        this.lastScrollX = 0;
        this.lastScrollY = 0;
        this.twoFingerTotalMovement = 0;

        // Scroll smoothing
        this.scrollAccumX = 0;
        this.scrollAccumY = 0;
        this.lastScrollTime = 0;
        this.scrollThrottleMs = 16;  // ~60fps

        // Scroll momentum
        this.scrollVelocityX = 0;
        this.scrollVelocityY = 0;
        this.momentumRAF = null;

        // Double-tap detection
        this.tapTimer = null;        // delayed single-click timer
        this.lastTapTime = 0;        // timestamp of last committed tap

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

    // ==================== State Machine ====================

    transition(newState) {
        const prev = this.state;
        this.state = newState;
        // Uncomment for debugging:
        // console.log(`[state] ${prev} → ${newState}`);
    }

    // ==================== Touch Handlers ====================

    handleTouchStart(e) {
        e.preventDefault();

        const touches = e.touches;
        this.touchCount = touches.length;
        this.touchStartTime = Date.now();

        if (touches.length === 1) {
            const touch = touches[0];
            this.startX = touch.clientX;
            this.startY = touch.clientY;
            this.lastX = touch.clientX;
            this.lastY = touch.clientY;
            this.totalMovement = 0;

            // Cancel any ongoing momentum
            this.stopMomentum();

            // Enter pendingTap — we don't know yet if this is a tap or drag
            this.transition('pendingTap');

            // Visual feedback
            this.updateTouchIndicator(touch.clientX, touch.clientY);
            this.trackpad.classList.add('touching');

        } else if (touches.length === 2) {
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;

            this.scrollStartMidX = midX;
            this.scrollStartMidY = midY;
            this.lastScrollX = midX;
            this.lastScrollY = midY;
            this.twoFingerTotalMovement = 0;
            this.scrollAccumX = 0;
            this.scrollAccumY = 0;
            this.scrollVelocityX = 0;
            this.scrollVelocityY = 0;
            this.lastScrollTime = Date.now();

            // Cancel any pending single-tap (finger count changed)
            this.cancelTapTimer();

            // Enter twoFingerPending — could be a two-finger tap or scroll
            this.transition('twoFingerPending');
        }
    }

    handleTouchMove(e) {
        e.preventDefault();

        const touches = e.touches;

        if (touches.length === 1 && (this.state === 'pendingTap' || this.state === 'dragging')) {
            const touch = touches[0];
            const dx = touch.clientX - this.lastX;
            const dy = touch.clientY - this.lastY;

            // Accumulate total distance from start point
            this.totalMovement += Math.sqrt(dx * dx + dy * dy);

            if (this.state === 'pendingTap') {
                // Still in dead zone? Don't send movement yet
                if (this.totalMovement < this.TAP_MOVE_THRESHOLD) {
                    this.lastX = touch.clientX;
                    this.lastY = touch.clientY;
                    return;
                }

                // Exceeded dead zone — commit to dragging
                this.transition('dragging');
                this.cancelTapTimer();
            }

            // In dragging state — send movement delta
            const deltaX = dx * this.sensitivity;
            const deltaY = dy * this.sensitivity;

            this.lastX = touch.clientX;
            this.lastY = touch.clientY;

            this.send({
                type: 'move',
                deltaX: deltaX,
                deltaY: deltaY
            });

            this.updateTouchIndicator(touch.clientX, touch.clientY);

        } else if (touches.length === 2 && (this.state === 'twoFingerPending' || this.state === 'scrolling')) {
            const midX = (touches[0].clientX + touches[1].clientX) / 2;
            const midY = (touches[0].clientY + touches[1].clientY) / 2;

            const dx = midX - this.lastScrollX;
            const dy = midY - this.lastScrollY;

            this.twoFingerTotalMovement += Math.sqrt(dx * dx + dy * dy);

            if (this.state === 'twoFingerPending') {
                // Still in dead zone?
                if (this.twoFingerTotalMovement < this.SCROLL_MOVE_THRESHOLD) {
                    this.lastScrollX = midX;
                    this.lastScrollY = midY;
                    return;
                }

                // Exceeded dead zone — commit to scrolling
                this.transition('scrolling');
            }

            // In scrolling state — accumulate and send
            const deltaX = dx * this.sensitivity * 0.5;
            const deltaY = dy * this.sensitivity * 0.5;

            this.lastScrollX = midX;
            this.lastScrollY = midY;

            this.scrollAccumX += deltaX;
            this.scrollAccumY += deltaY;

            // Track velocity for momentum (exponential moving average)
            const now = Date.now();
            const dt = now - this.lastScrollTime;
            if (dt > 0) {
                const alpha = 0.3;
                this.scrollVelocityX = alpha * (deltaX / dt * 16) + (1 - alpha) * this.scrollVelocityX;
                this.scrollVelocityY = alpha * (deltaY / dt * 16) + (1 - alpha) * this.scrollVelocityY;
            }

            // Throttle sends for smoother feel
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
        const allFingersUp = e.touches.length === 0;

        // ---- Handle state-specific end logic ----

        if (this.state === 'pendingTap' && this.touchCount === 1) {
            // Finger lifted without exceeding movement threshold — it's a tap
            if (touchDuration < this.TAP_MAX_DURATION) {
                this.handleTap();
            }
        }

        if (this.state === 'twoFingerPending' && this.touchCount === 2) {
            // Two fingers lifted without exceeding scroll threshold — two-finger tap
            if (touchDuration < this.TAP_MAX_DURATION) {
                this.cancelTapTimer();
                this.send({ type: 'click', button: 'right' });
                this.vibrateShort();
            }
        }

        if (this.state === 'scrolling') {
            // Flush remaining scroll accumulation
            if (Math.abs(this.scrollAccumX) > 0.1 || Math.abs(this.scrollAccumY) > 0.1) {
                this.send({
                    type: 'scroll',
                    deltaX: 0,
                    deltaY: -this.scrollAccumY
                });
            }

            // Start momentum if there was meaningful velocity
            const speed = Math.sqrt(
                this.scrollVelocityX * this.scrollVelocityX +
                this.scrollVelocityY * this.scrollVelocityY
            );
            if (speed > 0.5) {
                this.startMomentum();
            } else {
                this.send({ type: 'scrollEnd' });
            }
        }

        // ---- Reset if all fingers are up ----
        if (allFingersUp) {
            this.trackpad.classList.remove('touching');
            this.touchCount = 0;

            // Only go back to idle if we're not waiting on a tap timer
            if (this.state !== 'pendingTap' || !this.tapTimer) {
                this.transition('idle');
            }

            this.scrollAccumX = 0;
            this.scrollAccumY = 0;
        }
    }

    // ==================== Tap Handling (with double-tap delay) ====================

    handleTap() {
        const now = Date.now();
        const timeSinceLastTap = now - this.lastTapTime;

        if (timeSinceLastTap < this.DOUBLE_TAP_WINDOW && this.tapTimer) {
            // Second tap arrived within window — double-tap
            this.cancelTapTimer();
            this.lastTapTime = 0;
            this.send({ type: 'doubleclick' });
            this.vibrateLong();
            this.transition('idle');
        } else {
            // First tap — delay to wait for possible second tap
            this.cancelTapTimer();
            this.lastTapTime = now;

            this.tapTimer = setTimeout(() => {
                this.tapTimer = null;
                this.send({ type: 'click', button: 'left' });
                this.vibrateShort();
                this.transition('idle');
            }, this.DOUBLE_TAP_WINDOW);
        }
    }

    cancelTapTimer() {
        if (this.tapTimer) {
            clearTimeout(this.tapTimer);
            this.tapTimer = null;
        }
    }

    // ==================== Scroll Momentum ====================

    startMomentum() {
        const friction = 0.95;
        const minSpeed = 0.3;

        const tick = () => {
            this.scrollVelocityX *= friction;
            this.scrollVelocityY *= friction;

            const speed = Math.sqrt(
                this.scrollVelocityX * this.scrollVelocityX +
                this.scrollVelocityY * this.scrollVelocityY
            );

            if (speed < minSpeed) {
                this.scrollVelocityX = 0;
                this.scrollVelocityY = 0;
                this.send({ type: 'scrollEnd' });
                this.momentumRAF = null;
                return;
            }

            this.send({
                type: 'scroll',
                deltaX: 0,
                deltaY: -this.scrollVelocityY
            });

            this.momentumRAF = requestAnimationFrame(tick);
        };

        this.momentumRAF = requestAnimationFrame(tick);
    }

    stopMomentum() {
        if (this.momentumRAF) {
            cancelAnimationFrame(this.momentumRAF);
            this.momentumRAF = null;
            this.scrollVelocityX = 0;
            this.scrollVelocityY = 0;
        }
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

        // Expand/collapse settings toggle
        this.expandToggle.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.settingsExpanded = !this.settingsExpanded;
            this.settingsPanel.classList.toggle('collapsed', !this.settingsExpanded);
            this.appEl.classList.toggle('expanded', this.settingsExpanded);
        });

        // Prevent context menu
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ==================== Visual Feedback ====================

    updateTouchIndicator(x, y) {
        const rect = this.trackpad.getBoundingClientRect();
        const relX = x - rect.left;
        const relY = y - rect.top;

        this.touchIndicator.style.left = `${relX}px`;
        this.touchIndicator.style.top = `${relY}px`;

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
            this.sensitivity = settings.sensitivity || 5;
            // Clamp to new range in case old settings had a value outside 3-10
            this.sensitivity = Math.max(3, Math.min(10, this.sensitivity));
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
