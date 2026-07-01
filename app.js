// ============================================================================
// WORLDFINDER NEXT-GEN ENGINE: ARCHITECTURAL STATE LEDGER
// ============================================================================

const CONFIG = {
    // Interchangeable endpoint configuration target
    POCKETBASE_URL: 'https://worldfinder-worldfinder.hf.space', 
    STORAGE_KEY: 'wf_device_secret'
};

// Clean State Engine. Complete separation of raw data from UI components
let appState = {
    userSecret: null, 
    userId: null,
    map: null,
    userMarker: null,
    currentCoords: { lat: 33.4242, lng: -111.9281 }, // Default coordinates locked onto ASU Tempe
    pendingPinLatLng: null,
    pins: new Map() // Master structural state data ledger (Map ID -> Clean Data Record Object)
};

const activeMarkers = {}; // Tracks physical vector layer identities instance-mapped to the Leaflet canvas
const pb = new PocketBase(CONFIG.POCKETBASE_URL);
pb.autoCancellation(false); // Protect native pipeline channels from standard fetch cancellations

// Secure anonymous token layout tracking device identity locally
function initDeviceIdentity() {
    let existingSecret = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!existingSecret) {
        const buffer = new Uint8Array(16);
        window.crypto.getRandomValues(buffer);
        existingSecret = Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(CONFIG.STORAGE_KEY, existingSecret);
    }
    appState.userSecret = existingSecret;
    appState.userId = existingSecret.substring(0, 15);
    console.log(`👤 Active Signature: wf_guest_${appState.userId}`);
}

// ============================================================================
// THE UNIDIRECTIONAL CONTROL HORN: UNIFIED COMPONENT RENDERING
// ============================================================================

function commitStateToUI() {
    renderMapCanvas();
    renderProximityFeed();
}

// Visual Component 1: Completely decoupled map layer rendering
function renderMapCanvas() {
    if (!appState.map) return;

    // Remove any physical layer references removed from the data state ledger
    Object.keys(activeMarkers).forEach(id => {
        if (!appState.pins.has(id)) {
            appState.map.removeLayer(activeMarkers[id]);
            delete activeMarkers[id];
        }
    });

    // Draw layers cleanly based on data records inside the central ledger
    appState.pins.forEach((pin, id) => {
        if (!activeMarkers[id]) {
            const marker = L.circleMarker([pin.lat, pin.lng], {
                radius: 10,
                fillColor: pin.user_id === appState.userId ? '#2ed573' : '#ff4757',
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(appState.map);

            marker.bindPopup(`<div style="color:#111; font-weight:500;">${escapeHTML(pin.message)}</div>`);
            activeMarkers[id] = marker;
        }
    });
}

// Visual Component 2: Decoupled sidebar item template generator (Reads clean array data)
function renderProximityFeed() {
    const feedContainer = document.getElementById('proximity-feed-list');
    if (!feedContainer) return;

    feedContainer.innerHTML = "";
    
    // Sort records descending natively out of your master state data dictionary
    const sortedPins = Array.from(appState.pins.values()).sort((a, b) => new Date(b.created) - new Date(a.created));

    if (sortedPins.length === 0) {
        feedContainer.innerHTML = `<div style="color:#666; text-align:center; padding-top:40px; font-size:13px;">No active pulses around Tempe.</div>`;
        return;
    }

    sortedPins.forEach(pin => {
        const card = document.createElement('div');
        card.className = "feed-card";
        
        const isOwner = pin.user_id === appState.userId;
        const deleteButtonHTML = isOwner ? `<button class="delete-btn" onclick="executeSoftDelete('${pin.id}')">Remove</button>` : '';

        card.innerHTML = `
            ${deleteButtonHTML}
            <p>${escapeHTML(pin.message)}</p>
            <div class="feed-meta">
                <span>📍 ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}</span>
                <span>⏱️ ${pin.duration_hours}h</span>
            </div>
        `;
        
        // Clicking a sidebar item pans fluidly to its mapped vector coordinate location
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-btn')) return;
            appState.map.setView([pin.lat, pin.lng], 16, { animate: true, duration: 0.5 });
        });

        feedContainer.appendChild(card);
    });
}

// ============================================================================
// TRANSMISSION ACTIONS & CONTROLLERS
// ============================================================================

async function executeSoftDelete(id) {
    try {
        // Direct, non-compromised programmatic update payload firing cleanly to the server
        await pb.collection('pins').update(id, { message: "DELETED_BY_OWNER" });
    } catch (err) {
        console.error("Transmission Error executing removal validation rules:", err);
    }
}

