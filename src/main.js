// -----------------------------------------
// UNIFIED ARCHITECTURE & MQTT NETWORKING
// -----------------------------------------
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');

// If no room exists, create a random secure one and append to URL implicitly
if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 10).toUpperCase();
    window.history.replaceState(null, '', `?room=${roomId}`);
}

const myClientId = 'user_' + Math.random().toString(36).substring(2, 8);
const networkTopic = `gravitycanvas/v8_pro/${roomId}`;

// DOM Elements
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const cursor = document.getElementById("cursor");
const netStatus = document.getElementById("network-status");

// UI Interactivity
const toolBtns = document.querySelectorAll(".tool-btn[data-tool]");
const colorBtns = document.querySelectorAll(".color-btn");
const customColor = document.getElementById("custom-color");
const strokeWidthInput = document.getElementById("stroke-width");
const gravityToggle = document.getElementById("gravity-toggle");
const btnClear = document.getElementById("btn-clear");
const bgSelector = document.getElementById("bg-selector");
const btnExtract = document.getElementById("btn-extract");

// State
let currentTool = "pen"; 
let currentColor = "#ff3366";
let currentStrokeWidth = 8;
let gravityEnabled = false;
let currentBackground = "dark"; 
const eraserRadius = 30;

// Universal Pointer State
let isLocalDrawing = false;
let isLocalErasing = false;
let localPointerX = window.innerWidth / 2;
let localPointerY = window.innerHeight / 2;
let spaceDown = false; // laptop fallback tracking

// Render Engine Data
// We track lines multi-user style: "clientId" -> current active line
let activeLines = {}; 
// Archive of all completed / dead lines
let deadLines = [];   

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// -----------------------------------------
// MQTT CONNECTION (The Magic Relay)
// -----------------------------------------
netStatus.innerText = "🟡 Connecting...";

// wss://broker.emqx.io:8084/mqtt acts as a public lightning fast unblocked WebSockets relay
const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    clientId: myClientId,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
});

client.on('connect', () => {
    netStatus.innerText = "🟢 Sync Active";
    client.subscribe(networkTopic, (err) => {
        if (!err) console.log("Subscribed to absolute sync channel");
    });
});

client.on('error', () => { netStatus.innerText = "🔴 Connection Failed"; });
client.on('offline', () => { netStatus.innerText = "🟠 Offline"; });

function broadcast(payload) {
    if (client.connected) {
        payload.id = myClientId; // Stamp origin
        client.publish(networkTopic, JSON.stringify(payload));
    }
}

// Global Inbound Receiver
client.on('message', (topic, message) => {
    if (topic === networkTopic) {
        try {
            const data = JSON.parse(message.toString());
            // Ignore echoes of our own data
            if (data.id === myClientId) return; 

            // Handle Foreign Input Events
            if (data.t === 'clear') {
                activeLines = {};
                deadLines = [];
                return;
            }

            const maxDimRemote = Math.max(canvas.width, canvas.height);
            const absX = (data.nx * maxDimRemote) + (canvas.width / 2);
            const absY = (data.ny * maxDimRemote) + (canvas.height / 2);

            if (data.t === 'down') {
                if (data.tool === "eraser") {
                    processEraserCollisions(absX, absY, true); 
                } else {
                    if(activeLines[data.id]) deadLines.push(activeLines[data.id]);
                    activeLines[data.id] = { color: data.c, width: data.w, points: [{ x: absX, y: absY }] };
                }
            } else if (data.t === 'move') {
                if (data.tool === "eraser") {
                    processEraserCollisions(absX, absY, true);
                } else if (activeLines[data.id]) {
                    activeLines[data.id].points.push({ x: absX, y: absY });
                }
            } else if (data.t === 'up') {
                if (activeLines[data.id]) {
                    activeLines[data.id].points.forEach(p => p.isBasePoint = false);
                    deadLines.push(activeLines[data.id]);
                    delete activeLines[data.id];
                }
            }
        } catch (e) {
            console.error(e);
        }
    }
});


