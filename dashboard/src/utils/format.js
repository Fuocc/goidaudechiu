// Chữ cái đầu của từ cuối trong tên (VD "Nguyễn Thị Lan" → "L") để hiển thị avatar.
// An toàn với tên rỗng / null / toàn khoảng trắng: trả về `fallback` thay vì làm crash trang.
export function getInitial(name, fallback = '', { upper = false } = {}) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const ch = words.length ? words[words.length - 1][0] : '';
  if (!ch) return fallback;
  return upper ? ch.toUpperCase() : ch;
}

// Chuẩn hóa tên khách: "c lan" → "Chị Lan", "a nam" → "Anh Nam", viết hoa chữ cái đầu mỗi từ
export const normalizeName = (name) => {
  if (!name) return '';
  let cleaned = name.trim();
  if (cleaned.toLowerCase().startsWith('c ')) {
    cleaned = 'Chị ' + cleaned.substring(2);
  } else if (cleaned.toLowerCase().startsWith('a ')) {
    cleaned = 'Anh ' + cleaned.substring(2);
  }
  return cleaned.split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

// Tên ngắn của chi nhánh để hiển thị trên chip/nhãn:
// "CN1 ...", "Ý Ơi CN 2 - Hoàng Hoa Thám" → "CN 1", "CN 2"; tên không theo mẫu CN → phần trước " - ".
export function shortBranchName(name) {
  const s = String(name ?? '').trim();
  const cn = s.match(/CN\s?(\d+)/i);
  if (cn) return `CN ${cn[1]}`;
  return s.split(' - ')[0] || s;
}
