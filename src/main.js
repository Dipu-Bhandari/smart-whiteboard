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

// Physics / Drawing State
let lines = []; 
let currentLine = null;

// Gestures configs (Hysteresis implemented!)
const START_PINCH_THRESHOLD = 0.05; // Distance to initiate pinch
const STOP_PINCH_THRESHOLD = 0.08;  // Distance required to drop the pinch

// Dynamic Smoothing Data (1-Euro equivalent algorithm details)
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
        
        // Hand Landmarks mapping
        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        const wrist = landmarks[0];
        const middleTip = landmarks[12];
        const pinkyTip = landmarks[20];
        const middleBase = landmarks[9];
        
        // Calculate Distances for Gestures
        const pinchDist = Math.sqrt(Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2));
        const palmLength = Math.sqrt(Math.pow(wrist.x - middleTip.x, 2) + Math.pow(wrist.y - middleTip.y, 2));
        const palmWidth = Math.sqrt(Math.pow(indexTip.x - pinkyTip.x, 2) + Math.pow(indexTip.y - pinkyTip.y, 2));
        
        // Hysteresis calculation for smooth picking up mapping points
        if (!isDrawing && pinchDist < START_PINCH_THRESHOLD) {
             isDrawing = true;
             // Set up a new line context if we weren't erasing
             if (!isErasing) {
                 cursor.classList.add("drawing");
                 currentLine = {
                     color: currentTool === "eraser" ? "#0f1015" : currentColor,
                     width: currentTool === "eraser" ? currentStrokeWidth * 3 : currentStrokeWidth,
                     points: []
                 };
                 lines.push(currentLine);
             }
        } else if (isDrawing && pinchDist > STOP_PINCH_THRESHOLD) {
             isDrawing = false;
             cursor.classList.remove("drawing");
             currentLine = null;
        }

        // Anchor Math: Instead of dropping physically when index goes down, we anchor to the MIDPOINT of index + thumb
        let anchorX, anchorY;
        if (isDrawing) {
            // Anchor strictly to the midpoint for anti-jump!
            anchorX = (1 - (indexTip.x + thumbTip.x) / 2) * canvas.width;
            anchorY = ((indexTip.y + thumbTip.y) / 2) * canvas.height;
        } else {
            // While hovering, index works fine as a pointer base
            anchorX = (1 - indexTip.x) * canvas.width;
            anchorY = indexTip.y * canvas.height;
        }

        // Dynamic Velocity Smoothing
        if (smoothedX === 0 && smoothedY === 0) {
            smoothedX = anchorX;
            smoothedY = anchorY;
        } else {
            // calculate pixel speed/distance delta
            const distanceDelta = Math.sqrt(Math.pow(anchorX - smoothedX, 2) + Math.pow(anchorY - smoothedY, 2));
            
            // Dynamic Alpha calculates: High distance = Fast Move (less smooth, snap to reality), Low distance = Jitter (high smoothing)
            // Range 0.1 (strong smooth) to 0.8 (snap fast)
            let dynamicAlpha = 0.1 + (distanceDelta / 150); 
            dynamicAlpha = Math.min(Math.max(dynamicAlpha, 0.15), 0.85);

            smoothedX = (dynamicAlpha * anchorX) + ((1 - dynamicAlpha) * smoothedX);
            smoothedY = (dynamicAlpha * anchorY) + ((1 - dynamicAlpha) * smoothedY);
        }
        
        // Open Palm Logic => Creates Eraser Ball
        if (palmLength > 0.45 && pinchDist > 0.18 && palmWidth > 0.25 && !isDrawing) {
            isErasing = true;
            currentLine = null;
            
            eraserCenter.x = (1 - middleBase.x) * canvas.width;
            eraserCenter.y = middleBase.y * canvas.height;
            
            const physicalHandRadius = Math.sqrt(Math.pow(wrist.x - middleBase.x, 2) + Math.pow(wrist.y - middleBase.y, 2));
            eraserRadius = physicalHandRadius * canvas.width * 1.2;
            
            cursor.style.display = "block";
            cursor.classList.add("erasing");
            cursor.classList.remove("drawing");
            cursor.style.left = `${eraserCenter.x}px`;
            cursor.style.top = `${eraserCenter.y}px`;
            cursor.style.width = `${eraserRadius * 2}px`;
            cursor.style.height = `${eraserRadius * 2}px`;
            
        } else {
            isErasing = false;
            cursor.classList.remove("erasing");
            cursor.style.width = `20px`; 
            cursor.style.height = `20px`;
            
            // Draw State
            cursor.style.display = "block";
            cursor.style.left = `${smoothedX}px`;
            cursor.style.top = `${smoothedY}px`;
            
            if (isDrawing && currentLine) {
                currentLine.points.push({
                    x: smoothedX, 
                    y: smoothedY,
                    vx: 0,
                    vy: 0,
                    isBasePoint: true 
                });
            }
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
    
    // We break paths based on intersecting the eraser area
    for (const line of lines) {
        let currentSegment = [];
        
        for (const pt of line.points) {
            const dist = Math.sqrt(Math.pow(pt.x - eraserCenter.x, 2) + Math.pow(pt.y - eraserCenter.y, 2));
            
            if (dist < eraserRadius) {
                // Point is erased, break the segment
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

    ctx.fillStyle = "#0f1015"; // Base Dark Premium Bg
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
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
                        
                        // Bounce off bottom
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
    
    // Clear flags so points only stick while drawing
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

// Gravity Toggle
gravityToggle.addEventListener("change", (e) => {
    gravityEnabled = e.target.checked;
    
    if (gravityEnabled) {
        lines.forEach(line => {
            line.points.forEach(p => {
                p.isBasePoint = false;
                // Add velocity to scatter
                if (p.vy === 0) p.vy = (Math.random() - 0.5) * 3;
                if (p.vx === 0) p.vx = (Math.random() - 0.5) * 4;
            });
        });
    }
});
