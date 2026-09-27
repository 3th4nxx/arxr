import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";
const video = document.getElementById("camera");
const canvas = document.getElementById("three");
const startButton = document.getElementById("start");
const statusElement = document.getElementById("status");
const messageElement = document.getElementById("message");
const submessageElement = document.getElementById("submessage");
const centerElement = document.getElementById("center");
const voiceElement = document.getElementById("voice");
const pinchElement = document.getElementById("pinch");
let stream = null;
let handLandmarker = null;
let lastVideoTime = -1;
let handResults = null;
let scene;
let camera;
let renderer;
let cube;
let floor;
let shadow;
let cubeSpawned = false;
let grabbing = false;
let pinchWasActive = false;
let handWorld = new THREE.Vector3();
let previousHandWorld = new THREE.Vector3();
let handVelocity = new THREE.Vector3();
let cubeVelocity = new THREE.Vector3();
let floorY = 0;
let recognition = null;
let listening = false;
const clock = new THREE.Clock();
function setStatus(text) {
    statusElement.textContent = text;
}
function setMessage(main, sub = "") {
    messageElement.textContent = main;
    submessageElement.textContent = sub;
}
function createScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.01,
        100
    );
    camera.position.set(0, 1.6, 3);
    renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 2);
    scene.add(hemi);
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(2, 4, 2);
    light.castShadow = true;
    scene.add(light);
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.ShadowMaterial({
        opacity: 0.25
    });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);
    const shadowGeometry = new THREE.CircleGeometry(.55, 48);
    const shadowMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: .2,
        depthWrite: false
    });
    shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = floorY + .006;
    shadow.visible = false;
    scene.add(shadow);
    window.addEventListener("resize", resize);
    animate();
}
function createCube() {
    if (cube) {
        scene.remove(cube);
    }
    const geometry = new THREE.BoxGeometry(.35, .35, .35);
    const materials = [
        new THREE.MeshStandardMaterial({ color: 0xff3b30 }),
        new THREE.MeshStandardMaterial({ color: 0xff9500 }),
        new THREE.MeshStandardMaterial({ color: 0xffcc00 }),
        new THREE.MeshStandardMaterial({ color: 0x34c759 }),
        new THREE.MeshStandardMaterial({ color: 0x007aff }),
        new THREE.MeshStandardMaterial({ color: 0xaf52de })
    ];
    cube = new THREE.Mesh(geometry, materials);
    cube.castShadow = true;
    cube.receiveShadow = true;
    cube.position.set(
        camera.position.x,
        floorY + .175,
        camera.position.z - 1.4
    );
    cube.rotation.set(0, 0, 0);
    scene.add(cube);
    cubeSpawned = true;
    shadow.position.x = cube.position.x;
    shadow.position.z = cube.position.z;
    shadow.visible = true;
    setMessage("Cube spawned", "Pinch it to grab");
    voiceElement.textContent = "✓ Cube active";
}
function setupVoiceRecognition() {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        voiceElement.textContent = "Voice unavailable";
        return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => {
        listening = true;
        voiceElement.textContent = "🎤 Listening...";
    };
    recognition.onend = () => {
        listening = false;
        if (stream) {
            try {
                recognition.start();
            } catch {}
        }
    };
    recognition.onerror = () => {
        listening = false;
    };
    recognition.onresult = event => {
        let transcript = "";
        for (
            let i = event.resultIndex;
            i < event.results.length;
            i++
        ) {
            transcript += event.results[i][0].transcript;
        }
        transcript = transcript.toLowerCase();
        if (
            transcript.includes("cube") ||
            transcript.includes("cub")
        ) {
            spawnCube();
        }
    };
}
function startVoice() {
    if (!recognition || listening) return;
    try {
        recognition.start();
    } catch {}
}
function spawnCube() {
    if (!scene) return;
    createCube();
    setTimeout(() => {
        centerElement.classList.add("hidden");
    }, 1200);
}
async function startCamera() {
    stream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: {
                ideal: "environment"
            },
            width: {
                ideal: 1280
            },
            height: {
                ideal: 720
            }
        },
        audio: false
    });
    video.srcObject = stream;
    await video.play();
    video.style.display = "block";
    setStatus("Scanning");
    setMessage("Scanning surroundings", "Move your phone slowly");
    await new Promise(resolve => {
        if (video.readyState >= 2) {
            resolve();
        } else {
            video.onloadeddata = resolve;
        }
    });
}
async function setupHandTracking() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(
        vision,
        {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: .5,
            minHandPresenceConfidence: .5,
            minTrackingConfidence: .5
        }
    );
}
function detectHands() {
    if (!handLandmarker || video.readyState < 2) {
        requestAnimationFrame(detectHands);
        return;
    }
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        handResults = handLandmarker.detectForVideo(
            video,
            performance.now()
        );
        processHands(handResults);
    }
    requestAnimationFrame(detectHands);
}
function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
    );
}
function isPinching(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const d = distance(thumb, index);
    return d < .055;
}
function handToWorld(landmarks) {
    const wrist = landmarks[0];
    const index = landmarks[8];
    const x =
        ((index.x + wrist.x) * .5 - .5) * 2;
    const y =
        ((index.y + wrist.y) * .5);
    const depth =
        THREE.MathUtils.clamp(
            1.0 - Math.abs(index.z) * 4,
            .4,
            2.5
        );
    const vertical =
        (0.5 - y) * 1.5;
    const horizontal =
        x * depth;
    const forward =
        -depth;
    return new THREE.Vector3(
        horizontal,
        floorY + Math.max(.15, vertical + .8),
        camera.position.z + forward
    );
}
function processHands(results) {
    if (
        !results ||
        !results.landmarks ||
        results.landmarks.length === 0
    ) {
        pinchElement.textContent = "🤏 Show your hand";
        return;
    }
    const landmarks = results.landmarks[0];
    const pinch = isPinching(landmarks);
    const newWorld = handToWorld(landmarks);
    handVelocity
        .copy(newWorld)
        .sub(previousHandWorld)
        .multiplyScalar(60);
    previousHandWorld.copy(newWorld);
    handWorld.copy(newWorld);
    if (!cube || !cubeSpawned) {
        pinchElement.textContent = pinch
            ? "🤏 Pinching"
            : "🤚 Hand detected";
        return;
    }
    const cubeDistance =
        cube.position.distanceTo(handWorld);
    if (
        pinch &&
        !grabbing &&
        cubeDistance < .75
    ) {
        grabbing = true;
        setStatus("Holding cube");
        pinchElement.textContent = "🤏 Holding";
        cubeVelocity.set(0, 0, 0);
    }
    if (!pinch && grabbing) {
        grabbing = false;
        cubeVelocity.copy(handVelocity);
        setStatus("Cube released");
        pinchElement.textContent = "🤚 Released";
    }
    if (grabbing) {
        moveCubeWithHand();
    }
    pinchWasActive = pinch;
}
function moveCubeWithHand() {
    const target = handWorld.clone();
    target.y = Math.max(
        floorY + .175,
        target.y
    );
    cube.position.lerp(
        target,
        .35
    );
    cube.rotation.x += .02;
    cube.rotation.y += .025;
    resolveHandCollision();
}
function resolveHandCollision() {
    if (!cube || !grabbing) return;
    const cubeRadius = .175;
    const palm = handWorld.clone();
    const difference =
        cube.position.clone().sub(palm);
    const distanceToPalm =
        difference.length();
    if (
        distanceToPalm < cubeRadius + .08 &&
        distanceToPalm > .0001
    ) {
        const normal =
            difference.normalize();
        cube.position.copy(
            palm.clone().add(
                normal.multiplyScalar(
                    cubeRadius + .08
                )
            )
        );
    }
}
function updatePhysics(delta) {
    if (!cube || grabbing) return;
    cubeVelocity.y -= 9.81 * delta;
    cube.position.addScaledVector(
        cubeVelocity,
        delta
    );
    const bottom =
        floorY + .175;
    if (cube.position.y < bottom) {
        cube.position.y = bottom;
        if (Math.abs(cubeVelocity.y) > .5) {
            cubeVelocity.y *= -.45;
        } else {
            cubeVelocity.y = 0;
        }
        cubeVelocity.x *= .92;
        cubeVelocity.z *= .92;
    }
    const maxDistance = 6;
    if (cube.position.length() > maxDistance) {
        cubeVelocity.multiplyScalar(.5);
    }
    cube.rotation.x +=
        cubeVelocity.z * delta;
    cube.rotation.z -=
        cubeVelocity.x * delta;
}
function updateShadow() {
    if (!cube || !shadow) return;
    shadow.position.x = cube.position.x;
    shadow.position.z = cube.position.z;
    const height =
        Math.max(
            0,
            cube.position.y - floorY
        );
    const scale =
        THREE.MathUtils.clamp(
            1.0 - height * .35,
            .35,
            1
        );
    shadow.scale.set(
        scale,
        scale,
        scale
    );
}
function animate() {
    requestAnimationFrame(animate);
    const delta =
        Math.min(clock.getDelta(), .033);
    updatePhysics(delta);
    updateShadow();
    if (renderer && scene && camera) {
        renderer.render(
            scene,
            camera
        );
    }
}
function resize() {
    if (!camera || !renderer) return;
    camera.aspect =
        window.innerWidth /
        window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );
}
async function startAR() {
    startButton.disabled = true;
    startButton.style.display = "none";
    try {
        setMessage(
            "Starting camera",
            "Allow camera access"
        );
        await startCamera();
        createScene();
        setStatus("Loading hand tracking");
        await setupHandTracking();
        setStatus("Ready");
        setMessage(
            "Say “cube”",
            "Scan the floor, then say cube"
        );
        centerElement.classList.remove("hidden");
        setupVoiceRecognition();
        startVoice();
        detectHands();
    } catch (error) {
        console.error(error);
        setStatus("Error");
        setMessage(
            "AR couldn't start",
            error.message || "Check camera permissions"
        );
        startButton.disabled = false;
        startButton.style.display = "block";
    }
}
startButton.addEventListener(
    "click",
    startAR
);
