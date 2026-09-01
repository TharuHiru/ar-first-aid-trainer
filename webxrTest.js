// ============================================================
// Standalone Markerless WebXR AR Compatibility Test
// ============================================================
// This is your WebXR AR compatibility test snippet, unchanged in behavior,
// just wrapped so it starts on demand (when the user picks "Markerless AR"
// on the mode selector) instead of running the moment the page loads.
// Fully independent of the marker-based trainer and the in-training
// Scenario mode - it does not share any state or DOM with either.
// ============================================================

import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";

const statusEl = document.getElementById("webxrTestStatus");
const startButton = document.getElementById("webxrTestStart");

function show(text) {
    statusEl.innerHTML = text;
    console.log(text);
}

let camera, scene, renderer;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let initialized = false;

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
// SETUP THREE.JS SCENE
// ------------------------------------------------------------
function init() {
    if (initialized) {
        return; // safe to call more than once - only sets up the scene once
    }
    initialized = true;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20
    );

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // ARButton handles requestSession + the required WebGL/XRWebGLLayer wiring
    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"]
    });
    document.body.appendChild(arButton);
    startButton.style.display = "none"; // ARButton replaces our manual button

    // Reticle = ring showing where a surface was detected
    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Tap to place a small cube ("the model") at the reticle position
    const controller = renderer.xr.getController(0);
    controller.addEventListener("select", () => {
        if (!reticle.visible) {
            show("⚠️ No surface detected yet");
            return;
        }
        const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
        const material = new THREE.MeshStandardMaterial({ color: 0x2196f3 });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.setFromMatrixPosition(reticle.matrix);
        scene.add(cube);

        show("🟢 Model placed!<br>Hit-test + rendering both work.");
    });
    scene.add(controller);

    window.addEventListener("resize", onWindowResize);

    renderer.setAnimationLoop(render);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ------------------------------------------------------------
// RENDER + HIT TEST LOOP
// ------------------------------------------------------------
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

        if (hitTestSource) {
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
    }

    renderer.render(scene, camera);
}

// ------------------------------------------------------------
// Entry point - called from app.js when the user picks
// "Markerless AR" on the mode selector.
// ------------------------------------------------------------
window.initMarkerlessWebXRTest = function () {
    checkWebXR();
    init();
};