// -----------------------------------------
// INPUT HANDLERS (Mouse, Touch, Stylus, Trackpad)
// -----------------------------------------
function beginLocalStroke() {
    if (currentTool === "eraser") {
        isLocalErasing = true; isLocalDrawing = false;
        if(activeLines[myClientId]) { deadLines.push(activeLines[myClientId]); delete activeLines[myClientId]; }
        
        cursor.classList.add("erasing"); cursor.classList.remove("drawing");
        cursor.style.width = `${eraserRadius * 2}px`; cursor.style.height = `${eraserRadius * 2}px`;
    } else {
        isLocalDrawing = true; isLocalErasing = false;
        cursor.classList.add("drawing"); cursor.classList.remove("erasing");
        cursor.style.width = `20px`; cursor.style.height = `20px`;
        cursor.style.setProperty("--current-color", currentColor);
        
        // Fix for "lines wiping out": Never orphan a line if pointerdown misfires twice!
        if (activeLines[myClientId]) {
            activeLines[myClientId].points.forEach(p => p.isBasePoint = false);
            deadLines.push(activeLines[myClientId]);
        }
        
        activeLines[myClientId] = { color: currentColor, width: currentStrokeWidth, points: [] };
    }
    
    const maxDimLocal = Math.max(canvas.width, canvas.height);
    const nx = (localPointerX - (canvas.width / 2)) / maxDimLocal;
    const ny = (localPointerY - (canvas.height / 2)) / maxDimLocal;
    
    broadcast({ t: 'down', nx: nx, ny: ny, c: currentColor, w: currentStrokeWidth, tool: currentTool });
}

function processLocalMove() {
    cursor.style.display = "block";
    cursor.style.left = `${localPointerX}px`; cursor.style.top = `${localPointerY}px`;
    
    if (isLocalDrawing && activeLines[myClientId]) {
        activeLines[myClientId].points.push({ x: localPointerX, y: localPointerY, vx: 0, vy: 0, isBasePoint: true });
        
        const maxDimLocal = Math.max(canvas.width, canvas.height);
        const nx = (localPointerX - (canvas.width / 2)) / maxDimLocal;
        const ny = (localPointerY - (canvas.height / 2)) / maxDimLocal;
        
        broadcast({ t: 'move', nx: nx, ny: ny, tool: "pen" });
    }
    else if (isLocalErasing) {
        processEraserCollisions(localPointerX, localPointerY, false);
        
        const maxDimLocal = Math.max(canvas.width, canvas.height);
        const nx = (localPointerX - (canvas.width / 2)) / maxDimLocal;
        const ny = (localPointerY - (canvas.height / 2)) / maxDimLocal;
        
        broadcast({ t: 'move', nx: nx, ny: ny, tool: "eraser" });
    }
}

function endLocalStroke() {
    isLocalDrawing = false; isLocalErasing = false;
    cursor.classList.remove("drawing", "erasing");
    cursor.style.width = `20px`; cursor.style.height = `20px`;
    
    if (activeLines[myClientId]) {
        activeLines[myClientId].points.forEach(p => p.isBasePoint = false);
        deadLines.push(activeLines[myClientId]);
        delete activeLines[myClientId];
    }
    broadcast({ t: 'up' });
}

// Hardware Pointers (Mouse/Touch universally handled by pointer events)
canvas.addEventListener("pointerdown", (e) => { 
    if (e.pointerType === "touch") e.preventDefault(); // crucial for touch
    localPointerX = e.clientX; localPointerY = e.clientY; 
    beginLocalStroke(); 
    processLocalMove();
});

canvas.addEventListener("pointermove", (e) => { 
    if (e.pointerType === "touch") e.preventDefault();
    localPointerX = e.clientX; localPointerY = e.clientY; 
    processLocalMove(); 
});

window.addEventListener("pointerup", () => { endLocalStroke(); });
window.addEventListener("pointercancel", () => { endLocalStroke(); });

