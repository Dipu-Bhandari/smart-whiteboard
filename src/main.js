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

// State
let isDrawing = false;
let isErasing = false; 

let currentTool = "pen"; // "pen" or "eraser"
let currentColor = "#ff3366";
let currentStrokeWidth = 8;
let gravityEnabled = false;
let currentBackground = "dark"; 

// Trackpad Native Inputs
let pointerX = window.innerWidth / 2;
let pointerY = window.innerHeight / 2;
let spaceDown = false;
let mouseIsDown = false;
function isActiveDrawing() {
    return spaceDown || mouseIsDown;
}

// Physics / Drawing State
let lines = []; 
let currentLine = null;

// The size of the eraser block
let eraserRadius = 30;

// Resizing
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Start
startBtn.addEventListener("click", () => {
    startOverlay.classList.add("hidden");
    uiContainer.classList.remove("hidden");
    
    // Begin rendering loop
    window.requestAnimationFrame(renderLoop);
});

// Input Handlers - The "Spacebar Clutch"
window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && uiContainer.classList.contains("hidden") === false) {
        if (!spaceDown) {
            e.preventDefault();
            spaceDown = true;
            beginStroke();
        }
    }
});

window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
        spaceDown = false;
        endStroke();
    }
});

canvas.addEventListener("pointerdown", (e) => {
    mouseIsDown = true;
    pointerX = e.clientX;
    pointerY = e.clientY;
    beginStroke();
});

canvas.addEventListener("pointermove", (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    
    // Update cursor position visually
    cursor.style.display = "block";
    cursor.style.left = `${pointerX}px`;
    cursor.style.top = `${pointerY}px`;
});

window.addEventListener("pointerup", () => {
    mouseIsDown = false;
    endStroke();
});

function beginStroke() {
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
        
        // Setup new line
        currentLine = {
            color: currentColor,
            width: currentStrokeWidth,
            points: []
        };
        lines.push(currentLine);
    }
}

function endStroke() {
    if (!isActiveDrawing()) {
        isDrawing = false;
        isErasing = false;
        currentLine = null;
        
        cursor.classList.remove("drawing");
        cursor.classList.remove("erasing");
        cursor.style.width = `20px`; 
        cursor.style.height = `20px`;
    }
}

// Logic Loop
function renderLoop() {
    // 1. Accumulate Input
    if (isDrawing && currentLine) {
        currentLine.points.push({
            x: pointerX, 
            y: pointerY,
            vx: 0,
            vy: 0,
            isBasePoint: true 
        });
    }

    if (isErasing) {
        processEraserCollisions(pointerX, pointerY);
    }

    // 2. Render State
    updateAndRenderCanvas();
    
    window.requestAnimationFrame(renderLoop);
}

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
        if (currentSegment.length > 0) {
            newLinesList.push({ color: line.color, width: line.width, points: currentSegment });
        }
    }
    lines = newLinesList;
}

// Canvas & Physics Loop
function updateAndRenderCanvas() {
    // Render Background
    if (currentBackground === "dark") {
        ctx.fillStyle = "#0f1015";
    } else {
        ctx.fillStyle = "#f5f5f5"; // Notebook paper
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (currentBackground === "notebook") {
        ctx.lineWidth = 1;
        const lineSpacing = 70;
        
        // Build English standard double-ruled 2-line structure
        for(let y = 100; y < canvas.height - 20; y += lineSpacing) {
             ctx.strokeStyle = "#8ecae6"; // Blue lines
             ctx.beginPath();
             ctx.moveTo(0, y);
             ctx.lineTo(canvas.width, y);
             ctx.stroke();
             
             ctx.beginPath();
             ctx.moveTo(0, y + 10);
             ctx.lineTo(canvas.width, y + 10);
             ctx.stroke();
        }
        
        // Margin
        ctx.beginPath();
        ctx.strokeStyle = "#ffb5a7"; 
        ctx.lineWidth = 2;
        ctx.moveTo(120, 0);
        ctx.lineTo(120, canvas.height);
        ctx.stroke();
    }
    
    // Draw Ink
    for (const line of lines) {
        if (line.points.length === 0) continue;
        
        ctx.beginPath();
        ctx.lineWidth = line.width;
        ctx.strokeStyle = line.color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        
        ctx.moveTo(line.points[0].x, line.points[0].y);
            
        // Use standard points pathing or quadratic smoothing
        if (line.points.length < 3 || gravityEnabled) {
             for (let i = 1; i < line.points.length; i++) {
                let pt = line.points[i];
                if (gravityEnabled) {
                    if (!pt.isBasePoint || !isDrawing) {
                        pt.vy += 0.5; // gravity pull
                        pt.y += pt.vy;
                        pt.x += pt.vx;
                        
                        if (pt.y > canvas.height - 10) {
                            pt.y = canvas.height - 10;
                            pt.vy *= -0.6; 
                            pt.vx *= 0.8; 
                        }
                    }
                }
                ctx.lineTo(pt.x, pt.y);
             }
        } else {
             // Bezier curve smoothing
             for (let i = 1; i < line.points.length - 1; i++) {
                 let pt = line.points[i];
                 let nextPt = line.points[i+1];
                 let xc = (pt.x + nextPt.x) / 2;
                 let yc = (pt.y + nextPt.y) / 2;
                 ctx.quadraticCurveTo(pt.x, pt.y, xc, yc);
             }
             let lastPt = line.points[line.points.length - 1];
             ctx.lineTo(lastPt.x, lastPt.y);
        }
        ctx.stroke();
    }
    
    if (!isDrawing && lines.length > 0) {
        let lastLine = lines[lines.length - 1];
        lastLine.points.forEach(p => p.isBasePoint = false);
    }
}

// Events & OCR Setup

function clearCanvasPoints() {
    lines = [];
}
btnClear.addEventListener("click", clearCanvasPoints);

// Tool buttons
toolBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        toolBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTool = btn.getAttribute("data-tool");
    });
});

