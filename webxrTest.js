import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const statusEl = document.getElementById("webxrTestStatus");
const startButton = document.getElementById("webxrTestStart");
const backButton = document.getElementById("webxrBackButton");
const overlayRoot = document.getElementById("webxrTestContainer"); 

const kitSpeechBubble = document.getElementById("kitSpeechBubble");
const kitSpeechText = document.getElementById("kitSpeechText");
const kitFeedback = document.getElementById("kitFeedback");

function show(text) {
    statusEl.innerHTML = text;
    console.log(text);
}

const MARKERLESS_MODEL_SCALE = 0.25; 

const CLUSTER_MIN_RADIUS = 0.22;
const CLUSTER_MAX_RADIUS = 0.4;
const CLUSTER_ARC_RADIANS = Math.PI * 0.95; 

const ITEM_BOB_SPEED = 0.0022;
const ITEM_BOB_HEIGHT = 0.012;

const ITEM_DEFS = {
    bandAid: { path: "assets/models/band_aid_box.glb", emoji: "🩹", label: "Band-Aid", scale: 0.015, rotation: { x: 0, y: 0, z: 0 } },
    bandageRoll: { path: "assets/models/bandage_roll.glb", emoji: "🎗️", label: "Bandage Roll", scale: 0.035, rotation: { x: 0, y: Math.PI / 4, z: 0 }, shadowOffset: { x: 0, y: -0.005, z: 0 } },
    painBalm: { path: "assets/models/pain_balm.glb", emoji: "🧴", label: "Pain Balm", scale: 0.015, rotation: { x: 0, y: 0, z: 0 } },
    paracetamol: { path: "assets/models/paracetamol.glb", emoji: "💊", label: "Paracetamol", scale: 0.035, rotation: { x: 0, y: Math.PI / 6, z: 0 }, shadowOffset: { x: 0, y: -0.008, z: 0 } },
    sprit: { path: "assets/models/sprit.glb", emoji: "🧪", label: "Antiseptic Spirit", scale: 0.035, rotation: { x: 0, y: 0, z: 0 }, shadowOffset: { x: 0, y: -0.01, z: 0 } }
};

const scenarioQuestions = [
    {
        prompt: "Ooh, I'm feeling warm... I think someone has a fever. 🤒 Tap what we need!",
        correctItems: ["paracetamol"]
    },
    {
        prompt: "Ouch! Someone has a cut on their hand and it's bleeding. 🩸 Tap what we need!",
        correctItems: ["sprit", "bandAid"]
    },
    {
        prompt: "My back has been aching all day. 😣 Tap what can help!",
        correctItems: ["painBalm"]
    }
];

let camera, scene, renderer, controller;
let reticle, reticleMat;
let hitTestSource = null;
let hitTestSourceRequested = false;
let initialized = false;
let patientTemplate = null; 
let directionalLight = null;
let shadowPlane = null;
let arButtonEl = null;

let placedModel = null;
let placeRequested = false;

// ------------------------------------------------------------
// POSITIONAL AUDIO
// ------------------------------------------------------------
let audioListener = null;
let patientAudio = null;
let correctBuffer = null;
let wrongBuffer = null;
const audioLoader = new THREE.AudioLoader();

function preloadAudio() {
    audioLoader.load("assets/sounds/correct.wav", (b) => { correctBuffer = b; }, undefined,
        (e) => console.error("Failed to load correct.wav:", e));
    audioLoader.load("assets/sounds/wrong.wav", (b) => { wrongBuffer = b; }, undefined,
        (e) => console.error("Failed to load wrong.wav:", e));
}

function setupPatientAudio() {
    if (!placedModel || !audioListener) return;
    patientAudio = new THREE.PositionalAudio(audioListener);
    patientAudio.setRefDistance(0.5);
    patientAudio.setLoop(false);
    placedModel.add(patientAudio);
}

function playOneShot(buffer, volume = 0.7) {
    if (!patientAudio || !buffer) return;
    if (patientAudio.isPlaying) patientAudio.stop();
    patientAudio.setLoop(false);
    patientAudio.setBuffer(buffer);
    patientAudio.setVolume(volume);
    patientAudio.play();
}

// ------------------------------------------------------------
// VISUAL FEEDBACK: shake on wrong answer, wound-heals on correct
// ------------------------------------------------------------
let woundDecal = null;
let shakeState = null;
let healState = null;

