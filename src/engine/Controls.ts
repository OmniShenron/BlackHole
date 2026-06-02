import * as THREE from 'three';

export interface CameraControls {
  update: (delta: number) => void;
  dispose: () => void;
  resetIdleTimer: () => void;
  theta: number;
  phi: number;
  radius: number;
}

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  options: {
    minRadius?: number;
    maxRadius?: number;
    rotationSpeed?: number;
    zoomSpeed?: number;
    damping?: number;
    autoRotate?: boolean;
    autoRotateSpeed?: number;
  } = {}
): CameraControls {
  const minRadius = options.minRadius ?? 4.8;
  const maxRadius = options.maxRadius ?? 22.0;
  const rotationSpeed = options.rotationSpeed ?? 0.005;
  const zoomSpeed = options.zoomSpeed ?? 0.08;
  const damping = options.damping ?? 0.08;

  // Spherical state
  let targetTheta = 0.5; // horizontal angle
  let targetPhi = Math.PI / 2.0 - 0.12; // vertical angle (tilted down slightly)
  let targetRadius = 12.0; // camera zoom distance

  let currentTheta = targetTheta;
  let currentPhi = targetPhi;
  let currentRadius = targetRadius;

  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  let timeSinceLastInteraction = 0.0;

  function resetIdleTimer() {
    timeSinceLastInteraction = 0.0;
  }

  // Pointer event listeners
  function onPointerDown(e: PointerEvent) {
    // Only capture primary button clicks (left click)
    if (e.button !== 0) return;
    isDragging = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
    domElement.style.cursor = 'grabbing';
    resetIdleTimer();
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;

    targetTheta -= deltaX * rotationSpeed;
    targetPhi -= deltaY * rotationSpeed;

    // Prevent flipping the camera inside out (gimbal lock boundaries)
    const padding = 0.05;
    targetPhi = Math.max(padding, Math.min(Math.PI - padding, targetPhi));

    previousMousePosition = { x: e.clientX, y: e.clientY };
    resetIdleTimer();
  }

  function onPointerUp() {
    isDragging = false;
    domElement.style.cursor = 'grab';
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const zoomDelta = e.deltaY * zoomSpeed * 0.015;
    targetRadius += zoomDelta;
    targetRadius = Math.max(minRadius, Math.min(maxRadius, targetRadius));
    resetIdleTimer();
  }

  // Event bindings
  domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.style.cursor = 'grab';

  // Apply initial camera setup
  updateCameraPosition(currentTheta, currentPhi, currentRadius);

  function updateCameraPosition(t: number, p: number, r: number) {
    // Spherical to Cartesian coordinate transformation (Y-Up system)
    const x = r * Math.sin(p) * Math.sin(t);
    const y = r * Math.cos(p);
    const z = r * Math.sin(p) * Math.cos(t);

    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0); // Always stay locked onto central singularity
  }

  return {
    get theta() { return currentTheta; },
    get phi() { return currentPhi; },
    get radius() { return currentRadius; },
    resetIdleTimer,
    update: (delta: number) => {
      timeSinceLastInteraction += delta;

      // Handle passive rotation if camera is untouched by user
      const isAutoRotating = options.autoRotate && !isDragging;
      if (isAutoRotating) {
        const speed = options.autoRotateSpeed ?? 0.15;
        targetTheta += speed * delta;
      }

      // Smooth interpolation (dampened feedback)
      currentTheta += (targetTheta - currentTheta) * damping;
      currentPhi += (targetPhi - currentPhi) * damping;
      currentRadius += (targetRadius - currentRadius) * damping;

      // Subtle dynamic FOV expansion when zooming out reinforcing gravitational scale
      const baseFov = 35.0; // intimate focused perspective close to horizon
      const fovMax = 52.0;  // grand expanded lens scale looking from a distance
      const radiusRatio = (currentRadius - minRadius) / (maxRadius - minRadius);
      camera.fov = baseFov + radiusRatio * (fovMax - baseFov);
      camera.updateProjectionMatrix();

      updateCameraPosition(currentTheta, currentPhi, currentRadius);
    },
    dispose: () => {
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.style.cursor = 'auto';
    },
  };
}
