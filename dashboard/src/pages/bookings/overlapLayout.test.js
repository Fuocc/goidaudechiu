// Chạy: npm test (node --test). Xếp các lịch chồng giờ trong 1 cột nhân viên thành các làn cạnh nhau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOverlaps } from './overlapLayout.js';

const bk = (id, start, end) => ({ id, start_time: start, end_time: end });
const pos = (map) => Object.fromEntries([...map].map(([id, p]) => [id, `${p.lane}/${p.lanes}`]));

test('không chồng giờ → mỗi lịch 1 làn, rộng hết cột', () => {
  const r = layoutOverlaps([bk('a', '09:00', '10:00'), bk('b', '11:00', '12:00')]);
  assert.deepEqual(pos(r), { a: '0/1', b: '0/1' });
});

test('2 lịch chồng giờ → 2 làn', () => {
  const r = layoutOverlaps([bk('a', '09:00', '10:30'), bk('b', '10:00', '11:00')]);
  assert.deepEqual(pos(r), { a: '0/2', b: '1/2' });
});

test('chỉ chạm nhau (kết thúc 14:00, bắt đầu 14:00) → không tính là chồng', () => {
  const r = layoutOverlaps([bk('a', '13:00:00', '14:00:00'), bk('b', '14:00:00', '15:00:00')]);
  assert.deepEqual(pos(r), { a: '0/1', b: '0/1' });
});

test('chuỗi A–B–C (A và C không chồng) → C dùng lại làn 1, cả nhóm 2 làn', () => {
  const r = layoutOverlaps([
    bk('a', '09:00', '10:00'),
    bk('b', '09:30', '11:00'),
    bk('c', '10:00', '11:30')
  ]);
  assert.deepEqual(pos(r), { a: '0/2', b: '1/2', c: '0/2' });
});

test('3 lịch cùng giờ → 3 làn', () => {
  const r = layoutOverlaps([bk('a', '15:00', '16:00'), bk('b', '15:00', '16:00'), bk('c', '15:00', '16:00')]);
  assert.deepEqual(pos(r), { a: '0/3', b: '1/3', c: '2/3' });
});

test('các nhóm riêng trong cùng cột có số làn riêng', () => {
  const r = layoutOverlaps([
    bk('a', '09:00', '10:00'),
    bk('b', '09:00', '10:00'),
    bk('c', '09:00', '10:00'),
    bk('d', '13:00', '14:00'),
    bk('e', '13:30', '14:30'),
    bk('f', '17:00', '18:00')
  ]);
  assert.deepEqual(pos(r), { a: '0/3', b: '1/3', c: '2/3', d: '0/2', e: '1/2', f: '0/1' });
});

test('thứ tự đầu vào không đổi kết quả', () => {
  const list = [
    bk('a', '09:00', '10:00'),
    bk('b', '09:30', '11:00'),
    bk('c', '10:00', '11:30'),
    bk('d', '15:00', '16:00')
  ];
  const expected = pos(layoutOverlaps(list));
  assert.deepEqual(pos(layoutOverlaps([...list].reverse())), expected);
  assert.deepEqual(pos(layoutOverlaps([list[2], list[0], list[3], list[1]])), expected);
});

test('cùng giờ bắt đầu → lịch dài hơn nằm làn trái (giữ ổn định theo id khi bằng nhau)', () => {
  const r = layoutOverlaps([bk('short', '09:00', '09:30'), bk('long', '09:00', '11:00')]);
  assert.deepEqual(pos(r), { long: '0/2', short: '1/2' });
});

test('danh sách rỗng / không có → Map rỗng', () => {
  assert.equal(layoutOverlaps([]).size, 0);
  assert.equal(layoutOverlaps(undefined).size, 0);
});
