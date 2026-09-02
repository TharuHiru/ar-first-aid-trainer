import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const statusEl = document.getElementById("webxrTestStatus");
const startButton = document.getElementById("webxrTestStart");
const backButton = document.getElementById("webxrTestBackButton");

// --- First-aid quiz UI elements (live inside the WebXR dom-overlay, i.e.
// #webxrTestContainer, so they stay visible during the immersive session) ---
const kitSpeechBubble = document.getElementById("kitSpeechBubble");
const kitSpeechText = document.getElementById("kitSpeechText");
const kitFeedback = document.getElementById("kitFeedback");
const equipmentPanel = document.getElementById("equipmentPanel");
const equipmentButtons = document.querySelectorAll(".equipment-btn");
const submitAnswerButton = document.getElementById("submitAnswerButton");

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

// A touch is treated as a "tap" (opens the quiz) instead of a "drag"
// (rotates the model) when it's shorter than this and barely rotates
// the model.
const TAP_MAX_DURATION_MS = 350;
const TAP_MAX_ROTATION_RAD = 0.05;

let camera, scene, renderer, controller;
let reticle, reticleMat;
let hitTestSource = null;
let hitTestSourceRequested = false;
let initialized = false;
let firstAidBoxTemplate = null;
let directionalLight = null;
let shadowPlane = null;

// The currently placed box - once set, taps no longer place a new one and
// selectstart/selectend instead rotate this one (or, if it's a quick tap,
// open the first-aid quiz).
let placedModel = null;
let isDraggingRotate = false;
let lastControllerYaw = 0;
let selectStartTime = 0;
let dragRotationAmount = 0;

// ------------------------------------------------------------
// FIRST-AID QUIZ: the placed "doctor" model asks three scenario
// questions, one at a time, in a comic-style speech bubble. The player
// answers by tapping the correct combination of equipment buttons and
// pressing "Submit Answer".
// ------------------------------------------------------------
const scenarioQuestions = [
    {
        prompt: "Ooh, I'm feeling warm... I think someone has a fever. 🤒 What should we reach for?",
        correctItems: ["thermometer", "paracetamol"]
    },
    {
        prompt: "Ouch! Someone has a cut on their hand and it's bleeding. 🩸 What do we need?",
        correctItems: ["sprit", "bandAid"]
    },
    {
        prompt: "My back has been aching all day. 😣 What can help with that?",
        correctItems: ["painBalm"]
    }
];

let trainingActive = false;
let currentQuestion = 0;
const selectedEquipment = new Set();

function startTraining() {
    if (trainingActive) return;
    trainingActive = true;
    currentQuestion = 0;
    equipmentPanel.style.display = "grid";
    askQuestion();
}

function askQuestion() {
    selectedEquipment.clear();
    equipmentButtons.forEach((btn) => btn.classList.remove("selected"));
    kitFeedback.style.display = "none";

    const question = scenarioQuestions[currentQuestion];
    kitSpeechText.textContent = question.prompt;
    kitSpeechBubble.style.display = "block";
}

function toggleEquipmentSelection(btn) {
    if (!trainingActive) return;
    const item = btn.dataset.item;
    if (selectedEquipment.has(item)) {
        selectedEquipment.delete(item);
        btn.classList.remove("selected");
    } else {
        selectedEquipment.add(item);
        btn.classList.add("selected");
    }
}

