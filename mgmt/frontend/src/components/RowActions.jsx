import { canEdit, canDelete } from '../permissions.js';

// Small edit/delete icon pair, shown only for roles allowed to do that action.
// `disabled` forces it to render nothing regardless of role — used for "All Years"
// view and locked years, where no year-scoped record should be editable.
export default function RowActions({ role, onEdit, onDelete, disabled }) {
  const showEdit = !disabled && canEdit(role) && onEdit;
  const showDelete = !disabled && canDelete(role) && onDelete;
  if (!showEdit && !showDelete) return null;

  return (
    <div className="row-actions">
      {showEdit && (
        <button type="button" className="icon-btn" title="Edit" onClick={onEdit}>
          <span className="material-icons-round" style={{ fontSize: 16 }}>edit</span>
        </button>
      )}
      {showDelete && (
        <button type="button" className="icon-btn icon-danger" title="Delete" onClick={onDelete}>
          <span className="material-icons-round" style={{ fontSize: 16 }}>delete</span>
        </button>
      )}
    </div>
  );
}
