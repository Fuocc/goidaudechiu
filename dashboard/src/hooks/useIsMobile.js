import { useEffect, useState } from 'react';

// Trùng với breakpoint trong CSS (@media max-width: 768px)
export const MOBILE_BREAKPOINT = 768;

// true khi màn hình ≤ 768px; tự cập nhật khi đổi kích thước cửa sổ
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
}
