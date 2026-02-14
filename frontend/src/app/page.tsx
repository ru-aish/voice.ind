export default function HomePage() {
  return (
    <main style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      background: '#050505',
      color: '#f0f0f0',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient gradient background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `
          radial-gradient(ellipse 60% 50% at 50% 40%, rgba(0, 224, 158, 0.06) 0%, transparent 70%),
          radial-gradient(ellipse 40% 30% at 70% 60%, rgba(0, 120, 255, 0.04) 0%, transparent 60%)
        `,
        pointerEvents: 'none',
      }} />

      {/* Top nav bar */}
      <nav style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '24px 40px',
        zIndex: 10,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#00e09e',
            boxShadow: '0 0 12px rgba(0, 224, 158, 0.4)',
          }} />
          <span style={{
            fontFamily: "'Instrument Sans', sans-serif",
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(255, 255, 255, 0.6)',
          }}>
            Voice AI
          </span>
        </div>
        <div style={{
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.3)',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.05em',
        }}>
          v1.0
        </div>
      </nav>

      {/* Main content */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        textAlign: 'center',
        maxWidth: '680px',
      }}>
        {/* Overline */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          borderRadius: '9999px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.03)',
          marginBottom: '32px',
          fontSize: '12px',
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.5)',
          letterSpacing: '0.04em',
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#00e09e',
            animation: 'pulse 2s ease-in-out infinite',
          }} />
          Powered by Gemini Live API
        </div>

        {/* Headline */}
        <h1 style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
          fontWeight: 400,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          marginBottom: '20px',
          color: '#ffffff',
        }}>
          Speak naturally.{' '}
          <em style={{
            fontStyle: 'italic',
            color: '#00e09e',
          }}>
            Get answers instantly.
          </em>
        </h1>

        {/* Subheading */}
        <p style={{
          fontFamily: "'Instrument Sans', sans-serif",
          fontSize: 'clamp(1rem, 2vw, 1.15rem)',
          lineHeight: 1.65,
          color: 'rgba(255, 255, 255, 0.45)',
          maxWidth: '460px',
          margin: '0 auto 48px',
          fontWeight: 400,
        }}>
          A real-time voice agent with sub-second latency,
          audio-reactive visuals, and natural conversation flow.
        </p>

        {/* CTA Button */}
        <a
          href="/demo"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 36px',
            fontSize: '15px',
            fontWeight: 600,
            fontFamily: "'Instrument Sans', sans-serif",
            color: '#050505',
            background: '#00e09e',
            borderRadius: '9999px',
            textDecoration: 'none',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 0 24px rgba(0, 224, 158, 0.2), 0 4px 16px rgba(0, 0, 0, 0.3)',
            letterSpacing: '0.01em',
          }}
        >
          Start Conversation
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      </div>

      {/* Bottom detail */}
      <div style={{
        position: 'absolute',
        bottom: '32px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        fontSize: '11px',
        fontFamily: "'JetBrains Mono', monospace",
        color: 'rgba(255, 255, 255, 0.2)',
        letterSpacing: '0.05em',
      }}>
        <span>GROQ</span>
        <span style={{
          width: '3px',
          height: '3px',
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.15)',
        }} />
        <span>CEREBRAS</span>
        <span style={{
          width: '3px',
          height: '3px',
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.15)',
        }} />
        <span>DEEPGRAM</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        a:hover {
          transform: translateY(-1px);
          box-shadow: 0 0 32px rgba(0, 224, 158, 0.3), 0 6px 20px rgba(0, 0, 0, 0.4) !important;
        }
      `}</style>
    </main>
  );
}
