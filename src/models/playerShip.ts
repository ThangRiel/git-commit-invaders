import * as THREE from 'three';

export interface PlayerShipRig {
  group: THREE.Group;
  hullPivot: THREE.Group;
  leftFlame: THREE.Mesh;
  rightFlame: THREE.Mesh;
  muzzleGlow: THREE.Mesh;
  shieldRing: THREE.Mesh;
  contactShadow: THREE.Mesh;
  dispose: () => void;
}

export function createPlayerShip(
  _isSoftwareGl: boolean,
  contactShadowTexture: THREE.CanvasTexture
): PlayerShipRig {
  const group = new THREE.Group();
  const hullPivot = new THREE.Group();
  hullPivot.position.y = 0.65;
  group.add(hullPivot);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // Materials with clear roughness & metalness contrast (>= 0.25 roughness delta)
  const primaryArmorMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    metalness: 0.82,
    roughness: 0.22,
  });
  const darkFrameMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.45,
    roughness: 0.58,
  });
  const trimAccentMat = new THREE.MeshStandardMaterial({
    color: 0x93c5fd,
    metalness: 0.9,
    roughness: 0.18,
  });
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    metalness: 0.18,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.78,
  });
  const cannonMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.92,
    roughness: 0.16,
  });
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const muzzleMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  materials.push(
    primaryArmorMat,
    darkFrameMat,
    trimAccentMat,
    canopyMat,
    cannonMat,
    flameMat,
    muzzleMat
  );

  // 1. Primary Silhouette: Swept beveled central fuselage
  const fuselageShape = new THREE.Shape();
  fuselageShape.moveTo(0, -1.65);
  fuselageShape.lineTo(0.42, -0.35);
  fuselageShape.lineTo(0.55, 0.95);
  fuselageShape.lineTo(0.24, 1.32);
  fuselageShape.lineTo(-0.24, 1.32);
  fuselageShape.lineTo(-0.55, 0.95);
  fuselageShape.lineTo(-0.42, -0.35);
  fuselageShape.closePath();

  const fuselageGeo = new THREE.ExtrudeGeometry(fuselageShape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.07,
    bevelSegments: 2,
  });
  fuselageGeo.rotateX(Math.PI / 2);
  fuselageGeo.translate(0, 0.18, 0);
  geometries.push(fuselageGeo);

  const fuselageMesh = new THREE.Mesh(fuselageGeo, primaryArmorMat);
  hullPivot.add(fuselageMesh);

  // 2. Secondary Read: Twin swept delta wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.32, -0.15);
  wingShape.lineTo(1.85, 0.72);
  wingShape.lineTo(1.92, 1.15);
  wingShape.lineTo(0.45, 0.92);
  wingShape.closePath();

  const rightWingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  rightWingGeo.rotateX(Math.PI / 2);
  rightWingGeo.translate(0, 0.04, 0);
  geometries.push(rightWingGeo);

  const rightWing = new THREE.Mesh(rightWingGeo, darkFrameMat);
  hullPivot.add(rightWing);

  const leftWing = new THREE.Mesh(rightWingGeo, darkFrameMat);
  leftWing.scale.x = -1;
  hullPivot.add(leftWing);

  // 3. Wingtip stabilizer fins
  const finGeo = new THREE.BoxGeometry(0.1, 0.36, 0.62);
  geometries.push(finGeo);

  const rightFin = new THREE.Mesh(finGeo, trimAccentMat);
  rightFin.position.set(1.86, 0.14, 0.92);
  rightFin.rotation.z = -0.22;
  hullPivot.add(rightFin);

  const leftFin = new THREE.Mesh(finGeo, trimAccentMat);
  leftFin.position.set(-1.86, 0.14, 0.92);
  leftFin.rotation.z = 0.22;
  hullPivot.add(leftFin);

  // 4. Sculpted Sapphire Glass Cockpit Canopy
  const canopyGeo = new THREE.CapsuleGeometry(0.24, 0.56, 6, 12);
  canopyGeo.rotateX(Math.PI / 2);
  canopyGeo.scale(1.0, 0.72, 1.15);
  geometries.push(canopyGeo);

  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.31, -0.18);
  hullPivot.add(canopy);

  // 5. Dorsal intake spine
  const spineGeo = new THREE.BoxGeometry(0.18, 0.22, 0.85);
  geometries.push(spineGeo);
  const spine = new THREE.Mesh(spineGeo, darkFrameMat);
  spine.position.set(0, 0.28, 0.68);
  hullPivot.add(spine);

  // 6. Twin forward plasma cannons
  const cannonGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.95, 10);
  cannonGeo.rotateX(Math.PI / 2);
  geometries.push(cannonGeo);

  const leftCannon = new THREE.Mesh(cannonGeo, cannonMat);
  leftCannon.position.set(-0.92, 0.03, 0.18);
  hullPivot.add(leftCannon);

  const rightCannon = new THREE.Mesh(cannonGeo, cannonMat);
  rightCannon.position.set(0.92, 0.03, 0.18);
  hullPivot.add(rightCannon);

  // 7. Nose laser emitter core
  const noseGeo = new THREE.ConeGeometry(0.12, 0.45, 8);
  noseGeo.rotateX(-Math.PI / 2);
  geometries.push(noseGeo);
  const noseEmitter = new THREE.Mesh(noseGeo, trimAccentMat);
  noseEmitter.position.set(0, 0.05, -1.78);
  hullPivot.add(noseEmitter);

  // 8. Dual LatheGeometry thruster nozzles
  const nozzlePoints = [
    new THREE.Vector2(0.11, 0),
    new THREE.Vector2(0.17, 0.12),
    new THREE.Vector2(0.15, 0.34),
    new THREE.Vector2(0.19, 0.42),
  ];
  const nozzleGeo = new THREE.LatheGeometry(nozzlePoints, 12);
  nozzleGeo.rotateX(Math.PI / 2);
  geometries.push(nozzleGeo);

  const leftNozzle = new THREE.Mesh(nozzleGeo, darkFrameMat);
  leftNozzle.position.set(-0.26, 0.06, 1.24);
  hullPivot.add(leftNozzle);

  const rightNozzle = new THREE.Mesh(nozzleGeo, darkFrameMat);
  rightNozzle.position.set(0.26, 0.06, 1.24);
  hullPivot.add(rightNozzle);

  // 9. Animated thruster flames
  const flameGeo = new THREE.ConeGeometry(0.14, 0.85, 10);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.42);
  geometries.push(flameGeo);

  const leftFlame = new THREE.Mesh(flameGeo, flameMat);
  leftFlame.position.set(-0.26, 0.06, 1.62);
  hullPivot.add(leftFlame);

  const rightFlame = new THREE.Mesh(flameGeo, flameMat);
  rightFlame.position.set(0.26, 0.06, 1.62);
  hullPivot.add(rightFlame);

  // 10. Muzzle flash halo
  const muzzleGeo = new THREE.SphereGeometry(0.32, 10, 10);
  geometries.push(muzzleGeo);
  const muzzleGlow = new THREE.Mesh(muzzleGeo, muzzleMat);
  muzzleGlow.position.set(0, 0.06, -1.95);
  hullPivot.add(muzzleGlow);

  // 11. Plasma Shield Ring (visible when Shield upgrade is active)
  const shieldGeo = new THREE.TorusGeometry(2.25, 0.065, 10, 42);
  shieldGeo.rotateX(Math.PI / 2);
  geometries.push(shieldGeo);
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  materials.push(shieldMat);
  const shieldRing = new THREE.Mesh(shieldGeo, shieldMat);
  shieldRing.position.set(0, 0.72, 0.05);
  shieldRing.visible = false;
  group.add(shieldRing);

  // 12. Grounded contact shadow directly beneath the ship
  const shadowGeo = new THREE.PlaneGeometry(4.4, 3.8);
  shadowGeo.rotateX(-Math.PI / 2);
  geometries.push(shadowGeo);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  materials.push(shadowMat);

  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.set(0, 0.03, 0.1);
  group.add(contactShadow);

  return {
    group,
    hullPivot,
    leftFlame,
    rightFlame,
    muzzleGlow,
    shieldRing,
    contactShadow,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
