import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const statusEl = document.getElementById("webxrTestStatus");
const startButton = document.getElementById("webxrTestStart");

function show(text) {
    statusEl.innerHTML = text;
    console.log(text);
}

// Scale applied ONLY to the model placed in this standalone markerless test -
// tune this until it looks right relative to real-world objects on your table.
const MARKERLESS_MODEL_SCALE = 0.1;

let camera, scene, renderer;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let initialized = false;
let firstAidBoxTemplate = null;
let directionalLight = null;
let shadowPlane = null;

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
    // Hemisphere light stays as soft ambient/fill (sky vs ground bounce),
    // dropped a bit in intensity since the directional light now does
    // the heavy lifting on shading + shadows.
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6);
    hemiLight.position.set(0.5, 1, 0.25);
    scene.add(hemiLight);

    // Directional light = the actual "sun" that casts shadows.
    directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(1, 2, 1); // repositioned relative to placed model below
    directionalLight.castShadow = true;

    // Shadow camera frustum - kept tight since everything here happens
    // within roughly a 1-2m radius of the placed model.
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

    // Enable shadow rendering
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(renderer.domElement);

    const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"]
    });
    document.body.appendChild(arButton);
    startButton.style.display = "none";

    // Reticle = ring showing where a surface was detected
    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Invisible shadow-catcher plane. In AR there's no real geometry for
    // shadows to fall on, so this plane only renders the shadow itself
    // (ShadowMaterial is transparent everywhere else) onto the real floor.
    const shadowPlaneGeo = new THREE.PlaneGeometry(2, 2);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    shadowPlane.visible = false;
    shadowPlane.matrixAutoUpdate = false;
    scene.add(shadowPlane);

    // Load the first aid box model in the background.
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

    // Tap to place the first aid box model at the reticle position
    const controller = renderer.xr.getController(0);
    controller.addEventListener("select", () => {
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

        // Make every mesh in the model cast a shadow
        model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = false;
            }
        });

        scene.add(model);

        // Position the shadow-catcher plane at the same surface/height as
        // the placed model, and aim the directional light at it so the
        // shadow lands right under the box.
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

        show("🟢 First Aid Box placed!<br>Hit-test + rendering both work.");
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