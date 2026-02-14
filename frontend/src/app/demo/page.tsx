'use client';

import { useRef } from 'react';
import dynamic from 'next/dynamic';
import type { AudioOrb3DHandle } from '../components/AudioOrb3D/AudioOrb3D';

const AudioOrb3D = dynamic(() => import('../components/AudioOrb3D/AudioOrb3D'), { ssr: false });

export default function DemoPage() {
  const audioOrbRef = useRef<AudioOrb3DHandle>(null);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100dvh',
      overflow: 'hidden',
      background: '#000000',
    }}>
      <a
        href="/"
        style={{
          position: 'fixed',
          top: '20px',
          left: '20px',
          zIndex: 1000,
          padding: '10px 24px',
          fontSize: '14px',
          fontWeight: 600,
          color: 'rgba(255, 255, 255, 0.9)',
          background: 'rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '50px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          textDecoration: 'none',
          transition: 'all 0.3s ease',
        }}
      >
        ← Back to Home
      </a>

      <AudioOrb3D ref={audioOrbRef} />
    </div>
  );
}