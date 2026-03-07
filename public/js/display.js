class Display {
    constructor() {
        // Elements
        this.statusEl = document.getElementById('connection-status');
        this.statusText = this.statusEl.querySelector('.status-text');
        this.positionEl = document.getElementById('cursor-position');
        this.scrollArea = document.getElementById('scroll-area');

        // Cursor state
        this.cursorX = window.innerWidth / 2;
        this.cursorY = window.innerHeight / 2;
        this.isConnected = false;

        // Smooth scrolling (Apple-like momentum)
        this.scrollVelocityX = 0;
        this.scrollVelocityY = 0;
        this.scrollFriction = 0.94; // Higher = more momentum (0.90 - 0.96)
        this.scrollSensitivity = 2.0;
        this.isScrolling = false;
        this.currentScrollTarget = null;

        // Mouse follower instance
        this.cursor = null;

        // Hover state tracking
        this.lastHoveredElement = null;
        this.wasSticking = false;
        this.hadText = false;
        this.hadImg = false;
        this.currentStates = new Set();

        // WebSocket
        this.ws = null;
        this.reconnectAttempts = 0;

        this.init();
    }

    init() {
        this.initMouseFollower();
        this.connectWebSocket();
        this.bindEvents();
        this.startScrollLoop();
    }

    // ==================== Mouse Follower Setup ====================

    initMouseFollower() {
        // Register GSAP with MouseFollower
        MouseFollower.registerGSAP(gsap);

        // Create cursor instance
        this.cursor = new MouseFollower({
            speed: 0.55,
            ease: 'expo.out',
            skewing: 2,
            skewingText: 2,
            skewingIcon: 2,
            skewingMedia: 2,
            skewingDelta: 0.001,
            skewingDeltaMax: 0.15,
            stickDelta: 0.15,
            showTimeout: 0,
            hideOnLeave: false,
            // Disable default state detection - we handle it manually
            stateDetection: false
        });

        // Set initial position
        this.moveCursor(this.cursorX, this.cursorY);

        // Listen to cursor events
        this.cursor.on('render', () => {
            this.updatePositionDisplay();
        });
    }

    // ==================== WebSocket ====================

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to server');
            this.reconnectAttempts = 0;

            // Register as display
            this.send({
                type: 'register',
                clientType: 'display'
            });
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.updateStatus(false, 'Disconnected');
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts < 10) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 5000);
            setTimeout(() => this.connectWebSocket(), delay);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    // ==================== Message Handling ====================

    handleMessage(data) {
        switch (data.type) {
            case 'registered':
                this.updateStatus(true, 'Waiting for trackpad...');
                break;

            case 'move':
                this.handleMove(data.deltaX, data.deltaY);
                break;

            case 'click':
                this.handleClick(data.button);
                break;

            case 'doubleclick':
                this.handleDoubleClick();
                break;

            case 'scroll':
                this.handleScroll(data.deltaX, data.deltaY);
                break;
            
            case 'scrollEnd':
                this.handleScrollEnd();
                break;
        }

        // Update connection status when receiving trackpad data
        if (data.type === 'move' || data.type === 'click' || data.type === 'scroll') {
            this.updateStatus(true, 'Trackpad connected');
        }
    }

    handleMove(deltaX, deltaY) {
        // Update cursor position
        this.cursorX = Math.max(0, Math.min(window.innerWidth, this.cursorX + deltaX));
        this.cursorY = Math.max(0, Math.min(window.innerHeight, this.cursorY + deltaY));

        this.moveCursor(this.cursorX, this.cursorY);
        this.checkHoverState();
    }

    handleClick(button = 'left') {
        // Visual feedback
        this.cursor.addState('-active');
        setTimeout(() => this.cursor.removeState('-active'), 150);

        // Find element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (element) {
            if (button === 'left') {
                // Simulate click
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY
                });
                element.dispatchEvent(clickEvent);

                // Also trigger focus for interactive elements
                if (element.matches('button, a, input, select, textarea')) {
                    element.focus();
                }
            } else if (button === 'right') {
                // Simulate context menu (optional)
                const contextEvent = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY
                });
                element.dispatchEvent(contextEvent);
            }
        }
    }

    handleDoubleClick() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (element) {
            const dblClickEvent = new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY
            });
            element.dispatchEvent(dblClickEvent);
        }
    }

    // ==================== Smooth Scrolling (Apple-like) ====================

    handleScroll(deltaX, deltaY) {
        // Find scrollable element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        this.currentScrollTarget = this.findScrollableParent(element);

        // Add velocity instead of direct scroll (momentum-based)
        this.scrollVelocityX += deltaX * this.scrollSensitivity;
        this.scrollVelocityY += deltaY * this.scrollSensitivity;

        // Cap maximum velocity for smoother feel
        const maxVelocity = 50;
        this.scrollVelocityX = Math.max(-maxVelocity, Math.min(maxVelocity, this.scrollVelocityX));
        this.scrollVelocityY = Math.max(-maxVelocity, Math.min(maxVelocity, this.scrollVelocityY));

        this.isScrolling = true;
    }

    handleScrollEnd() {
        // Momentum continues naturally via friction
        // No abrupt stop
    }

    startScrollLoop() {
        const scrollLoop = () => {
            if (Math.abs(this.scrollVelocityX) > 0.5 || Math.abs(this.scrollVelocityY) > 0.5) {
                const target = this.currentScrollTarget;

                if (target) {
                    target.scrollBy({
                        top: this.scrollVelocityY,
                        left: this.scrollVelocityX,
                        behavior: 'auto'
                    });
                } else {
                    // Scroll the main window
                    window.scrollBy({
                        top: this.scrollVelocityY,
                        left: this.scrollVelocityX,
                        behavior: 'auto'
                    });
                }

                // Apply friction (deceleration) - this creates the momentum feel
                this.scrollVelocityX *= this.scrollFriction;
                this.scrollVelocityY *= this.scrollFriction;
            } else {
                // Stop completely when velocity is very low
                this.scrollVelocityX = 0;
                this.scrollVelocityY = 0;
                this.isScrolling = false;
            }

            requestAnimationFrame(scrollLoop);
        };

        requestAnimationFrame(scrollLoop);
    }

    findScrollableParent(element) {
        while (element && element !== document.body) {
            const style = window.getComputedStyle(element);
            const overflowY = style.overflowY;
            const overflowX = style.overflowX;

            if (
                (overflowY === 'auto' || overflowY === 'scroll') &&
                element.scrollHeight > element.clientHeight
            ) {
                return element;
            }

            if (
                (overflowX === 'auto' || overflowX === 'scroll') &&
                element.scrollWidth > element.clientWidth
            ) {
                return element;
            }

            element = element.parentElement;
        }
        return null;
    }

    // ==================== Cursor Movement ====================

    moveCursor(x, y) {
        // Get the cursor element
        const cursorEl = document.querySelector('.mf-cursor');
        
        if (cursorEl) {
            // Use GSAP for smooth animation
            gsap.to(cursorEl, {
                x: x,
                y: y,
                duration: 0.55,
                ease: 'expo.out',
                overwrite: true
            });
        }
    }

    // ==================== Hover State Detection ====================

    checkHoverState() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (!element) return;

        // Trigger mouseenter/mouseleave for state detection
        this.simulateHover(element);

        // Check for data attributes and apply cursor states
        this.checkCursorAttributes(element);
    }

    simulateHover(element) {
        // Store last hovered element
        if (this.lastHoveredElement && this.lastHoveredElement !== element) {
            // Mouse leave old element
            const leaveEvent = new MouseEvent('mouseleave', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY
            });
            this.lastHoveredElement.dispatchEvent(leaveEvent);
        }

        if (element !== this.lastHoveredElement) {
            // Mouse enter new element
            const enterEvent = new MouseEvent('mouseenter', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY
            });
            element.dispatchEvent(enterEvent);
        }

        this.lastHoveredElement = element;
    }

    checkCursorAttributes(element) {
        // Walk up the DOM to find cursor attributes
        let current = element;
        let foundStick = null;
        let foundText = null;
        let foundImg = null;
        let foundStates = new Set();

        while (current && current !== document.body) {
            // Check for stick
            if (current.hasAttribute('data-cursor-stick') && !foundStick) {
                const stickTarget = current.getAttribute('data-cursor-stick');
                foundStick = stickTarget ? document.querySelector(stickTarget) : current;
            }

            // Check for text
            if (current.hasAttribute('data-cursor-text') && !foundText) {
                foundText = current.getAttribute('data-cursor-text');
            }

            // Check for image
            if (current.hasAttribute('data-cursor-img') && !foundImg) {
                foundImg = current.getAttribute('data-cursor-img');
            }

            // Check for custom states (data-cursor="-pointer -inverse -hidden")
            if (current.hasAttribute('data-cursor')) {
                const states = current.getAttribute('data-cursor').split(' ').filter(s => s.trim());
                states.forEach(state => foundStates.add(state));
            }

            // Auto-detect interactive elements and add pointer state
            if (current.matches('a, button, [role="button"], .demo-btn, .demo-link')) {
                foundStates.add('-pointer');
            }

            // Cards get pointer state
            if (current.matches('.card, .image-item')) {
                foundStates.add('-pointer');
            }

            current = current.parentElement;
        }

        // ===== Apply Sticky =====
        if (foundStick && !this.wasSticking) {
            this.cursor.setStick(foundStick);
        } else if (!foundStick && this.wasSticking) {
            this.cursor.removeStick();
        }
        this.wasSticking = !!foundStick;

        // ===== Apply Text =====
        if (foundText && foundText !== this.hadText) {
            this.cursor.setText(foundText);
        } else if (!foundText && this.hadText) {
            this.cursor.removeText();
        }
        this.hadText = foundText || false;

        // ===== Apply Image =====
        if (foundImg && foundImg !== this.hadImg) {
            this.cursor.setImg(foundImg);
        } else if (!foundImg && this.hadImg) {
            this.cursor.removeImg();
        }
        this.hadImg = foundImg || false;

        // ===== Apply/Remove States =====
        // Remove states that are no longer active
        this.currentStates.forEach(state => {
            if (!foundStates.has(state)) {
                this.cursor.removeState(state);
            }
        });

        // Add new states
        foundStates.forEach(state => {
            if (!this.currentStates.has(state)) {
                this.cursor.addState(state);
            }
        });

        this.currentStates = foundStates;
    }

    // ==================== UI Updates ====================

    updateStatus(connected, message) {
        this.isConnected = connected;
        this.statusEl.className = connected ? 'connected' : 'disconnected';
        this.statusText.textContent = message;
    }

    updatePositionDisplay() {
        this.positionEl.textContent = `X: ${Math.round(this.cursorX)} | Y: ${Math.round(this.cursorY)}`;
    }

    // ==================== Event Binding ====================

    bindEvents() {
        // Handle window resize
        window.addEventListener('resize', () => {
            // Keep cursor in bounds
            this.cursorX = Math.min(this.cursorX, window.innerWidth);
            this.cursorY = Math.min(this.cursorY, window.innerHeight);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new Display();
});
