// Cài đặt thông báo theo chi nhánh, lưu trong Clerk unsafeMetadata.notifications = { muted_branch_ids: [...] }.
// Định dạng cũ { branch1, branch2 } so với ID số 1/2 trong khi ID chi nhánh là UUID → chưa từng có tác dụng,
// nên được coi như "bật tất cả".
export function getMutedBranchIds(user) {
  const ids = user?.unsafeMetadata?.notifications?.muted_branch_ids;
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
}

// Endpoint push của thiết bị hiện tại (null nếu chưa đăng ký / trình duyệt không hỗ trợ).
// Dùng getRegistration() thay vì serviceWorker.ready để không treo khi service worker chưa đăng ký được.
export async function getCurrentPushEndpoint() {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription?.endpoint || null;
  } catch (e) {
    return null;
  }
}
