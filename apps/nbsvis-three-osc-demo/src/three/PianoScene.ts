import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { getWhiteKeyIndex, isBlackKey, MIDI_END, MIDI_START } from './PianoLayout';
import { buildKeyboardCase, buildRoom } from './RoomDecor';

type KeyMeta = {
  midi: number;
  baseColor: number;
  baseY: number;
  x: number;
  z: number;
  topY: number;
  width: number;
};

const MAX_FALLING_NOTES = 8192;
const FALLING_BLOCK_HEIGHT = 0.7;
const ORBIT_RESUME_MS = 4000;

function keyHue(midi: number): number {
  return ((midi - MIDI_START) / (MIDI_END - MIDI_START)) % 1;
}

export type CameraState = {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  fpsMode: boolean;
};

export class PianoScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly keyMeshes = new Map<number, THREE.Mesh>();
  private readonly clock = new THREE.Clock();
  private readonly keyState = new Set<string>();
  private readonly controls: OrbitControls;
  private fallingMesh!: THREE.InstancedMesh;
  private fallingCount = 0;
  private readonly fallingDummy = new THREE.Object3D();
  private readonly fallingColor = new THREE.Color();
  private orbitResumeTimer: number | undefined;
  private frameId: number | undefined;
  private fpsMode = false;
  private yaw = 2.266;
  private pitch = -0.8762;

  public constructor(private readonly container: HTMLElement) {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    buildRoom(this.scene);
    this.scene.add(new THREE.HemisphereLight(0x8a93c8, 0x2a1a14, 0.55));
    // cool "moonlight" fill from the window, plus a key light that casts the shadows
    const dir = new THREE.DirectionalLight(0xfff1dc, 1.4);
    dir.position.set(18, 42, 30);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -40;
    dir.shadow.camera.right = 40;
    dir.shadow.camera.top = 30;
    dir.shadow.camera.bottom = -30;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 140;
    dir.shadow.bias = -0.0004;
    this.scene.add(dir);

    this.camera.position.set(0, 20, 38);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Slowly orbit the piano; dragging takes over, and auto-orbit resumes when idle.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, -1);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 70;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.addEventListener('start', this.pauseOrbit);
    this.controls.addEventListener('end', this.scheduleOrbitResume);
    this.controls.update();

    this.buildPiano();
    this.buildFallingNotes();
    this.bindFpsInput();
    this.animate();
  }

  private buildFallingNotes(): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
    });
    this.fallingMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material,
      MAX_FALLING_NOTES,
    );
    this.fallingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fallingMesh.frustumCulled = false;
    this.fallingMesh.count = 0;
    // Allocate the per-instance colour buffer up front.
    this.fallingMesh.setColorAt(0, this.fallingColor.setHex(0xffffff));
    this.scene.add(this.fallingMesh);
  }

  /** Starts a new frame of falling notes; call `addFallingNote` then `endFallingNotes`. */
  public beginFallingNotes(): void {
    this.fallingCount = 0;
  }

  /** `heightAboveKey` is the distance above the key's top surface (world units, >= 0). */
  public addFallingNote(midi: number, heightAboveKey: number, velocity: number): void {
    if (this.fallingCount >= MAX_FALLING_NOTES) return;
    const key = this.keyMeshes.get(midi);
    if (!key) return;
    const meta = key.userData as KeyMeta;

    const dummy = this.fallingDummy;
    dummy.position.set(meta.x, meta.topY + FALLING_BLOCK_HEIGHT / 2 + heightAboveKey, meta.z);
    dummy.scale.set(meta.width * 0.9, FALLING_BLOCK_HEIGHT, meta.width * 0.9);
    dummy.updateMatrix();

    const i = this.fallingCount++;
    this.fallingMesh.setMatrixAt(i, dummy.matrix);
    const v = Math.max(0, Math.min(1, velocity));
    this.fallingMesh.setColorAt(i, this.fallingColor.setHSL(keyHue(midi), 0.9, 0.35 + v * 0.3));
  }

  public endFallingNotes(): void {
    this.fallingMesh.count = this.fallingCount;
    this.fallingMesh.instanceMatrix.needsUpdate = true;
    if (this.fallingMesh.instanceColor) this.fallingMesh.instanceColor.needsUpdate = true;
  }

  private pauseOrbit = (): void => {
    this.controls.autoRotate = false;
    if (this.orbitResumeTimer !== undefined) {
      window.clearTimeout(this.orbitResumeTimer);
      this.orbitResumeTimer = undefined;
    }
  };

  private scheduleOrbitResume = (): void => {
    this.orbitResumeTimer = window.setTimeout(() => {
      if (!this.fpsMode) this.controls.autoRotate = true;
      this.orbitResumeTimer = undefined;
    }, ORBIT_RESUME_MS);
  };

  private buildPiano(): void {
    const whiteWidth = 1;
    const whiteHeight = 0.6;
    const whiteDepth = 6.4;
    const blackWidth = 0.62;
    const blackHeight = 0.9;
    const blackDepth = 4.1;

    const whiteCount = 52;
    const span = (whiteCount - 1) * whiteWidth;
    const centerOffset = span / 2;

    buildKeyboardCase(this.scene, centerOffset + whiteWidth / 2);

    for (let midi = MIDI_START; midi <= MIDI_END; midi++) {
      if (isBlackKey(midi)) {
        continue;
      }

      const whiteIndex = getWhiteKeyIndex(midi);
      const x = whiteIndex * whiteWidth - centerOffset;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(whiteWidth * 0.94, whiteHeight, whiteDepth),
        new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.45, metalness: 0.02 }),
      );
      mesh.position.set(x, 0, 0);
      mesh.userData = {
        midi,
        baseColor: 0xf4f1e6,
        baseY: 0,
        x,
        z: 0,
        topY: whiteHeight / 2,
        width: whiteWidth,
      } satisfies KeyMeta;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.keyMeshes.set(midi, mesh);
      this.scene.add(mesh);
    }

    for (let midi = MIDI_START; midi <= MIDI_END; midi++) {
      if (!isBlackKey(midi)) {
        continue;
      }

      const leftWhite = getWhiteKeyIndex(midi) - 1;
      const x = leftWhite * whiteWidth - centerOffset + whiteWidth * 0.67;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(blackWidth, blackHeight, blackDepth),
        new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.3 }),
      );
      mesh.position.set(x, 0.25, -0.9);
      mesh.userData = {
        midi,
        baseColor: 0x101214,
        baseY: 0.25,
        x,
        z: -0.9,
        topY: 0.25 + blackHeight / 2,
        width: blackWidth,
      } satisfies KeyMeta;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.keyMeshes.set(midi, mesh);
      this.scene.add(mesh);
    }
  }

  public setKeyActive(midi: number, active: boolean, velocity = 1): void {
    const mesh = this.keyMeshes.get(midi);
    if (!mesh) return;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    const meta = mesh.userData as KeyMeta;
    const baseColor = meta.baseColor;
    const pressDepth = baseColor === 0x101214 ? 0.06 : 0.08;
    if (active) {
      const clampedVelocity = Math.max(0, Math.min(1, velocity));
      const hue = keyHue(midi);
      const saturation = 0.85;
      const lightness = 0.45 + clampedVelocity * 0.2;
      const emissiveStrength = 0.08 + clampedVelocity * 0.22;
      mat.color.setHSL(hue, saturation, lightness);
      mat.emissive.setHSL(hue, 0.9, emissiveStrength);
    } else {
      mat.color.setHex(baseColor);
      mat.emissive.setHex(0x000000);
    }
    mesh.position.y = meta.baseY - (active ? pressDepth : 0);
  }

  public pickMidiAt(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(Array.from(this.keyMeshes.values()), false);
    if (!hits.length) return null;
    const top = hits[0].object as THREE.Mesh;
    return (top.userData as KeyMeta).midi ?? null;
  }

  public resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  public toggleFpsMode(): boolean {
    this.fpsMode = !this.fpsMode;
    this.controls.enabled = !this.fpsMode;
    if (this.fpsMode) {
      this.controls.autoRotate = false;
      this.renderer.domElement.requestPointerLock();
    } else if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    return this.fpsMode;
  }

  public isFpsModeEnabled(): boolean {
    return this.fpsMode;
  }

  public getCameraState(): CameraState {
    return {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
      yaw: this.yaw,
      pitch: this.pitch,
      fpsMode: this.fpsMode,
    };
  }

  private bindFpsInput(): void {
    document.addEventListener('pointerlockchange', () => {
      this.fpsMode = document.pointerLockElement === this.renderer.domElement;
      this.controls.enabled = !this.fpsMode;
      if (!this.fpsMode) {
        this.keyState.clear();
        // hand the camera back to orbit controls from where free-fly left it
        this.controls.autoRotate = true;
        this.controls.update();
      }
    });

    window.addEventListener('keydown', (event) => {
      this.keyState.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.keyState.delete(event.code);
    });

    window.addEventListener('mousemove', (event) => {
      if (!this.fpsMode) return;
      const lookSpeed = 0.0022;
      this.yaw -= event.movementX * lookSpeed;
      this.pitch -= event.movementY * lookSpeed;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
      this.updateCameraDirection();
    });
  }

  private updateCameraDirection(): void {
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  private updateFpsMovement(deltaSeconds: number): void {
    if (!this.fpsMode) return;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (this.keyState.has('KeyW')) move.add(forward);
    if (this.keyState.has('KeyS')) move.sub(forward);
    if (this.keyState.has('KeyD')) move.add(right);
    if (this.keyState.has('KeyA')) move.sub(right);
    if (this.keyState.has('Space')) move.y += 1;
    if (this.keyState.has('ShiftLeft') || this.keyState.has('ShiftRight')) move.y -= 1;
    if (move.lengthSq() === 0) return;
    const speed = 12;
    move.normalize().multiplyScalar(speed * deltaSeconds);
    this.camera.position.add(move);
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.updateFpsMovement(dt);
    if (!this.fpsMode) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  public destroy(): void {
    if (this.frameId !== undefined) {
      cancelAnimationFrame(this.frameId);
    }
    if (this.orbitResumeTimer !== undefined) window.clearTimeout(this.orbitResumeTimer);
    this.controls.dispose();
    this.fallingMesh.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
