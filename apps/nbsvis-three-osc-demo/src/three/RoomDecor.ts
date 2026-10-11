import * as THREE from 'three';

/** World-space layout shared with the keys (1 unit is roughly 2.3 cm). */
export const KEY_BOTTOM_Y = -0.3;
export const KEY_TOP_Y = 0.3;
const CASE_HEIGHT = 1.4;
const CASE_BOTTOM_Y = KEY_BOTTOM_Y - CASE_HEIGHT;
const TABLE_TOP_Y = CASE_BOTTOM_Y;
const TABLE_HEIGHT = 1.2;
const FLOOR_Y = -33;
const CEILING_Y = 60;
const ROOM_HALF = 85;

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  texture.anisotropy = 4;
  return texture;
}

function shadowed<T extends THREE.Mesh>(mesh: T, cast = true, receive = true): T {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
  mesh.position.set(x, y, z);
  return mesh;
}

/** Dark room with wooden floor, a night-time window, a rug, a table and a warm lamp. */
export function buildRoom(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x07080c);

  const roomHeight = CEILING_Y - FLOOR_Y;
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4458,
    roughness: 0.95,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_HALF * 2, roomHeight, ROOM_HALF * 2),
    wallMaterial,
  );
  shell.position.y = (CEILING_Y + FLOOR_Y) / 2;
  shell.receiveShadow = true;
  scene.add(shell);

  // Wooden floor
  const floorTexture = canvasTexture(
    512,
    512,
    (ctx) => {
      const planks = 8;
      for (let i = 0; i < planks; i++) {
        const shade = 70 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${shade + 45}, ${shade + 15}, ${shade - 15})`;
        ctx.fillRect(0, (i * 512) / planks, 512, 512 / planks);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, (i * 512) / planks, 512, 3);
        // plank end joints
        const joint = Math.random() * 512;
        ctx.fillRect(joint, (i * 512) / planks, 3, 512 / planks);
      }
    },
    [8, 8],
  );
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y + 0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  // Rug under the table
  const rug = new THREE.Mesh(
    new THREE.CylinderGeometry(42, 42, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: 0x7a2e3a, roughness: 1 }),
  );
  rug.position.set(0, FLOOR_Y + 0.07, 0);
  rug.receiveShadow = true;
  scene.add(rug);
  const rugRing = new THREE.Mesh(
    new THREE.TorusGeometry(36, 0.5, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xd9b26a, roughness: 1 }),
  );
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.set(0, FLOOR_Y + 0.15, 0);
  scene.add(rugRing);

  // Baseboard
  const baseboardMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2633, roughness: 0.8 });
  for (const [w, d, x, z] of [
    [ROOM_HALF * 2, 1, 0, -ROOM_HALF + 0.5],
    [ROOM_HALF * 2, 1, 0, ROOM_HALF - 0.5],
    [1, ROOM_HALF * 2, -ROOM_HALF + 0.5, 0],
    [1, ROOM_HALF * 2, ROOM_HALF - 0.5, 0],
  ] as const) {
    scene.add(box(w, 3, d, baseboardMaterial, x, FLOOR_Y + 1.5, z));
  }

  buildWindow(scene);
  buildTable(scene);
  buildLamp(scene);
}

function buildWindow(scene: THREE.Scene): void {
  const width = 46;
  const height = 34;
  const nightSky = canvasTexture(512, 384, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, '#04050f');
    g.addColorStop(0.6, '#10183a');
    g.addColorStop(1, '#3a2a5c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 384);
    for (let i = 0; i < 110; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`;
      const r = Math.random() < 0.1 ? 2 : 1;
      ctx.fillRect(Math.random() * 512, Math.random() * 300, r, r);
    }
    // moon
    ctx.fillStyle = '#f5f1d8';
    ctx.beginPath();
    ctx.arc(400, 80, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10183a';
    ctx.beginPath();
    ctx.arc(412, 74, 20, 0, Math.PI * 2);
    ctx.fill();
    // distant skyline
    ctx.fillStyle = '#0a0d1e';
    for (let x = 0; x < 512; x += 28) {
      const h = 40 + Math.random() * 90;
      ctx.fillRect(x, 384 - h, 24, h);
    }
  });

  const z = -ROOM_HALF + 0.2;
  const y = 14;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: nightSky, fog: false }),
  );
  glass.position.set(0, y, z);
  scene.add(glass);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6 });
  const t = 1.6;
  scene.add(box(width + t * 2, t, 1.4, frameMaterial, 0, y + height / 2 + t / 2, z + 0.5));
  scene.add(box(width + t * 2, t, 1.4, frameMaterial, 0, y - height / 2 - t / 2, z + 0.5));
  scene.add(box(t, height, 1.4, frameMaterial, -width / 2 - t / 2, y, z + 0.5));
  scene.add(box(t, height, 1.4, frameMaterial, width / 2 + t / 2, y, z + 0.5));
  scene.add(box(0.8, height, 1, frameMaterial, 0, y, z + 0.5));
  scene.add(box(width, 0.8, 1, frameMaterial, 0, y, z + 0.5));
}

