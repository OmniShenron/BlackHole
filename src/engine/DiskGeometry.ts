import * as THREE from 'three';

/**
 * Creates high-resolution polar coordinate disk geometry.
 * Storing polar coordinates directly in attributes allows extremely efficient
 * procedural noise and lensing calculations on the GPU.
 */
export function createDiskGeometry(
  innerRadius: number,
  outerRadius: number,
  radialSegments: number,
  angularSegments: number
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  const vertices: number[] = [];
  const indices: number[] = [];
  const polarAngles: number[] = [];
  const polarRadii: number[] = [];

  for (let rIndex = 0; rIndex <= radialSegments; rIndex++) {
    const r = innerRadius + (outerRadius - innerRadius) * (rIndex / radialSegments);
    for (let aIndex = 0; aIndex < angularSegments; aIndex++) {
      const angle = (aIndex / angularSegments) * Math.PI * 2;

      // Unwarped flat coordinates in XZ plane (Y=0)
      const x = r * Math.sin(angle);
      const z = r * Math.cos(angle);
      const y = 0.0;

      vertices.push(x, y, z);
      polarAngles.push(angle);
      polarRadii.push(r);
    }
  }

  // Generate faces (triangles) mapping between radial levels and angular slices
  for (let rIndex = 0; rIndex < radialSegments; rIndex++) {
    for (let aIndex = 0; aIndex < angularSegments; aIndex++) {
      const current = rIndex * angularSegments + aIndex;
      const nextAngle = (aIndex + 1) % angularSegments;
      const nextRad = (rIndex + 1) * angularSegments + aIndex;
      const nextAngleNextRad = (rIndex + 1) * angularSegments + nextAngle;

      // First triangle of quad
      indices.push(current, nextRad, rIndex * angularSegments + nextAngle);
      // Second triangle of quad
      indices.push(rIndex * angularSegments + nextAngle, nextRad, nextAngleNextRad);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('polarAngle', new THREE.Float32BufferAttribute(polarAngles, 1));
  geometry.setAttribute('polarRadius', new THREE.Float32BufferAttribute(polarRadii, 1));
  geometry.setIndex(indices);

  // Compute normals for shader calculations
  geometry.computeVertexNormals();

  return geometry;
}
