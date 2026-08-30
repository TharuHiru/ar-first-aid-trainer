// This will detect when the marker is found or lost and show/hide the start button accordingly.
// NOTE: `scene` here is always the marker-based (MindAR) scene - untouched from before.

// ============================================================
// Debug Console - Shows logs on-screen for mobile debugging
// ============================================================
const debugPanel = document.getElementById('debugPanel');
const debugLogs = document.getElementById('debugLogs');
const debugClose = document.getElementById('debugClose');
let debugLogCount = 0;

function addDebugLog(message) {
    debugLogCount++;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    debugLogs.appendChild(logEntry);
    
    // Auto-scroll to bottom
    debugLogs.scrollTop = debugLogs.scrollHeight;
    
    // Keep only last 50 logs to avoid memory issues
    while (debugLogs.children.length > 50) {
        debugLogs.removeChild(debugLogs.firstChild);
    }
    
    // Show the debug panel
    debugPanel.style.display = 'flex';
}

debugClose.addEventListener('click', function() {
    debugPanel.style.display = 'none';
});

// Intercept console.log, console.error to display on screen
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
    originalLog.apply(console, args);
    addDebugLog('LOG: ' + args.join(' '));
};

console.error = function(...args) {
    originalError.apply(console, args);
    addDebugLog('ERROR: ' + args.join(' '));
};

const scene = document.querySelector('a-scene');
const markerScene = document.getElementById('markerScene');
const startButton = document.getElementById('startTraining');
const podium = document.getElementById('podium');
const instructionButton = document.getElementById('instructionButton');
const trainingButtonsContainer = document.getElementById('trainingButtonsContainer');
const viewItemsButton = document.getElementById('viewItemsButton');
const scenarioButton = document.getElementById('scenarioButton');

// Markerless (WebXR hit-test) scene + its overlay UI - used only for Scenario mode
const markerlessScene = document.getElementById('markerlessScene');
const markerlessOverlay = document.getElementById('markerlessOverlay');
const markerlessFallbackVideo = document.getElementById('markerlessFallbackVideo');
const exitScenarioButton = document.getElementById('exitScenarioButton');
const placeHereButton = document.getElementById('placeHereButton');
const scenarioQuestionButton = document.getElementById('scenarioQuestionButton');
const reticle = document.getElementById('reticle');
const placedModel = document.getElementById('placedModel');
const arStatusMessage = document.getElementById('arStatusMessage');

// Scenario mode state
let arModeActive = false;       // true WebXR hit-test session is running
let fallbackModeActive = false; // AR-lite (camera + gyro, no WebXR) is running
let fallbackStream = null;      // getUserMedia stream used by the AR-lite fallback

// Define instructions for each item
const itemInstructions = {
    bandAid: "Apply Band-Aid to wound",
    bandageRoll: "Wrap bandage roll around injury",
    painBalm: "Apply pain balm gently",
    paracetamol: "Take paracetamol tablet",
    sprit: "Clean wound with spirit",
    thermometer: "Check temperature"
};

// Define custom podium positions for each item 
const itemPodiumPositions = {
    bandAid: { x: 0, y: 0.09, z: 0.01 },
    bandageRoll: { x: 0, y: 0.13, z: 0 },
    painBalm: { x: 0.02, y: 0.09, z: 0 },
    paracetamol: { x: 0.01, y: 0.12, z: 0 },
    sprit: { x: 0, y: 0.14, z: 0 },
    thermometer: { x: 0, y: 0.1, z: 0 }
};

// Track original positions
const originalPositions = {
    bandAid: { x: 0.1, y: -0.13, z: 0 },
    bandageRoll: { x: 0.3, y: -0.09, z: 0 },
    painBalm: { x: 0.3, y: -0.26, z: 0 },
    paracetamol: { x: 0.1, y: -0.24, z: 0 },
    sprit: { x: 0.3, y: 0.04, z: 0 },
    thermometer: { x: 0.1, y: 0.01, z: 0 }
};

// Track which item is on podium
window.itemOnPodium = null;
window.trainingStarted = false;
window.viewItemsMode = false;

scene.addEventListener('targetFound', function () {
    console.log("Marker detected!");
    startButton.style.display = 'block';

});

scene.addEventListener('targetLost', function () {
    console.log("Marker lost!");
    startButton.style.display = 'none';
    trainingButtonsContainer.classList.remove('visible');
});

// Start Training button - shows View Items and Scenario buttons
startButton.addEventListener('click', function () {
    console.log("Start Training clicked");
    startButton.style.display = 'none';
    trainingButtonsContainer.classList.add('visible');
});