function setsMatch(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

function checkAnswer() {
    if (!trainingActive) return;
    if (selectedEquipment.size === 0) {
        kitFeedback.textContent = "Pick at least one item first!";
        kitFeedback.className = "kit-feedback wrong";
        kitFeedback.style.display = "block";
        return;
    }

    const question = scenarioQuestions[currentQuestion];
    const correctSet = new Set(question.correctItems);

    if (setsMatch(selectedEquipment, correctSet)) {
        kitFeedback.textContent = "✅ You are correct!";
        kitFeedback.className = "kit-feedback correct";
        kitFeedback.style.display = "block";

        currentQuestion += 1;
        if (currentQuestion < scenarioQuestions.length) {
            setTimeout(askQuestion, 1800);
        } else {
            setTimeout(finishTraining, 1800);
        }
    } else {
        kitFeedback.textContent = "❌ You are wrong, try again.";
        kitFeedback.className = "kit-feedback wrong";
        kitFeedback.style.display = "block";
        selectedEquipment.clear();
        equipmentButtons.forEach((btn) => btn.classList.remove("selected"));
    }
}

function finishTraining() {
    kitSpeechText.textContent = "Great job! You know your first-aid kit well. 🎉";
    kitFeedback.style.display = "none";
    equipmentPanel.style.display = "none";
    trainingActive = false;
}

equipmentButtons.forEach((btn) => {
    btn.addEventListener("click", () => toggleEquipmentSelection(btn));
});

if (submitAnswerButton) {
    submitAnswerButton.addEventListener("click", checkAnswer);
}

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
// BACK TO HOME
// ------------------------------------------------------------
// Leaves the markerless test screen and returns to the mode selector.
// If a real WebXR session is currently running, end it first so the
// device/browser cleanly exits AR before we swap the UI back.
function goBackToHome() {
    const session = renderer && renderer.xr ? renderer.xr.getSession() : null;

    const returnHome = () => {
        const container = document.getElementById("webxrTestContainer");
        const modeSelector = document.getElementById("modeSelector");
        if (container) container.style.display = "none";
        if (modeSelector) modeSelector.style.display = "flex";
    };

    if (session) {
        session.end().then(returnHome).catch(returnHome);
    } else {
        returnHome();
    }
}

if (backButton) {
    backButton.addEventListener("click", goBackToHome);
}

// ------------------------------------------------------------
// DRAG-TO-ROTATE / TAP-TO-OPEN-QUIZ
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
    selectStartTime = performance.now();
    dragRotationAmount = 0;
}

function onSelectEnd() {
    isDraggingRotate = false;
    if (!placedModel) return;

    // A short touch that barely rotated the model counts as a "tap" on
    // the first-aid box itself, rather than a rotate-drag - that's what
    // opens the quiz.
    const duration = performance.now() - selectStartTime;
    const wasTap = duration < TAP_MAX_DURATION_MS && dragRotationAmount < TAP_MAX_ROTATION_RAD;

    if (wasTap && !trainingActive) {
        startTraining();
    }
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
    renderer.domElement.classList.add("webxr-test-canvas");
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.domElement.style.pointerEvents = "none";
    renderer.domElement.style.zIndex = "1";
    renderer.domElement.style.position = "fixed";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.left = "0";

    document.body.appendChild(renderer.domElement);

    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay", "depth-sensing"],
        domOverlay: { root: document.getElementById("webxrTestContainer") },
        depthSensing: {
            usagePreference: ["gpu-optimized", "cpu-optimized"],
            dataFormatPreference: ["luminance-alpha", "float32"]
        }
    });
    
    arButton.style.pointerEvents = "auto";
    arButton.style.zIndex = "10000";
    document.body.appendChild(arButton);
    
    // Hide the old start button and show the new AR button
    startButton.style.display = "none";
    setTimeout(() => {
        const newStartBtn = document.querySelector('button[aria-label="Enter AR"]') || document.body.lastChild;
        if (newStartBtn && newStartBtn !== arButton) {
            newStartBtn.style.pointerEvents = "auto";
            newStartBtn.style.zIndex = "10000";
        }
    }, 100);

    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
    reticleMat = new THREE.MeshBasicMaterial({ color: 0x3ECF8E, transparent: true });
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
            "assets/models/doctor.glb",
            (gltf) => {
                firstAidBoxTemplate = gltf.scene;
                console.log("doctor.glb loaded");
            },
            undefined,
            (error) => {
                console.error("Failed to load doctor.glb:", error);
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

        show("🩹 First-aid box placed!<br>Tap it to start the quiz, or press and drag to rotate it.");
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
    if (reticle && reticle.visible) {
        const hue = (timestamp * 0.00005) % 1; // slow color cycle
        reticleMat.color.setHSL(hue, 0.9, 0.55);

        const pulse = 1 + Math.sin(timestamp * 0.004) * 0.08;
        reticle.scale.set(pulse, pulse, pulse);
    }
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
        // finger down after a model is already placed. Disabled while
        // the quiz is active so answering questions never spins the box.
        if (isDraggingRotate && placedModel && !trainingActive) {
            const currentYaw = getControllerYaw();
            const delta = angleDelta(currentYaw, lastControllerYaw) * ROTATION_SENSITIVITY;
            placedModel.rotation.y += delta;
            dragRotationAmount += Math.abs(delta);
            lastControllerYaw = currentYaw;
        }
    }

    renderer.render(scene, camera);
}

window.initMarkerlessWebXRTest = function () {
    checkWebXR();
    init();
};