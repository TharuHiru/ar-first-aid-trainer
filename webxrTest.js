import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const statusEl = document.getElementById("webxrTestStatus");
const startButton = document.getElementById("webxrTestStart");

function show(text) {
    statusEl.innerHTML = text;
    console.log(text);
}

// Scale applied ONLY to the model placed in this standalone markerless test
const MARKERLESS_MODEL_SCALE = 0.1;

// How much a full screen-drag turn maps onto model rotation. The XR "target
// ray" for a screen touch only sweeps roughly the camera's FOV as you drag
// across the screen, so this multiplies that up into a fuller spin.
const ROTATION_SENSITIVITY = 4;

let camera, scene, renderer, controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let initialized = false;
let firstAidBoxTemplate = null;
let directionalLight = null;
let shadowPlane = null;

// The currently placed box - once set, taps no longer place a new one and
// selectstart/selectend instead rotate this one.
let placedModel = null;
let isDraggingRotate = false;
let lastControllerYaw = 0;

// ------------------------------------------------------------
// CHECK WEBXR SUPPORT FIRST
// ------------------------------------------------------------
async function checkWebXR() {
    if (!navigator.xr) {
        show("❌ WebXR NOT available in this browser<br>(try Chrome on Android with ARCore)");
        startButton.disabled = true;
        return;
    }
    try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");
        if (!supported) {
            show("❌ immersive-ar NOT supported on this device");
            startButton.disabled = true;
            return;
        }
        show("✅ immersive-ar supported. Tap Start AR.");
    } catch (error) {
        show("❌ WebXR check error<br>" + error.message);
    }
}

// ------------------------------------------------------------
// DRAG-TO-ROTATE
// ------------------------------------------------------------
// The controller Object3D's orientation tracks the XR input source's
// "target ray" every frame while a screen touch is active - this is what
// we read instead of DOM pointer events, which don't reliably fire during
// an immersive-ar session.
function getControllerYaw() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.quaternion);
    return Math.atan2(dir.x, dir.z);
}

// Shortest signed angle from b to a, handling the -π/π wraparound
function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function onSelectStart() {
    // Only rotate if a model is already placed - otherwise this tap is
    // the initial placement tap and 'select' below handles it.
    if (!placedModel) return;
    isDraggingRotate = true;
    lastControllerYaw = getControllerYaw();
}

function onSelectEnd() {
    isDraggingRotate = false;
}

// ------------------------------------------------------------
// SETUP THREE.JS SCENE
// ------------------------------------------------------------
function init() {
    if (initialized) {
        return;
    }
    initialized = true;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20
    );

    // --- Lighting for a more realistic look ---
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6);
    hemiLight.position.set(0.5, 1, 0.25);
    scene.add(hemiLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(1, 2, 1);
    directionalLight.castShadow = true;

    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 5;
    directionalLight.shadow.camera.left = -1;
    directionalLight.shadow.camera.right = 1;
    directionalLight.shadow.camera.top = 1;
    directionalLight.shadow.camera.bottom = -1;
    directionalLight.shadow.bias = -0.001;

    scene.add(directionalLight);
    scene.add(directionalLight.target);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(renderer.domElement);

    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"],
        requiredFeatures: ["depth-sensing"],
            depthSensing: {
                usagePreference: ["gpu-optimized", "cpu-optimized"],
                dataFormatPreference: ["luminance-alpha", "float32"]
            }
    });
    
    document.body.appendChild(arButton);
    startButton.style.display = "none";

    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    const shadowPlaneGeo = new THREE.PlaneGeometry(2, 2);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    shadowPlane.visible = false;
    shadowPlane.matrixAutoUpdate = false;
    scene.add(shadowPlane);

    try {
        const loader = new GLTFLoader();
        loader.load(
            "assets/models/first_aid_box.glb",
            (gltf) => {
                firstAidBoxTemplate = gltf.scene;
                console.log("first_aid_box.glb loaded");
            },
            undefined,
            (error) => {
                console.error("Failed to load first_aid_box.glb:", error);
            }
        );
    } catch (error) {
        console.error("GLTFLoader setup failed:", error);
    }

    controller = renderer.xr.getController(0);
    scene.add(controller);

    // 'select' = a completed tap. Only place the model the FIRST time -
    // once placedModel exists, taps are handled by selectstart/selectend
    // below for rotation instead, so we must not re-place here.
    controller.addEventListener("select", () => {
        if (placedModel) return; // already placed - ignore, avoid re-placing mid-rotate
        if (!reticle.visible) {
            show("⚠️ No surface detected yet");
            return;
        }
        if (!firstAidBoxTemplate) {
            show("⏳ Model still loading, try again in a second");
            return;
        }

        const model = firstAidBoxTemplate.clone(true);
        model.position.setFromMatrixPosition(reticle.matrix);
        model.quaternion.setFromRotationMatrix(reticle.matrix);
        model.scale.setScalar(MARKERLESS_MODEL_SCALE);

        model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = false;
            }
        });

        scene.add(model);
        placedModel = model;
        reticle.visible = false;

        shadowPlane.matrix.copy(reticle.matrix);
        shadowPlane.visible = true;

        const modelWorldPos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
        directionalLight.position.set(
            modelWorldPos.x + 1,
            modelWorldPos.y + 2,
            modelWorldPos.z + 1
        );
        directionalLight.target.position.copy(modelWorldPos);
        directionalLight.target.updateMatrixWorld();

        show("🟢 First Aid Box placed!<br>Press and drag left/right to rotate it.");
    });

    // selectstart/selectend bracket a touch-and-hold - used here for rotation
    controller.addEventListener("selectstart", onSelectStart);
    controller.addEventListener("selectend", onSelectEnd);

    window.addEventListener("resize", onWindowResize);

    renderer.setAnimationLoop(render);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function render(timestamp, frame) {
    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (!hitTestSourceRequested) {
            session.requestReferenceSpace("viewer").then((viewerSpace) => {
                session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                    hitTestSource = source;
                });
            });

            session.addEventListener("end", () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });

            hitTestSourceRequested = true;
        }

        if (hitTestSource && !placedModel) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);

            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);

                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                show("🟢 Surface detected — tap screen to place model");
            } else {
                reticle.visible = false;
                show("🔵 Searching for a surface...<br>Move phone slowly over a floor/table");
            }
        }

        // Apply rotation each frame while the user is holding their
        // finger down after a model is already placed.
        if (isDraggingRotate && placedModel) {
            const currentYaw = getControllerYaw();
            placedModel.rotation.y += angleDelta(currentYaw, lastControllerYaw) * ROTATION_SENSITIVITY;
            lastControllerYaw = currentYaw;
        }
    }

    renderer.render(scene, camera);
}

window.initMarkerlessWebXRTest = function () {
    checkWebXR();
    init();
};