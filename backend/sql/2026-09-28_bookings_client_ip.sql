-- Lưu IP của khách tự đặt từ landing page (chỉ request chưa đăng nhập; lịch do nhân viên / AI tạo để NULL).
-- Dùng cho chống spam: giới hạn slot theo IP, mỗi IP 1 bộ giữ chỗ, gắn cờ khi 1 IP đặt với nhiều SĐT.
-- Chạy 1 lần trong Supabase → SQL Editor. Chưa chạy thì backend vẫn chạy, chỉ tạm tắt các giới hạn theo IP.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS client_ip text;

CREATE INDEX IF NOT EXISTS bookings_client_ip_created_at_idx
  ON public.bookings (client_ip, created_at)
  WHERE client_ip IS NOT NULL;
