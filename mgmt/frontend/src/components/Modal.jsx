export default function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content">
        {/* Close (X) button — top-right of every modal. Previously a modal could
            only be dismissed by tapping the backdrop, which is easy to miss on
            mobile, so users hit the browser Back button and lost their whole
            navigation. onClose is passed by every caller. */}
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
