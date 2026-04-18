// -----------------------------------------
// URL Router & Dual System Boot
// -----------------------------------------
const urlParams = new URLSearchParams(window.location.search);
const remoteId = urlParams.get('remote');

if (remoteId) {
    document.getElementById('remote-container').classList.remove('hidden');
    initRemoteMode(remoteId);
} else {
    document.getElementById('master-container').classList.remove('hidden');
    initMasterMode();
}

// -----------------------------------------
// MASTER MODE (Laptop/Projector)
// -----------------------------------------
function initMasterMode() {
    // DOM Elements
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const startOverlay = document.getElementById("start-overlay");
    const startBtn = document.getElementById("start-btn");
    const uiContainer = document.getElementById("ui-container");
    const cursor = document.getElementById("cursor");
    
    // UI Elements
    const toolBtns = document.querySelectorAll(".tool-btn[data-tool]");
    const colorBtns = document.querySelectorAll(".color-btn");
    const customColor = document.getElementById("custom-color");
    const strokeWidthInput = document.getElementById("stroke-width");
    const gravityToggle = document.getElementById("gravity-toggle");
    const btnClear = document.getElementById("btn-clear");
    const bgSelector = document.getElementById("bg-selector");
    const btnExtract = document.getElementById("btn-extract");
    const transcriptionPanel = document.getElementById("transcription-panel");
    const ocrStatus = document.getElementById("ocr-status");
    const ocrResult = document.getElementById("ocr-result");
    const closeTranscription = document.getElementById("close-transcription");
    
    // PeerJS Variables
    let peer = new Peer(); 
    let peerId = null;
    let peerConnection = null;

    // State
    let isDrawing = false;
    let isErasing = false; 
    let currentTool = "pen"; 
    let currentColor = "#ff3366";
    let currentStrokeWidth = 8;
    let gravityEnabled = false;
    let currentBackground = "dark"; 

    // Inputs (Network + Trackpad)
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let spaceDown = false;
    let mouseIsDown = false;
    
    // Physics / Drawing State
    let lines = []; 
    let currentLine = null;
    let eraserRadius = 30;

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    // -----------------------------------------
    // Network Setup
    // -----------------------------------------
    peer.on('open', (id) => {
        peerId = id;
        document.getElementById('peer-status').innerText = "Scan to Pair Smart Stylus";
        
        // Generate QR
        const remoteUrl = window.location.href.split('?')[0] + "?remote=" + id;
        new QRCode(document.getElementById("qr-container"), {
            text: remoteUrl,
            width: 200,
            height: 200,
            colorDark : "#0f1015",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    });

    peer.on('connection', (conn) => {
        peerConnection = conn;
        document.getElementById('network-ui-status').innerText = "📱 Stylus Paired";
        
        // Auto-start when remote connects
        startOverlay.classList.add("hidden");
        uiContainer.classList.remove("hidden");
        window.requestAnimationFrame(renderLoop);

        conn.on('data', (data) => {
            if (data.type === 'clear') {
                lines = [];
                return;
            }
            if (data.type === 'down') {
                currentTool = data.tool;
                pointerX = data.nx * canvas.width;
                pointerY = data.ny * canvas.height;
                beginStroke(true); // network triggered
            }
            if (data.type === 'move') {
                pointerX = data.nx * canvas.width;
                pointerY = data.ny * canvas.height;
                
                // Update cursor
                cursor.style.display = "block";
                cursor.style.left = `${pointerX}px`;
                cursor.style.top = `${pointerY}px`;
            }
            if (data.type === 'up') {
                endStroke();
            }
        });
    });

    // Start manually (Local Trackpad fallback)
    startBtn.addEventListener("click", () => {
        startOverlay.classList.add("hidden");
        uiContainer.classList.remove("hidden");
        window.requestAnimationFrame(renderLoop);
    });

    // -----------------------------------------
    // Core Engine
    // -----------------------------------------
    function beginStroke(isNetwork = false) {
        if (currentTool === "eraser") {
            isErasing = true;
            isDrawing = false;
            currentLine = null;
            
            cursor.classList.add("erasing");
            cursor.classList.remove("drawing");
            cursor.style.width = `${eraserRadius * 2}px`;
            cursor.style.height = `${eraserRadius * 2}px`;
        } else {
            isDrawing = true;
            isErasing = false;
            cursor.classList.add("drawing");
            cursor.classList.remove("erasing");
            cursor.style.width = `20px`; 
            cursor.style.height = `20px`;
            
            currentLine = {
                color: currentColor,
                width: currentStrokeWidth,
                points: []
            };
            lines.push(currentLine);
        }
    }

    function endStroke() {
        if (!spaceDown && !mouseIsDown) {
            isDrawing = false;
            isErasing = false;
            currentLine = null;
            cursor.classList.remove("drawing", "erasing");
            cursor.style.width = `20px`; 
            cursor.style.height = `20px`;
        }
    }

    // Local inputs clutch trackpad
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && uiContainer.classList.contains("hidden") === false) {
            if (!spaceDown) { e.preventDefault(); spaceDown = true; beginStroke(); }
        }
    });

    window.addEventListener("keyup", (e) => {
        if (e.code === "Space") { spaceDown = false; endStroke(); }
    });

    canvas.addEventListener("pointerdown", (e) => { mouseIsDown = true; pointerX = e.clientX; pointerY = e.clientY; beginStroke(); });
    canvas.addEventListener("pointermove", (e) => { 
        pointerX = e.clientX; pointerY = e.clientY; 
        cursor.style.display = "block";
        cursor.style.left = `${pointerX}px`; cursor.style.top = `${pointerY}px`;
    });
    window.addEventListener("pointerup", () => { mouseIsDown = false; endStroke(); });


    function processEraserCollisions(cx, cy) {
        let newLinesList = [];
        for (const line of lines) {
            let currentSegment = [];
            for (const pt of line.points) {
                const dist = Math.sqrt(Math.pow(pt.x - cx, 2) + Math.pow(pt.y - cy, 2));
                if (dist < eraserRadius) {
                    if (currentSegment.length > 0) {
                        newLinesList.push({ color: line.color, width: line.width, points: currentSegment });
                        currentSegment = [];
                    }
                } else {
                    currentSegment.push(pt);
                }
            }
            if (currentSegment.length > 0) newLinesList.push({ color: line.color, width: line.width, points: currentSegment });
        }
        lines = newLinesList;
    }

    // -----------------------------------------
    // Physics Render
    // -----------------------------------------
    function renderLoop() {
        if (isDrawing && currentLine) {
            currentLine.points.push({ x: pointerX, y: pointerY, vx: 0, vy: 0, isBasePoint: true });
        }
        if (isErasing) {
            processEraserCollisions(pointerX, pointerY);
        }

        if (currentBackground === "dark") ctx.fillStyle = "#0f1015";
        else ctx.fillStyle = "#f5f5f5"; 
        
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (currentBackground === "notebook") {
            ctx.lineWidth = 1;
            for(let y = 100; y < canvas.height - 20; y += 70) {
                 ctx.strokeStyle = "#8ecae6"; 
                 ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
                 ctx.beginPath(); ctx.moveTo(0, y + 10); ctx.lineTo(canvas.width, y + 10); ctx.stroke();
            }
            ctx.beginPath(); ctx.strokeStyle = "#ffb5a7"; ctx.lineWidth = 2; ctx.moveTo(120, 0); ctx.lineTo(120, canvas.height); ctx.stroke();
        }
        
        for (const line of lines) {
            if (line.points.length === 0) continue;
            ctx.beginPath(); ctx.lineWidth = line.width; ctx.strokeStyle = line.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.moveTo(line.points[0].x, line.points[0].y);
                
            if (line.points.length < 3 || gravityEnabled) {
                 for (let i = 1; i < line.points.length; i++) {
                    let pt = line.points[i];
                    if (gravityEnabled && (!pt.isBasePoint || !isDrawing)) {
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
                 let lastPt = line.points[line.points.length - 1];
                 ctx.lineTo(lastPt.x, lastPt.y);
            }
            ctx.stroke();
        }
        
        if (!isDrawing && lines.length > 0) {
            lines[lines.length - 1].points.forEach(p => p.isBasePoint = false);
        }
        window.requestAnimationFrame(renderLoop);
    }

    btnClear.addEventListener("click", () => lines = []);
    toolBtns.forEach(btn => btn.addEventListener("click", () => {
        toolBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active"); currentTool = btn.getAttribute("data-tool");
    }));
    colorBtns.forEach(btn => btn.addEventListener("click", () => {
        colorBtns.forEach(b => b.classList.remove("active")); btn.classList.add("active");
        currentColor = btn.getAttribute("data-color"); cursor.style.setProperty("--current-color", currentColor);
        currentTool = "pen"; toolBtns[0].classList.add("active"); toolBtns[1].classList.remove("active");
    }));
    customColor.addEventListener("input", (e) => {
        currentColor = e.target.value; colorBtns.forEach(b => b.classList.remove("active"));
        cursor.style.setProperty("--current-color", currentColor);
    });
    strokeWidthInput.addEventListener("input", (e) => currentStrokeWidth = parseInt(e.target.value));
    bgSelector.addEventListener("change", (e) => currentBackground = e.target.value);
    gravityToggle.addEventListener("change", (e) => {
        gravityEnabled = e.target.checked;
        if (gravityEnabled) lines.forEach(line => line.points.forEach(p => { p.isBasePoint = false; if(p.vy===0) p.vy=(Math.random()-0.5)*3; if(p.vx===0) p.vx=(Math.random()-0.5)*4; }));
    });

    btnExtract.addEventListener("click", async () => {
        transcriptionPanel.classList.remove("hidden"); ocrStatus.innerText = "⏳ Initializing Tesseract AI... Please wait."; ocrResult.value = "";
        const offCanvas = document.createElement("canvas"); offCanvas.width = canvas.width; offCanvas.height = canvas.height;
        const offCtx = offCanvas.getContext("2d");
        offCtx.fillStyle = "#ffffff"; offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
        
        for (const line of lines) {
            if (line.points.length === 0) continue;
            offCtx.beginPath(); offCtx.lineWidth = line.width; offCtx.strokeStyle = "#000"; offCtx.lineCap = "round"; offCtx.lineJoin = "round";
            offCtx.moveTo(line.points[0].x, line.points[0].y);
            if (line.points.length < 3) {
                 for (let i=1; i<line.points.length; i++) offCtx.lineTo(line.points[i].x, line.points[i].y);
            } else {
                 for (let i=1; i<line.points.length-1; i++) offCtx.quadraticCurveTo(line.points[i].x, line.points[i].y, (line.points[i].x + line.points[i+1].x)/2, (line.points[i].y+line.points[i+1].y)/2);
                 offCtx.lineTo(line.points[line.points.length-1].x, line.points[line.points.length-1].y);
            }
            offCtx.stroke();
        }
        try {
            ocrStatus.innerText = "🧠 Analyzing handwriting...";
            const { data: { text } } = await Tesseract.recognize(offCanvas.toDataURL("image/png"), 'eng', { logger: m => console.log(m) });
            if (text && text.trim().length > 0) { ocrStatus.innerText = "✅ Extraction Complete!"; ocrResult.value = text; } 
            else { ocrStatus.innerText = "⚠️ No readable text found."; }
        } catch (err) { ocrStatus.innerText = "❌ Error occurred during OCR processing."; }
    });
    closeTranscription.addEventListener("click", () => transcriptionPanel.classList.add("hidden"));
}

// -----------------------------------------
// REMOTE STYLUS MODE (Smartphone)
// -----------------------------------------
function initRemoteMode(masterId) {
    const statusText = document.getElementById('remote-status');
    const penBtn = document.getElementById('remote-pen-btn');
    const errBtn = document.getElementById('remote-eraser-btn');
    const clrBtn = document.getElementById('remote-clear-btn');
    
    let peer = new Peer();
    let conn = null;
    let currentRemoteTool = "pen";

    peer.on('open', (id) => {
        statusText.innerText = "Connecting to Laptop...";
        conn = peer.connect(masterId, { reliable: true });
        
        conn.on('open', () => {
            statusText.innerText = "Smart Stylus Linked.\nDraw anywhere!";
            setTimeout(() => statusText.classList.add('hidden'), 2000);
            
            // Interaction bindings
            const container = document.getElementById('remote-container');
            
            penBtn.addEventListener('click', () => { 
                currentRemoteTool = "pen"; 
                penBtn.classList.add("active"); errBtn.classList.remove("active");
            });
            errBtn.addEventListener('click', () => { 
                currentRemoteTool = "eraser"; 
                errBtn.classList.add("active"); penBtn.classList.remove("active");
            });
            clrBtn.addEventListener('click', () => conn.send({ type: 'clear' }));

            // Normalize coordinate data relative to full screen
            function sendCoord(e, type) {
                const touch = e.touches[0];
                if (!touch) return;
                const nx = touch.clientX / window.innerWidth;
                const ny = touch.clientY / window.innerHeight;
                conn.send({ type, nx, ny, tool: currentRemoteTool });
            }

            container.addEventListener('touchstart', (e) => { e.preventDefault(); sendCoord(e, 'down'); }, {passive: false});
            container.addEventListener('touchmove', (e) => { e.preventDefault(); sendCoord(e, 'move'); }, {passive: false});
            container.addEventListener('touchend', (e) => { conn.send({ type: 'up' }); });
        });
    });
}
