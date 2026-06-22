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
    // Targeted your input panel element correctly here:
    const drawerDrop = document.getElementById('inputPanel'); 

    // Prevent clicks from falling through to the interactive map canvas below
    document.getElementById('action-pill').style.pointerEvents = 'auto';
    if (drawerVibe) drawerVibe.style.pointerEvents = 'auto';
    if (drawerDrop) drawerDrop.style.pointerEvents = 'auto';

    btnDrop.addEventListener('click', () => {
        btnDrop.classList.add('active');
        btnVibe.classList.remove('active');
        if (drawerVibe) drawerVibe.classList.remove('open');
        
        // Open the submission panel automatically if they click 'Drop a Pulse'
        if (appState.currentCoords.lat && appState.map) {
            appState.map.flyTo([appState.currentCoords.lat, appState.currentCoords.lng], 17, {
                animate: true,
                duration: 1.0
            });
            // Automatically triggers your open sequence at your live location
            if (typeof openInputDrawer === "function") {
                openInputDrawer(appState.currentCoords.lat, appState.currentCoords.lng);
            }
        } else {
            alert("Waiting for GPS telemetry signal...");
        }
    });

    btnVibe.addEventListener('click', () => {
        btnVibe.classList.add('active');
        btnDrop.classList.remove('active');
        
        // Hide the submission form if it's open, and slide up the feed stream
        if (typeof closeInputDrawer === "function") closeInputDrawer();
        if (drawerVibe) drawerVibe.classList.add('open');

        if (appState.map) {
            appState.map.zoomOut(3, { animate: true, duration: 1.2 });
        }
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