function buildTable(scene: THREE.Scene): void {
  const topTexture = canvasTexture(
    512,
    256,
    (ctx) => {
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 70; i++) {
        ctx.strokeStyle = `rgba(${40 + Math.random() * 40}, 20, 5, ${0.12 + Math.random() * 0.2})`;
        ctx.lineWidth = 1 + Math.random() * 2;
        const y0 = Math.random() * 256;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(
          170,
          y0 + (Math.random() - 0.5) * 18,
          340,
          y0 + (Math.random() - 0.5) * 18,
          512,
          y0,
        );
        ctx.stroke();
      }
    },
    [2, 1],
  );
  const wood = new THREE.MeshStandardMaterial({ map: topTexture, roughness: 0.55 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3a1f, roughness: 0.7 });

  const width = 90;
  const depth = 36;
  const topCenterY = TABLE_TOP_Y - TABLE_HEIGHT / 2;
  scene.add(box(width, TABLE_HEIGHT, depth, wood, 0, topCenterY, 0));

  const legHeight = topCenterY - TABLE_HEIGHT / 2 - FLOOR_Y;
  const legY = FLOOR_Y + legHeight / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      scene.add(
        box(2.4, legHeight, 2.4, legMaterial, sx * (width / 2 - 3), legY, sz * (depth / 2 - 3)),
      );
    }
  }
  // apron under the table top
  scene.add(
    box(width - 6, 3, 1, legMaterial, 0, topCenterY - TABLE_HEIGHT / 2 - 1.5, -(depth / 2 - 3)),
  );
  scene.add(
    box(width - 6, 3, 1, legMaterial, 0, topCenterY - TABLE_HEIGHT / 2 - 1.5, depth / 2 - 3),
  );
}

function buildLamp(scene: THREE.Scene): void {
  const x = 62;
  const z = -50;
  const baseY = FLOOR_Y;
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d1d22, metalness: 0.6, roughness: 0.4 });
  scene.add(box(6, 0.6, 6, metal, x, baseY + 0.3, z));
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 46, 12), metal));
  pole.position.set(x, baseY + 23, z);
  scene.add(pole);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 7, 8, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xffd9a0,
      emissive: 0xffa84d,
      emissiveIntensity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  shade.position.set(x, baseY + 48, z);
  scene.add(shade);

  const light = new THREE.PointLight(0xffb066, 900, 160, 1.6);
  light.position.set(x, baseY + 47, z);
  scene.add(light);
}

