// This will detect when the marker is found or lost and show/hide the start button accordingly.
const scene = document.querySelector('a-scene');
const startButton = document.getElementById('startTraining');

scene.addEventListener('targetFound', function () {
    console.log("Marker detected!");
    startButton.style.display = 'block';

});

scene.addEventListener('targetLost', function () {
    console.log("Marker lost!");
    startButton.style.display = 'none';

});

// Javascript code to handle mouse drag rotation for the 3D model
AFRAME.registerComponent('mouse-rotate', {
    init: function () {
        this.dragging = false;
        this.lastX = 0;
        this.lastY = 0;

        this.el.sceneEl.canvas.addEventListener('mousedown', (e) => {
            this.dragging = true;
            this.lastX = e.clientX;
            this.lastY = e.clientY;
        });

        window.addEventListener('mouseup', () => {
            this.dragging = false;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.dragging) return;

            const dx = e.clientX - this.lastX;
            const dy = e.clientY - this.lastY;

            const rotation = this.el.getAttribute('rotation');

            rotation.y += dx * 0.5;
            rotation.x += dy * 0.5;

            this.el.setAttribute('rotation', rotation);

            this.lastX = e.clientX;
            this.lastY = e.clientY;
        });
    }
});

// This will handle the start button click event and set a global variable to indicate that training has started.
window.trainingStarted = false;

startButton.addEventListener('click', function () {
    window.trainingStarted = true;
    console.log("Training started");
    startButton.innerText = "Training Started";
    startButton.disabled = true;

});

// Register draggable component 
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
        event.preventDefault();
    },
    
    onPointerUp(event) {
        if (!this.isDragging) {
            return;
        }
        
        this.isDragging = false;
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