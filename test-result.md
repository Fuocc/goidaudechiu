# BÁO CÁO QA — AI Chat Panel (Engine V2 - Agent) — Ý Ơi Spa

**Môi trường:** localhost:5173 (dev/staging) | **Chi nhánh test:** CN 1 - Lê Văn Huân | **Engine:** V2 (Agent) suốt quá trình | **Ngày hệ thống:** T7, 11/7/2026

Toàn bộ dữ liệu test (khách "QA Test ...", 2 lịch tạo cho Trân) đã được dọn sạch bằng chính AI chat; trạng thái tour trực của T7 11/7 và chi nhánh của Trân/Hân đã được khôi phục nguyên trạng (kiểm chứng lại qua reload trang Lịch NV). Booking thật "Lan - Giữ chỗ 2:00-3:15PM" không bị đụng tới.

## Bảng kết quả chi tiết

| # | Tool | Trạng thái | Lệnh đã gõ | Kết quả thực tế |
|---|------|-----------|-----------|------------------|
| 1 | search_bookings | **PASS** | "Chị QA Test Search 11h ydc" → "Tìm lịch của QA Test Search hôm nay" | Tạo đúng lịch 11:00-12:00 với Nị; search trả đúng thông tin, khớp calendar. Badge: search_bookings/get_spa_context/get_available_staff/create_booking rồi search_bookings. Không lỗi console. |
| 2 | create_booking | **PASS** | "Chị QA Test A 15h ydc" | Tạo đúng 15:00-16:00, tự gán Nị (đang rảnh). Badge: get_spa_context, get_available_staff, create_booking. Khớp calendar. |
| 3 | update_booking (giờ) | **PASS** | "Đổi giờ QA Test A qua 16h" | Dời đúng sang 16:00-17:00 (tính lại đúng 60 phút của ydc). Badge: search_bookings, get_available_staff, update_booking. |
| 4 | update_booking (đổi thợ) | **PASS** | "Đổi thợ cho QA Test A sang Hân" | Đổi thành công sang Hân, giữ đúng giờ 16:00. Badge: search_bookings, get_spa_context, check_conflicts, update_booking. **Xác nhận bug "employee_ids column" đã được fix**, không còn lỗi kỹ thuật. |
| 5 | check_in_booking | **PASS** (Minor) | "QA Test A tới rới" | Booking dời đúng sang giờ hiện tại làm tròn (21:45, do giờ hệ thống thực tế là 21:42). Đúng logic. Điểm nhỏ: câu trả lời text không nói rõ giờ mới, chỉ nói "đã cập nhật trạng thái" — thiếu thông tin cụ thể. |
| 6 | delete_booking | **PASS** | "Hủy lịch QA Test A" | Hủy thành công, biến mất khỏi calendar. Badge: search_bookings, delete_booking. |
| 7 | get_available_staff | **FAIL — Major** | "Có nhân viên nào rảnh lúc 14h hôm nay không?" | AI trả lời: "Nị, Trân, Nhung, Trang, Anh và Hân" đều rảnh lúc 14h. **Sai**: Hân đang có lịch thật "Lan - Giữ chỗ" 14:00-15:15 (dịch vụ "Giữ chỗ" 75 phút, xác nhận qua trang Dịch vụ là dịch vụ đang Hoạt động, không phải placeholder ảo). Không báo lỗi, không hỏi lại — đây là silent wrong data, có thể dẫn tới double-book Hân. |
| 8 | get_spa_context | **PASS** (Minor) | "Dịch vụ ydc là dịch vụ gì?" | Trả lời đúng tên + thời lượng (60 phút). Đối chiếu trang Dịch vụ: đúng, giá thật là 179.000đ nhưng AI không đề cập giá — thiếu một phần thông tin so với kỳ vọng test case. |
| 9 | set_staff_duty | **PASS** | "Tour hôm nay: Hân Nị Anh" | Cập nhật đúng, đối chiếu trang Lịch NV: Hân/Nị/Anh = "Trực theo tour", Nhung/Trân/Trang = "Nghỉ theo tour" cho đúng ngày T7 11/7. |
| 10 | get_branches | **PASS** | "Chi nhánh nào mở cửa sớm nhất chủ nhật?" | Trả lời CN3 - Lê Đức Thọ, 08:00. Đối chiếu trang Chi nhánh: đúng (CN3 Chủ Nhật 8AM-8PM, còn CN1/CN2 là 9AM-10PM). |
| 11 | get_daily_summary | **PASS** (Minor) | "Hôm nay chi nhánh này còn slot không?" | Trả lời có tên nhân viên rảnh cụ thể (Nị, Anh, Hân) nhưng **không có số liệu tổng lịch hẹn hôm nay** như test case yêu cầu — câu trả lời hơi chung, thiếu 1 chỉ số quan trọng. |
| 12 | check_conflicts | **FAIL — Critical** | "Kiểm tra Hân có bận lúc 3h chiều nay không" | AI trả lời: "Hân không bận vào lúc 15:00 chiều nay." **Sai hoàn toàn** — Hân có lịch "Lan - Giữ chỗ" 14:00-15:15, tức đang bận tại đúng thời điểm 15:00. Không báo lỗi, đưa thông tin sai tuyệt đối, nguy cơ double-book nếu người dùng tin theo. |
| 13 | reassign_staff_bookings | **PASS** | Tạo "QA Test D 12h ydc với Trân" + "QA Test E 14h ydc với Trân" → "Dồn hết lịch của Trân hôm nay cho người khác" | Dồn đúng 2 lịch sang Nị (đang rảnh cả 2 khung giờ), không double-book. Badge: get_spa_context, reassign_staff_bookings. |
| 14 | move_staff_to_branch | **PASS** | "Chuyển Trân sang CN 2" → "Chuyển Trân về lại CN 1" | Đổi đúng, revert đúng, đối chiếu trang Nhân viên/Lịch NV khớp. |

