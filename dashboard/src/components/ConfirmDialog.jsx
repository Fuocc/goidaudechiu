import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Hộp thoại xác nhận thay cho window.confirm() (hộp thoại trình duyệt chặn luồng, lệch giao diện app).
 * Dùng:  const confirmDialog = useConfirm();
 *        if (!(await confirmDialog({ message: 'Xóa?', danger: true }))) return;
 * Nhận chuỗi hoặc { title, message, confirmText, cancelText, danger }. Trả Promise<boolean>.
 */
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(null); // hộp thoại đang mở (để trả lời khi đóng / khi có hộp mới)
  const confirmBtnRef = useRef(null);

  const close = useCallback((result) => {
    const current = dialogRef.current;
    dialogRef.current = null;
    setDialog(null);
    current?.resolve(result);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    const opts = typeof options === 'string' ? { message: options } : (options || {});
    dialogRef.current?.resolve(false); // hộp cũ chưa trả lời → coi như Hủy
    const next = { confirmText: 'Đồng ý', cancelText: 'Hủy', danger: false, ...opts, resolve };
    dialogRef.current = next;
    setDialog(next);
  }), []);

  useEffect(() => {
    if (!dialog) return;
    const previouslyFocused = document.activeElement;
    confirmBtnRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // capture + stopPropagation: Esc chỉ đóng hộp xác nhận, không đóng luôn modal bên dưới
        e.preventDefault();
        e.stopPropagation();
        close(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [dialog, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="modal-overlay confirm-dialog-overlay" onClick={() => close(false)}>
          <div
            className="modal confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="confirm-dialog-title">{dialog.title || 'Xác nhận'}</h3>
            </div>
            <div className="modal-body">
              <p id="confirm-dialog-message" className="confirm-dialog-message">{dialog.message}</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
                {dialog.cancelText}
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(true)}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm phải được dùng bên trong <ConfirmProvider>');
  return confirm;
}