// Laptop Spacebar-Clutch specific fallback
window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { if (!spaceDown) { e.preventDefault(); spaceDown = true; beginLocalStroke(); } }
});
window.addEventListener("keyup", (e) => { if (e.code === "Space") { spaceDown = false; endLocalStroke(); } });

// -----------------------------------------
// ERASER ALGORITHM
// -----------------------------------------
function processEraserCollisions(cx, cy, isRemote) {
    let newDeadLines = [];
    
    // Check dead pool
    for (const line of deadLines) {
        let currentSegment = [];
        for (const pt of line.points) {
            const dist = Math.sqrt(Math.pow(pt.x - cx, 2) + Math.pow(pt.y - cy, 2));
            if (dist < eraserRadius) {
                if (currentSegment.length > 0) { newDeadLines.push({ color: line.color, width: line.width, points: currentSegment }); currentSegment = []; }
            } else currentSegment.push(pt);
        }
        if (currentSegment.length > 0) newDeadLines.push({ color: line.color, width: line.width, points: currentSegment });
    }
    deadLines = newDeadLines;
    
    // Check active pools of OTHERS (can't erase your own active stroke visually nicely without breaking array)
    // Actually we can, we just drop the points or split the active. But practically you only erase dead paths.
}

// -----------------------------------------
// PHYSICS RENDER LOOP
// -----------------------------------------
function renderLoop() {
    if (currentBackground === "dark") ctx.fillStyle = "#0f1015"; else ctx.fillStyle = "#f5f5f5"; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Env Draw
    if (currentBackground === "notebook") {
        ctx.lineWidth = 1;
        for(let y = 100; y < canvas.height - 20; y += 70) {
             ctx.strokeStyle = "#8ecae6"; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
             ctx.beginPath(); ctx.moveTo(0, y + 10); ctx.lineTo(canvas.width, y + 10); ctx.stroke();
        }
        ctx.beginPath(); ctx.strokeStyle = "#ffb5a7"; ctx.lineWidth = 2; ctx.moveTo(120, 0); ctx.lineTo(120, canvas.height); ctx.stroke();
    }
    
    const allLinesToDraw = deadLines.concat(Object.values(activeLines));
    
    for (const line of allLinesToDraw) {
        if (!line || !line.points || line.points.length === 0) continue;
        ctx.beginPath(); ctx.lineWidth = line.width; ctx.strokeStyle = line.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.moveTo(line.points[0].x, line.points[0].y);
            
        if (line.points.length < 3 || gravityEnabled) {
             for (let i = 1; i < line.points.length; i++) {
                let pt = line.points[i];
                if (gravityEnabled && pt.isBasePoint === false) {
                    pt.vy += 0.5; pt.y += pt.vy; pt.x += pt.vx;
                    if (pt.y > canvas.height - 10) { pt.y = canvas.height - 10; pt.vy *= -0.6; pt.vx *= 0.8; }
                }
                ctx.lineTo(pt.x, pt.y);
             }
        } else {
             for (let i = 1; i < line.points.length - 1; i++) {
                 let pt = line.points[i]; let nextPt = line.points[i+1];
                 ctx.quadraticCurveTo(pt.x, pt.y, (pt.x + nextPt.x) / 2, (pt.y + nextPt.y) / 2);
             }
             let lastPt = line.points[line.points.length - 1]; ctx.lineTo(lastPt.x, lastPt.y);
        }
        ctx.stroke();
    }
    
    window.requestAnimationFrame(renderLoop);
}

// Boot loop
window.requestAnimationFrame(renderLoop);

// -----------------------------------------
// UI EVENT BINDINGS
// -----------------------------------------
btnClear.addEventListener("click", () => { activeLines = {}; deadLines = []; broadcast({ t: 'clear' }); });

toolBtns.forEach(btn => btn.addEventListener("click", () => { 
    toolBtns.forEach(b => b.classList.remove("active")); 
    btn.classList.add("active"); 
    currentTool = btn.getAttribute("data-tool"); 
    if(currentTool === "pen") { cursor.style.border = "2px solid white"; cursor.style.background = "var(--current-color)"; }
}));