// View Items button - enables drag and drop with podium only
viewItemsButton.addEventListener('click', function () {
    console.log("View Items clicked");
    window.trainingStarted = true;
    window.viewItemsMode = true;
    trainingButtonsContainer.classList.remove('visible');
    
    // Show the podium
    podium.setAttribute('visible', 'true');
    console.log("Podium shown - ready for drag and drop");
});

// ============================================================
// Scenario mode - WebXR hit-test AR (with AR-lite fallback)
// ============================================================

// Shows/updates a plain-text status banner in the AR overlay so it's
// immediately obvious whether this device is actually running real
// WebXR hit-test AR or fell back to the camera-only mode.
function setArStatus(text, show) {
    if (show === undefined) show = true;
    arStatusMessage.textContent = text;
    arStatusMessage.style.display = show ? 'block' : 'none';
}

// Scenario button - leave the marker-based scene entirely and switch to the
// markerless scene. Tries real WebXR hit-test AR first (best quality, needs
// ARCore on Android; not available on iOS at all). If that isn't supported
// or fails to start, falls back to "AR-lite": live camera feed + gyroscope
// look-around, with a Place Here button instead of a real detected surface.
// This fallback works on essentially any phone with a camera and gyro,
// including iPhones, since it doesn't use WebXR/ARCore at all.
scenarioButton.addEventListener('click', async function () {
    console.log("Scenario clicked");

    if (!window.isSecureContext) {
        alert("Scenario mode needs a secure connection (https://) to use the camera and sensors.");
        return;
    }

    trainingButtonsContainer.classList.remove('visible');
    window.scenarioMode = true;

    reticle.setAttribute('visible', 'false');
    placedModel.setAttribute('visible', 'false');
    scenarioQuestionButton.style.display = 'none';
    placeHereButton.style.display = 'none';
    setArStatus("Checking WebXR AR support on this device...");

    // Stop MindAR so it releases the camera feed - needed for both paths below.
    // The marker scene itself is left completely intact - just paused/hidden.
    const mindarSystem = markerScene.systems && markerScene.systems['mindar-image-system'];
    if (mindarSystem && typeof mindarSystem.stop === 'function') {
        mindarSystem.stop();
    }
    markerScene.style.display = 'none';
    startButton.style.display = 'none';

    markerlessScene.style.display = 'block';
    markerlessOverlay.style.display = 'block';

    // Check for real WebXR AR support before touching anything.
    let arSupported = false;
    if (navigator.xr) {
        try {
            arSupported = await navigator.xr.isSessionSupported('immersive-ar');
        } catch (err) {
            console.error("navigator.xr.isSessionSupported check failed:", err);
        }
    }

    if (arSupported) {
        setArStatus("✅ WebXR AR is supported. Starting session...");
        try {
            await markerlessScene.enterAR();
            arModeActive = true;
            setArStatus("Move your phone slowly to scan for a flat surface, then tap the screen to place the box.");
            console.log("Entered real WebXR AR session - scan a flat surface and tap to place the box");
            return;
        } catch (err) {
            console.error("WebXR AR session failed to start, falling back to AR-lite:", err);
            setArStatus("⚠️ WebXR AR failed to start on this device. Falling back to camera view (no real surface detection).");
        }
    } else {
        console.log("WebXR AR not supported on this device/browser, using AR-lite fallback");
        setArStatus("❌ This device/browser does not support WebXR AR (no real surface detection). Falling back to camera view.");
    }

    startFallbackAR();
});

// Fires once ar-hit-test finds a real surface for the first time (or again
// after losing and re-finding one). Real WebXR AR only.
markerlessScene.addEventListener('ar-hit-test-achieved', function () {
    if (!placedModel.getAttribute('visible')) {
        setArStatus("Surface detected — tap anywhere on the screen to place the box.");
    }
});

// Fires when the user taps the screen while a hit-test result is active
// (real WebXR AR only). This is the actual placement trigger.
markerlessScene.addEventListener('ar-hit-test-select', function () {
    console.log("Surface tapped - placing test model at hit-test location");

    // Copy the reticle's current tracked position/rotation onto the placed model
    placedModel.object3D.position.copy(reticle.object3D.position);
    placedModel.object3D.quaternion.copy(reticle.object3D.quaternion);
    placedModel.setAttribute('visible', 'true');

    // Stop hit-test from continuing to move the reticle now that we've placed
    markerlessScene.removeAttribute('ar-hit-test');
    reticle.setAttribute('visible', 'false');

    setArStatus("✅ Box placed on a real detected surface — this device supports WebXR hit-test AR.");
    scenarioQuestionButton.style.display = 'block';
});

