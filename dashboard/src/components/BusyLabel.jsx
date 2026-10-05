// Nội dung nút khi đang xử lý: vòng xoay nhỏ + chữ "Đang ..." (VD "Đang cập nhật...").
// Không bận → hiện children như cũ. Đặt bên trong <button>, nút tự lo `disabled`.
export default function BusyLabel({ busy, text, children }) {
  if (!busy) return children;
  return (
    <span className="btn-busy">
      <span className="btn-spinner" aria-hidden="true" />
      {text && <span>{text}</span>}
    </span>
  );
}