function setupWoundDecal() {
    if (!placedModel) return;
    const woundGeo = new THREE.CircleGeometry(0.03, 24);
    const woundMat = new THREE.MeshBasicMaterial({
        color: 0xb02020, transparent: true, opacity: 0.85, depthWrite: false
    });
    woundDecal = new THREE.Mesh(woundGeo, woundMat);
    woundDecal.position.set(0, 0.25, 0.06);
    woundDecal.rotation.x = -Math.PI / 2;
    placedModel.add(woundDecal);
}

function triggerShakeEffect() {
    if (!placedModel) return;
    shakeState = { startTime: performance.now(), duration: 400, originalPos: placedModel.position.clone() };
}

function triggerHealEffect() {
    healState = { startTime: performance.now(), duration: 900 };
}

// ------------------------------------------------------------
// ITEM SETUP + PLACEMENT (clustered near the doctor, small scale, shadows)
// ------------------------------------------------------------
const worldItems = new Map();
const itemTemplates = new Map();
let itemTemplatesLoaded = 0;

const selectedItems = new Set(); 

function preloadItemTemplates(onAllLoaded) {
    const names = Object.keys(ITEM_DEFS);
    const loader = new GLTFLoader();
    names.forEach((name) => {
        loader.load(
            ITEM_DEFS[name].path,
            (gltf) => {
                itemTemplates.set(name, gltf.scene);
                itemTemplatesLoaded += 1;
                if (itemTemplatesLoaded === names.length && onAllLoaded) onAllLoaded();
            },
            undefined,
            (error) => console.error(`Failed to load ${ITEM_DEFS[name].path}:`, error)
        );
    });
}

function ensureItemMesh(name) {
    let entry = worldItems.get(name);
    if (entry) return entry;

    const template = itemTemplates.get(name);
    if (!template) return null; 

    const mesh = template.clone(true);
    const s = ITEM_DEFS[name].scale;
    mesh.scale.set(s, s, s);
    
    // Apply rotation from ITEM_DEFS
    const rot = ITEM_DEFS[name].rotation;
    if (rot) {
        mesh.rotation.set(rot.x, rot.y, rot.z);
    }
    
    // Apply shadow offset to position the model closer to ground
    const shadowOffset = ITEM_DEFS[name].shadowOffset || { x: 0, y: 0, z: 0 };
    mesh.position.y = shadowOffset.y;
    mesh.position.x = shadowOffset.x;
    mesh.position.z = shadowOffset.z;
    
    mesh.userData.itemName = name;

    mesh.traverse((node) => {
        if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = false;
            node.userData.itemName = name; 
            if (node.material) {
                node.material = node.material.clone();
                if (node.material.emissive) {
                    node.userData.baseEmissive = node.material.emissive.clone();
                    node.userData.baseEmissiveIntensity = node.material.emissiveIntensity ?? 1;
                }
            }
        }
    });

    scene.add(mesh);
    entry = { mesh, baseY: 0, bobPhase: Math.random() * Math.PI * 2 };
    worldItems.set(name, entry);
    return entry;
}

function clusterItemsAroundPatient(centerPos, facingAngle) {
    const names = Object.keys(ITEM_DEFS);
    names.forEach((name, i) => {
        const entry = ensureItemMesh(name);
        if (!entry) return;

        const t = names.length === 1 ? 0.5 : i / (names.length - 1);
        const angle = facingAngle - CLUSTER_ARC_RADIANS / 2 + CLUSTER_ARC_RADIANS * t;
        const radius = CLUSTER_MIN_RADIUS + Math.random() * (CLUSTER_MAX_RADIUS - CLUSTER_MIN_RADIUS);

        const x = centerPos.x + Math.sin(angle) * radius;
        const z = centerPos.z + Math.cos(angle) * radius;

        entry.mesh.position.set(x, centerPos.y, z);
        entry.baseY = centerPos.y;
        entry.mesh.visible = true;
    });
}

