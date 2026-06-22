// ==========================================
// WORLDFINDER CORE ENGINE: IDENTITY & SYNC
// ==========================================

const CONFIG = {
    POCKETBASE_URL: 'https://worldfinder-worldfinder.hf.space',
    STORAGE_KEY: 'wf_device_secret'
};

let appState = {
    userSecret: null, 
    userId: null,
    map: null,
    userMarker: null,
    currentCoords: { lat: null, lng: null },
    pendingPinLatLng: null
};

const pb = new PocketBase(CONFIG.POCKETBASE_URL);
const activeMarkers = {};

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
    console.log(`👤 Anonymous Signature: wf_guest_${appState.userId}`);
}

// ==========================================
// TELEMETRY ENGINE: CANVAS MAP & HIGH-ACCURACY GPS
// ==========================================

function initCanvasMap() {
    const asuCenter = [33.4242, -111.9281];
    
    // Mount directly to your layout container ID `#map`
    appState.map = L.map('map', {
        preferCanvas: true,
        zoomControl: false,
        attributionControl: false
    }).setView(asuCenter, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(appState.map);

    // Map click lists a pending pin location boundary
    appState.map.on('click', function(e) {
        if (typeof openInputDrawer === "function") {
            openInputDrawer(e.latlng.lat, e.latlng.lng);
        }
    });
}

function trackUserLocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.watchPosition(
        (position) => {
            let { latitude, longitude, accuracy } = position.coords;
            if (accuracy > 40) { latitude = 33.4242; longitude = -111.9281; }

            appState.currentCoords.lat = latitude;
            appState.currentCoords.lng = longitude;

            if (!appState.userMarker) {
                appState.map.setView([latitude, longitude], 17);
                appState.userMarker = L.marker([latitude, longitude], {
                    icon: L.divIcon({ className: 'user-location-dot', iconSize: [14, 14] })
                }).addTo(appState.map);
            } else {
                appState.userMarker.setLatLng([latitude, longitude]);
            }
        },
        (error) => { console.error(error); }, 
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 4000 }
    );
}

// ==========================================
// TIME-AWARE DATA STREAM SYNC PIPELINE
// ==========================================

function drawPinOnMap(pinData) {
    if (pinData.message === "DELETED_BY_OWNER") {
        if (activeMarkers[pinData.id]) {
            appState.map.removeLayer(activeMarkers[pinData.id]);
            delete activeMarkers[pinData.id];
        }
        return;
    }
    if (activeMarkers[pinData.id]) return;

    const createdTime = new Date(pinData.created); 
    const hours = pinData.duration_hours || 1; 
    const lifespanInMs = hours * 60 * 60 * 1000; 
    const expirationTime = new Date(createdTime.getTime() + lifespanInMs);
    const millisecondsLeft = expirationTime.getTime() - new Date().getTime();

    if (millisecondsLeft <= 0) return; 

    let pinStyle = 'neon-pin-icon';
    let label = 'Live Pulse (Free)';
    if (hours === 6) { pinStyle = 'pro-pin-icon'; label = 'Pro Spot'; }
    else if (hours === 24) { pinStyle = 'anchor-pin-icon'; label = 'Anchor Spot'; }
    else if (hours === 168) { pinStyle = 'landmark-pin-icon'; label = 'Landmark Event'; }

    const customIcon = L.divIcon({ className: pinStyle, iconSize: [12, 12] });
    const isOwner = pinData.user_id === appState.userId;
    const deleteButtonHtml = isOwner ? `<br><button onclick="deletePinPermanently('${pinData.id}')" style="margin-top: 10px; background: #ff0055; color: white; border: none; padding: 6px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer; width: 100%;">Remove My Pin</button>` : '';
    const expTimeString = expirationTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    const marker = L.marker([pinData.lat, pinData.lng], { icon: customIcon }).addTo(appState.map).bindPopup(`
        <div style="font-family: sans-serif; min-width: 140px;">
            <span style="color: #888; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
            <p style="margin: 6px 0; font-size: 14px; font-weight: 500; color: #fff;">${pinData.message}</p>
            <span style="color: rgba(255,255,255,0.6); font-size: 11px;">⏱️ Expires at ${expTimeString}</span>
            ${deleteButtonHtml}
        </div>
    `);
    activeMarkers[pinData.id] = marker;

    setTimeout(() => { 
        if (activeMarkers[pinData.id]) {
            appState.map.removeLayer(marker); 
            delete activeMarkers[pinData.id];
        }
    }, millisecondsLeft);
}

async function deletePinPermanently(pinId) {
    if (confirm("Do you want to clear this pin from the live map?")) {
        try {
            await pb.collection('pins').update(pinId, { message: "DELETED_BY_OWNER", user_id: appState.userId });
        } catch (err) { console.error(err); }
    }
}

async function syncPinsPipeline() {
    try {
        const records = await pb.collection('pins').getList(1, 50, { sort: '-created' });
        records.items.forEach(pinData => { if (pinData.lat && pinData.lng) drawPinOnMap(pinData); });
    } catch (err) { console.log(err); }
}

function startLiveSync() {
    pb.collection('pins').subscribe('*', function (e) {
        if (e.action === 'create' || e.action === 'update') drawPinOnMap(e.record);
        if (e.action === 'delete' && activeMarkers[e.record.id]) {
            appState.map.removeLayer(activeMarkers[e.record.id]);
            delete activeMarkers[e.record.id];
        }
    }).catch(err => console.log(err));
}

// ==========================================
// INTERACTIVE HUD FLUID DYNAMICS ENGINE
// ==========================================

