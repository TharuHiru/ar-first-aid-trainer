// This will detect when the marker is found or lost and show/hide the start button accordingly.
const scene = document.querySelector('a-scene');
const startButton = document.getElementById('startTraining');
const podium = document.getElementById('podium');
const instructionTag = document.getElementById('instructionTag');

scene.addEventListener('targetFound', function () {
    console.log("Marker detected!");
    startButton.style.display = 'block';

});

scene.addEventListener('targetLost', function () {
    console.log("Marker lost!");
    startButton.style.display = 'none';

});


window.trainingStarted = false;
window.bandAidOnPodium = false;
window.bandAidOriginalPosition = { x: 0.1, y: -0.13, z: 0 };

startButton.addEventListener('click', function () {
    window.trainingStarted = true;
    console.log("Training started");
    startButton.innerText = "Training Started";
    startButton.disabled = true;
    
    // Show the podium
    podium.setAttribute('visible', 'true');
    console.log("Podium shown");

});

// Register draggable component - adapted from working fire extinguisher code
AFRAME.registerComponent('draggable-object', {
    schema: {
        target: { type: "selector" }
    },
    
    init() {
        this.isDragging = false;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.dragPlane = new THREE.Plane();
        this.worldPoint = new THREE.Vector3();
        this.targetPoint = new THREE.Vector3();
        
        this.target = this.data.target;
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
        const bandAidPos = this.el.getAttribute('position');
        const podiumPos = podium.getAttribute('position');
        
        console.log("Band aid pos:", bandAidPos, "Podium pos:", podiumPos);
        
        // Simple distance check (band aid is within 0.2 units of podium center)
        const distance = Math.sqrt(
            Math.pow(bandAidPos.x - podiumPos.x, 2) +
            Math.pow(bandAidPos.y - (podiumPos.y + 0.08), 2)
        );
        
        console.log("Distance to podium:", distance);
        
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
        console.log("Band aid dragging started!");
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
    
    onPointerUp(event) {
        if (!this.isDragging) {
            return;
        }
        
        this.isDragging = false;
        const currentPos = this.el.getAttribute('position');
        
        // Check if dropped on podium
        if (this.checkPodiumCollision()) {
            console.log("Band aid placed on podium!");
            window.bandAidOnPodium = true;
            
            // Move band aid to podium center - keep Z position same
            const podiumPos = podium.getAttribute('position');
            const newPos = {
                x: podiumPos.x,
                y: podiumPos.y + 0.09,
                z: podiumPos.z + 0.01 
            };
            
            console.log("Setting position to:", newPos);
            this.el.setAttribute('position', newPos);
            
            // Show instruction tag
            instructionTag.setAttribute('visible', 'true');
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #90EE90');
        } else {
            console.log("Band aid dropped away from podium");
            window.bandAidOnPodium = false;
            instructionTag.setAttribute('visible', 'false');
            podium.querySelector('#podiumTop').setAttribute('material', 'emissive: #1a3a1a');
        }
        
        if (this.canvas.hasPointerCapture(event.pointerId)) {
            this.canvas.releasePointerCapture(event.pointerId);
        }
        console.log("Band aid dropped!");
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