function setItemHighlight(name, selected) {
    const entry = worldItems.get(name);
    if (!entry) return;

    const s = ITEM_DEFS[name].scale;
    entry.mesh.scale.setScalar(selected ? s * 1.2 : s);

    entry.mesh.traverse((node) => {
        if (node.isMesh && node.material && node.material.emissive) {
            if (selected) {
                node.material.emissive.setHex(0x3ecf8e);
                node.material.emissiveIntensity = 1.4;
            } else if (node.userData.baseEmissive) {
                node.material.emissive.copy(node.userData.baseEmissive);
                node.material.emissiveIntensity = node.userData.baseEmissiveIntensity;
            }
        }
    });
}

function toggleSelectItem(name) {
    if (selectedItems.has(name)) {
        selectedItems.delete(name);
        setItemHighlight(name, false);
    } else {
        selectedItems.add(name);
        setItemHighlight(name, true);
    }
    updateInventoryTray();
}

function clearSelections() {
    selectedItems.forEach((name) => setItemHighlight(name, false));
    selectedItems.clear();
    updateInventoryTray();
}

// ------------------------------------------------------------
// HUD: selection tray + Submit button, injected into the WebXR dom-overlay.
// ------------------------------------------------------------
let inventoryTrayEl, submitButtonEl;

function injectHuntStyles() {
    const style = document.createElement("style");
    style.textContent = `
        #arInventoryTray {
            position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 8px; z-index: 9500;
        }
        .ar-inventory-slot {
            width: 40px; height: 40px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; background: rgba(0,0,0,0.35);
            opacity: 0.45; transform: scale(0.9);
            transition: opacity 0.15s ease, transform 0.15s ease;
        }
        .ar-inventory-slot.held {
            opacity: 1; transform: scale(1.08);
            background: rgba(62,207,142,0.5);
            box-shadow: 0 0 8px rgba(62,207,142,0.75);
        }
        #arSubmitButton {
            position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
            padding: 10px 20px; border-radius: 20px; border: none;
            background: #3ECF8E; color: #06281a; font-weight: 700;
            font-family: sans-serif; font-size: 15px;
            z-index: 9600; display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        }
    `;
    document.head.appendChild(style);
}

function createHuntHUD() {
    injectHuntStyles();

    inventoryTrayEl = document.createElement("div");
    inventoryTrayEl.id = "arInventoryTray";
    inventoryTrayEl.style.display = "none";
    Object.keys(ITEM_DEFS).forEach((name) => {
        const slot = document.createElement("div");
        slot.className = "ar-inventory-slot";
        slot.dataset.item = name;
        slot.textContent = ITEM_DEFS[name].emoji;
        inventoryTrayEl.appendChild(slot);
    });

    submitButtonEl = document.createElement("button");
    submitButtonEl.id = "arSubmitButton";
    submitButtonEl.textContent = "✅ Submit Answer";
    submitButtonEl.addEventListener("click", checkAnswer);

    overlayRoot.appendChild(inventoryTrayEl);
    overlayRoot.appendChild(submitButtonEl);
}

function showHuntHUD() {
    inventoryTrayEl.style.display = "flex";
}

function hideHuntHUD() {
    inventoryTrayEl.style.display = "none";
    submitButtonEl.style.display = "none";
}

function updateInventoryTray() {
    const slots = inventoryTrayEl.querySelectorAll(".ar-inventory-slot");
    slots.forEach((slot) => slot.classList.toggle("held", selectedItems.has(slot.dataset.item)));
    submitButtonEl.style.display = selectedItems.size > 0 ? "block" : "none";
}

// ------------------------------------------------------------
// QUIZ FLOW
// ------------------------------------------------------------
let trainingActive = false;
let currentQuestion = 0;

function startTraining(centerPos, facingAngle) {
    trainingActive = true;
    currentQuestion = 0;
    clearSelections();

    showHuntHUD();
    clusterItemsAroundPatient(centerPos, facingAngle);
    askQuestion();
}

function askQuestion() {
    kitFeedback.style.display = "none";
    const question = scenarioQuestions[currentQuestion];
    kitSpeechText.textContent = question.prompt;
    kitSpeechBubble.style.display = "block";
}

function setsMatch(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) if (!b.has(item)) return false;
    return true;
}

