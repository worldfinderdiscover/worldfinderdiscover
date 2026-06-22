// ==========================================
// WORLDFINDER CORE ENGINE: IDENTITY & SYNC
// ==========================================

// Configuration Constants
const CONFIG = {
    POCKETBASE_URL: 'http://127.0.0.1:8090', // Your local PocketBase instance
    STORAGE_KEY: 'wf_device_secret'         // The local cookie-alternative passport
};

// Global Application State
let appState = {
    userSecret: null, // The private key (NEVER sent to the DB)
    userId: null      // The public signature (Sent to the DB)
};

/**
 * 🔑 DEVICE IDENTITY BOOTSTRAPPER
 * Generates or retrieves the user's anonymous cryptographic passport.
 */
function initDeviceIdentity() {
    // 1. Check if this browser already has a secret identity passport
    let existingSecret = localStorage.getItem(CONFIG.STORAGE_KEY);

    if (!existingSecret) {
        // 2. First Open: Generate a high-entropy cryptographically secure random string
        const buffer = new Uint8Array(16);
        window.crypto.getRandomValues(buffer);
        
        // Convert the random bytes to a clean hex text string
        existingSecret = Array.from(buffer)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // 3. Bake it into the browser's local storage permanently
        localStorage.setItem(CONFIG.STORAGE_KEY, existingSecret);
        console.log("✨ New WorldFinder Identity generated locally.");
    } else {
        console.log("💾 Existing WorldFinder Identity loaded from storage.");
    }

    // 4. Set our global state
    appState.userSecret = existingSecret;
    
    // 5. Slice out the first 15 characters to act as the Public User ID
    // This allows users to manage their pins without exposing their private key
    appState.userId = existingSecret.substring(0, 15);

    console.log(`👤 Anonymous Signature: wf_guest_${appState.userId}`);
}

// ==========================================
// TELEMETRY ENGINE: CANVAS MAP & HIGH-ACCURACY GPS
// ==========================================

// Extend the global application state to track spatial metrics
appState.map = null;
appState.userMarker = null;
appState.currentCoords = { lat: null, lng: null };

/**
 * 🗺️ CANVAS MAP INITIALIZER
 * Mounts a fullscreen map optimized for low-tier hardware performance.
 */
function initCanvasMap() {
    // Center initially on ASU Tempe coordinates as our fallback baseline
    const asuCenter = [33.4242, -111.9281];

    // Initialize the Leaflet map container with Canvas performance flag turned ON
    appState.map = L.map('map-viewport', {
        preferCanvas: true,       // Force drawing directly to canvas (crucial for cheap phones)
        zoomControl: false,       // Hide default desktop buttons to save screen space
        attributionControl: false // Hide small text to maximize map real estate
    }).setView(asuCenter, 15);

    // Load lightweight, high-contrast open-source street tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(appState.map);

    console.log("🗺️ Leaflet optimized canvas map successfully attached to viewport.");
}

/**
 * 🛰️ LIVE FOOTSTEP TELEMETRY TRACKER
 * Continuously watches hardware GPS position and locks user position.
 */
function trackUserLocation() {
    if (!navigator.geolocation) {
        console.error("❌ This device browser does not support GPS hardware mapping.");
        return;
    }

    // High-accuracy configuration options for walking speeds
    const geoOptions = {
        enableHighAccuracy: true, // Forces phone to use hardware GPS rather than cheap cellular towers
        timeout: 10000,           // Give up searching after 10 seconds to save battery
        maximumAge: 0             // Force browser to fetch fresh position data, never cached telemetry
    };

    navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            
            // Safeguard: If GPS is bouncing erratically (worse than 40m radius), log it but don't jump map camera
            if (accuracy > 40) {
                console.warn(`⚠️ High GPS variance detected (${Math.round(accuracy)}m). Stabilizing view.`);
            }

            appState.currentCoords.lat = latitude;
            appState.currentCoords.lng = longitude;

            // If this is the first ping, drop a custom pulsing blue marker onto their location
            if (!appState.userMarker) {
                // Using a simple Leaflet circle marker representing their current presence
                appState.userMarker = L.circleMarker([latitude, longitude], {
                    radius: 8,
                    fillColor: '#00e5ff', // Neon Blue Presence Dot
                    fillOpacity: 0.9,
                    color: '#ffffff',
                    weight: 2
                }).addTo(appState.map);

                // Smoothly glide the master camera grid to lock focus directly over their phone position
                appState.map.flyTo([latitude, longitude], 16, { animate: true, duration: 1.5 });
            } else {
                // Subsequent pings: smoothly slide their blue dot without jarring camera shifts
                appState.userMarker.setLatLng([latitude, longitude]);
            }

            console.log(`🛰️ GPS Pipeline Synchronized: [${latitude.toFixed(4)}, ${longitude.toFixed(4)}] Accuracy: ${Math.round(accuracy)}m`);
        },
        (error) => {
            console.error(`❌ Geolocation Core Fault: ${error.message}`);
        }, 
        geoOptions
    );
}

// ==========================================
// INTERACTIVE HUD FLUID DYNAMICS ENGINE
// ==========================================

/**
 * 🎛️ HUD INTERACTION INITIALIZER
 * Binds the floating pill buttons to slide the drawers and glide the map camera.
 */
function initHudInteractions() {
    const btnDrop = document.getElementById('btn-drop-pulse');
    const btnVibe = document.getElementById('btn-catch-vibe');
    const drawerDrop = document.getElementById('drawer-drop');
    const drawerVibe = document.getElementById('drawer-vibe');

    // Prevent clicks from falling through to the interactive map canvas below
    document.getElementById('action-pill').style.pointerEvents = 'auto';
    drawerDrop.style.pointerEvents = 'auto';
    drawerVibe.style.pointerEvents = 'auto';

    /**
     * STATE 1: Drop a Pulse Activated (Micro view)
     */
    btnDrop.addEventListener('click', () => {
        btnDrop.classList.add('active');
        btnVibe.classList.remove('active');
        drawerDrop.classList.add('open');
        drawerVibe.classList.remove('open');

        // Snap the map camera smoothly down to where the user is walking
        if (appState.currentCoords.lat && appState.map) {
            appState.map.flyTo([appState.currentCoords.lat, appState.currentCoords.lng], 17, {
                animate: true,
                duration: 1.0
            });
        }
    });

    /**
     * STATE 2: Catch a Vibe Activated (Macro view)
     */
    btnVibe.addEventListener('click', () => {
        btnVibe.classList.add('active');
        btnDrop.classList.remove('active');
        drawerVibe.classList.add('open');
        drawerDrop.classList.remove('open');

        // Glide the camera out to a bird's-eye bird view to reveal crowd density
        if (appState.map) {
            appState.map.zoomOut(3, { animate: true, duration: 1.2 });
        }
    });
}

// ==========================================
// 🚀 UNIFIED APPLICATION MASTER BOOTSTRAP
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initDeviceIdentity();   // 1. Mint or load anonymous identity token
    initCanvasMap();        // 2. Load the optimized canvas map layout
    trackUserLocation();    // 3. Fire up high-accuracy hardware GPS pipeline
    initHudInteractions();  // 4. Bind layout drawer transitions
});