function initHudInteractions() {
    const btnDrop = document.getElementById('btn-drop-pulse');
    const btnVibe = document.getElementById('btn-catch-vibe');
    const drawerVibe = document.getElementById('drawer-vibe');
    const drawerDrop = document.getElementById('inputPanel'); 

    // Prevent clicks from falling through to the interactive map canvas below
    document.getElementById('action-pill').style.pointerEvents = 'auto';
    if (drawerVibe) drawerVibe.style.pointerEvents = 'auto';
    if (drawerDrop) drawerDrop.style.pointerEvents = 'auto';

    /**
     * STATE 1: DROP A PULSE ACTIVATED
     */
    btnDrop.addEventListener('click', () => {
        btnDrop.classList.add('active');
        btnVibe.classList.remove('active');
        if (drawerVibe) drawerVibe.classList.remove('open');
        
        if (appState.currentCoords.lat && appState.map) {
            appState.map.flyTo([appState.currentCoords.lat, appState.currentCoords.lng], 17, {
                animate: true,
                duration: 1.0
            });
            if (typeof openInputDrawer === "function") {
                openInputDrawer(appState.currentCoords.lat, appState.currentCoords.lng);
            }
        } else {
            alert("Waiting for GPS telemetry signal...");
        }
    });

    /**
     * STATE 2: CATCH A VIBE ACTIVATED (Clean Macro Target & Feed Fetch)
     */
    btnVibe.addEventListener('click', () => {
        btnVibe.classList.add('active');
        btnDrop.classList.remove('active');
        
        if (typeof closeInputDrawer === "function") closeInputDrawer();
        if (drawerVibe) drawerVibe.classList.add('open');

        // FIX 1: Zoom cleanly to lock focus directly over the active Tempe/ASU testing grid
        if (appState.map) {
            appState.map.flyTo([33.4242, -111.9281], 14, {
                animate: true,
                duration: 1.0
            });
        }

        // FIX 3: Instantly render the active proximity streams inside the feed
        renderProximityFeed();
    });

    /**
     * FIX 2: PANEL CLOSING MECHANICS
     * Clicking the drawer's top structural handle slider acts as a manual toggle dismissal
     */
    const vibeHandle = drawerVibe ? drawerVibe.querySelector('.drawer-handle') : null;
    if (vibeHandle) {
        vibeHandle.style.cursor = 'pointer';
        vibeHandle.style.padding = '10px 0'; // Increase tap targets on mobile
        vibeHandle.addEventListener('click', () => {
            if (drawerVibe) drawerVibe.classList.remove('open');
            btnVibe.classList.remove('active');
            btnDrop.classList.add('active'); // Reset state seamlessly
            
            // Re-center map over your walking footstep tracking marker
            if (appState.currentCoords.lat && appState.map) {
                appState.map.flyTo([appState.currentCoords.lat, appState.currentCoords.lng], 17, { animate: true });
            }
        });
    }
}

/**
 * FIX 3: DYNAMIC LOCAL PULSE STREAM GENERATOR
 * Fetches data streams out of activeMarkers state and updates the list viewport.
 */
function renderProximityFeed() {
    const feedContainer = document.getElementById('proximity-feed-list');
    if (!feedContainer) return;

    // Flush the placeholder default template strings
    feedContainer.innerHTML = "";

    // Pull records out of the runtime pipeline cache 
    const activePins = Object.values(activeMarkers).map(m => {
        // Leaflet anchors data context elements in the popup engine properties
        const div = document.createElement('div');
        div.innerHTML = m.getPopup().getContent();
        
        const text = div.querySelector('p')?.innerText || "Active Pulse";
        const label = div.querySelector('span')?.innerText || "Live Pulse";
        const timeStr = div.querySelectorAll('span')[1]?.innerText || "";
        
        return { text, label, timeStr, latlng: m.getLatLng() };
    });

    if (activePins.length === 0) {
        feedContainer.innerHTML = `
            <p style="color: #666; font-size: 13px; text-align: center; margin-top: 30px;">
                No active pulses in the Tempe area right now. Go drop one!
            </p>`;
        return;
    }

    // Build functional UI row blocks dynamically for every live story item
    activePins.forEach(pin => {
        const row = document.createElement('div');
        row.style.background = '#11141d';
        row.style.border = '1px solid rgba(255,255,255,0.05)';
        row.style.borderRadius = '12px';
        row.style.padding = '12px';
        row.style.marginBottom = '10px';
        row.style.cursor = 'pointer';
        row.style.transition = 'background 0.2s';

        row.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="color: #00e5ff; font-size: 10px; font-weight: bold; text-transform: uppercase;">${pin.label}</span>
                <span style="color: #555; font-size: 10px;">${pin.timeStr}</span>
            </div>
            <p style="margin: 0; font-size: 13px; color: #fff; font-weight: 500;">${pin.text}</p>
        `;

        // Interactive Focus Link: Clicking a list row flies the map directly onto that pin's location!
        row.addEventListener('click', () => {
            if (appState.map) {
                appState.map.flyTo(pin.latlng, 18, { animate: true });
                // Automatically flash open the marker's popup bubble
                Object.values(activeMarkers).find(m => m.getLatLng().equals(pin.latlng))?.openPopup();
            }
        });

        row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.03)');
        row.addEventListener('mouseleave', () => row.style.background = '#11141d');

        feedContainer.appendChild(row);
    });
}

// Unified Bootstrapper
document.addEventListener('DOMContentLoaded', () => {
    initDeviceIdentity();
    initCanvasMap();
    trackUserLocation();
    initHudInteractions();
    syncPinsPipeline().then(() => { startLiveSync(); });
    setInterval(syncPinsPipeline, 4000);
});
