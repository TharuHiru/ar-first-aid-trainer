// This will detect when the marker is found or lost and show/hide the start button accordingly.
const scene = document.querySelector('a-scene');
const startButton = document.getElementById('startTraining');
const podium = document.getElementById('podium');
const instructionButton = document.getElementById('instructionButton');
const trainingButtonsContainer = document.getElementById('trainingButtonsContainer');
const viewItemsButton = document.getElementById('viewItemsButton');
const scenarioButton = document.getElementById('scenarioButton');
const scenarioBloodHand = document.getElementById('scenarioBloodHand');

// Create scenario question button
const scenarioQuestionButton = document.createElement('button');
scenarioQuestionButton.id = 'scenarioQuestionButton';
scenarioQuestionButton.textContent = "What do you use with this hand wound?";
scenarioQuestionButton.style.display = 'none';
scenarioQuestionButton.style.position = 'fixed';
scenarioQuestionButton.style.bottom = '20px';
scenarioQuestionButton.style.left = '50%';
scenarioQuestionButton.style.transform = 'translateX(-50%)';
scenarioQuestionButton.style.padding = '12px 24px';
scenarioQuestionButton.style.fontSize = '16px';
scenarioQuestionButton.style.backgroundColor = '#FF6B6B';
scenarioQuestionButton.style.color = 'white';
scenarioQuestionButton.style.border = 'none';
scenarioQuestionButton.style.borderRadius = '5px';
scenarioQuestionButton.style.cursor = 'pointer';
scenarioQuestionButton.style.zIndex = '1000';
document.body.appendChild(scenarioQuestionButton);

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
    scenarioBloodHand.setAttribute('visible', 'false');
    scenarioQuestionButton.style.display = 'none';
    window.scenarioMode = false;
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

// Scenario button - display blood hand model with question
scenarioButton.addEventListener('click', function () {
    console.log("Scenario clicked");
    trainingButtonsContainer.classList.remove('visible');
    window.scenarioMode = true;
    
    // Show the blood hand model
    scenarioBloodHand.setAttribute('visible', 'true');
    scenarioQuestionButton.style.display = 'block';
    
    console.log("Blood hand model shown with question button");
});

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