// AR-lite fallback: camera feed + device orientation, no WebXR required.
async function startFallbackAR() {
    try {
        fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
    } catch (err) {
        console.error("Camera access failed:", err);
        alert("Couldn't access the camera for Scenario mode. Please allow camera access and try again.");
        returnToMarkerScene();
        return;
    }

    markerlessFallbackVideo.srcObject = fallbackStream;
    markerlessFallbackVideo.style.display = 'block';
    try {
        await markerlessFallbackVideo.play();
    } catch (err) {
        console.error("Video playback failed:", err);
    }

    // Ensure markerlessScene canvas is visible and properly styled
    console.log("AR-lite: Setting up scene display");
    markerlessScene.style.display = 'block';
    const sceneCanvas = markerlessScene.canvas;
    if (sceneCanvas) {
        sceneCanvas.style.position = 'absolute';
        sceneCanvas.style.top = '0';
        sceneCanvas.style.left = '0';
        sceneCanvas.style.width = '100%';
        sceneCanvas.style.height = '100%';
        sceneCanvas.style.zIndex = '10';
        console.log("Canvas positioned and z-indexed");
    }

    fallbackModeActive = true;
    placeHereButton.style.display = 'block';
    console.log("AR-lite started - look around, then tap Place Here to anchor the test box");
}

// Place Here button (AR-lite only) - anchors the box a fixed distance in
// front of wherever the camera is currently pointing. Not a real detected
// surface - just an approximation for devices without WebXR hit-test.
placeHereButton.addEventListener('click', function () {
    const camera = markerlessScene.camera;
    if (!camera) {
        console.error("Camera not found in markerless scene");
        return;
    }

    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    const distance = 1.2; // meters in front of the camera
    const targetPos = camPos.clone().add(camDir.multiplyScalar(distance));

    console.log("Placing test box at:", targetPos);

    placedModel.object3D.position.copy(targetPos);
    placedModel.object3D.lookAt(camPos.x, targetPos.y, camPos.z);
    placedModel.setAttribute('visible', 'true');

    placeHereButton.style.display = 'none';
    scenarioQuestionButton.style.display = 'block';
    setArStatus("Box placed at an approximate distance — no real surface detection on this device.");
    console.log("Placement complete (AR-lite fallback)");
});

// Exit Scenario button - leave whichever mode is currently active
exitScenarioButton.addEventListener('click', function () {
    console.log("Exit Scenario clicked");
    if (arModeActive && (markerlessScene.is('ar-mode') || markerlessScene.is('vr-mode'))) {
        markerlessScene.exitVR(); // triggers 'exit-vr' below, which cleans up
    } else {
        returnToMarkerScene();
    }
});

// Fires whenever the WebXR AR session ends - whether from Exit Scenario,
// the system's own back/close control, or the browser. Always brings the
// user back to the (untouched) marker-based scene.
markerlessScene.addEventListener('exit-vr', returnToMarkerScene);

function returnToMarkerScene() {
    console.log("Returning to marker-based scene");
    arModeActive = false;

    if (fallbackModeActive) {
        fallbackModeActive = false;
        if (fallbackStream) {
            fallbackStream.getTracks().forEach(function (track) { track.stop(); });
            fallbackStream = null;
        }
        markerlessFallbackVideo.pause();
        markerlessFallbackVideo.srcObject = null;
        markerlessFallbackVideo.style.display = 'none';
    }

    markerlessScene.style.display = 'none';
    markerlessOverlay.style.display = 'none';
    placeHereButton.style.display = 'none';
    scenarioQuestionButton.style.display = 'none';
    reticle.setAttribute('visible', 'false');
    placedModel.setAttribute('visible', 'false');
    setArStatus('', false);

    // Restore hit-test tracking for the next time Scenario is opened, since
    // placing a model removes the ar-hit-test component to freeze the reticle.
    markerlessScene.setAttribute('ar-hit-test', 'target: #reticle; type: footprint;');

    window.scenarioMode = false;

    markerScene.style.display = 'block';

    const mindarSystem = markerScene.systems && markerScene.systems['mindar-image-system'];
    if (mindarSystem && typeof mindarSystem.start === 'function') {
        mindarSystem.start();
    }
}

