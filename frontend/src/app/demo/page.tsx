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
      background: '#050505',
    }}>
      {/* Back button - minimal pill */}
      <a
        href="/"
        style={{
          position: 'fixed',
          top: '20px',
          left: '20px',
          zIndex: 1000,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 18px',
          fontSize: '13px',
          fontWeight: 500,
          fontFamily: "'Instrument Sans', sans-serif",
          color: 'rgba(255, 255, 255, 0.65)',
          background: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '9999px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          textDecoration: 'none',
          transition: 'all 0.2s ease',
          letterSpacing: '0.01em',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 7H3M3 7L6 4M3 7L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Home
      </a>

      <AudioOrb3D ref={audioOrbRef} />
    </div>
  );
}
