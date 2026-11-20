export default function GreenLoader({ label = 'Loading…' }) {
  return (
    <div className="green-loader" role="status" aria-live="polite">
      <span className="green-loader-ring" aria-hidden="true" />
      <span className="green-loader-text">{label}</span>
    </div>
  )
}
