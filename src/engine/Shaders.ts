/**
 * Custom GLSL Shader code for high-fidelity relativistic black hole visualization.
 * Incorporates Dave Hoskins stable hashing, perfect continuous angular coordinate wraps,
 * and seamless physical blending of lensing curves via a single-pass Schwarzschild raytracer.
 */

// Dave Hoskins stable hash functions for procedural gas noise and celestial alignments
const NOISE_GLSL = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D Value Noise with stable hash
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
             mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

// Optimized 2-Octave Fractional Brownian Motion (FBM)
float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(0.877584, 0.479426, -0.479426, 0.877584);
  v += a * noise(p);
  p = rot * p * 2.0 + shift;
  a *= 0.5;
  v += a * noise(p);
  return v;
}

// Optimized 3-Octave Fractional Brownian Motion (FBM)
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(0.877584, 0.479426, -0.479426, 0.877584);
  v += a * noise(p);
  p = rot * p * 2.0 + shift;
  a *= 0.5;
  v += a * noise(p);
  p = rot * p * 2.0 + shift;
  a *= 0.5;
  v += a * noise(p);
  return v;
}

// Optimized 4-Octave Fractional Brownian Motion (FBM) with precalculated rotation matrix
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(0.877584, 0.479426, -0.479426, 0.877584);
  v += a * noise(p);
  p = rot * p * 2.0 + shift;
  a *= 0.5;
  v += a * noise(p);
  p = rot * p * 2.0 + shift;
  a *= 0.5;
  v += a * noise(p);
  p = rot * p * 2.0 + shift;
  a *= 0.5;
  v += a * noise(p);
  return v;
}

