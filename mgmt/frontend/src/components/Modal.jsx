export default function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content">
        {
}
        {onClose && (
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <span className="material-icons-round">close</span>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
