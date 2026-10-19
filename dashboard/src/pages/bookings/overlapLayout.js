// Xếp các lịch chồng giờ trong 1 cột nhân viên thành các làn cạnh nhau (kiểu Google Calendar).
// File .js thuần (không JSX) để chạy được test bằng node --test.

// "HH:mm" / "HH:mm:ss" → số phút trong ngày
const toMinutes = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * bookings: [{ id, start_time, end_time }] của 1 cột.
 * Trả Map id → { lane, lanes }: lane = làn (0 = trái nhất), lanes = số làn của nhóm chồng giờ chứa lịch đó.
 * - Nhóm = các lịch chồng nhau trực tiếp hoặc qua chuỗi (A chồng B, B chồng C). Chỉ chạm nhau (14:00 hết, 14:00 bắt đầu) không tính.
 * - Mỗi lịch vào làn trái nhất còn trống lúc nó bắt đầu → 1 làn có thể chứa nhiều lịch nối tiếp.
 * - Cùng giờ bắt đầu: lịch dài hơn nằm trái; bằng nhau thì theo id → kết quả không phụ thuộc thứ tự đầu vào.
 */
export function layoutOverlaps(bookings) {
  const result = new Map();
  const items = (bookings || [])
    .map(b => ({ id: b.id, start: toMinutes(b.start_time), end: toMinutes(b.end_time) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || String(a.id).localeCompare(String(b.id)));

  let group = [];       // các lịch của nhóm đang xét
  let laneEnds = [];    // giờ kết thúc của lịch cuối trong mỗi làn
  let groupEnd = -Infinity;

  const closeGroup = () => {
    for (const it of group) result.set(it.id, { lane: it.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };

  for (const it of items) {
    if (it.start >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex(end => end <= it.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    it.lane = lane;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.end);
  }
  closeGroup();
  return result;
}