/** Draws the sloped control panel: speaker grilles, display, buttons, slider and label. */
function panelTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 210;
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#1b1c21';
    ctx.fillRect(0, 0, w, h);

    // top silver trim
    const trim = ctx.createLinearGradient(0, 0, 0, 14);
    trim.addColorStop(0, '#c9ccd2');
    trim.addColorStop(1, '#7c8088');
    ctx.fillStyle = trim;
    ctx.fillRect(0, 0, w, 14);

    // speaker grilles at both ends
    const grille = (x0: number, x1: number) => {
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(x0, 34, x1 - x0, h - 60);
      ctx.fillStyle = '#34363d';
      for (let y = 46; y < h - 38; y += 13) {
        for (let x = x0 + 10; x < x1 - 8; x += 13) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    grille(40, 330);
    grille(w - 330, w - 40);

    // LCD
    const lcdX = w / 2 - 190;
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(lcdX - 8, 30, 396, 130);
    ctx.fillStyle = '#9db8a0';
    ctx.fillRect(lcdX, 38, 380, 114);
    ctx.fillStyle = '#26382a';
    ctx.font = 'bold 56px monospace';
    ctx.fillText('NBSVIS', lcdX + 24, 92);
    ctx.font = '26px monospace';
    ctx.fillText('♪ 120  001', lcdX + 24, 134);

    // buttons rows either side of the LCD
    const button = (x: number, y: number, color: string) => {
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(x - 2, y - 2, 52, 30);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 48, 26);
    };
    const colors = ['#d8d8dc', '#d8d8dc', '#d8d8dc', '#e04a4a', '#d8d8dc', '#4a8be0'];
    for (let i = 0; i < 6; i++) {
      button(380 + i * 66, 48, colors[i]);
      button(380 + i * 66, 104, '#9a9ca4');
      button(w - 380 - 48 - i * 66, 48, colors[(i + 2) % 6]);
      button(w - 380 - 48 - i * 66, 104, '#9a9ca4');
    }

    // master volume slider
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(w / 2 + 230, 70, 120, 14);
    ctx.fillStyle = '#d8d8dc';
    ctx.fillRect(w / 2 + 270, 58, 14, 38);

    // label
    ctx.fillStyle = '#c9ccd2';
    ctx.font = 'italic bold 30px sans-serif';
    ctx.fillText('NBSVIS  keyboard', 360, 190);

    // power LED
    ctx.fillStyle = '#3cff6a';
    ctx.beginPath();
    ctx.arc(w - 360, 190, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Casio-style plastic case: base under the keys, end caps, a sloped control panel behind the
 * keys. The keys themselves are built by `PianoScene` between the end caps.
 */
export function buildKeyboardCase(scene: THREE.Scene, keysHalfWidth: number): void {
  const plastic = new THREE.MeshStandardMaterial({
    color: 0x1b1c21,
    roughness: 0.45,
    metalness: 0.1,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.7 });

  const capWidth = 2.6;
  const outerHalf = keysHalfWidth + capWidth;
  const frontZ = 3.9; // slightly in front of the keys (key front edge is at z = 3.2)
  const backZ = -9.6;
  const depth = frontZ - backZ;
  const centerZ = (frontZ + backZ) / 2;

  // base the keys sit on
  scene.add(
    box(outerHalf * 2, CASE_HEIGHT, depth, plastic, 0, CASE_BOTTOM_Y + CASE_HEIGHT / 2, centerZ),
  );

  // end caps wrap the keys on both sides
  const capHeight = KEY_TOP_Y + 0.9 - KEY_BOTTOM_Y;
  for (const side of [-1, 1]) {
    scene.add(
      box(
        capWidth,
        capHeight,
        depth,
        plastic,
        side * (keysHalfWidth + capWidth / 2),
        KEY_BOTTOM_Y + capHeight / 2,
        centerZ,
      ),
    );
  }

  // thin silver strip along the front edge
  scene.add(
    box(outerHalf * 2, 0.18, 0.18, trim, 0, CASE_BOTTOM_Y + CASE_HEIGHT - 0.05, frontZ + 0.05),
  );

  // sloped control panel behind the keys
  const panelDepth = 6.4;
  const panelCenterZ = -3.2 - 0.3 - panelDepth / 2;
  const panel = new THREE.Group();
  panel.position.set(0, KEY_BOTTOM_Y + 0.4, panelCenterZ);
  panel.rotation.x = 0.26; // top surface tilts towards the player
  panel.add(box(outerHalf * 2, 1.3, panelDepth, plastic, 0, 0.35, 0));
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(outerHalf * 2 - 2, panelDepth - 0.8),
    new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.5 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.set(0, 1.01, 0);
  face.receiveShadow = true;
  panel.add(face);
  scene.add(panel);

  // rear section behind the panel so the case has a closed back
  scene.add(
    box(
      outerHalf * 2,
      capHeight + 1.2,
      Math.abs(backZ - (panelCenterZ - panelDepth / 2)) + 0.4,
      plastic,
      0,
      KEY_BOTTOM_Y + (capHeight + 1.2) / 2,
      (backZ + panelCenterZ - panelDepth / 2) / 2,
    ),
  );
}
