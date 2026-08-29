"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function Petals({ count = 400 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = Math.random() * 20 - 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      spd[i * 3] = (Math.random() - 0.5) * 0.01;
      spd[i * 3 + 1] = -0.01 - Math.random() * 0.02;
      spd[i * 3 + 2] = (Math.random() - 0.5) * 0.005;
    }
    return { positions: pos, speeds: spd };
  }, [count]);

  useFrame(() => {
    const geo = ref.current?.geometry;
    if (!geo) return;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] += speeds[i * 3];
      arr[i * 3 + 1] += speeds[i * 3 + 1];
      arr[i * 3 + 2] += speeds[i * 3 + 2];
      if (arr[i * 3 + 1] < -6) arr[i * 3 + 1] = 12;
    }
    geo.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#ffb7c5"
        transparent
        opacity={0.8}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export function SakuraScene() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none sakura-gradient motion-reduce:hidden"
    >
      <Canvas
        camera={{ position: [0, 0, 10], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.5]}
      >
        <Petals />
      </Canvas>
    </div>
  );
}