// Register draggable component - adapted from working fire extinguisher code
AFRAME.registerComponent('draggable-object', {
    schema: {
        target: { type: "selector" },
        itemName: { type: "string" }
    },
    
    init() {
        this.isDragging = false;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.dragPlane = new THREE.Plane();
        this.worldPoint = new THREE.Vector3();
        this.targetPoint = new THREE.Vector3();
        
        this.target = this.data.target;
        this.itemName = this.data.itemName;
        this.canvas = this.el.sceneEl.canvas;
        
        if (!this.target || !this.canvas) {
            console.log("Target or canvas not found");
            return;
        }
        
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        
        this.canvas.addEventListener("pointerdown", this.onPointerDown);
        this.canvas.addEventListener("pointermove", this.onPointerMove);
        this.canvas.addEventListener("pointerup", this.onPointerUp);
        this.canvas.addEventListener("pointercancel", this.onPointerUp);
    },
    
    setPointerPosition(event) {
        const bounds = this.canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    },
    
    getTargetPoint(event) {
        this.setPointerPosition(event);
        this.raycaster.setFromCamera(this.pointer, this.el.sceneEl.camera);
        
        const normal = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(this.target.object3D.getWorldQuaternion(new THREE.Quaternion()));
        
        this.dragPlane.setFromNormalAndCoplanarPoint(
            normal,
            this.target.object3D.getWorldPosition(new THREE.Vector3())
        );
        
        return this.raycaster.ray.intersectPlane(this.dragPlane, this.worldPoint);
    },
    
    checkPodiumCollision() {
        const itemPos = this.el.getAttribute('position');
        const podiumPos = podium.getAttribute('position');
        
        // Simple distance check
        const distance = Math.sqrt(
            Math.pow(itemPos.x - podiumPos.x, 2) +
            Math.pow(itemPos.y - (podiumPos.y + 0.08), 2)
        );
        
        console.log(`${this.itemName} - Distance to podium:`, distance.toFixed(3));
        
        return distance < 0.25;
    },
    
    onPointerDown(event) {
        if (!window.trainingStarted) {
            return;
        }
        
        this.setPointerPosition(event);
        this.raycaster.setFromCamera(this.pointer, this.el.sceneEl.camera);
        const intersections = this.raycaster.intersectObject(this.el.object3D, true);
        
        if (!intersections.length || !this.getTargetPoint(event)) {
            return;
        }
        
        this.isDragging = true;
        this.canvas.setPointerCapture(event.pointerId);
        console.log(`${this.itemName} dragging started!`);
        event.preventDefault();
    },
    
    onPointerMove(event) {
        if (!this.isDragging || !this.getTargetPoint(event)) {
            return;
        }
        
        this.targetPoint.copy(this.target.object3D.worldToLocal(this.worldPoint.clone()));
        const position = this.el.object3D.position;
        position.x = this.targetPoint.x;
        position.y = this.targetPoint.y;
        this.el.setAttribute("position", position);
        
        // Check if over podium and highlight it
        if (this.checkPodiumCollision()) {
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #FFD700');
        } else {
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #1a3a1a');
        }
        
        event.preventDefault();
    },
    
    snapToExactPosition(itemName, position) {
        // Snap item to exact position with no variation
        this.el.setAttribute('position', {
            x: position.x,
            y: position.y,
            z: position.z
        });
        console.log(`${itemName} snapped to exact position:`, position);
    },
    
    onPointerUp(event) {
        if (!this.isDragging) {
            return;
        }
        
        this.isDragging = false;
        const currentPos = this.el.getAttribute('position');
        
        // Check if dropped on podium
        if (this.checkPodiumCollision()) {
            console.log(`${this.itemName} placed on podium!`);
            window.itemOnPodium = this.itemName;
            
            // Get podium position and apply item-specific offset - PRESERVE EXACT POSITIONS
            const podiumPos = podium.getAttribute('position');
            const itemOffset = itemPodiumPositions[this.itemName] || { x: 0, y: 0.15, z: 0 };
            
            const newPos = {
                x: podiumPos.x + itemOffset.x,
                y: podiumPos.y + itemOffset.y,
                z: podiumPos.z + itemOffset.z
            };
            
            console.log(`${this.itemName} - Setting position to EXACT:`, newPos);
            // Use snapToExactPosition to ensure NO DRIFT
            this.snapToExactPosition(this.itemName, newPos);
            
            // Show instruction button with item-specific text
            const instruction = itemInstructions[this.itemName] || "Apply item";
            instructionButton.textContent = instruction;
            instructionButton.style.display = 'block';
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #90EE90');
        } else {
            console.log(`${this.itemName} dropped away from podium`);
            
            // Return item to original position
            const originalPos = originalPositions[this.itemName];
            if (originalPos) {
                this.el.setAttribute('position', originalPos);
                console.log(`${this.itemName} returned to original position:`, originalPos);
            }
            
            // If this was the item on podium, hide the button
            if (window.itemOnPodium === this.itemName) {
                window.itemOnPodium = null;
                instructionButton.style.display = 'none';
            }
            
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #1a3a1a');
        }
        
        if (this.canvas.hasPointerCapture(event.pointerId)) {
            this.canvas.releasePointerCapture(event.pointerId);
        }
        console.log(`${this.itemName} dropped!`);
    },
    
    remove() {
        if (!this.canvas) {
            return;
        }
        
        this.canvas.removeEventListener("pointerdown", this.onPointerDown);
        this.canvas.removeEventListener("pointermove", this.onPointerMove);
        this.canvas.removeEventListener("pointerup", this.onPointerUp);
        this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    }
});