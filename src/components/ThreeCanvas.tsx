import React, { useEffect, useRef } from 'react';
import { SimulationParams } from '../types';
import { BlackHoleSceneManager } from '../engine/SceneManager';

interface ThreeCanvasProps {
  params: SimulationParams;
}

export const ThreeCanvas: React.FC<ThreeCanvasProps> = ({ params }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<BlackHoleSceneManager | null>(null);

  // Initialize WebGL Scene on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const manager = new BlackHoleSceneManager(containerRef.current, params);
    managerRef.current = manager;

    // Handle Resize events
    const handleResize = () => {
      manager.resize();
    };
    window.addEventListener('resize', handleResize);

    // Initial setup trigger
    manager.resize();

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  // Update parameters smoothly whenever any value in the HUD changes
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.setParams(params);
    }
  }, [params]);

  // Intercept taps to pause auto-rotation immediately
  const handlePointerDown = () => {
    if (managerRef.current) {
      managerRef.current.resetControlsTimer();
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full bg-black outline-none select-none overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={handlePointerDown}
    />
  );
};
export default ThreeCanvas;
