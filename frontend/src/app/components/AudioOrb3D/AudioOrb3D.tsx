'use client';

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';

export interface AudioOrb3DHandle {
  pause: () => void;
  resume: () => void;
}

const AudioOrb3D = forwardRef<AudioOrb3DHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const [loadStatus, setLoadStatus] = useState('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    pause: () => {
      if (elementRef.current) {
        const litElement = elementRef.current as unknown as { pause?: () => void };
        if (typeof litElement.pause === 'function') {
          litElement.pause();
        }
      }
    },
    resume: () => {
      if (elementRef.current) {
        const litElement = elementRef.current as unknown as { resume?: () => void };
        if (typeof litElement.resume === 'function') {
          litElement.resume();
        }
      }
    }
  }));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    
    setLoadStatus('loading module');
    let mounted = true;
    
    const loadLitComponent = async () => {
      try {
        setLoadStatus('importing...');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!mounted) return;
        
        await import('./AudioOrbLit');
        setLoadStatus('module loaded');
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        if (!mounted) return;
        
        const isRegistered = customElements.get('gdm-live-audio') !== undefined;
        
        if (!isRegistered) {
          throw new Error('Custom element "gdm-live-audio" not registered after import');
        }
        
        setLoadStatus('creating element');
        
        if (containerRef.current && mounted) {
          const element = document.createElement('gdm-live-audio');
          elementRef.current = element;
          containerRef.current.appendChild(element);
          setLoadStatus('ready');
        } else {
          throw new Error('Container ref is null');
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
          setLoadStatus('error');
        }
      }
    };

    loadLitComponent();

    return () => {
      mounted = false;
      
      if (elementRef.current) {
        try {
          const litElement = elementRef.current as unknown as {
            pause?: () => void;
            inputAudioContext?: { close: () => void; state: string } | null;
            outputAudioContext?: { close: () => void; state: string } | null;
            mediaStream?: { getTracks: () => MediaStreamTrack[] } | null;
          };
          
          if (typeof litElement.pause === 'function') {
            litElement.pause();
          }
          
          if (litElement.inputAudioContext) {
            litElement.inputAudioContext.close();
          }
          
          if (litElement.outputAudioContext) {
            litElement.outputAudioContext.close();
          }
          
          if (litElement.mediaStream) {
            litElement.mediaStream.getTracks().forEach((track) => {
              track.stop();
            });
          }
        } catch {}
        
        if (elementRef.current.parentNode) {
          elementRef.current.parentNode.removeChild(elementRef.current);
        }
        elementRef.current = null;
      }
      
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: '100vh',
        background: '#050505',
        position: 'relative'
      }}
      suppressHydrationWarning
    >
      {loadStatus !== 'ready' && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          padding: '24px',
          maxWidth: '80%',
        }}>
          {loadStatus === 'error' ? (
            <>
              <div style={{
                color: '#ff5c5c',
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: "'Instrument Sans', sans-serif",
                marginBottom: '8px',
              }}>
                Failed to load
              </div>
              <div style={{
                fontSize: '12px',
                fontFamily: "'JetBrains Mono', monospace",
                color: 'rgba(255, 255, 255, 0.35)',
                lineHeight: 1.5,
              }}>
                {errorMessage}
              </div>
            </>
          ) : (
            <>
              {/* Loading spinner */}
              <div style={{
                width: '32px',
                height: '32px',
                border: '2px solid rgba(255, 255, 255, 0.06)',
                borderTopColor: '#00e09e',
                borderRadius: '50%',
                margin: '0 auto 16px',
                animation: 'spin 0.8s linear infinite',
              }} />
              <div style={{
                fontSize: '13px',
                fontFamily: "'Instrument Sans', sans-serif",
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.4)',
                letterSpacing: '0.02em',
              }}>
                Loading...
              </div>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </>
          )}
        </div>
      )}
    </div>
  );
});

AudioOrb3D.displayName = 'AudioOrb3D';

export default AudioOrb3D;