colorBtns.forEach(btn => btn.addEventListener("click", () => { 
    colorBtns.forEach(b => b.classList.remove("active")); 
    btn.classList.add("active"); 
    currentColor = btn.getAttribute("data-color"); 
    cursor.style.setProperty("--current-color", currentColor); 
    
    currentTool = "pen"; toolBtns[0].classList.add("active"); toolBtns[1].classList.remove("active"); 
}));

customColor.addEventListener("input", (e) => { 
    currentColor = e.target.value; 
    colorBtns.forEach(b => b.classList.remove("active")); 
    cursor.style.setProperty("--current-color", currentColor); 
});

strokeWidthInput.addEventListener("input", (e) => currentStrokeWidth = parseInt(e.target.value));
bgSelector.addEventListener("change", (e) => currentBackground = e.target.value);

gravityToggle.addEventListener("change", (e) => { 
    gravityEnabled = e.target.checked; 
    if (gravityEnabled) {
        deadLines.forEach(line => line.points.forEach(p => { 
            if(p.vy===undefined || p.vy===0) p.vy=(Math.random()-0.5)*3; 
            if(p.vx===undefined || p.vx===0) p.vx=(Math.random()-0.5)*4; 
        })); 
    }
});

// Settings & Extractor Overlays
const qrBtn = document.getElementById('btn-qr');
const qrOverlay = document.getElementById('qr-overlay');
const closeQr = document.getElementById('close-qr');
const roomDisplay = document.getElementById('room-code-display');

qrBtn.addEventListener('click', () => {
    qrOverlay.classList.remove("hidden");
    roomDisplay.innerText = "Shared Room ID: " + roomId;
    document.getElementById("qr-container").innerHTML = ""; // clear old
    new QRCode(document.getElementById("qr-container"), {
        text: window.location.href, // Has the room query automatically
        width: 200, height: 200, colorDark : "#0f1015", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H
    });
});
closeQr.addEventListener('click', () => qrOverlay.classList.add('hidden'));

// Transcription UI
const transcriptionPanel = document.getElementById("transcription-panel");
const ocrStatus = document.getElementById("ocr-status");
const ocrResult = document.getElementById("ocr-result");

btnExtract.addEventListener("click", async () => {
    transcriptionPanel.classList.remove("hidden"); ocrStatus.innerText = "⏳ Initializing Tesseract AI..."; ocrResult.value = "";
    const offCanvas = document.createElement("canvas"); offCanvas.width = canvas.width; offCanvas.height = canvas.height; const offCtx = offCanvas.getContext("2d");
    offCtx.fillStyle = "#ffffff"; offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
    
    // Draw dead lines
    for (const line of deadLines) {
        if (!line || !line.points || line.points.length === 0) continue;
        offCtx.beginPath(); offCtx.lineWidth = line.width; offCtx.strokeStyle = "#000"; offCtx.lineCap = "round"; offCtx.lineJoin = "round";
        offCtx.moveTo(line.points[0].x, line.points[0].y);
        for (let i=1; i<line.points.length; i++) offCtx.lineTo(line.points[i].x, line.points[i].y);
        offCtx.stroke();
    }
    try {
        ocrStatus.innerText = "🧠 Analyzing handwriting...";
        const { data: { text } } = await Tesseract.recognize(offCanvas.toDataURL("image/png"), 'eng', { logger: m => console.log(m) });
        if (text && text.trim().length > 0) { ocrStatus.innerText = "✅ Extraction Complete!"; ocrResult.value = text; } 
        else ocrStatus.innerText = "⚠️ No readable text found.";
    } catch (err) { ocrStatus.innerText = "❌ Error occurred during OCR processing."; }
});
document.getElementById("close-transcription").addEventListener('click', () => transcriptionPanel.classList.add('hidden'));
