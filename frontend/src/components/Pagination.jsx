export default function Pagination({ page, totalPages, count, pageSize, onPageChange, label = 'items', loading = false }) {
  if (loading) {
    return (
      <div className="list-meta">
        <span>Loading {label}…</span>
      </div>
    )
  }
  if (!count) {
    return (
      <div className="list-meta">
        <span>Total 0 {label}</span>
      </div>
    )
  }

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, count)

  return (
    <div className="list-meta pagination-bar">
      <span>
        Total <strong>{count.toLocaleString()}</strong> {label}
        <span className="pagination-range"> · showing {from.toLocaleString()}–{to.toLocaleString()}</span>
      </span>
      <div className="pagination-controls">
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="pagination-page">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
