export interface SimulationParams {
  innerRadius: number;
  outerRadius: number;
  blackHoleMass: number;    // solar mass scale driving singularity lensing
  lensingStrength: number; // multiplier for disk warping
  dopplerStrength: number;  // strength of Doppler boosting asymmetry
  rotationSpeed: number;    // accretion disk spinning speed
  diskBrightness: number;   // overall glow intensity
  gravitationalRedshift: boolean; // toggle redshift dimming near horizon
  activeTheme: 'classic-amber' | 'pulsar-blue' | 'singularity-red' | 'cosmic-purple';
  autoRotate: boolean;      // automatic camera orbiting
  autoRotateSpeed: number;  // speed of auto rotation
  starDensity: number;      // grid size multiplier of stars
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  timeDilation: number;     // uniform time-dilation multiplier near horizon
}

export const DEFAULT_PARAMS: SimulationParams = {
  innerRadius: 1.7,
  outerRadius: 7.0,
  blackHoleMass: 2.0,
  lensingStrength: 0.34,
  dopplerStrength: 0.0,
  rotationSpeed: 0.34,
  diskBrightness: 3.4,
  gravitationalRedshift: false,
  activeTheme: 'singularity-red',
  autoRotate: true,
  autoRotateSpeed: 0.07,
  starDensity: 150.0,
  bloomStrength: 0.5,
  bloomRadius: 0.34,
  bloomThreshold: 0.34,
  timeDilation: 0.34,
};
