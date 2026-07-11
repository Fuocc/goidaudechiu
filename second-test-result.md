# BÁO CÁO KIỂM THỬ — NHÓM 2: NGỮ CẢNH & UI CỦA CHAT PANEL

Đã hoàn tất 10 test case của Nhóm 2, dọn dẹp toàn bộ dữ liệu test, và khôi phục trạng thái ban đầu (Engine V2 ON, chi nhánh CN1, không còn lịch "QA Test..." nào sót lại, chỉ còn lịch thật "Lan - Giữ chỗ").

| # | Test case | Trạng thái | Lệnh/hành động đã dùng | Kết quả thực tế |
|---|---|---|---|---|
| 1 | Reply-to context | PASS | Tạo "QA Test R1" (15h) + "QA Test R2" (17h, decoy) → bấm Trả lời trên tin nhắn tạo R1 → gõ "đổi giờ qua 5h" | AI cập nhật đúng lịch của "Chị QA Test R1" sang 17:00, không đụng tới R2, không tạo lịch mới. Tuy nhiên phát hiện side-effect nghiêm trọng: xem Bug C dưới đây. |
| 2 | Undo (create) + double-undo | PASS | Tạo "QA Test U1" → Hoàn tác → thử bấm lại | Lịch biến mất hoàn toàn khỏi calendar. Nút "Hoàn tác" tự chuyển thành text tĩnh "ĐÃ HOÀN TÁC LỊCH HẸN" (không thể bấm lại), ngăn chặn double-undo hợp lý. |
| 3 | Undo (sau update) | PASS (có lưu ý Minor) | Tạo "QA Test U2" 13h → đổi giờ qua 14h → Hoàn tác trên tin nhắn SỬA | Backend hoàn tác đúng — sau này kiểm tra lại (qua search_bookings) xác nhận lịch trở về 13:00-14:00 chính xác. Nhưng ngay sau khi bấm Hoàn tác, modal chi tiết lịch vẫn hiển thị SAI (14:00-15:00, chưa refresh) → UI không cập nhật tức thời, dễ gây hiểu nhầm cho nhân viên. |
| 4 | Multi-turn không dùng reply-to | PASS | "Chị QA Test B 17h yvv" → (không bấm Trả lời) "đổi giờ bạn vừa tạo qua 18h" | AI hiểu đúng ngữ cảnh hội thoại, sửa đúng lịch "QA Test B" sang 18:00, không tạo/sửa nhầm. |
| 5 | Đổi chi nhánh giữa chừng | PASS | Đổi dropdown chat sang CN2 → "Chị QA Test CN2 10h ydc" | Lịch được tạo đúng tại CN2 - Hoàng Hoa Thám, nhân viên Tí (nhân viên của CN2), xác nhận qua calendar CN2. |
| 6 | Lịch sử lệnh (mũi tên lên/xuống) | PASS (có lỗi Minor) | Gõ vài lệnh, bấm Lên/Xuống nhiều lần | Mũi tên Lên/Xuống điều hướng đúng thứ tự các lệnh cũ. Lỗi Minor: gõ dở 1 nội dung chưa gửi → bấm Lên rồi bấm Xuống hết lịch sử → ô nhập bị XÓA TRẮNG thay vì khôi phục lại nội dung đang gõ dở, gây mất nội dung người dùng đang soạn. |
| 7 | Xóa lịch sử chat | FAIL (Major) | Mở dropdown chi nhánh → bấm "Xóa lịch sử chat" | Lịch sử bị xóa NGAY LẬP TỨC, KHÔNG có bất kỳ hộp thoại xác nhận (confirm) nào trước khi xóa — trái với kỳ vọng. Việc xóa có persist đúng qua localStorage (F5 lại vẫn mất, quay về màn hình "Xin chào!"). Đây là hành động không thể hoàn tác nhưng thiếu bước xác nhận an toàn. |
| 8 | Refresh giữa chừng | PASS | Đang chat dở → F5 trang | Tin nhắn cũ + kết quả AI vẫn còn nguyên sau refresh. Công tắc Engine V2 và chi nhánh CN1 vẫn giữ nguyên trạng thái. |
| 9 | Badge công cụ đầy đủ | PASS | Quan sát qua tất cả lệnh nhiều-bước trong Nhóm 1 & 2 | Mọi lệnh nhiều bước (tạo lịch, đổi giờ, đổi chi nhánh...) đều hiển thị đầy đủ chuỗi badge đúng thứ tự gọi (vd get_spa_context → get_available_staff → create_booking), không thiếu badge nào trong toàn bộ các lần kiểm tra. |
| 10 | Responsive mobile (~375px) | NOT TESTED | Dùng resize_window về 375x667, 375x800, 500x900 | Không thể kiểm thử: công cụ resize cửa sổ không có tác dụng thực tế trong môi trường này (window.innerWidth luôn giữ ~1498px dù đã thử resize nhiều lần). Đây là hạn chế công cụ của tôi, không phải lỗi ứng dụng — cần kiểm tra lại bằng cách khác (vd DevTools device toolbar thủ công) nếu muốn có kết quả chắc chắn. |