## Bug phát sinh thêm trong quá trình test (ngoài 14 case, nhưng liên quan trực tiếp)

**Bug A — set_staff_duty "xóa/bỏ tour" báo thành công nhưng KHÔNG cập nhật dữ liệu thật (Critical, silent no-op).** Khi dọn dẹp, tôi gõ "Bỏ lịch trực tour hôm nay, cho tất cả nhân viên đi làm bình thường không theo tour". AI trả lời: "Đã xóa lịch trực tour của ngày hôm nay. Tất cả nhân viên đã được đưa về trạng thái đi làm bình thường." — nhưng khi đối chiếu (và cả sau khi F5 reload) trang Lịch NV, trạng thái "Trực theo tour"/"Nghỉ theo tour" của T7 11/7 **hoàn toàn không đổi**. Tôi phải vào sửa tay từng nhân viên trong Lịch NV để khôi phục đúng baseline. Đây là dạng bug nguy hiểm nhất theo tiêu chí đề bài: AI báo thành công nhưng dữ liệu thật không đổi.

**Bug B — Lỗi kỹ thuật thô lộ ra khi hủy nhiều lịch cùng lúc (Major).** Lệnh "Hủy lịch QA Test Search, QA Test D và QA Test E" (3 tên trong 1 câu) khiến AI trả về nguyên văn: **"Lỗi: Vượt quá giới hạn vòng lặp xử lý"**. Console log xác nhận exception thật từ app: `AI Command Error: Error: Vượt quá giới hạn vòng lặp xử lý` tại `api.js:16`. Thực tế 2/3 lịch (Search, D) đã bị hủy thành công trước khi lỗi xảy ra, còn lịch E vẫn còn treo — tức là silent partial-failure kèm lộ lỗi kỹ thuật thô cho người dùng. Lưu ý: cùng dạng lệnh hủy 3 tên trong log lịch sử cũ (trước khi tôi bắt đầu) từng chạy thành công, nên bug này có thể **flaky** — cần lập trình viên kiểm tra logic giới hạn vòng lặp của agent khi xử lý nhiều tool-call liên tiếp.

## Tổng kết

- **PASS:** 10/14 (test 1, 2, 3, 4, 6, 9, 10, 13, 14, và 5/8/11 PASS nhưng có ghi chú Minor)
- **PASS có ghi chú Minor:** 5, 8, 11 (đã tính trong PASS ở trên, tổng cộng 3 case có điểm trừ nhỏ)
- **FAIL:** 2/14 (test 7 — Major, test 12 — Critical)
- **FLAKY:** 0/14 chính thức, nhưng Bug B (lỗi vòng lặp) có dấu hiệu flaky
- **NOT TESTED:** 0/14

### Top 3 bug nghiêm trọng nhất cần fix trước khi giao khách hàng

1. **(Critical) check_conflicts trả lời sai hoàn toàn** — báo nhân viên "không bận" trong khi thực tế đang có lịch hẹn active tại đúng thời điểm hỏi. Nguy cơ double-booking trực tiếp cho khách hàng thật.
2. **(Critical) set_staff_duty không thực sự xóa/reset tour trực** — AI báo thành công nhưng dữ liệu không đổi (silent no-op), rất nguy hiểm vì manager sẽ tin vào lời AI mà không kiểm tra lại, dẫn đến lịch trực sai âm thầm tồn đọng.
3. **(Major) get_available_staff bỏ sót lịch loại "Giữ chỗ" khi tính rảnh/bận** — cùng nguyên nhân gốc với bug #1 (có vẻ 2 tool này dùng chung logic lấy lịch bận nhưng đang lọc sai/loại trừ nhầm loại dịch vụ "Giữ chỗ"), nên khả năng cao đây là 1 lỗi gốc duy nhất ảnh hưởng cả check_conflicts và get_available_staff — ưu tiên fix gốc rễ cho cả 2.

Ngoài ra nên xem lại giới hạn "vòng lặp xử lý" của agent khi xử lý lệnh có nhiều đối tượng cùng lúc (Bug B), và bổ sung giá dịch vụ + tổng số lịch hẹn vào câu trả lời của get_spa_context/get_daily_summary để đầy đủ thông tin hơn (Minor).