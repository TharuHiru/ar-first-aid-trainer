const modeSelector = document.getElementById('modeSelector');
const markerModeBtn = document.getElementById('markerModeBtn');
const markerlessModeBtn = document.getElementById('markerlessModeBtn');
const webxrTestContainer = document.getElementById('webxrTestContainer');

markerModeBtn.addEventListener('click', function () {
    modeSelector.style.display = 'none';

    markerScene.style.display = 'block';
    const mindarSystem = markerScene.systems && markerScene.systems['mindar-image-system'];
    if (mindarSystem && typeof mindarSystem.start === 'function') {
        mindarSystem.start();
    }
});

markerlessModeBtn.addEventListener('click', function () {
    modeSelector.style.display = 'none';

    webxrTestContainer.style.display = 'block';
    if (typeof window.initMarkerlessWebXRTest === 'function') {
        window.initMarkerlessWebXRTest();
    }
});

const scene = document.querySelector('a-scene');
const markerScene = document.getElementById('markerScene');
const startButton = document.getElementById('startTraining');
const podium = document.getElementById('podium');
const instructionButton = document.getElementById('instructionButton');
const trainingButtonsContainer = document.getElementById('trainingButtonsContainer');
const viewItemsButton = document.getElementById('viewItemsButton');

const markerlessScene = document.getElementById('markerlessScene');
const markerlessOverlay = document.getElementById('markerlessOverlay');
const exitScenarioButton = document.getElementById('exitScenarioButton');
const scenarioQuestionButton = document.getElementById('scenarioQuestionButton');
const reticle = document.getElementById('reticle');
const placedModel = document.getElementById('placedModel');
const arStatusMessage = document.getElementById('arStatusMessage');

// Scenario mode state
let arModeActive = false;       // true WebXR hit-test session is running

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

// Sound effects for picking up / placing items
const pickupSound = new Audio('assets/sounds/pickup.wav');
const placeSound = new Audio('assets/sounds/place.wav');

function playSound(audioEl) {
    const instance = audioEl.cloneNode();
    instance.play().catch(() => {}); // ignore autoplay-block errors
}

scene.addEventListener('targetFound', function () {
    startButton.style.display = 'block';
});

scene.addEventListener('targetLost', function () {
    startButton.style.display = 'none';
    trainingButtonsContainer.classList.remove('visible');
});

// Start Training button - shows View Items and Scenario buttons
startButton.addEventListener('click', function () {
    startButton.style.display = 'none';
    trainingButtonsContainer.classList.add('visible');
});

// View Items button - enables drag and drop with podium only
viewItemsButton.addEventListener('click', function () {
    window.trainingStarted = true;
    window.viewItemsMode = true;
    trainingButtonsContainer.classList.remove('visible');
    
    // Show the podium
    podium.setAttribute('visible', 'true');
});


function setArStatus(text, show) {
    if (show === undefined) show = true;
    arStatusMessage.textContent = text;
    arStatusMessage.style.display = show ? 'block' : 'none';
}

markerlessScene.addEventListener('ar-hit-test-achieved', function () {
    if (!placedModel.getAttribute('visible')) {
        setArStatus("Surface detected — tap anywhere on the screen to place the box.");
    }
});


markerlessScene.addEventListener('ar-hit-test-select', function () {
    placedModel.object3D.position.copy(reticle.object3D.position);
    placedModel.object3D.quaternion.copy(reticle.object3D.quaternion);
    placedModel.setAttribute('visible', 'true');

    markerlessScene.removeAttribute('ar-hit-test');
    reticle.setAttribute('visible', 'false');

    setArStatus("✅ Box placed on a real detected surface — this device supports WebXR hit-test AR.");
    scenarioQuestionButton.style.display = 'block';
});

// AR-lite fallback removed - WebXR only
// Place Here button removed - WebXR only
// Exit Scenario button - leave whichever mode is currently active
exitScenarioButton.addEventListener('click', function () {
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
    arModeActive = false;

    markerlessScene.style.display = 'none';
    markerlessOverlay.style.display = 'none';
    scenarioQuestionButton.style.display = 'none';
    reticle.setAttribute('visible', 'false');
    placedModel.setAttribute('visible', 'false');
    setArStatus('', false);

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
        playSound(pickupSound);
        this.canvas.setPointerCapture(event.pointerId);
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
    },
    
    onPointerUp(event) {
        if (!this.isDragging) {
            return;
        }
        
        this.isDragging = false;
        playSound(placeSound);
        const currentPos = this.el.getAttribute('position');
        
        // Check if dropped on podium
        if (this.checkPodiumCollision()) {
            window.itemOnPodium = this.itemName;
            
            // Get podium position and apply item-specific offset - PRESERVE EXACT POSITIONS
            const podiumPos = podium.getAttribute('position');
            const itemOffset = itemPodiumPositions[this.itemName] || { x: 0, y: 0, z: 0 };
            
            const newPos = {
                x: podiumPos.x + itemOffset.x,
                y: podiumPos.y + itemOffset.y,
                z: podiumPos.z + itemOffset.z
            };
            
            // Use snapToExactPosition to ensure NO DRIFT
            this.snapToExactPosition(this.itemName, newPos);
            
            // Show instruction button with item-specific text
            const instruction = itemInstructions[this.itemName] || "Apply item";
            instructionButton.textContent = instruction;
            instructionButton.style.display = 'block';
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #90EE90');
        } else {
            // Return item to original position
            const originalPos = originalPositions[this.itemName];
            if (originalPos) {
                this.el.setAttribute('position', originalPos);
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