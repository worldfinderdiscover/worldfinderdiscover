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
    
    appState.map = L.map('map', {
        preferCanvas: true,
        zoomControl: false,
        attributionControl: false
    }).setView(asuCenter, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(appState.map);

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
            renderProximityFeed();
        }
        return;
    }
    
    // If the marker already exists on our map canvas, just update its raw payload state
    if (activeMarkers[pinData.id]) {
        const hours = pinData.duration_hours || 1;
        let label = 'Live Pulse (Free)';
        if (hours === 6) label = 'Pro Spot';
        else if (hours === 24) label = 'Anchor Spot';
        else if (hours === 168) label = 'Landmark Event';
        
        activeMarkers[pinData.id].wFPayload.message = pinData.message;
        renderProximityFeed();
        return;
    }

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

    const marker = L.marker([pinData.lat, pinData.lng], { icon: customIcon });
    
    marker.wFPayload = {
        message: pinData.message,
        hours: hours,
        label: label,
        id: pinData.id,
        expTimeString: expTimeString
    };

    marker.addTo(appState.map).bindPopup(`
        <div style="font-family: sans-serif; min-width: 140px;">
            <span style="color: #888; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">${label}</span>
            <p style="margin: 6px 0; font-size: 14px; font-weight: 500; color: #fff;">${pinData.message}</p>
            <span style="color: rgba(255,255,255,0.6); font-size: 11px;">⏱️ Expires at ${expTimeString}</span>
            ${deleteButtonHtml}
        </div>
    `);
    
    activeMarkers[pinData.id] = marker;
    renderProximityFeed();

    setTimeout(() => { 
        if (activeMarkers[pinData.id]) {
            appState.map.removeLayer(marker); 
            delete activeMarkers[pinData.id];
            renderProximityFeed();
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
        // Fetch fresh instances using basic HTTP get lists
        const records = await pb.collection('pins').getList(1, 50, { sort: '-created' });
        
        // 1. Match incoming stream records to map layers
        records.items.forEach(pinData => { 
            if (pinData.lat && pinData.lng) drawPinOnMap(pinData); 
        });
        
        // 2. SAFE CLEANUP: Remove map pins that have been wiped from the server table 
        const serverIds = records.items.map(item => item.id);
        Object.keys(activeMarkers).forEach(localId => {
            if (!serverIds.includes(localId)) {
                // Safeguard: verify the marker layer actually exists on the map before trying to remove it
                if (activeMarkers[localId] && appState.map && appState.map.hasLayer(activeMarkers[localId])) {
                    appState.map.removeLayer(activeMarkers[localId]);
                }
                delete activeMarkers[localId];
            }
        });

        // 3. Force the feed list to refresh with the clean data
        renderProximityFeed();
    } catch (err) { 
        console.log("Telemetry Sync Interval Warning (Handled):", err); 
    }
}

function startLiveSync() {
    // Subscribe directly to collection updates via SSE stream channel connection
    pb.collection('pins').subscribe('*', function (e) {
        console.log("Real-time stream activity payload discovered:", e);
        if (e.action === 'create' || e.action === 'update') {
            drawPinOnMap(e.record);
        }
        if (e.action === 'delete') {
            if (activeMarkers[e.record.id]) {
                appState.map.removeLayer(activeMarkers[e.record.id]);
                delete activeMarkers[e.record.id];
            }
            renderProximityFeed();
        }
    }).catch(err => {
        console.error("Realtime subscription channel disrupted. Falling back to polling loops.", err);
    });
}

// ==========================================
// INTERACTIVE HUD FLUID DYNAMICS ENGINE
// ==========================================

function initHudInteractions() {
    const btnDrop = document.getElementById('btn-drop-pulse');
    const btnVibe = document.getElementById('btn-catch-vibe');
    const drawerVibe = document.getElementById('drawer-vibe');
    const drawerDrop = document.getElementById('inputPanel'); 

    document.getElementById('action-pill').style.pointerEvents = 'auto';
    if (drawerVibe) drawerVibe.style.pointerEvents = 'auto';
    if (drawerDrop) drawerDrop.style.pointerEvents = 'auto';

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

    btnVibe.addEventListener('click', () => {
    btnVibe.classList.add('active');
    btnDrop.classList.remove('active');
    
    if (typeof closeInputDrawer === "function") closeInputDrawer();
    if (drawerVibe) drawerVibe.classList.add('open'); // 1. Panel slides up

    if (appState.map) {
        appState.map.flyTo([33.4242, -111.9281], 15, {
            animate: true,
            duration: 1.0
        });
    }

    // 🔥 THE FIX: Force the feed to render right now because the gate is now OPEN!
    renderProximityFeed(); 
});

    const vibeHandle = drawerVibe ? drawerVibe.querySelector('.drawer-handle') : null;
    if (vibeHandle) {
        vibeHandle.style.cursor = 'pointer';
        vibeHandle.style.padding = '14px 0'; 
        vibeHandle.addEventListener('click', () => {
            if (drawerVibe) drawerVibe.classList.remove('open');
            btnVibe.classList.remove('active');
            btnDrop.classList.add('active');
            
            if (appState.currentCoords.lat && appState.map) {
                appState.map.flyTo([appState.currentCoords.lat, appState.currentCoords.lng], 17, { animate: true });
            }
        });
    }
}

function renderProximityFeed() {
    const feedContainer = document.getElementById('proximity-feed-list');
    if (!feedContainer) return;


    feedContainer.innerHTML = "";

    const activePins = Object.values(activeMarkers)
        .filter(m => m.wFPayload)
        .map(m => {
            return {
                text: m.wFPayload.message,
                label: m.wFPayload.label,
                timeStr: m.wFPayload.expTimeString,
                latlng: m.getLatLng()
            };
        });

    if (activePins.length === 0) {
        feedContainer.innerHTML = `
            <p style="color: #666; font-size: 13px; text-align: center; margin-top: 4px; padding: 20px 0;">
                No active pulses in the Tempe area right now. Go drop one!
            </p>`;
        return;
    }

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
                <span style="color: rgba(255,255,255,0.4); font-size: 10px;">⏱️ Til ${pin.timeStr}</span>
            </div>
            <p style="margin: 0; font-size: 13px; color: #fff; font-weight: 500;">${pin.text}</p>
        `;

        row.addEventListener('click', () => {
            if (appState.map) {
                appState.map.flyTo(pin.latlng, 18, { animate: true, duration: 1.0 });
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
    
    // Fallback Polling Intervaller to sync state if websockets disconnect
    setInterval(syncPinsPipeline, 3000);
});
