import { getInitial } from '../../utils/format';
import BusyLabel from '../../components/BusyLabel';

// Popup xác nhận đổi giờ / nhân viên sau khi kéo-thả thẻ lịch
// Component trình bày: state + handler vẫn nằm ở Bookings.jsx, truyền vào qua props.
export default function DragConfirmDialog({
  dragConfirm,
  dragConfirmRef,
  handleDragCancel,
  handleDragConfirm,
  dragSaving // true khi đang lưu → khóa các nút, nút lưu hiện "Đang lưu..."
}) {
  // Lịch thuộc nhóm đổi giờ: backend báo SCOPE_REQUIRED → Bookings.jsx hỏi "Cả nhóm / Chỉ khách này" sau khi bấm Thay Đổi
  return (
    <>
      {dragConfirm && (
        <div className="modal-overlay drag-confirm-overlay" onClick={handleDragCancel}>
          <div className="drag-confirm-popup" ref={dragConfirmRef} onClick={e => e.stopPropagation()}>
            <div className="drag-confirm-header">
              <h3 className="drag-confirm-title">Xác nhận thay đổi?</h3>
              <button className="modal-close" aria-label="Đóng" onClick={handleDragCancel} disabled={dragSaving}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M19 5L5 19" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                  <path d="M5 5L19 19" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>
            <div className="drag-confirm-body">
              <div className="drag-confirm-label">Từ:</div>
              <div className="drag-confirm-row">
                <div className="drag-confirm-time-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <span className="drag-confirm-time">{dragConfirm.fromTime}</span>
                <div className="drag-confirm-staff-badge">
                  <span className="drag-confirm-staff-initial">{getInitial(dragConfirm.fromStaff, 'A', { upper: true })}</span>
                  <span className="drag-confirm-staff-name">{dragConfirm.fromStaff}</span>
                </div>
              </div>
              <div className="drag-confirm-label">Thành:</div>
              <div className="drag-confirm-row">
                <div className="drag-confirm-time-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <span className="drag-confirm-time">{dragConfirm.toTime}</span>
                <div className="drag-confirm-staff-badge">
                  <span className="drag-confirm-staff-initial">{getInitial(dragConfirm.toStaff, 'A', { upper: true })}</span>
                  <span className="drag-confirm-staff-name">{dragConfirm.toStaff}</span>
                </div>
              </div>
            </div>
            <div className="drag-confirm-actions">
              <button className="drag-confirm-cancel" onClick={handleDragCancel} disabled={dragSaving}>Hủy, giữ nguyên</button>
              <button className="drag-confirm-submit" onClick={handleDragConfirm} disabled={dragSaving} aria-busy={dragSaving}>
                <BusyLabel busy={dragSaving} text="Đang lưu...">Thay Đổi</BusyLabel>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
