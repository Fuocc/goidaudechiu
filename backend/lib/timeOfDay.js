/**
 * Giờ trong ngày dùng chung: HH:MM ↔ phút, giờ kết thúc từ giờ bắt đầu + thời lượng, "hôm nay" theo giờ VN.
 */

// "HH:MM" hoặc "HH:MM:SS" → số phút từ 0h
function toMinutes(t) {
  const [h, m] = String(t || '0:0').split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

// Số phút từ 0h → "HH:MM"
const toHHMM = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

// Giờ kết thúc = giờ bắt đầu + thời lượng (phút)
const endTime = (start, lengthMinutes) => toHHMM(toMinutes(start) + lengthMinutes);

// "Hôm nay" theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD — không phụ thuộc múi giờ của server
const vnToday = (now = new Date()) => new Date(now.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

module.exports = { toMinutes, toHHMM, endTime, vnToday };
