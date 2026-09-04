export function Crescent({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <rect width="1024" height="1024" rx="224" fill="#1f3d2b" />
      <mask id="hawl-cut">
        <rect width="1024" height="1024" fill="#fff" />
        <circle cx="600" cy="452" r="270" fill="#000" />
      </mask>
      <circle cx="512" cy="480" r="300" fill="#e3bf62" mask="url(#hawl-cut)" />
    </svg>
  );
}
