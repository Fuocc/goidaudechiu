// Chữ cái đầu của từ cuối trong tên (VD "Nguyễn Thị Lan" → "L") để hiển thị avatar.
// An toàn với tên rỗng / null / toàn khoảng trắng: trả về `fallback` thay vì làm crash trang.
export function getInitial(name, fallback = '', { upper = false } = {}) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const ch = words.length ? words[words.length - 1][0] : '';
  if (!ch) return fallback;
  return upper ? ch.toUpperCase() : ch;
}
