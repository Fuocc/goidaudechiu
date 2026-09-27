import { toast } from 'react-toastify';

// Câu mô tả lỗi dễ hiểu cho người dùng
export function describeError(err) {
  if (err?.name === 'TypeError') return 'Không kết nối được máy chủ'; // fetch lỗi mạng: "Failed to fetch"
  if (!err?.message || err.message === 'Request failed') return 'Lỗi không xác định';
  return err.message;
}

// Báo lỗi tải/lưu dữ liệu cho người dùng thay vì nuốt im lặng.
// `context` mô tả việc đang làm (VD "Không tải được danh sách khách hàng"); cũng dùng làm toastId
// để cùng một lỗi lặp lại (VD backend đang ngủ) không bắn ra hàng loạt toast.
export function notifyError(err, context = 'Đã có lỗi xảy ra') {
  console.error(`[${context}]`, err);
  toast.error(`${context}: ${describeError(err)}`, { toastId: context, position: 'bottom-right' });
}