// Stable 3D Hash for celestial twinkling
float hash3D(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Depth-based jitter function to prevent moiré patterns during zoom and establish a 3D volume feeling
vec3 getDepthJitter(vec3 gridCell, float depthParam) {
  float j = hash3D(gridCell + vec3(4.11, 7.89, 9.33));
  return (vec3(j, fract(j * 17.0), fract(j * 43.1)) - 0.5) * 0.12 * sin(depthParam * 2.5 + j * 6.28);
}

// 2D curl noise vector field for realistic fluid dynamics
vec2 curlNoise(vec2 p) {
  const float e = 0.08;
  // Curl gradient evaluated via lightweight 2-octave FBM for immense performance gains
  float dx = (fbm2(p + vec2(e, 0.0)) - fbm2(p - vec2(e, 0.0))) / (2.0 * e);
  float dy = (fbm2(p + vec2(0.0, e)) - fbm2(p - vec2(0.0, e))) / (2.0 * e);
  return vec2(dy, -dx);
}
`;

// Helper for generating standard blackbody theme color palettes
const PALETTES_GLSL = `
vec3 getThemeColor(float x, int theme) {
  vec3 col = vec3(0.0);
  if (theme == 0) {
    // Amber (Classic Stellar) - Keeping it richly amber
    vec3 c1 = vec3(0.06, 0.003, 0.0); // deep core red
    vec3 c2 = vec3(1.0, 0.35, 0.01); // vibrant solar orange
    vec3 c3 = vec3(1.0, 0.88, 0.32); // dazzling thermal yellow
    vec3 c4 = vec3(1.0, 0.52, 0.0);  // saturated orange instead of wash-out white
    if (x < 0.25) {
      col = mix(c1, c2, x / 0.25);
    } else if (x < 0.7) {
      col = mix(c2, c3, (x - 0.25) / 0.45);
    } else {
      col = mix(c3, c4, clamp((x - 0.7) / 0.8, 0.0, 1.0));
    }
  } else if (theme == 1) {
    // Blue Pulsar (Energetics) - Fully blue
    vec3 c1 = vec3(0.0, 0.015, 0.08); // deep cosmic indigo
    vec3 c2 = vec3(0.05, 0.42, 1.0);  // stellar cyan-blue
    vec3 c3 = vec3(0.48, 0.86, 1.0);  // glowing electric teal
    vec3 c4 = vec3(0.00, 0.28, 1.0);  // deep electric blue bypasses white blowout
    if (x < 0.25) {
      col = mix(c1, c2, x / 0.25);
    } else if (x < 0.7) {
      col = mix(c2, c3, (x - 0.25) / 0.45);
    } else {
      col = mix(c3, c4, clamp((x - 0.7) / 0.8, 0.0, 1.0));
    }
  } else if (theme == 2) {
    // Singularity Red (Supergravity) - Intensely red
    vec3 c1 = vec3(0.015, 0.0, 0.0);   // bloodline red
    vec3 c2 = vec3(0.85, 0.01, 0.04);  // accretion plasma red
    vec3 c3 = vec3(1.0, 0.38, 0.08);   // searing crimson orange
    vec3 c4 = vec3(0.95, 0.05, 0.02);  // hyper-saturated red
    if (x < 0.25) {
      col = mix(c1, c2, x / 0.25);
    } else if (x < 0.7) {
      col = mix(c2, c3, (x - 0.25) / 0.45);
    } else {
      col = mix(c3, c4, clamp((x - 0.7) / 0.8, 0.0, 1.0));
    }
  } else {
    // Cosmic Purple (Forbidden Physics) - Ultra violet
    vec3 c1 = vec3(0.02, 0.0, 0.06);   // deep violet shadow
    vec3 c2 = vec3(0.62, 0.02, 0.98);  // radiant interstellar orchid
    vec3 c3 = vec3(1.0, 0.48, 0.95);   // bright fuschia plasma
    vec3 c4 = vec3(0.55, 0.00, 0.95);  // neon deep purple
    if (x < 0.25) {
      col = mix(c1, c2, x / 0.25);
    } else if (x < 0.7) {
      col = mix(c2, c3, (x - 0.25) / 0.45);
    } else {
      col = mix(c3, c4, clamp((x - 0.7) / 0.8, 0.0, 1.0));
    }
  }
  return col;
}
`;

/**
 * ----------------------------------------------------
 * 1. UNIFIED PHYSICALLY ACCURATE RELATIVISTIC SCHWARZSCHILD GEODESIC RAYTRACER
 * Traces photons in real-time under a curved space-time metric.
 * Correctly computes double lensing, Doppler Beaming, Redshift,
 * and high-frequency turbulent noise on a 30.0 radius bounding sphere.
 * ----------------------------------------------------
 */
export const DiskShader = {
  vertexShader: `
    varying vec3 vWorldPos;

    void main() {
      // Pass the global world coordinate space of the sphere
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform float uTime;
    uniform float uInnerRadius;
    uniform float uOuterRadius;
    uniform float uLensingStrength;
    uniform float uDopplerStrength;
    uniform float uRotationSpeed;
    uniform float uDiskBrightness;
    uniform float uMotionBlur;
    uniform bool uGravitationalRedshift;
    uniform int uTheme;
    uniform vec3 uBlackHolePosition;
    uniform float uStarDensity;
    uniform float uTimeDilation;
    uniform mat4 uViewMatrix;
    uniform sampler2D uDopplerLUT;

    varying vec3 vWorldPos;

    ${NOISE_GLSL}
    ${PALETTES_GLSL}

    // Dynamic rendering of gravitationally lensed background stars with 3D parallax mapping and GR-accurate spaghettification
    vec3 renderStars(vec3 dir, float densityCoeff, int theme, vec3 camPos, mat4 viewMat, float minR) {
      float rs = 1.02;
      // 1. GR-consistent Non-Linear Time Dilation
      float timeDilationFactor = sqrt(max(0.005, 1.0 - rs / max(rs + 0.0005, minR)));
      float dilatedTime = uTime * timeDilationFactor;
      
      // Starfield planetary drift slow-down integrated with time dilation
      float cosR = cos(dilatedTime * 0.008);
      float sinR = sin(dilatedTime * 0.008);
      vec3 rDir = vec3(
        dir.x * cosR - dir.z * sinR,
        dir.y,
        dir.x * sinR + dir.z * cosR
      );

      // Extract camera rotation vectors from the view matrix
      vec3 camRight = viewMat[0].xyz;
      vec3 camUp = viewMat[1].xyz;

      // 2. Gravitational Deflection & Spaghettification Matrix
      // Create an orthonormal deformation frame along the radial lensing direction on the sky
      vec3 radialWarpDir = vec3(0.0, 1.0, 0.0);
      vec3 originalRd = normalize(vWorldPos - cameraPosition);
      vec3 deflection = dir - originalRd;
      float warpLength = length(deflection);
      if (warpLength > 0.001) {
        radialWarpDir = deflection / warpLength;
      } else {
        vec3 toBH = -normalize(camPos);
        radialWarpDir = normalize(toBH - dot(toBH, dir) * dir);
      }
      vec3 tangentWarpDir = normalize(cross(radialWarpDir, dir + vec3(0.001, 0.0, 0.001)));
      vec3 normalWarpDir = cross(radialWarpDir, tangentWarpDir);

      // Spaghettification intensity scales up dramatically near the horizon
      float spag = smoothstep(12.0, 1.03, minR) * uLensingStrength;
      float rScale = mix(1.0, 0.12, spag);  // Radially elongated
      float tScale = mix(1.0, 3.8, spag);   // Tangentially compressed for razor-sharp thin arcs

      mat3 defMatrix = mat3(
        radialWarpDir * rScale,
        tangentWarpDir * tScale,
        normalWarpDir * tScale
      );

      // 3. Layer 1: Deep Distant Starfield (Near-static background reference)
      float zoomDepth = length(camPos);
      vec3 starCoord1 = rDir * densityCoeff;
      vec3 gridCell1 = floor(starCoord1);
      starCoord1 += getDepthJitter(gridCell1, zoomDepth);
      gridCell1 = floor(starCoord1);
      vec3 cellOffset1 = fract(starCoord1);
      float starSelection1 = hash3D(gridCell1);
      vec3 color1 = vec3(0.0);

      if (starSelection1 > 0.96) {
        vec3 offset1 = vec3(
          hash3D(gridCell1 + vec3(0.12, 0.34, 0.56)),
          hash3D(gridCell1 + vec3(0.78, 0.90, 0.12)),
          hash3D(gridCell1 + vec3(0.34, 0.56, 0.78))
        ) * 0.7 + 0.15;
        
        vec3 diff1 = cellOffset1 - offset1;
        vec3 transformedDiff1 = defMatrix * diff1;
        float distToStar1 = length(transformedDiff1);
        
        float starGlow1 = exp(-distToStar1 * 28.0) * 3.5 + exp(-distToStar1 * 6.0) * 0.4;
        float twinkle1 = 0.6 + 0.4 * sin(dilatedTime * 2.5 + hash3D(gridCell1) * 62.8);
        color1 = vec3(starGlow1 * twinkle1);
      }

      // Layer 2: Foreground/Midground Starfield (Closer scale, larger parallax shift)
      vec3 parallaxMid = camPos * 0.008 + camRight * 0.02 + camUp * 0.01;
      vec2 midCoord = rDir.xy * (densityCoeff * 1.55) + parallaxMid.xy;
      vec3 starCoord2 = vec3(midCoord, rDir.z * (densityCoeff * 1.55) + parallaxMid.z);
      vec3 gridCell2 = floor(starCoord2);
      starCoord2 += getDepthJitter(gridCell2, zoomDepth * 1.3);
      gridCell2 = floor(starCoord2);
      vec3 cellOffset2 = fract(starCoord2);
      float starSelection2 = hash3D(gridCell2);
      vec3 color2 = vec3(0.0);

      if (starSelection2 > 0.985) {
        vec3 offset2 = vec3(
          hash3D(gridCell2 + vec3(0.31, 0.14, 0.76)),
          hash3D(gridCell2 + vec3(0.58, 0.93, 0.22)),
          hash3D(gridCell2 + vec3(0.14, 0.56, 0.88))
        ) * 0.7 + 0.15;
        
        vec3 diff2 = cellOffset2 - offset2;
        vec3 transformedDiff2 = defMatrix * diff2;
        float distToStar2 = length(transformedDiff2);
        
        float starGlow2 = exp(-distToStar2 * 20.0) * 4.5 + exp(-distToStar2 * 4.5) * 0.55;
        float twinkle2 = 0.7 + 0.3 * sin(dilatedTime * 4.0 + hash3D(gridCell2) * 44.0);
        color2 = vec3(starGlow2 * twinkle2);
      }

      // Layer 3: Foreground Starfield (Closest to observer, maximum parallax)
      vec3 parallaxFore = camPos * 0.028 + camRight * 0.065 + camUp * 0.045;
      vec2 foreCoord = rDir.xy * (densityCoeff * 2.2) + parallaxFore.xy;
      vec3 starCoord3 = vec3(foreCoord, rDir.z * (densityCoeff * 2.2) + parallaxFore.z);
      vec3 gridCell3 = floor(starCoord3);
      starCoord3 += getDepthJitter(gridCell3, zoomDepth * 1.8);
      gridCell3 = floor(starCoord3);
      vec3 cellOffset3 = fract(starCoord3);
      float starSelection3 = hash3D(gridCell3);
      vec3 color3 = vec3(0.0);

      if (starSelection3 > 0.993) {
        vec3 offset3 = vec3(
          hash3D(gridCell3 + vec3(0.55, 0.23, 0.11)),
          hash3D(gridCell3 + vec3(0.12, 0.87, 0.44)),
          hash3D(gridCell3 + vec3(0.76, 0.34, 0.95))
        ) * 0.7 + 0.15;
        
        vec3 diff3 = cellOffset3 - offset3;
        vec3 transformedDiff3 = defMatrix * diff3;
        float distToStar3 = length(transformedDiff3);
        
        float starGlow3 = exp(-distToStar3 * 16.0) * 5.5 + exp(-distToStar3 * 3.5) * 0.7;
        float twinkle3 = 0.85 + 0.15 * sin(dilatedTime * 5.5 + hash3D(gridCell3) * 33.3);
        color3 = vec3(starGlow3 * twinkle3);
      }

      vec3 thermalColor = vec3(1.0);
      float hashVal = hash3D(gridCell1);
      if (theme == 0) {
        thermalColor = mix(vec3(1.0, 0.85, 0.68), vec3(0.65, 0.82, 1.0), hashVal);
      } else if (theme == 1) {
        thermalColor = mix(vec3(0.72, 0.88, 1.0), vec3(0.52, 0.72, 1.0), hashVal);
      } else if (theme == 2) {
        thermalColor = mix(vec3(1.0, 0.72, 0.62), vec3(1.0, 0.42, 0.42), hashVal);
      } else {
        thermalColor = mix(vec3(1.0, 0.78, 1.0), vec3(0.78, 0.58, 1.0), hashVal);
      }

      // Circular screen-space shadow mask for background stars
      vec3 toBH = -normalize(camPos);
      float cosAngleToBH = dot(dir, toBH);
      float distToCam = length(camPos);
      float sinShadow = clamp(2.4 / distToCam, 0.0, 1.0);
      float cosShadow = sqrt(1.0 - sinShadow * sinShadow);
      float shadowMask = 1.0 - smoothstep(cosShadow - 0.008, cosShadow + 0.002, cosAngleToBH);

      return thermalColor * (color1 * 0.85 + color2 * 1.5 + color3 * 2.2) * shadowMask;
    }

    void main() {
      // Relative positions in black hole space (singular point is centered at (0,0,0) locally)
      vec3 ro = cameraPosition - uBlackHolePosition;
      vec3 rd = normalize(vWorldPos - cameraPosition);

      // Setup Schwarzschild geodesic raytracing values
      vec3 p = ro;
      vec3 v = rd;

      vec3 accumulatedColor = vec3(0.0);
      float transmission = 1.0;
      bool hitHorizon = false;
      bool renderedPhotonRing = false;
      float minR = 9999.0;

      // Conserved initial angular momentum impact parameter (b = |ro x rd|)
      float b = length(cross(ro, rd));

      // Analytical Schwarzschild critical shadow impact parameter limit
      float rs = 1.02;
      float shadowCriticalB = 2.598076 * rs * uLensingStrength;

      // Walk along the curved space-time path
      for (int step = 0; step < 90; step++) {
        float r2 = dot(p, p);
        float r = sqrt(r2);
        minR = min(minR, r);

        // Mathematically precise Schwarzschild shadow capture checks based on event horizon limit
        // Stops raymarching once inside the core absorption boundary
        if (r < rs * 0.99) {
          hitHorizon = true;
          break;
        }

        // Optimization: if we have moved beyond the outer boundary of the accretion disk and are heading outward,
        // we can safely stop raymarching because the ray will never bend back to hit the disk!
        if (r > uOuterRadius && dot(p, v) > 0.0) {
          break;
        }

        // Meticulous adaptive step size
        // Scale down step size if we are vertically near the disk plane or close to the event horizon,
        // which completely eliminates clipping or skipping artifacts when fully zoomed in or out.
        float diskProximity = abs(p.y) / (0.12 + 0.05 * length(p.xz));
        float h_base = max(0.02, min(0.3, (r - 0.95) * 0.12));
        float h = mix(0.04, h_base, clamp(diskProximity, 0.0, 1.0));

        // Schwarzschild gravity bending acceleration: a = -1.5 * L^2 * p / r^5
        // Conserved angular momentum scalar L^2 = b^2
        float L2 = b * b;
        vec3 accel = - (1.5 * L2 * p) / (r2 * r2 * r) * uLensingStrength;

        // Perform Euler-Verlet integration step
        vec3 v_next = v + accel * h;
        v_next = normalize(v_next);
        vec3 p_next = p + v_next * h;

        // 1. KERR METRIC ASYMMETRIC PHOTON RING WITH DEPTH OCCLUSION
        // Approximates Lense-Thirring frame-dragging on the light-bending critical curves.
        // We calculate spin direction of the frame around the Y-axis.
        float spinDot = dot(v_next, normalize(vec3(-p.z, 0.0, p.x)));
        
        // Dynamically shift orbit crossing radius based on spin-direction to form asymmetric curves
        float r_ring = 1.44 - 0.18 * spinDot * uRotationSpeed * uLensingStrength;
        float r_next_val = length(p_next);
        
        if (!renderedPhotonRing && (r - r_ring) * (r_next_val - r_ring) < 0.0) {
          renderedPhotonRing = true;
          
          // Non-linear Kerr lensing warp shifts the critical impact parameter
          float asymmetry = (0.05 + 0.18 * uRotationSpeed * spinDot) * uLensingStrength;
          float critB = (1.28 + 1.15 * uLensingStrength) * (1.0 - asymmetry);
          
          // Ensure the photon ring is extremely thin, sharp, and elegant to prevent blob blowouts
          float ringWidth = 0.0006 + 0.0012 * uLensingStrength;
          
          float ringProfile = exp(-pow((b - critB) / ringWidth, 2.0));
          if (ringProfile > 0.005) {
            float ringBeaming = exp(spinDot * 1.4 * uDopplerStrength);
            // Drastically reduced brightness multiplier for subtle sub-horizon elegance
            float ringIntensity = ringProfile * uDiskBrightness * 0.82 * ringBeaming;
            vec3 ringColor = getThemeColor(ringIntensity * 0.45, uTheme);
            vec3 finalRingColor = mix(ringColor * 1.2, vec3(1.0), clamp(pow(ringProfile, 6.0) * 0.3 * ringBeaming, 0.0, 1.0));
            
            // Subdued transparency profiles to reveal a razor-sharp shadow cleanly silhouetted
            float ringAlpha = ringProfile * 0.32 * uDiskBrightness * (0.2 + 0.8 * smoothstep(0.0, 1.0, uLensingStrength));
            // Apply anti-aliased smooth-step fallback near Schwarzschild horizon boundary (rs=1.02)
            float ringShadowAA = smoothstep(rs, rs + 0.016, minR);
            ringAlpha = clamp(ringAlpha * ringShadowAA, 0.0, 0.95);
            
            accumulatedColor += transmission * finalRingColor * ringAlpha;
            transmission *= (1.0 - ringAlpha);
          }
        }

        // 2. UNIFIED ACCRETION DISK INTEGRATION & TURBULENCE ENGINE
        // Calculates coordinates, multi-octave FBM turbulence, and relativistic light behaviors in a unified branch.
        float d_int = length(p.xz);
        float innerCompressFactor = exp(-1.2 * (d_int - uInnerRadius));
        float diskThickness = 0.08 + 0.32 * innerCompressFactor + 0.015 * d_int;
        bool inDiskZone = (d_int >= uInnerRadius && d_int <= uOuterRadius && abs(p.y) < diskThickness);

        if (inDiskZone) {
          // Smooth vertical profile (peaks at Y=0, fades at borders)
          float verticalAngle = (p.y / diskThickness) * 1.570796;
          float verticalFalloff = cos(verticalAngle);
          
          // Radial density profile with a soft, smoky outer edge taper and an inner ISCO plunge
          float r_norm = (d_int - uInnerRadius) / (uOuterRadius - uInnerRadius + 1e-4);
          float radialPlunge = 1.0 - exp(-r_norm * 14.0);
          
          // Incorporates a perfect 'fade-to-black' alpha ramp for the outer perimeter (7Rs = 7.14)
          // ensuring the gas dissipates into a truly smoky, semi-transparent transition against the starfield.
          float outerTaper = smoothstep(7.14, 5.0, d_int);
          float smokyTaper = outerTaper * smoothstep(1.0, 0.28, r_norm);
          float radialDecay = pow(1.0 - r_norm, 1.6);
          float radialFalloff = radialPlunge * radialDecay * smokyTaper;

          // Keplerian orbits with non-zero spin background floor at outer perimeter (keeps outer lanes looping)
          float angle = atan(p.z, p.x);
          float speedCoeff = 1.6 * uRotationSpeed;
          // Enhanced orbital speed baseline so complete disk perimeters spin, loop and orbit actively
          float angularVelocity = speedCoeff * (0.42 + 0.58 / (sqrt(d_int) + 0.1));
          
          // Warp/shear coordinates near the event horizon to represent frame dragging and time dilation!
          float horizonWarp = 1.0 + 1.8 * exp(-1.5 * (d_int - uInnerRadius));
          float spiralShear = d_int * 0.28 * horizonWarp;

          // Gravitational coordinate time dilation (slowing time non-linearly close to the horizon)
          float r_rel = (d_int - rs) / (d_int + 1e-4);
          // Non-linear coordinate velocity slowdown - "frozen light" effect
          float frozenFactor = clamp(1.0 - exp(-r_rel * 4.5), 0.0, 1.0);
          float localTimeDilation = mix(1.0, pow(frozenFactor, 2.5), uTimeDilation);
          float localTime = uTime * localTimeDilation;

          // 3D Cartesian flat coordinates for displacement
          vec2 uv_center = vec2(cos(angle) * d_int, sin(angle) * d_int);

          // We implement an incredibly high-fidelity, dual-tap, low-intensity, time-decaying trail buffer
          // to visually project orbital velocity and create a cinematic flow of gas particles
          float d_sample = 0.0;
          float trailWeightCoeff = 0.0;
          mat2 fbmRot = mat2(0.877584, 0.479426, -0.479426, 0.877584);
          vec2 fbmShift = vec2(100.0);

          for (int tap = 0; tap < 2; tap++) {
            float decayStep = float(tap);
            // Decay trail delayed time offset, stretching further backward close to the horizon due to higher angular speeds
            float trailDelay = decayStep * 0.16 * uRotationSpeed;
            float tapTime = localTime - trailDelay;
            float tapWeight = (tap == 0) ? 1.0 : 0.38; // Low-intensity, time-decaying blend weight

            float tapBreathing = 0.12 * sin(tapTime * 1.15) * frozenFactor;
            float tapSlowOrbit = 0.22 * sin(tapTime * 0.28 + d_int * 0.45) * frozenFactor;

            // Generate curlNoise displacement for this tap
            vec2 curlShift = curlNoise(uv_center * 0.35 + vec2(0.04 * tapTime, 0.02 * tapTime)) * (0.12 + 0.28 * innerCompressFactor);

            // Refactored consolidated loop evaluating the three FBM noise layers to decrease instruction count dramatically
            float n1 = 0.0, n2 = 0.0, n3 = 0.0;
            for (int layer = 0; layer < 3; layer++) {
              float theta = angle;
              float scale = 1.0;
              float speedMult = 1.0;
              
              if (layer == 0) {
                theta -= (tapTime * angularVelocity + tapSlowOrbit - spiralShear + tapBreathing);
                scale = 0.45;
                speedMult = 1.1;
              } else if (layer == 1) {
                theta -= (tapTime * angularVelocity * 1.35 + tapSlowOrbit * 0.65 - spiralShear * 0.85);
                scale = 0.95;
                speedMult = 1.8;
              } else {
                theta -= (tapTime * angularVelocity * 1.85 + tapSlowOrbit * 0.35 - spiralShear * 0.55);
                scale = 2.2;
                speedMult = 3.5;
              }

              vec2 uv = vec2(cos(theta) * d_int * scale, sin(theta) * d_int * scale);
              if (layer == 0) uv += curlShift;
              else if (layer == 1) uv += curlShift * 1.6;
              else uv += curlShift * 2.8;

              vec2 p_noise = uv * speedMult;
              if (layer == 0) p_noise += tapTime * 0.05;
              else if (layer == 1) p_noise -= tapTime * 0.12;
              else p_noise += vec2(tapTime * 0.22, -tapTime * 0.18);

              // Unrolled internal FBM - 3 octaves for layer 0, 2 octaves for layers 1 & 2
              float v_fbm = 0.0;
              float a = 0.5;
              v_fbm += a * noise(p_noise);
              p_noise = fbmRot * p_noise * 2.0 + fbmShift;
              a *= 0.5;
              v_fbm += a * noise(p_noise);

              if (layer == 0) {
                p_noise = fbmRot * p_noise * 2.0 + fbmShift;
                a *= 0.5;
                v_fbm += a * noise(p_noise);
                n1 = v_fbm;
              } else if (layer == 1) {
                n2 = v_fbm;
              } else {
                n3 = v_fbm;
              }
            }

            // Combine multi-layered turbulent noise cascades
            float tapSample = mix(n1, n2, 0.45);
            tapSample = mix(tapSample, n3, 0.28 + 0.12 * innerCompressFactor);

            // Integrate Motion Blur directly into this tap
            float diskOrbitalSpeed = angularVelocity * 0.14;
            float totalMotionBlur = uMotionBlur * 0.72 + diskOrbitalSpeed;
            if (totalMotionBlur > 0.015) {
              float blurAngle = totalMotionBlur * 0.18 / sqrt(max(0.1, d_int));
              // Offset angle symmetrically
              float theta1_blur1 = angle - (tapTime * angularVelocity + tapSlowOrbit - spiralShear + tapBreathing) + blurAngle;
              float theta1_blur2 = angle - (tapTime * angularVelocity + tapSlowOrbit - spiralShear + tapBreathing) - blurAngle;
              vec2 uv_blur1 = vec2(cos(theta1_blur1) * d_int * 0.45, sin(theta1_blur1) * d_int * 0.45) + curlShift;
              vec2 uv_blur2 = vec2(cos(theta1_blur2) * d_int * 0.45, sin(theta1_blur2) * d_int * 0.45) + curlShift;
              
              // Low cost FBM
              float nBlur1 = fbm2(uv_blur1 * 1.1);
              float nBlur2 = fbm2(uv_blur2 * 1.1);
              tapSample = mix(tapSample, (nBlur1 + nBlur2) * 0.5, 0.45);
            }

            d_sample += tapSample * tapWeight;
            trailWeightCoeff += tapWeight;
          }

          d_sample /= trailWeightCoeff;

          // Material physics density based on noise wraps - ultra low contrast on outer edge for smoothest smoky gas transition
          float edgeContrast = mix(0.85, 0.08, r_norm);
          float thickSample = smoothstep(0.5 - edgeContrast, 0.5 + edgeContrast, d_sample);
          
          // Moderate inner density thickening near event horizon to avoid overexposure bright blowout
          float innerDensityThickening = 1.0 + 0.5 * innerCompressFactor;
          float gasDensity = radialFalloff * verticalFalloff * (0.35 + 0.65 * thickSample) * innerDensityThickening;

          // RELATIVISTIC DOPPLER BEAMING & GRAVITATIONAL REDSHIFT VIA PRE-CALCULATED LOOKUP TABLE (LUT)
          // Look up already-processed values from the 2D texture, keeping step instruction count incredibly low.
          vec3 velDir = normalize(vec3(-p.z, 0.0, p.x));
          float dotVal = dot(velDir, v);
          float lutU = clamp(dotVal * 0.5 + 0.5, 0.005, 0.995);
          float lutV = clamp((d_int - 1.0) / 29.0, 0.005, 0.995);
          float beaming = texture2D(uDopplerLUT, vec2(lutU, lutV)).r;

          // Emit color
          float finalGasDensity = gasDensity * beaming * uDiskBrightness;
          
          // Map theme color with safety compression to completely prevent bright lights blowout near blackhole shadow
          float thermalIntensity = finalGasDensity * mix(0.55, 0.22, innerCompressFactor);
          vec3 heatColor = getThemeColor(thermalIntensity, uTheme);

          // Redshift spectrum shift to infrared below ISCO (r < 3.0)
          if (uGravitationalRedshift && r < 3.0) {
            float shiftFactor = clamp((3.0 - r) / (3.0 - uInnerRadius + 1e-3), 0.0, 1.0);
            heatColor.g *= mix(1.0, 0.12, shiftFactor);
            heatColor.b *= mix(1.0, 0.03, shiftFactor);
            heatColor.r = mix(heatColor.r, heatColor.r * 1.4, shiftFactor);
            
            // Absolute energy loss: dim completely near the event horizon boundary
            float energyLoss = mix(1.0, 0.0, shiftFactor);
            heatColor *= energyLoss;
            finalGasDensity *= energyLoss;
          }

          // Volumetric single-step opacity integration with a physical cap to let the ray penetrate
          // through multiple layers. This reveals glorious 3D filaments with zero flat bloated areas!
          float stepAlpha = finalGasDensity * h * 3.6;
          float innerTaper = smoothstep(uInnerRadius, uInnerRadius + 0.15, d_int);
          stepAlpha = clamp(stepAlpha * innerTaper, 0.0, 0.42);

          accumulatedColor += transmission * heatColor * stepAlpha;
          transmission *= (1.0 - stepAlpha);

          if (transmission < 0.01) {
            break;
          }
        }

        // 3. FAINT PROCEDURAL ATMOSPHERIC SCATTERING
        // Represents the tenuous plasma/matter surrounding the accretion disk,
        // softening the transition between the disk and deep space.
        if (transmission > 0.01 && r > uInnerRadius * 0.95 && r < uOuterRadius * 1.5) {
          // Exponential falloff from the black hole center and vertically from the disk plane
          float atmosDensity = 0.015 * exp(-0.45 * r) * exp(-1.8 * abs(p.y)) * uDiskBrightness;
          
          if (atmosDensity > 0.00005) {
            float r_rel = (r - rs) / (r + 1e-4);
            float frozenFactor = clamp(1.0 - exp(-r_rel * 4.5), 0.0, 1.0);
            float localTimeDilation = mix(1.0, pow(frozenFactor, 2.5), uTimeDilation);
            float atmosTime = uTime * localTimeDilation;
            
            // Faint swirling plasma noise for dynamic, realistic aesthetics
            float atmosNoise = noise(p.xz * 0.32 + vec2(0.0, atmosTime * 0.04)) * 0.5 + 0.5;
            float finalAtmosDensity = atmosDensity * mix(0.7, 1.3, atmosNoise);
            
            // Render with a soft, tenuous theme-based glow
            vec3 atmosColor = getThemeColor(0.2, uTheme);
            float stepAtmosAlpha = clamp(finalAtmosDensity * h * 2.2, 0.0, 0.035);
            
            accumulatedColor += transmission * atmosColor * stepAtmosAlpha;
            transmission *= (1.0 - stepAtmosAlpha);
          }
        }

        // Advance step
        p = p_next;
        v = v_next;
      }

      // Schwarzschild shadow smoothstep anti-aliasing to provide a seamless transition from the horizon
      float shadowAlpha = hitHorizon ? 0.0 : smoothstep(rs, rs + 0.016, minR);
      
      // Gravitational lensing warping is localized closest to the black hole horizon to prevent ugly starfield stretching
      float starWarpFactor = smoothstep(4.0, 1.15, minR) * uLensingStrength;
      vec3 starRay = normalize(mix(rd, v, starWarpFactor));
      
      vec3 starrySky = renderStars(starRay, uStarDensity, uTheme, ro, uViewMatrix, minR);
      accumulatedColor += transmission * starrySky * shadowAlpha;

      gl_FragColor = vec4(accumulatedColor, 1.0);
    }
  `
};

/**
 * Preservation placeholders for secondary unused meshes to avoid compilations
 */
export const PhotonRingShader = {
  vertexShader: `void main() { gl_Position = vec4(0.0); }`,
  fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`
};

export const JetShader = {
  vertexShader: `void main() { gl_Position = vec4(0.0); }`,
  fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`
};

export const StarfieldShader = {
  vertexShader: `void main() { gl_Position = vec4(0.0); }`,
  fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`
};