## Bug phát sinh thêm ngoài 10 test case (phát hiện trong lúc test)

**Bug C — Nghiêm trọng (Critical/Major):** `update_booking` không kiểm tra trùng lịch nhân viên khi đổi giờ qua reply-to. Ở Test 1, sau khi đổi "QA Test R1" sang 17:00, nó trùng chính xác với "QA Test R2" (cùng giờ, cùng nhân viên Nị) mà KHÔNG có bất kỳ cảnh báo nào — cả 2 lịch bị double-book, và trên calendar 1 thẻ lịch bị hiển thị đè lên thẻ khác (không thấy được cả 2). Điều này cùng nhóm với các bug check_conflicts/get_available_staff đã phát hiện ở Nhóm 1 — hệ thống kiểm tra xung đột lịch không đáng tin cậy ở nhiều tool khác nhau.

**Bug D — Nghiêm trọng (Major, silent wrong action):** Trong lúc dọn dẹp, tôi gõ nhầm "Hầy lịch QA Test U2" (lỗi chính tả "Hầy" thay vì "Hủy"). AI vẫn hiểu là lệnh hủy lịch và trả lời mơ hồ "Đã hủy lịch của chị QA Test." (không nêu rõ tên khách cụ thể) — nhưng thực tế nó đã hủy NHẦM lịch của một khách khác ("QA Test Refresh") thay vì "QA Test U2" như yêu cầu. "QA Test U2" vẫn còn nguyên trên lịch. Đây là lỗi silent wrong data nghiêm trọng: AI thực hiện sai hành động xóa dữ liệu mà không báo lỗi hay hỏi lại xác nhận khi tên khách không khớp chính xác.

**Lưu ý về hạ tầng (không tính là bug của AI Chat Panel):** Giữa lúc test, server backend gặp downtime khoảng 1-2 phút (toàn bộ API trả về lỗi 503, kể cả tải trang), gây ra vài lỗi "Lỗi: Failed to fetch" khi gửi lệnh AI. Đây là lỗi hạ tầng/dev server, không phải lỗi logic của tính năng, nhưng có thể ảnh hưởng đến trải nghiệm thực tế nếu xảy ra ở production.

## Tổng kết Nhóm 2
PASS hoàn toàn: 5/10 (test 2, 4, 5, 8, 9). PASS có lưu ý Minor: 2/10 (test 3, 6). FAIL: 1/10 (test 7 — thiếu xác nhận trước khi xóa). NOT TESTED: 1/10 (test 10 — hạn chế công cụ). Test 1 về bản chất reply-to là PASS nhưng phát sinh Bug C nghiêm trọng.

Top bug ưu tiên xử lý (tính luôn cả Nhóm 1 đã báo cáo trước): việc các tool ghi/sửa/xóa dữ liệu (update_booking, delete_booking, check_conflicts, get_available_staff) đều không xử lý tốt việc kiểm tra trùng lịch hoặc khớp tên khách chính xác trước khi thực hiện — nhóm lỗi này lặp lại nhiều lần và có nguy cơ gây double-booking hoặc xóa nhầm dữ liệu khách hàng trong thực tế.