// Helper tool preventing cross-site scripting vulnerabilities inside string layout mapping
function escapeHTML(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ============================================================================
// CORE LEAFLET MAP CANVAS SETUP
// ============================================================================

function initCanvasMap() {
    appState.map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([appState.currentCoords.lat, appState.currentCoords.lng], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(appState.map);

    appState.userMarker = L.circleMarker([appState.currentCoords.lat, appState.currentCoords.lng], {
        radius: 7,
        fillColor: '#38ef7d',
        color: '#ffffff',
        weight: 3,
        fillOpacity: 1
    }).addTo(appState.map).bindPopup("<b style='color:#111;'>Your Location</b>");

    // Dynamic map interaction placement listener
    appState.map.on('click', (e) => {
        appState.pendingPinLatLng = [e.latlng.lat, e.latlng.lng];
        document.getElementById('action-pill-container').style.display = "none";
        document.getElementById('inputPanel').classList.add('active');
    });
}

function trackUserLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
        (position) => {
            appState.currentCoords.lat = position.coords.latitude;
            appState.currentCoords.lng = position.coords.longitude;
            if (appState.userMarker) {
                appState.userMarker.setLatLng([appState.currentCoords.lat, appState.currentCoords.lng]);
            }
        },
        (err) => console.warn("GPS Telemetry Access Denied: Running on manual coordinate canvas overrides."),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// ============================================================================
// DOM INTERACTION HANDLERS
// ============================================================================

function initHudInteractions() {
    const drawer = document.getElementById('feed-drawer');
    
    document.getElementById('vibe-btn').addEventListener('click', () => drawer.classList.add('active'));
    document.getElementById('close-drawer-btn').addEventListener('click', () => drawer.classList.remove('active'));
    
    document.getElementById('pulse-btn').addEventListener('click', () => {
        appState.pendingPinLatLng = [appState.currentCoords.lat, appState.currentCoords.lng];
        document.getElementById('action-pill-container').style.display = "none";
        document.getElementById('inputPanel').classList.add('active');
    });

    document.getElementById('cancelPinBtn').addEventListener('click', () => {
        document.getElementById('inputPanel').classList.remove('active');
        document.getElementById('action-pill-container').style.display = "flex";
        appState.pendingPinLatLng = null;
        document.getElementById('pinMessageInput').value = "";
    });

    document.getElementById('submitPinBtn').addEventListener('click', async () => {
        const message = document.getElementById('pinMessageInput').value.trim();
        const durationHours = parseInt(document.getElementById('pinTierSelect').value);
        
        if (!message || !appState.pendingPinLatLng) return;
        
        try {
            await pb.collection('pins').create({ 
                message: message, 
                lat: appState.pendingPinLatLng[0], 
                lng: appState.pendingPinLatLng[1], 
                duration_hours: durationHours, 
                user_id: appState.userId 
            });
            
            document.getElementById('pinMessageInput').value = "";
            document.getElementById('inputPanel').classList.remove('active');
            document.getElementById('action-pill-container').style.display = "flex";
            appState.pendingPinLatLng = null;
        } catch (err) { 
            alert("Database transmission failed."); 
        }
    });
}

// ============================================================================
// THE TRUE UNCOMPROMISED REAL-TIME PIPELINE HANDSHAKE
// ============================================================================

async function runInitialDatabaseBootstrap() {
    try {
        // Fetch snapshot configuration mapping directly into memory ledger
        const records = await pb.collection('pins').getFullList({ sort: '-created' });
        appState.pins.clear();
        
        records.forEach(record => {
            if (record.message !== "DELETED_BY_OWNER") {
                appState.pins.set(record.id, record);
            }
        });
        commitStateToUI();
    } catch (err) {
        console.error("Initial pipeline load failed, initializing real-time connection listeners:", err);
    }
}

function startUncompromisedLiveSync() {
    // True native SSE streaming pipe subscription layout mapping entries straight to state memory
    pb.collection('pins').subscribe('*', function (e) {
        console.log("📡 STREAM PIPELINE SIGNAL RECEIVED:", e.action, e.record.id);
        
        if (e.action === 'create' && e.record.message !== "DELETED_BY_OWNER") {
            appState.pins.set(e.record.id, e.record);
        } else if (e.action === 'update') {
            if (e.record.message === "DELETED_BY_OWNER") {
                appState.pins.delete(e.record.id); // Erase from ledger instantly
            } else {
                appState.pins.set(e.record.id, e.record); // Update entry instantly
            }
        } else if (e.action === 'delete') {
            appState.pins.delete(e.record.id);
        }
        
        // Execute global unidirectional update sequence immediately on event arrival
        commitStateToUI();
    }).catch(err => console.error("Real-time transport connection refused (Streaming Pipe Terminated):", err));
}

// ============================================================================
// UNIFIED ENGINE INITIALIZER
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initDeviceIdentity();
    initCanvasMap();
    trackUserLocation();
    initHudInteractions();
    
    // Boot native data streams
    runInitialDatabaseBootstrap();
    startUncompromisedLiveSync();
});