function checkAnswer() {
    if (!trainingActive || selectedItems.size === 0) return;

    const question = scenarioQuestions[currentQuestion];
    const correctSet = new Set(question.correctItems);

    if (setsMatch(selectedItems, correctSet)) {
        kitFeedback.textContent = "✅ You are correct!";
        kitFeedback.className = "kit-feedback correct";
        kitFeedback.style.display = "block";

        playOneShot(correctBuffer, 0.8);
        triggerHealEffect();
        clearSelections();

        currentQuestion += 1;
        if (currentQuestion < scenarioQuestions.length) {
            setTimeout(askQuestion, 1800);
        } else {
            setTimeout(finishTraining, 1800);
        }
    } else {
        kitFeedback.textContent = "❌ Not quite - let's start over!";
        kitFeedback.className = "kit-feedback wrong";
        kitFeedback.style.display = "block";

        playOneShot(wrongBuffer, 0.8);
        triggerShakeEffect();
        clearSelections();

        currentQuestion = 0;
        setTimeout(askQuestion, 1800);
    }
}

function finishTraining() {
    kitSpeechText.textContent = "Great job! You know your first-aid kit well. 🎉";
    kitFeedback.style.display = "none";
    trainingActive = false;
    hideHuntHUD();

    if (woundDecal) woundDecal.visible = false;
    if (patientAudio && patientAudio.isPlaying) patientAudio.stop();
}

function resetHuntState() {
    trainingActive = false;
    currentQuestion = 0;
    clearSelections();
    if (inventoryTrayEl) hideHuntHUD();
    if (kitSpeechBubble) kitSpeechBubble.style.display = "none";
    if (kitFeedback) kitFeedback.style.display = "none";
}

// ------------------------------------------------------------
// CHECK WEBXR SUPPORT FIRST
// ------------------------------------------------------------
async function checkWebXR() {
    if (!navigator.xr) {
        show("WebXR NOT available in this browser<br>(try Chrome on Android with ARCore)");
        startButton.disabled = true;
        return;
    }
    try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");
        if (!supported) {
            show("immersive-ar NOT supported on this device");
            startButton.disabled = true;
            return;
        }
        show("immersive-ar supported. Tap Start AR.");
    } catch (error) {
        show("WebXR check error<br>" + error.message);
    }
}

// ------------------------------------------------------------
// BACK TO HOME
// ------------------------------------------------------------
function goBackToHome() {
    const session = renderer && renderer.xr ? renderer.xr.getSession() : null;
    const returnHome = () => {
        resetHuntState();
        const container = document.getElementById("webxrTestContainer");
        const modeSelector = document.getElementById("modeSelector");
        if (container) container.style.display = "none";
        if (modeSelector) modeSelector.style.display = "flex";
        if (arButtonEl) arButtonEl.style.display = "none";
        if (renderer) renderer.domElement.style.display = "none";
    };
    if (session) {
        session.end().then(returnHome).catch(returnHome);
    } else {
        returnHome();
    }
}

if (backButton) backButton.addEventListener("click", goBackToHome);

const tapRaycaster = new THREE.Raycaster();
const tapMatrix = new THREE.Matrix4();

function getTapRaycaster() {
    tapMatrix.identity().extractRotation(controller.matrixWorld);
    tapRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    tapRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(tapMatrix);
    return tapRaycaster;
}

function findItemNameFromHit(object) {
    let node = object;
    while (node) {
        if (node.userData && node.userData.itemName) return node.userData.itemName;
        node = node.parent;
    }
    return null;
}

function onControllerSelect() {
    if (!placedModel) {
        placeRequested = true;
        return;
    }
    if (!trainingActive) return;

    const raycaster = getTapRaycaster();

    const itemMeshes = [];
    worldItems.forEach((entry) => { if (entry.mesh.visible) itemMeshes.push(entry.mesh); });

    const itemHits = raycaster.intersectObjects(itemMeshes, true);
    if (itemHits.length > 0) {
        const name = findItemNameFromHit(itemHits[0].object);
        if (name) toggleSelectItem(name);
        return;
    }

    const doctorHits = raycaster.intersectObject(placedModel, true);
    if (doctorHits.length > 0) {
        checkAnswer();
    }
}

