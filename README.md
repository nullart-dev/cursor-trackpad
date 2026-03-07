# Cursor Trackpad

Turn your Android device into a trackpad that controls a Cuberto-style cursor on another screen.

## Features

- 🎯 Smooth cursor following with mouse-follower library
- 📱 Touch-based trackpad with gesture support
- 🧲 Magnetic/sticky cursor effects
- 📝 Text and image cursor states
- 🔄 Two-finger scrolling
- 👆 Tap gestures (single tap, double tap, two-finger tap)
- 📊 Real-time position tracking

## Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Start the Server

```bash
npm start
```

You'll see output like:
```
========================================
   Cursor Trackpad Server Running
========================================

Local:    http://localhost:3000
Network:  http://192.168.1.100:3000

Open on your devices:
  Trackpad: http://192.168.1.100:3000/trackpad.html
  Display:  http://192.168.1.100:3000/display.html

========================================
```

### 3. Open on Your Devices

1. **Display device** (laptop, desktop, TV): Open the display URL in Chrome
2. **Trackpad device** (Android phone/tablet): Open the trackpad URL in Chrome

Both devices must be on the same WiFi network.

## Usage

### Trackpad Gestures

| Gesture | Action |
|---------|--------|
| Single finger drag | Move cursor |
| Single tap | Left click |
| Double tap | Double click |
| Two finger tap | Right click |
| Two finger drag | Scroll |

### Display Interactions

The display page includes demo elements showing different cursor states:

- **Magnetic buttons** - Cursor sticks to button center
- **Text cursor** - Shows text inside the cursor on hover
- **Image preview** - Shows image thumbnail in cursor
- **Inverse cursor** - Cursor color inverts
- **Hidden cursor** - Cursor hides on hover

## Configuration

### Trackpad Settings

Adjust sensitivity using the slider at the bottom of the trackpad interface.

### Cursor Options

Modify cursor behavior in `public/js/display.js`:

```javascript
this.cursor = new MouseFollower({
    speed: 0.55,        // Movement speed (0-1)
    ease: 'expo.out',   // Easing function
    skewing: 2,         // Skew effect intensity
    stickDelta: 0.15,   // Magnetic effect strength
});
```

## Project Structure

```
cursor-trackpad/
├── server/
│   ├── package.json
│   └── server.js          # WebSocket server
└── public/
    ├── trackpad.html      # Trackpad interface
    ├── display.html       # Display with cursor
    ├── css/
    │   ├── trackpad.css
    │   └── display.css
    └── js/
        ├── trackpad.js    # Touch handling
        └── display.js     # Cursor control
```

## Dependencies

- [Express](https://expressjs.com/) - Web server
- [ws](https://github.com/websockets/ws) - WebSocket server
- [GSAP](https://greensock.com/gsap/) - Animation library
- [mouse-follower](https://github.com/Cuberto/mouse-follower) - Cursor effects

## Adding Custom Cursor States

### In HTML (using data attributes)

```html
<!-- Magnetic effect -->
<button data-cursor-stick>Sticky Button</button>

<!-- Text in cursor -->
<div data-cursor-text="Hello!">Hover me</div>

<!-- Image in cursor -->
<div data-cursor-img="/path/to/image.jpg">Show image</div>

<!-- Custom state -->
<div data-cursor="-inverse">Inverse cursor</div>

<!-- Combined -->
<button data-cursor-stick data-cursor-text="Click!" data-cursor="-pointer">
    Full featured button
</button>
```

### In JavaScript

```javascript
// Get cursor instance
const cursor = this.cursor;

// Add/remove states
cursor.addState('-pointer');
cursor.removeState('-pointer');

// Text
cursor.setText('Hello!');
cursor.removeText();

// Image
cursor.setImg('/path/to/image.jpg');
cursor.removeImg();

// Magnetic
cursor.setStick(element);
cursor.removeStick();

// Show/hide
cursor.hide();
cursor.show();
```

## Troubleshooting

### Devices can't connect

1. Ensure both devices are on the same WiFi network
2. Check if firewall is blocking port 3000
3. Try using the IP address shown in server output

### Cursor is laggy

1. Reduce sensitivity on trackpad
2. Check network latency
3. Close other browser tabs

### Touch not working on Android

1. Make sure you're using Chrome
2. Check that the page is served over HTTP (not file://)
3. Clear browser cache and reload

## Next Steps

For production use, consider:

1. **Native Android app** - Better touch handling and lower latency
2. **Direct connection** - Remove server, display acts as WebSocket server
3. **Bluetooth** - No WiFi needed, lower latency

## License

MIT
