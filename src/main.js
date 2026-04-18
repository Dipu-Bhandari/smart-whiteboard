import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

// DOM Elements
const video = document.getElementById("webcam");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const loading = document.getElementById("loading");
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
let handLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;

let isDrawing = false;
let isErasing = false; // Open palm active
let eraserCenter = { x: 0, y: 0 };
let eraserRadius = 0;

let currentTool = "pen"; // "pen" or "eraser"
let currentColor = "#ff3366";
let currentStrokeWidth = 8;
let gravityEnabled = false;
let currentBackground = "dark"; // 'dark' or 'notebook'

// Physics / Drawing State
let lines = []; 
let currentLine = null;

// Dynamic Smoothing Data 
let smoothedX = 0;
let smoothedY = 0;

// Resizing
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Initialize MediaPipe
async function initializeHandTracking() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );
        handLandmarker = await HandLandmarker.createFromModelPath(vision, 
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
        );
        await handLandmarker.setOptions({
            baseOptions: { delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1
        });
        
        loading.classList.add("hidden");
        startOverlay.classList.remove("hidden");
    } catch (error) {
        console.error(error);
        loading.innerHTML = "<h2>Error loading models</h2><p>Please check console.</p>";
    }
}
initializeHandTracking();

// Enable camera
async function enableCam() {
    startOverlay.classList.add("hidden");
    
    // Ideal high quality tracking feeds
    const constraints = {
        video: { 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 }, 
            facingMode: "user" 
        }
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
        uiContainer.classList.remove("hidden");
    } catch (err) {
        alert("Camera access denied.");
    }
}
startBtn.addEventListener("click", enableCam);

// Prediction Loop
async function predictWebcam() {
    let nowInMs = Date.now();
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, nowInMs);
        processResults(results);
    }
    
    updateAndRenderCanvas();
    window.requestAnimationFrame(predictWebcam);
}

// Logic to process gesture results
function processResults(results) {
    if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        const wrist = landmarks[0];
        const indexTip = landmarks[8];
        const indexPIP = landmarks[6];
        const middleTip = landmarks[12];
        const middlePIP = landmarks[10];
        const ringTip = landmarks[16];
        const ringPIP = landmarks[14];
        const pinkyTip = landmarks[20];
        const pinkyPIP = landmarks[18];
        const middleBase = landmarks[9];
        
        const dist2D = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

        // Pointing Gesture Detection (Index Extended, others folded)
        const isIndexExtended = dist2D(indexTip, wrist) > dist2D(indexPIP, wrist);
        const isMiddleFolded = dist2D(middleTip, wrist) < dist2D(middlePIP, wrist) + 0.03;
        const isRingFolded = dist2D(ringTip, wrist) < dist2D(ringPIP, wrist) + 0.03;
        const isPinkyFolded = dist2D(pinkyTip, wrist) < dist2D(pinkyPIP, wrist) + 0.03;
        const isPointing = isIndexExtended && isMiddleFolded && isRingFolded && isPinkyFolded;
        
        // Open Palm Gesture Detection (All Extended)
        const isMiddleExtended = dist2D(middleTip, wrist) > dist2D(middlePIP, wrist);
        const isRingExtended = dist2D(ringTip, wrist) > dist2D(ringPIP, wrist);
        const isPinkyExtended = dist2D(pinkyTip, wrist) > dist2D(pinkyPIP, wrist);
        const isOpenPalm = isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended;

        // Anchor cursor to index tip
        let anchorX = (1 - indexTip.x) * canvas.width;
        let anchorY = indexTip.y * canvas.height;

        // Maximum Steadiness Filter (V4 Protocol)
        if (smoothedX === 0 && smoothedY === 0) {
            smoothedX = anchorX;
            smoothedY = anchorY;
        } else {
            const CONSTANT_ALPHA = 0.05; // 95% smoothing - Extremely stable drawing
            smoothedX = (CONSTANT_ALPHA * anchorX) + ((1 - CONSTANT_ALPHA) * smoothedX);
            smoothedY = (CONSTANT_ALPHA * anchorY) + ((1 - CONSTANT_ALPHA) * smoothedY);
        }
        
        // Open Palm Logic => Creates Eraser Ball
        if (isOpenPalm) {
            isErasing = true;
            isDrawing = false;
            currentLine = null;
            
            eraserCenter.x = (1 - middleBase.x) * canvas.width;
            eraserCenter.y = middleBase.y * canvas.height;
            
            // Reduced to whiteboard marker scale (V4 protocol)
            const physicalHandRadius = dist2D(wrist, middleBase);
            eraserRadius = physicalHandRadius * canvas.width * 0.4;
            
            cursor.style.display = "block";
            cursor.classList.add("erasing");
            cursor.classList.remove("drawing");
            cursor.style.left = `${eraserCenter.x}px`;
            cursor.style.top = `${eraserCenter.y}px`;
            cursor.style.width = `${eraserRadius * 2}px`;
            cursor.style.height = `${eraserRadius * 2}px`;
            
        } else if (isPointing) {
            // Pointing Logic => Drawing
            isErasing = false;
            cursor.classList.remove("erasing");
            cursor.style.width = `20px`; 
            cursor.style.height = `20px`;
            
            cursor.style.display = "block";
            cursor.style.left = `${smoothedX}px`;
            cursor.style.top = `${smoothedY}px`;
            cursor.classList.add("drawing");
            
            if (!isDrawing) {
                isDrawing = true;
                
                // Determine base color based on background if using classic UI eraser
                let inkColor = currentColor;
                if (currentTool === "eraser") {
                    inkColor = currentBackground === "dark" ? "#0f1015" : "#f5f5f5";
                }

                currentLine = {
                    color: inkColor,
                    width: currentTool === "eraser" ? currentStrokeWidth * 3 : currentStrokeWidth,
                    points: []
                };
                lines.push(currentLine);
            }
            
            currentLine.points.push({
                x: smoothedX, 
                y: smoothedY,
                vx: 0,
                vy: 0,
                isBasePoint: true 
            });
        } else {
            // Hand visible as a fist or other shape -> Stop all input
            isErasing = false;
            isDrawing = false;
            currentLine = null;
            
            cursor.classList.remove("erasing");
            cursor.classList.remove("drawing");
            cursor.style.width = `20px`; 
            cursor.style.height = `20px`;
            
            cursor.style.display = "block";
            cursor.style.left = `${smoothedX}px`;
            cursor.style.top = `${smoothedY}px`;
        }
    } else {
        cursor.style.display = "none";
        isDrawing = false;
        isErasing = false;
        currentLine = null;
        smoothedX = 0; 
        smoothedY = 0;
    }
}