// ------------------------------------------------------------
// MODEL + ITEM PLACEMENT
// ------------------------------------------------------------
function placeModelAtMatrix(matrix) {
    if (!patientTemplate) {
        show("Model still loading, try again in a second");
        return;
    }

    const model = patientTemplate.clone(true);
    model.scale.setScalar(MARKERLESS_MODEL_SCALE);
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);
    const feetOffsetY = -box.min.y;

    model.position.setFromMatrixPosition(matrix);
    model.quaternion.setFromRotationMatrix(matrix);
    model.position.y += feetOffsetY;

    model.traverse((node) => {
        if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = false;
        }
    });

    scene.add(model);
    placedModel = model;
    reticle.visible = false;

    shadowPlane.matrix.copy(matrix);
    shadowPlane.visible = true;

    const modelWorldPos = new THREE.Vector3().setFromMatrixPosition(matrix);
    directionalLight.position.set(modelWorldPos.x + 1, modelWorldPos.y + 2, modelWorldPos.z + 1);
    directionalLight.target.position.copy(modelWorldPos);
    directionalLight.target.updateMatrixWorld();

    setupPatientAudio();
    setupWoundDecal();

    const xrCamera = renderer.xr.getCamera(camera);
    const camPos = new THREE.Vector3();
    xrCamera.getWorldPosition(camPos);
    const facingAngle = Math.atan2(camPos.x - modelWorldPos.x, camPos.z - modelWorldPos.z);

    show("Tap the correct item(s), then click on submit");
    startTraining(modelWorldPos, facingAngle);
}

// ------------------------------------------------------------
// SETUP THREE.JS SCENE
// ------------------------------------------------------------
function init() {
    if (initialized) return;
    initialized = true;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    preloadAudio();

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

    arButtonEl = arButton;
    arButton.style.pointerEvents = "auto";
    arButton.style.zIndex = "10000";
    document.body.appendChild(arButton);

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
            (gltf) => { patientTemplate = gltf.scene; console.log("doctor.glb loaded"); },
            undefined,
            (error) => console.error("Failed to load doctor.glb:", error)
        );
    } catch (error) {
        console.error("GLTFLoader setup failed:", error);
    }

    preloadItemTemplates(() => console.log("All item models loaded"));
    createHuntHUD();

    controller = renderer.xr.getController(0);
    scene.add(controller);
    controller.addEventListener("select", onControllerSelect);

    renderer.xr.addEventListener("sessionstart", () => {
        const bg = document.getElementById("webxrTestBg");
        if (bg) bg.style.display = "none";
    });
    renderer.xr.addEventListener("sessionend", () => {
        const bg = document.getElementById("webxrTestBg");
        if (bg) bg.style.display = "";
        resetHuntState();
    });

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
        const hue = (timestamp * 0.00005) % 1;
        reticleMat.color.setHSL(hue, 0.9, 0.55);
        const pulse = 1 + Math.sin(timestamp * 0.004) * 0.08;
        reticle.scale.set(pulse, pulse, pulse);
    }

    if (shakeState) {
        const t = performance.now() - shakeState.startTime;
        if (t < shakeState.duration) {
            const strength = 0.01 * (1 - t / shakeState.duration);
            const offset = Math.sin(t * 0.08) * strength;
            placedModel.position.x = shakeState.originalPos.x + offset;
        } else {
            placedModel.position.copy(shakeState.originalPos);
            shakeState = null;
        }
    }

    if (healState && woundDecal) {
        const t = performance.now() - healState.startTime;
        const progress = Math.min(t / healState.duration, 1);
        woundDecal.material.opacity = 0.85 * (1 - progress);
        woundDecal.scale.setScalar(1 - progress * 0.5);
        if (progress >= 1) healState = null;
    }

    if (trainingActive) {
        worldItems.forEach((entry) => {
            if (!entry.mesh.visible) return;
            entry.bobPhase += ITEM_BOB_SPEED * 16;
            entry.mesh.position.y = entry.baseY + Math.sin(entry.bobPhase) * ITEM_BOB_HEIGHT;
        });
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

                if (placeRequested) {
                    placeRequested = false;
                    placeModelAtMatrix(reticle.matrix);
                } else {
                    show("Surface detected — tap screen to place");
                }
            } else {
                reticle.visible = false;
                if (placeRequested) {
                    placeRequested = false;
                    show("Lost the surface — aim at it again and tap");
                } else {
                    show("Searching for a surface...<br>Move phone slowly over a floor/table");
                }
            }
        }
    }

    renderer.render(scene, camera);
}

window.initMarkerlessWebXRTest = function () {
    checkWebXR();
    init();
    if (arButtonEl) arButtonEl.style.display = "";
    if (renderer) renderer.domElement.style.display = "";
};