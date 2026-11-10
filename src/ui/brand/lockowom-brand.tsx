export function LockowomMark({ compact = false, animated = true }: { compact?: boolean; animated?: boolean }) {
  return <span className={`lockowom-brand ${compact ? 'lockowom-brand--compact' : ''} ${animated ? 'lockowom-brand--animated' : ''}`} aria-label="Lockowom Systems">
    <svg className="lockowom-mark" viewBox="0 0 64 64" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="lockowom-cobalt" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#37C9FF" />
          <stop offset=".48" stopColor="#006CFF" />
          <stop offset="1" stopColor="#0047D9" />
        </linearGradient>
      </defs>
      <path className="lockowom-mark__trace" d="M31 6 10 18v28l21 12 23-13V30L36 40V22l18 10V18L31 6Z" />
      <path className="lockowom-mark__fill" fill="url(#lockowom-cobalt)" d="M31 6 10 18v28l21 12 23-13V30L36 40V22l18 10V18L31 6Z" />
      <path className="lockowom-mark__cut" d="M10 18 31 30 54 18M31 30v28" />
    </svg>
    <span className="lockowom-wordmark">
      <strong>LOCKOWOM</strong>
      <small>SYSTEMS</small>
    </span>
  </span>
}

export function LockowomSplash() {
  return <main className="brand-splash" aria-label="Iniciando Lockowom Systems">
    <div className="brand-splash__orb" aria-hidden="true" />
    <LockowomMark animated />
    <p>Inventario · Logística · Control</p>
    <span className="brand-splash__progress" aria-hidden="true"><i /></span>
  </main>
}
