-- Booking guard (ROADMAP.md › 1): ghi lịch "khóa → kiểm tra lại → ghi" trong MỘT transaction.
-- Backend lên kế hoạch (chọn NV / giường) bằng JS, rồi gọi booking_guard_write() để:
--   1) khóa theo NGÀY (pg_advisory_xact_lock, sắp xếp ngày tăng dần → 2 lệnh dời lịch qua 2 ngày không khóa chéo nhau),
--   2) kiểm tra lại trùng NV (có buffer) / trùng giường (không buffer) — bỏ qua lịch đã hủy và giữ chỗ đã hết hạn,
--   3) không trùng → insert / update; có trùng → trả danh sách, KHÔNG ghi gì.
-- Hai request cùng lúc vào cùng ngày sẽ chạy lần lượt → không còn 2 lịch cùng NV / giường.
--
-- AN TOÀN:
--  - CHỈ THÊM (3 hàm + 1 index). KHÔNG sửa / xóa dòng dữ liệu nào, KHÔNG đổi cột nào của bảng.
--  - Cả file nằm trong 1 transaction (BEGIN … COMMIT): lỗi ở bất kỳ bước nào → không có gì được áp dụng.
--  - Chạy lại nhiều lần vẫn an toàn (CREATE OR REPLACE / IF NOT EXISTS).
--
-- CHẠY THỬ (không lưu gì): đổi dòng COMMIT cuối file thành ROLLBACK rồi Run. Không báo lỗi → đổi lại COMMIT, Run thật.
-- GỠ: chạy khối ROLLBACK ở cuối file (gỡ sạch 100% vì file không đụng tới dữ liệu).

BEGIN;

-- 0) Cột hạn giữ chỗ đã có sẵn trong bảng (chưa code nào dùng) — chỉ KIỂM TRA, không sửa
DO $$
BEGIN
  IF coalesce((SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'hold_expires_at'), '?')
     <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'bookings.hold_expires_at không có hoặc không phải timestamptz — dừng lại, báo Claude kiểm tra';
  END IF;
END $$;

-- 1) Hàm phụ
-- Giờ → số phút trong ngày (tránh time + interval bị quay vòng qua nửa đêm khi cộng buffer)
CREATE OR REPLACE FUNCTION public.booking_guard_min(t time)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT (extract(epoch FROM t) / 60)::integer
$$;

-- Lịch giữ chỗ đã hết hạn → không còn chặn slot (kể cả khi chưa được dọn).
-- Hạn lấy theo thứ tự: cột hold_expires_at → "EXPIRES:<ms>" trong ghi chú (giữ chỗ cũ) → 10 phút sau khi tạo.
CREATE OR REPLACE FUNCTION public.booking_guard_hold_expired(b public.bookings)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT b.status = 'pending'
     AND coalesce(b.internal_note, '') LIKE '[GIỮ CHỖ TẠM THỜI]%'
     AND coalesce(
           b.hold_expires_at,
           to_timestamp((substring(b.internal_note FROM 'EXPIRES:(\d{1,15})'))::bigint / 1000.0),
           b.created_at + interval '10 minutes'
         ) <= now()
$$;