// Colors
colorBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        colorBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentColor = btn.getAttribute("data-color");
        cursor.style.setProperty("--current-color", currentColor);
        
        currentTool = "pen"; // default back to pen
        toolBtns[0].classList.add("active");
        toolBtns[1].classList.remove("active");
    });
});

customColor.addEventListener("input", (e) => {
    currentColor = e.target.value;
    colorBtns.forEach(b => b.classList.remove("active"));
    cursor.style.setProperty("--current-color", currentColor);
});

// Stroke width
strokeWidthInput.addEventListener("input", (e) => {
    currentStrokeWidth = parseInt(e.target.value);
});

// Background selection
bgSelector.addEventListener("change", (e) => {
    currentBackground = e.target.value;
});

// Gravity Toggle
gravityToggle.addEventListener("change", (e) => {
    gravityEnabled = e.target.checked;
    
    if (gravityEnabled) {
        lines.forEach(line => {
            line.points.forEach(p => {
                p.isBasePoint = false;
                if (p.vy === 0) p.vy = (Math.random() - 0.5) * 3;
                if (p.vx === 0) p.vx = (Math.random() - 0.5) * 4;
            });
        });
    }
});

// AI OCR Extraction
btnExtract.addEventListener("click", async () => {
    transcriptionPanel.classList.remove("hidden");
    ocrStatus.innerText = "⏳ Initializing Tesseract AI... Please wait.";
    ocrResult.value = "";
    
    const offCanvas = document.createElement("canvas");
    offCanvas.width = canvas.width;
    offCanvas.height = canvas.height;
    const offCtx = offCanvas.getContext("2d");
    
    // Fill white
    offCtx.fillStyle = "#ffffff";
    offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
    
    for (const line of lines) {
        if (line.points.length === 0) continue;
        offCtx.beginPath();
        offCtx.lineWidth = line.width;
        offCtx.strokeStyle = "#000000"; 
        offCtx.lineCap = "round";
        offCtx.lineJoin = "round";
        
        offCtx.moveTo(line.points[0].x, line.points[0].y);
        if (line.points.length < 3) {
             for (let i = 1; i < line.points.length; i++) {
                offCtx.lineTo(line.points[i].x, line.points[i].y);
             }
        } else {
             for (let i = 1; i < line.points.length - 1; i++) {
                 let pt = line.points[i];
                 let nextPt = line.points[i+1];
                 let xc = (pt.x + nextPt.x) / 2;
                 let yc = (pt.y + nextPt.y) / 2;
                 offCtx.quadraticCurveTo(pt.x, pt.y, xc, yc);
             }
             let lastPt = line.points[line.points.length - 1];
             offCtx.lineTo(lastPt.x, lastPt.y);
        }
        offCtx.stroke();
    }
    
    const imageData = offCanvas.toDataURL("image/png");
    
    try {
        ocrStatus.innerText = "🧠 Analyzing handwriting...";
        const { data: { text } } = await Tesseract.recognize(
            imageData,
            'eng',
            { logger: m => console.log(m) }
        );
        
        if (text && text.trim().length > 0) {
            ocrStatus.innerText = "✅ Extraction Complete!";
            ocrResult.value = text;
        } else {
            ocrStatus.innerText = "⚠️ No readable text found.";
            ocrResult.value = "";
        }
    } catch (err) {
        console.error(err);
        ocrStatus.innerText = "❌ Error occurred during OCR processing.";
    }
});

closeTranscription.addEventListener("click", () => {
    transcriptionPanel.classList.add("hidden");
});
