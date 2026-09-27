// Cho phép phần tử bấm được không phải <button> (div/span có onClick) dùng được bằng bàn phím:
// Tab tới được + Enter/Space để kích hoạt. Giữ nguyên thẻ và class → không đổi giao diện.
// Phím gõ bên trong phần tử con (ô nhập, nút con...) không kích hoạt phần tử cha.
export const clickableProps = (onActivate) => ({
  role: 'button',
  tabIndex: 0,
  onKeyDown: (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate(e);
    }
  }
});
