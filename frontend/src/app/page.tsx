export default function HomePage() {
  return (
    <main style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      background: '#000000',
      color: '#ffffff',
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>
        Voice AI
      </h1>
      <p style={{ fontSize: '1.25rem', marginBottom: '2rem', opacity: 0.7 }}>
        Real-time voice agent powered by Gemini Live API
      </p>
      <a
        href="/demo"
        style={{
          padding: '12px 32px',
          fontSize: '1rem',
          fontWeight: 600,
          color: '#ffffff',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '50px',
          textDecoration: 'none',
          transition: 'transform 0.2s ease',
        }}
      >
        Try Demo →
      </a>
    </main>
  );
}