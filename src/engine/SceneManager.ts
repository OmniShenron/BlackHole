import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { SimulationParams } from '../types';
import { createDiskGeometry } from './DiskGeometry';
import { createCameraControls, CameraControls } from './Controls';
import { DiskShader, PhotonRingShader, JetShader, StarfieldShader } from './Shaders';

export class BlackHoleSceneManager {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: CameraControls;
  
  // Post-processing
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  // Meshes (supporting double-lensed accretion disk splitting)
  private diskMesh!: THREE.Mesh;
  private diskMeshBottom!: THREE.Mesh;
  private photonRingMesh!: THREE.Mesh;
  private starfieldMesh!: THREE.Mesh;
  private jetMesh!: THREE.Mesh;
  private horizonMesh!: THREE.Mesh;

  // Materials
  private diskMaterial!: THREE.ShaderMaterial;
  private diskMaterialBottom!: THREE.ShaderMaterial;
  private photonRingMaterial!: THREE.ShaderMaterial;
  private starfieldMaterial!: THREE.ShaderMaterial;
  private jetMaterial!: THREE.ShaderMaterial;

  // Simulation state
  private params: SimulationParams;
  private animationFrameId: number | null = null;
  private lastTime = 0.0;
  private clock = new THREE.Clock();
  private blackHolePosition = new THREE.Vector3(0, 0, 0);

  // Camera motion velocity tracking states for orbital physical blur
  private prevCameraQuaternion = new THREE.Quaternion();
  private prevCameraPosition = new THREE.Vector3();
  private motionBlurStrength = 0.0;

  // Relativistic Doppler beaming and Gravitational Redshift lookup table texture
  private dopplerLUT!: THREE.DataTexture;

  constructor(container: HTMLElement, initialParams: SimulationParams) {
    this.container = container;
    this.params = { ...initialParams };

    this.initCore();
    this.initSceneObjects();
    this.initPostProcessing();
    this.initControls();

    // Start tick loop
    this.clock.start();
    this.lastTime = this.clock.getElapsedTime();
    this.animate();
  }

