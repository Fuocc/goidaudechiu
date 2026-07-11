## Báo cáo NHÓM 3 — Edge Case & Test Phá (AI Chat Panel, Engine V2)

Đã hoàn thành toàn bộ 17 test case, dọn dẹp sạch dữ liệu QA Test và xác nhận lịch trực nhân viên không bị thay đổi vĩnh viễn.

| # | Test case | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | Gửi rỗng / chỉ dấu cách | **PASS** | Click gửi khi rỗng không có gì xảy ra; gõ 3 dấu cách rồi Enter → input tự xoá, không gửi tin nhắn nào. |
| 2 | Lệnh ghép cực dài, nhiều yêu cầu 1 lần | **FAIL (Major)** | Hệ thống xử lý được phần đầu (tạo "QA Test Long" 8h, đổi qua 9h) rồi trả lỗi kỹ thuật thô **"Lỗi: Vượt quá giới hạn vòng lặp xử lý"**, không hoàn tất các yêu cầu còn lại (đếm lịch CN1, hỏi rảnh Nị 14h, tạo Long2). |
| 3 | Spam nút gửi khi đang loading | **PASS** | Chỉ 1 tin nhắn/1 lịch được tạo, không trùng lặp. |
| 4 | Tên mơ hồ "Thảo" vs "Thảo Mai" | **PASS** | "đổi giờ QA Test Thảo qua 6h" chỉ dời đúng "Thảo" (15h→6h), "Thảo Mai" giữ nguyên 15h. |
| 5 | Đặt lịch ngoài giờ mở cửa (2h sáng, CN1 mở 9h) | **FAIL (Critical)** | AI tạo lịch thành công lúc 02:00 sáng — hoàn toàn không kiểm tra giờ mở cửa chi nhánh, không cảnh báo gì. |
| 6 | Chỉ định NV đang bận cùng giờ | **PASS** | AI dùng `check_conflicts`, từ chối tạo, hỏi đổi NV/giờ khác — không double-book. |
| 7 | Dịch vụ không tồn tại ("xyzkhongtontai123") | **FAIL (Major)** | AI **không hỏi lại** mà tự âm thầm gán dịch vụ "Giữ chỗ" (dịch vụ đặt-chỗ, hoàn toàn không liên quan) cho khách. |
| 8 | Nhân viên không tồn tại ("Zzyyxx123") | **PASS** | Báo rõ "không tồn tại trong hệ thống", không tạo lịch, không tự gán người khác. |
| 9 | "Tour hôm nay: Nị, Zzyyxx123" | **PASS** | Thêm đúng Nị vào trực, báo rõ Zzyyxx123 không tồn tại nên không thêm được. (Lần gọi đầu bị lỗi quá tải hạ tầng, lần 2 mới chạy — xem Bug hạ tầng bên dưới). |
| 10 | Hủy lịch đã hủy (double-cancel) | **PASS** | Lần 2 báo "Không tìm thấy lịch hẹn... để hủy", không crash. |
| 11 | "12h" | **PASS** | Tạo đúng 12:00 trưa (12:00–13:00), không ra 00:00 nửa đêm. |
| 12 | "7h" không rõ sáng/tối, ngoài giờ mở cửa | **FAIL (Major)** | AI hiểu là 07:00 **sáng** (trước giờ mở cửa 9h) và vẫn tạo lịch — không tự đẩy sang tối theo quy tắc kỳ vọng. Đáng chú ý: cùng lúc test 16, "3h" lại được hiểu thành 15:00 chiều — cho thấy quy tắc suy luận giờ không nhất quán. |
| 13 | 5 khách cùng giờ, không đủ NV rảnh | **PASS** | AI phát hiện chỉ 1 NV rảnh, từ chối tạo cả 5, hỏi tách giờ khác — xác nhận qua search: 0/5 lịch được tạo. |
| 14 | reassign_staff_bookings cho NV không có lịch | **PASS** | Trả lời hợp lý "Trang không có lịch hẹn nào... không có gì cần chuyển", không lỗi. |
| 15 | Câu hỏi không liên quan (thời tiết) | **PASS** | Từ chối lịch sự, không gọi tool nào, hướng lại chủ đề spa. |
| 16 | Emoji trong tên khách ("Chị Test 😊") | **PASS** | Không crash, không lỗi encode; tuy nhiên emoji bị lược bỏ âm thầm khỏi tên lưu (chấp nhận được, chỉ là quan sát phụ). |
| 17 | Trả lời tin nhắn CŨ (lịch đã bị hủy trước đó) rồi sửa | **FAIL (Critical)** | AI báo **"Đã cập nhật giờ hẹn của chị QA Test D1 sang 08:00 thành công"** dù lịch này đã bị xoá từ trước — xác minh lại bằng search_bookings cho thấy khách này **không tồn tại**. Đây là lỗi "âm thầm sai dữ liệu / hallucinate thành công" nghiêm trọng nhất theo tiêu chí đề ra. |

### Bug phát hiện thêm (ngoài dự kiến)
Trong lúc gửi lệnh liên tiếp nhanh (test 9 và 13), hệ thống 2 lần trả lỗi hạ tầng "Lỗi: AI đang quá tải, vui lòng thử lại sau 1-2 phút". Ở test 13, sau khi báo lỗi này, khi kiểm tra lại thì lịch "QA Test D3" **đã được tạo thành công ở backend** dù giao diện báo lỗi yêu cầu thử lại — thông báo lỗi gây hiểu lầm, có rủi ro user thử lại và tạo trùng lịch.

### Tổng kết Nhóm 3
12/17 PASS sạch, 5/17 FAIL. Ba lỗi ưu tiên cao nhất: (1) không kiểm tra giờ mở cửa chi nhánh khi tạo lịch (test 5, 12); (2) tự bịa dịch vụ khi gõ sai/dịch vụ không tồn tại thay vì hỏi lại (test 7); (3) hallucinate báo "thành công" khi sửa lịch đã không còn tồn tại qua reply-to (test 17) — đây là lỗi nặng nhất vì có thể khiến nhân viên spa tin rằng đã đổi giờ cho khách trong khi thực tế không có gì xảy ra.

Toàn bộ dữ liệu QA Test đã được dọn sạch, lịch trực nhân viên CN1 vẫn đủ 6 người như ban đầu. Bạn muốn tôi tiếp tục với nhóm test nào khác, hay tổng hợp báo cáo chung cho cả 3 nhóm?