function processEraserCollisions() {
    if (!isErasing) return;
    
    let newLinesList = [];
    for (const line of lines) {
        let currentSegment = [];
        for (const pt of line.points) {
            const dist = Math.sqrt(Math.pow(pt.x - eraserCenter.x, 2) + Math.pow(pt.y - eraserCenter.y, 2));
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
    processEraserCollisions();

    // Render Environment Background
    if (currentBackground === "dark") {
        ctx.fillStyle = "#0f1015";
    } else {
        ctx.fillStyle = "#f5f5f5"; // Notebook paper
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (currentBackground === "notebook") {
        ctx.lineWidth = 1;
        const lineSpacing = 70;
        
        // Draw double lines continuously
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
        
        // Red Margin Line
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
             // Bezier ink curve smoothing
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
        
        currentTool = "pen";
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

// AI OCR Extraction
btnExtract.addEventListener("click", async () => {
    // Show UI
    transcriptionPanel.classList.remove("hidden");
    ocrStatus.innerText = "⏳ Initializing Tesseract AI... Please wait (this may take a moment).";
    ocrResult.value = "";
    
    // To read OCR well, we should feed it a clean image (white background, black text is ideal)
    // We already have lines. Let's create an offscreen canvas to render just the lines cleanly.
    const offCanvas = document.createElement("canvas");
    offCanvas.width = canvas.width;
    offCanvas.height = canvas.height;
    const offCtx = offCanvas.getContext("2d");
    
    // 1. Fill white background
    offCtx.fillStyle = "#ffffff";
    offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
    
    // 2. Render all strokes but force a high contrast color (dark)
    for (const line of lines) {
        if (line.points.length === 0) continue;
        offCtx.beginPath();
        offCtx.lineWidth = line.width;
        // Invert light colors to black for OCR visibility
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
    
    // Convert to data URL
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
            ocrStatus.innerText = "⚠️ No readable text found. Make sure handwriting is large and clear.";
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