  /**
   * Initializes the core WebGL engine: renderer, scene, and camera settings.
   */
  private initCore() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // Direct WebGL Renderer initialization with ACES Filmic Tone Mapping and high contrast
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    
    // Attach to DOM
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Perspective Camera at focused field of view (FOV) for cinematic effect
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
  }

  /**
   * Creates the 3D meshes and binds the relational shader configurations.
   */
  private initSceneObjects() {
    // 0. Initialize Doppler / Redshift lookup texture
    this.initDopplerLUT();

    // 1. Relativistic Spin Loop swirling near the event horizon (dummy mesh - hidden)
    const jetGeom = new THREE.CylinderGeometry(1.0, 1.0, 32.0, 32, 64, true);
    this.jetMaterial = new THREE.ShaderMaterial({
      vertexShader: JetShader.vertexShader,
      fragmentShader: JetShader.fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uTime: { value: 0.0 },
        uTheme: { value: this.getThemeIndex(this.params.activeTheme) },
        uBlackHolePosition: { value: new THREE.Vector3() },
        cameraPosition: { value: new THREE.Vector3() },
        uLensingStrength: { value: this.params.lensingStrength },
        uDopplerStrength: { value: this.params.dopplerStrength },
      }
    });
    this.jetMesh = new THREE.Mesh(jetGeom, this.jetMaterial);
    this.jetMesh.visible = false;
    this.scene.add(this.jetMesh);

    // 2. High-Fidelity Raymarching 3D Sphere Geometry surrounding the system
    const diskGeom = new THREE.SphereGeometry(30.0, 32, 32);
    this.diskMaterial = new THREE.ShaderMaterial({
      vertexShader: DiskShader.vertexShader,
      fragmentShader: DiskShader.fragmentShader,
      side: THREE.BackSide, // Facing inner camera to capture complete ray sphere
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false, 
      depthTest: true,
      uniforms: {
        uTime: { value: 0.0 },
        cameraPosition: { value: new THREE.Vector3() },
        uInnerRadius: { value: this.params.innerRadius },
        uOuterRadius: { value: this.params.outerRadius },
        uLensingStrength: { value: this.params.lensingStrength },
        uDopplerStrength: { value: this.params.dopplerStrength },
        uRotationSpeed: { value: this.params.rotationSpeed },
        uDiskBrightness: { value: this.params.diskBrightness },
        uMotionBlur: { value: 0.0 },
        uLensedDirection: { value: 1.0 }, 
        uGravitationalRedshift: { value: this.params.gravitationalRedshift },
        uTheme: { value: this.getThemeIndex(this.params.activeTheme) },
        uBlackHolePosition: { value: new THREE.Vector3() },
        uStarDensity: { value: this.params.starDensity },
        uTimeDilation: { value: this.params.timeDilation ?? 1.0 },
        uViewMatrix: { value: new THREE.Matrix4() },
        uDopplerLUT: { value: this.dopplerLUT },
      }
    });

    this.diskMesh = new THREE.Mesh(diskGeom, this.diskMaterial);
    this.scene.add(this.diskMesh);

    // Clone materials to keep dummy meshes happy (all hidden to avoid overlapping)
    this.diskMaterialBottom = this.diskMaterial.clone();
    this.diskMaterialBottom.uniforms.uLensedDirection.value = -1.0; 
    this.diskMeshBottom = new THREE.Mesh(diskGeom, this.diskMaterialBottom);
    this.diskMeshBottom.visible = false;
    this.scene.add(this.diskMeshBottom);

    const photonRingGeom = createDiskGeometry(1.48, 1.58, 10, 180);
    this.photonRingMaterial = new THREE.ShaderMaterial({
      vertexShader: PhotonRingShader.vertexShader,
      fragmentShader: PhotonRingShader.fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uTime: { value: 0.0 },
        cameraPosition: { value: new THREE.Vector3() },
        uLensingStrength: { value: this.params.lensingStrength },
        uDopplerStrength: { value: this.params.dopplerStrength },
        uRotationSpeed: { value: this.params.rotationSpeed },
        uDiskBrightness: { value: this.params.diskBrightness },
        uTheme: { value: this.getThemeIndex(this.params.activeTheme) },
        uBlackHolePosition: { value: new THREE.Vector3() },
      }
    });

    this.photonRingMesh = new THREE.Mesh(photonRingGeom, this.photonRingMaterial);
    this.photonRingMesh.visible = false;
    this.scene.add(this.photonRingMesh);

    const skyboxGeom = new THREE.SphereGeometry(1.0, 4, 4);
    this.starfieldMaterial = new THREE.ShaderMaterial({
      vertexShader: StarfieldShader.vertexShader,
      fragmentShader: StarfieldShader.fragmentShader,
      side: THREE.BackSide, 
      depthWrite: false,
      depthTest: true,
      uniforms: {
        cameraPosition: { value: new THREE.Vector3() },
        uTime: { value: 0.0 },
        uLensingStrength: { value: this.params.lensingStrength },
        uStarDensity: { value: this.params.starDensity },
        uMotionBlur: { value: 0.0 },
        uBlackHolePosition: { value: new THREE.Vector3() },
        uTheme: { value: this.getThemeIndex(this.params.activeTheme) },
      }
    });

    this.starfieldMesh = new THREE.Mesh(skyboxGeom, this.starfieldMaterial);
    this.starfieldMesh.visible = false;
    this.scene.add(this.starfieldMesh);

    const horizonGeom = new THREE.SphereGeometry(1.0, 4, 4);
    const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.horizonMesh = new THREE.Mesh(horizonGeom, horizonMat);
    this.horizonMesh.visible = false;
    this.scene.add(this.horizonMesh);
  }

  /**
   * Initializes the Doppler beaming and Gravitational Redshift lookup texture (LUT).
   */
  private initDopplerLUT() {
    const size = 128;
    const data = new Float32Array(size * size * 4);
    this.dopplerLUT = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.dopplerLUT.minFilter = THREE.LinearFilter;
    this.dopplerLUT.magFilter = THREE.LinearFilter;
    this.dopplerLUT.wrapS = THREE.ClampToEdgeWrapping;
    this.dopplerLUT.wrapT = THREE.ClampToEdgeWrapping;
    this.updateDopplerLUT();
  }

  /**
   * Regenerates and updates the pre-compiled values of the Doppler beaming factor LUT.
   */
  private updateDopplerLUT() {
    const size = 128;
    const data = this.dopplerLUT.image.data as Float32Array;

    const rotationSpeed = this.params.rotationSpeed;
    const dopplerStrength = this.params.dopplerStrength;
    const gravitationalRedshift = this.params.gravitationalRedshift;
    const rs = 1.02;

    for (let y = 0; y < size; y++) {
      const v = y / (size - 1);
      // Map v from 0..1 to radial distances 1.0..30.0
      const d_int = 1.0 + v * 29.0;
      const beta = Math.min(0.85, Math.max(0.0, 0.68 * rotationSpeed / Math.sqrt(Math.max(0.1, d_int))));
      const gamma = 1.0 / Math.sqrt(Math.max(0.001, 1.0 - beta * beta * dopplerStrength * dopplerStrength));
      const gravFactor = gravitationalRedshift ? Math.sqrt(Math.max(0.0, 1.0 - rs / d_int)) : 1.0;

      for (let x = 0; x < size; x++) {
        const u = x / (size - 1);
        const dotVal = 2.0 * u - 1.0;
        const betaDotRay = dotVal * beta * dopplerStrength;
        const dopplerFactor = 1.0 / (gamma * (1.0 + betaDotRay));
        const totalShift = dopplerFactor * gravFactor;
        const beaming = Math.pow(totalShift, 5.0);

        const index = (y * size + x) * 4;
        data[index] = beaming;
        data[index + 1] = beaming;
        data[index + 2] = beaming;
        data[index + 3] = 1.0;
      }
    }
    this.dopplerLUT.needsUpdate = true;
  }

  /**
   * Initializes the cinematic bloom postprocessing filters.
   */
  private initPostProcessing() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.composer = new EffectComposer(this.renderer);
    
    // Regular scene rendering
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Unreal Bloom Pass for beautiful thermal and photon emissions
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.params.bloomStrength,
      this.params.bloomRadius,
      this.params.bloomThreshold
    );
    this.composer.addPass(this.bloomPass);
  }

  /**
   * Binds user orbital input events.
   */
  private initControls() {
    this.controls = createCameraControls(this.camera, this.renderer.domElement, {
      autoRotate: this.params.autoRotate,
      autoRotateSpeed: this.params.autoRotateSpeed,
    });
    // Set initial tracking state to avoid rotational velocity spikes on first frame
    this.prevCameraQuaternion.copy(this.camera.quaternion);
    this.prevCameraPosition.copy(this.camera.position);
  }

  /**
   * Translates theme string aliases into index descriptors.
   */
  private getThemeIndex(theme: string): number {
    switch (theme) {
      case 'classic-amber': return 0;
      case 'pulsar-blue': return 1;
      case 'singularity-red': return 2;
      case 'cosmic-purple': return 3;
      default: return 0;
    }
  }

  /**
   * Updates state parameters smoothly.
   */
  public setParams(newParams: SimulationParams) {
    this.params = { ...newParams };

    // Regenerate Doppler beaming and Gravitational Redshift lookup table texture
    this.updateDopplerLUT();

    // Update controls settings
    this.controls.dispose();
    this.controls = createCameraControls(this.camera, this.renderer.domElement, {
      autoRotate: this.params.autoRotate,
      autoRotateSpeed: this.params.autoRotateSpeed,
    });
    this.prevCameraQuaternion.copy(this.camera.quaternion);
    this.prevCameraPosition.copy(this.camera.position);

    // Update material uniforms directly
    const themeIndex = this.getThemeIndex(this.params.activeTheme);
    
    // Sync Top Accretion Disk Shader uniforms
    this.diskMaterial.uniforms.uLensingStrength.value = this.params.lensingStrength;
    this.diskMaterial.uniforms.uDopplerStrength.value = this.params.dopplerStrength;
    this.diskMaterial.uniforms.uRotationSpeed.value = this.params.rotationSpeed;
    this.diskMaterial.uniforms.uDiskBrightness.value = this.params.diskBrightness;
    this.diskMaterial.uniforms.uGravitationalRedshift.value = this.params.gravitationalRedshift;
    this.diskMaterial.uniforms.uTheme.value = themeIndex;
    this.diskMaterial.uniforms.uStarDensity.value = this.params.starDensity;
    this.diskMaterial.uniforms.uInnerRadius.value = this.params.innerRadius;
    this.diskMaterial.uniforms.uOuterRadius.value = this.params.outerRadius;
    this.diskMaterial.uniforms.uTimeDilation.value = this.params.timeDilation ?? 1.0;

    // Sync Bottom Accretion Disk Shader uniforms
    this.diskMaterialBottom.uniforms.uLensingStrength.value = this.params.lensingStrength;
    this.diskMaterialBottom.uniforms.uDopplerStrength.value = this.params.dopplerStrength;
    this.diskMaterialBottom.uniforms.uRotationSpeed.value = this.params.rotationSpeed;
    this.diskMaterialBottom.uniforms.uDiskBrightness.value = this.params.diskBrightness;
    this.diskMaterialBottom.uniforms.uGravitationalRedshift.value = this.params.gravitationalRedshift;
    this.diskMaterialBottom.uniforms.uTheme.value = themeIndex;
    this.diskMaterialBottom.uniforms.uInnerRadius.value = this.params.innerRadius;
    this.diskMaterialBottom.uniforms.uOuterRadius.value = this.params.outerRadius;
    this.diskMaterialBottom.uniforms.uTimeDilation.value = this.params.timeDilation ?? 1.0;

    // Sync Photon Ring uniforms
    this.photonRingMaterial.uniforms.uLensingStrength.value = this.params.lensingStrength;
    this.photonRingMaterial.uniforms.uDopplerStrength.value = this.params.dopplerStrength;
    this.photonRingMaterial.uniforms.uRotationSpeed.value = this.params.rotationSpeed;
    this.photonRingMaterial.uniforms.uDiskBrightness.value = this.params.diskBrightness;
    this.photonRingMaterial.uniforms.uTheme.value = themeIndex;

    // Sync Starfield uniforms
    this.starfieldMaterial.uniforms.uLensingStrength.value = this.params.lensingStrength;
    this.starfieldMaterial.uniforms.uStarDensity.value = this.params.starDensity;
    this.starfieldMaterial.uniforms.uTheme.value = themeIndex;

    // Sync Jet / Feeding stream uniforms
    this.jetMaterial.uniforms.uTheme.value = themeIndex;
    this.jetMaterial.uniforms.uLensingStrength.value = this.params.lensingStrength;
    this.jetMaterial.uniforms.uDopplerStrength.value = this.params.dopplerStrength;

    this.bloomPass.strength = this.params.bloomStrength;
    this.bloomPass.radius = this.params.bloomRadius;
    this.bloomPass.threshold = this.params.bloomThreshold;
  }

  /**
   * Resizes viewport adaptively.
   */
  public resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  /**
   * Animation Frame Trigger recursion loop.
   */
  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const time = this.clock.getElapsedTime();
    const delta = Math.min(time - this.lastTime, 0.1); // Clamp huge stutters
    this.lastTime = time;

    // Update kinetic orbital controls
    this.controls.update(delta);

    // Explicitly update camera matrices to guarantee correct 100% synchronized View-Matrix Inverse values
    this.camera.updateMatrixWorld();

    // Track linear camera translation speed (zoom/translation velocity tracking)
    const currentCamPos = this.camera.position;
    const translationSpeed = currentCamPos.distanceTo(this.prevCameraPosition) / (delta || 0.016);
    this.prevCameraPosition.copy(currentCamPos);

    // Track relative angular camera velocity to compute dynamic motion blur
    const deltaQ = new THREE.Quaternion().copy(this.camera.quaternion).multiply(this.prevCameraQuaternion.clone().invert());
    // Find quaternion angular difference (W component represents cosine of half the rotation angle)
    const angleDiff = 2.0 * Math.acos(Math.min(1.0, Math.max(-1.0, deltaQ.w)));
    const rotationSpeed = angleDiff / (delta || 0.016);
    
    // Total velocity combines rotation and linear translation velocities represent a true relativistic camera motion
    const cameraSpeed = rotationSpeed * 0.5 + translationSpeed * 0.03;
    
    // Scale and damp the visual motion blur value (lag slightly so it decays organically)
    const targetBlur = Math.min(1.5, cameraSpeed * 0.45);
    this.motionBlurStrength += (targetBlur - this.motionBlurStrength) * 0.22;
    this.prevCameraQuaternion.copy(this.camera.quaternion);

    // Sync camera reference uniform parameters
    const camPos = this.camera.position;
    this.diskMaterial.uniforms.cameraPosition.value.copy(camPos);
    this.diskMaterialBottom.uniforms.cameraPosition.value.copy(camPos);
    this.photonRingMaterial.uniforms.cameraPosition.value.copy(camPos);
    this.starfieldMaterial.uniforms.cameraPosition.value.copy(camPos);
    this.jetMaterial.uniforms.cameraPosition.value.copy(camPos);

    // Sync dynamic view position matrix for lensed parallax calculations
    this.diskMaterial.uniforms.uViewMatrix.value.copy(this.camera.matrixWorldInverse);
    this.diskMaterialBottom.uniforms.uViewMatrix.value.copy(this.camera.matrixWorldInverse);

    // Sync motion blur parameters
    this.diskMaterial.uniforms.uMotionBlur.value = this.motionBlurStrength;
    this.diskMaterialBottom.uniforms.uMotionBlur.value = this.motionBlurStrength;
    this.starfieldMaterial.uniforms.uMotionBlur.value = this.motionBlurStrength;

    // Center position locked at the origin for perfect centered layout
    this.blackHolePosition.set(0, 0, 0);

    // Keep meshes and uniforms pinned to the origin
    this.diskMesh.position.copy(this.blackHolePosition);
    this.diskMeshBottom.position.copy(this.blackHolePosition);
    this.photonRingMesh.position.copy(this.blackHolePosition);
    this.jetMesh.position.copy(this.blackHolePosition);
    this.horizonMesh.position.copy(this.blackHolePosition);

    this.diskMaterial.uniforms.uBlackHolePosition.value.copy(this.blackHolePosition);
    this.diskMaterialBottom.uniforms.uBlackHolePosition.value.copy(this.blackHolePosition);
    this.photonRingMaterial.uniforms.uBlackHolePosition.value.copy(this.blackHolePosition);
    this.starfieldMaterial.uniforms.uBlackHolePosition.value.copy(this.blackHolePosition);
    this.jetMaterial.uniforms.uBlackHolePosition.value.copy(this.blackHolePosition);

    // Sync time indexes
    this.diskMaterial.uniforms.uTime.value = time;
    this.diskMaterialBottom.uniforms.uTime.value = time;
    this.photonRingMaterial.uniforms.uTime.value = time;
    this.starfieldMaterial.uniforms.uTime.value = time;
    this.jetMaterial.uniforms.uTime.value = time;

    // Center starfield skybox perfectly onto camera to prevent panning boundaries leak
    this.starfieldMesh.position.copy(camPos);

    // Render composited frame with active postprocessing (Bloom)
    this.composer.render();
  };

  /**
   * Resets the controllers' idle state on click/interaction.
   */
  public resetControlsTimer() {
    this.controls?.resetIdleTimer();
  }

  /**
   * Cleans up CPU and GPU memories to avoid leaks upon unmounting.
   */
  public dispose() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.controls.dispose();

    // Traverse and dispose geometries and materials
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    // Clean up post-processing targets
    this.composer.dispose();
    this.renderer.dispose();

    // Remove canvas element from container DOM
    this.container.innerHTML = '';
  }
}
