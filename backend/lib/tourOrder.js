/**
 * Thứ tự tour nhân viên theo chi nhánh.
 * Nguồn duy nhất: settings.tour_order_<branch_id> = mảng employee_id theo thứ tự ưu tiên
 * (ghi bởi tab Settings "Xếp Tour" và lệnh AI set_staff_duty).
 */

async function loadTourOrder(supabase, branchId) {
  if (!branchId) return [];
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', `tour_order_${branchId}`)
    .maybeSingle();
  return Array.isArray(data?.value) ? data.value : [];
}

// Người có trong tour xếp theo thứ tự tour, người ngoài tour xếp sau (giữ nguyên thứ tự gốc).
// Trả về mảng mới, không sửa mảng truyền vào.
function sortByTourOrder(list, tourOrder, getId = (item) => item.id) {
  return [...list].sort((a, b) => {
    const idxA = tourOrder.indexOf(getId(a));
    const idxB = tourOrder.indexOf(getId(b));
    if (idxA === -1 && idxB === -1) return 0;
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
}

module.exports = { loadTourOrder, sortByTourOrder };
