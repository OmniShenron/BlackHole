/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import Lenis from 'lenis';
import { ThreeCanvas } from './components/ThreeCanvas';
import { DEFAULT_PARAMS, SimulationParams } from './types';

export default function App() {
  const [params, setParams] = useState<SimulationParams>(DEFAULT_PARAMS);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans flex select-none no-scrollbar">
      {/* 3D WebGL Canvas background */}
      <div className="absolute inset-0 z-0">
        <ThreeCanvas params={params} />
      </div>
    </div>
  );
}
