const modeSelector = document.getElementById('modeSelector');
const markerModeBtn = document.getElementById('markerModeBtn');
const markerlessModeBtn = document.getElementById('markerlessModeBtn');
const webxrTestContainer = document.getElementById('webxrTestContainer');
const markerInstructions = document.getElementById('markerInstructions');
const downloadMarkerButton = document.getElementById('downloadMarkerButton');
const letsStartButton = document.getElementById('letsStartButton');
const guideMessage = document.getElementById('guideMessage');
const camBackButton = document.getElementById('camBackButton');
const webxrBackButton = document.getElementById('webxrBackButton');

window.itemOnPodium = null;
window.trainingStarted = false;
window.viewItemsMode = false;
window.guideStage = 0; // 0 = not started, 1 = first item placed, 2 = well done shown

markerModeBtn.addEventListener('click', function () {
    modeSelector.style.display = 'none';
    markerInstructions.style.display = 'flex';
});

downloadMarkerButton.addEventListener('click', function () {
    const link = document.createElement('a');
    link.href = 'assets/images/new_marker.jpg';
    link.download = 'marker.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

letsStartButton.addEventListener('click', function () {
    markerInstructions.style.display = 'none';

    markerScene.style.display = 'block';
    if (camBackButton) {
        camBackButton.style.display = 'inline-flex';
    }
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

if (camBackButton) {
    camBackButton.addEventListener('click', function () {
        const mindarSystem = markerScene.systems && markerScene.systems['mindar-image-system'];
        if (mindarSystem && typeof mindarSystem.stop === 'function') {
            mindarSystem.stop();
        }

        markerScene.style.display = 'none';
        camBackButton.style.display = 'none';
        startButton.style.display = 'none';
        instructionButton.style.display = 'none';
        guideMessage.style.display = 'none';
        podium.setAttribute('visible', 'false');

        // Reset training state so re-entering starts fresh
        window.trainingStarted = false;
        window.viewItemsMode = false;
        window.itemOnPodium = null;
        window.guideStage = 0;

        modeSelector.style.display = 'flex';
    });
}

if (webxrBackButton) {
    webxrBackButton.addEventListener('click', function () {
        if (typeof window.stopMarkerlessWebXRTest === 'function') {
            window.stopMarkerlessWebXRTest();
        }
        webxrTestContainer.style.display = 'none';
        modeSelector.style.display = 'flex';
    });
}

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
});

// Start Training button 
startButton.addEventListener('click', function () {
    
    startButton.style.display = 'none';
    window.trainingStarted = true;
    window.viewItemsMode = true;

    // Show the podium
    podium.setAttribute('visible', 'true');

    // guide the user to drag an item onto the podium
    showGuideMessage('Drag and drop an item onto the podium to view its usage.');
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

    setArStatus("Box placed on a real detected surface — this device supports WebXR hit-test AR.");
    scenarioQuestionButton.style.display = 'block';
});

exitScenarioButton.addEventListener('click', function () {
    if (arModeActive && (markerlessScene.is('ar-mode') || markerlessScene.is('vr-mode'))) {
        markerlessScene.exitVR(); 
    } else {
        returnToMarkerScene();
    }
});

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
    if (camBackButton) {
        camBackButton.style.display = 'inline-flex';
    }

    const mindarSystem = markerScene.systems && markerScene.systems['mindar-image-system'];
    if (mindarSystem && typeof mindarSystem.start === 'function') {
        mindarSystem.start();
    }
}

function showGuideMessage(text) {
    guideMessage.textContent = text;
    guideMessage.style.display = 'block';

    // restart the CSS animation by forcing a reflow
    guideMessage.style.animation = 'none';
    void guideMessage.offsetWidth; // force reflow
    guideMessage.style.animation = 'guideMessagePop 0.4s ease-out';
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
            
            // Stage 2: guide the user to try another item, the first time only
            if (window.guideStage === 0) {
                window.guideStage = 1;
                showGuideMessage('You can place it back and try another item to view.');
            }

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

            // Stage 3: after the first item is taken off the podium, show final encouragement
            if (window.guideStage === 1) {
                window.guideStage = 2;
                showGuideMessage('Well done! Try exploring the other items too.');
            }
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