-- 2) Hàm chính
-- p = {
--   "lock_dates":  ["2026-11-09", ...],                 -- mọi ngày bị ghi (ngày cũ + ngày mới khi dời lịch)
--   "exclude_ids": ["<uuid>", ...],                     -- lịch đang được dời (không tính trùng với chỗ cũ của chính nó)
--   "checks": [{ "ref": 0, "date": "...", "start_time": "15:00", "end_time": "16:00",
--                "employee_id": "<uuid>|null", "employee_buffer": 0, "bed_id": "<uuid>|null" }],
--   "inserts": [{ ...cột bookings... }],               -- chỉ các cột có trong object được ghi; cột khác giữ DEFAULT
--   "updates": [{ "id": "<uuid>", "set": { ...cột... } }]
-- }
-- Trả về { ok: true, ids: [...insert..., ...update...] } hoặc { ok: false, conflicts: [...] }
CREATE OR REPLACE FUNCTION public.booking_guard_write(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  d date;
  chk jsonb;
  r jsonb;
  cols text;
  sets text;
  new_id uuid;
  ids uuid[] := '{}';
  conflicts jsonb := '[]'::jsonb;
  excl uuid[];
  s_min integer;
  e_min integer;
  buf integer;
BEGIN
  -- 1) Khóa theo ngày, thứ tự cố định
  FOR d IN
    SELECT DISTINCT x::date FROM jsonb_array_elements_text(coalesce(p->'lock_dates', '[]'::jsonb)) x ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('booking_guard:' || d::text, 0));
  END LOOP;

  excl := coalesce(
    (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(coalesce(p->'exclude_ids', '[]'::jsonb)) x),
    '{}'::uuid[]);

  -- 2) Kiểm tra lại sau khi đã khóa
  FOR chk IN SELECT * FROM jsonb_array_elements(coalesce(p->'checks', '[]'::jsonb))
  LOOP
    s_min := booking_guard_min((chk->>'start_time')::time);
    e_min := booking_guard_min((chk->>'end_time')::time);
    buf := coalesce((chk->>'employee_buffer')::integer, 0);

    IF nullif(chk->>'employee_id', '') IS NOT NULL THEN
      conflicts := conflicts || coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'type', 'employee_busy', 'ref', chk->'ref', 'id', b.id, 'employee_id', b.employee_id,
          'customer_name', coalesce(b.temporary_name, c.name, 'Khách'),
          'start_time', to_char(b.start_time, 'HH24:MI'), 'end_time', to_char(b.end_time, 'HH24:MI')))
        FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
        WHERE b.booking_date = (chk->>'date')::date
          AND b.employee_id = (chk->>'employee_id')::uuid
          AND b.status <> 'cancelled'
          AND b.id <> ALL (excl)
          AND NOT booking_guard_hold_expired(b)
          AND s_min < booking_guard_min(b.end_time) + buf
          AND booking_guard_min(b.start_time) < e_min
      ), '[]'::jsonb);
    END IF;

    IF nullif(chk->>'bed_id', '') IS NOT NULL THEN
      conflicts := conflicts || coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'type', 'bed_busy', 'ref', chk->'ref', 'id', b.id, 'bed_id', b.bed_id,
          'customer_name', coalesce(b.temporary_name, c.name, 'Khách'),
          'start_time', to_char(b.start_time, 'HH24:MI'), 'end_time', to_char(b.end_time, 'HH24:MI')))
        FROM bookings b LEFT JOIN customers c ON c.id = b.customer_id
        WHERE b.booking_date = (chk->>'date')::date
          AND b.bed_id = (chk->>'bed_id')::uuid
          AND b.status <> 'cancelled'
          AND b.id <> ALL (excl)
          AND NOT booking_guard_hold_expired(b)
          AND s_min < booking_guard_min(b.end_time)
          AND booking_guard_min(b.start_time) < e_min
      ), '[]'::jsonb);
    END IF;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'conflicts', conflicts);
  END IF;

  -- 3) Ghi: chỉ các cột được gửi lên (cột không gửi giữ DEFAULT khi insert / giữ nguyên khi update)
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'inserts', '[]'::jsonb))
  LOOP
    SELECT string_agg(format('%I', k), ', ') INTO cols FROM jsonb_object_keys(r) k;
    EXECUTE format('INSERT INTO bookings (%s) SELECT %s FROM jsonb_populate_record(NULL::bookings, $1) RETURNING id', cols, cols)
      USING r INTO new_id;
    ids := ids || new_id;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p->'updates', '[]'::jsonb))
  LOOP
    SELECT string_agg(format('%1$I = src.%1$I', k), ', ') INTO sets FROM jsonb_object_keys(r->'set') k;
    IF sets IS NULL THEN CONTINUE; END IF;
    EXECUTE format('UPDATE bookings b SET %s FROM jsonb_populate_record(NULL::bookings, $1) src WHERE b.id = $2', sets)
      USING r->'set', (r->>'id')::uuid;
    ids := ids || (r->>'id')::uuid;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ids', to_jsonb(ids));
END;
$$;

-- Chỉ backend (service_role) được gọi — không mở cho trình duyệt (anon / authenticated)
REVOKE ALL ON FUNCTION public.booking_guard_write(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_guard_hold_expired(public.bookings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_guard_min(time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_guard_write(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_guard_hold_expired(public.bookings) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_guard_min(time) TO service_role;

-- 3) Index cho truy vấn kiểm tra trùng theo ngày
CREATE INDEX IF NOT EXISTS bookings_guard_date_idx
  ON public.bookings (booking_date)
  WHERE status <> 'cancelled';

-- Tự kiểm tra trong transaction: lệnh rỗng phải chạy được, nếu không → cả file bị hủy
DO $$
BEGIN
  IF public.booking_guard_write('{}'::jsonb) <> '{"ok": true, "ids": []}'::jsonb THEN
    RAISE EXCEPTION 'booking_guard_write tự kiểm tra thất bại';
  END IF;
END $$;

COMMIT;

-- Kiểm tra sau khi chạy (phải trả {"ok": true, "ids": []}):
--   SELECT public.booking_guard_write('{}'::jsonb);

-- ============================ ROLLBACK (gỡ) ============================
-- Thứ tự gỡ: trả backend về code cũ TRƯỚC (code mới cần hàm này để ghi lịch), rồi mới chạy khối dưới.
-- File không sửa dữ liệu nào → gỡ xong là database y như trước khi chạy.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.booking_guard_write(jsonb);
-- DROP FUNCTION IF EXISTS public.booking_guard_hold_expired(public.bookings);
-- DROP FUNCTION IF EXISTS public.booking_guard_min(time);
-- DROP INDEX IF EXISTS public.bookings_guard_date_idx;
-- COMMIT;
