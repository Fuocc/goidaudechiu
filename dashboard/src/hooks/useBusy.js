import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Theo dõi các thao tác đang chạy (lưu, xóa, tạo...) theo key để khóa nút + đổi chữ "Đang ...".
 *
 *   const { run, isBusy } = useBusy();
 *   <button disabled={isBusy('save')} onClick={() => run('save', handleSave)}>
 *
 *  - run(key, fn): chạy fn; nếu key đó đang chạy thì bỏ qua (trả undefined) → chặn bấm liên tục.
 *    Dùng ref (đồng bộ) để chặn, vì `disabled` chỉ có hiệu lực ở lần render sau — bấm đúp nhanh vẫn lọt.
 *  - isBusy(key): key đang chạy? Không truyền key → có thao tác nào đang chạy không.
 *  - Key có thể kèm id (VD `delete:${id}`) để chỉ khóa đúng dòng đang xử lý.
 */
export function useBusy() {
  const pendingRef = useRef(new Set());
  const mountedRef = useRef(true);
  const [pending, setPending] = useState(() => new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback(async (key, fn) => {
    if (pendingRef.current.has(key)) return undefined;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    try {
      return await fn();
    } finally {
      pendingRef.current.delete(key);
      if (mountedRef.current) setPending(new Set(pendingRef.current));
    }
  }, []);

  const isBusy = useCallback(
    (key) => (key === undefined ? pending.size > 0 : pending.has(key)),
    [pending]
  );

  return { run, isBusy };
}
