import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Khả năng truy cập cho modal — không thêm thẻ bọc, không đổi giao diện.
 * Gắn ref trả về vào khung modal (phần tử .modal):
 *  - Esc → gọi onClose (luôn dùng bản onClose mới nhất)
 *  - Khi mở: nếu focus chưa nằm trong modal (không có ô autoFocus) → focus vào khung modal
 *  - Tab / Shift+Tab chạy vòng trong modal
 *  - Khi đóng: trả focus về phần tử đã mở modal
 * Hộp ConfirmDialog nằm trên chặn Esc ở pha capture nên Esc chỉ đóng hộp xác nhận.
 */
export function useModalA11y(open, onClose) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.setAttribute('data-modal-a11y', ''); // CSS: không vẽ viền focus quanh cả khung
      node.focus({ preventScroll: true });
    }

    const onKeyDown = (e) => {
      const modal = ref.current;
      if (!modal) return;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab' && modal.contains(document.activeElement)) {
        const items = [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused) && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return ref;
}
