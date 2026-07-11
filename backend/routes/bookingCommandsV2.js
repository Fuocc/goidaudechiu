const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = 'gemini-3.1-flash-lite'; //250 requests/day

const stripDiacritics = (str) => str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/*1. AI Tools*/
const spaTools = [
  {
    name: "set_staff_duty",
    description: "Phân chia lịch tour trực nhân viên trong ngày cho chi nhánh hiện tại. Nhân viên KHÔNG có tên trong danh sách sẽ tự động nghỉ (OFF_DUTY). Nếu tên thuộc về nhân viên đang ở chi nhánh khác, hệ thống sẽ TỰ ĐỘNG chuyển nhân viên đó sang chi nhánh hiện tại. Dùng khi lệnh dạng 'Tour ...' hoặc chỉ liệt kê tên nhân viên theo thứ tự, không có giờ hẹn/tên khách/dịch vụ.",
    parameters: {
      type: "object",
      properties: {
        orderedStaffNames: {
          type: "array",
          items: { type: "string" },
          description: "Danh sách tên nhân viên theo đúng thứ tự xuất hiện trong lệnh (thứ tự tour). Bỏ số thứ tự (1., 2.) và dòng phân cách."
        },
        date: {
          type: "string",
          description: "Ngày áp dụng dạng YYYY-MM-DD. Mặc định hôm nay nếu lệnh không nói rõ ngày."
        }
      },
      required: ["orderedStaffNames"]
    }
  },
  {
    name: "search_bookings",
    description: "Tìm kiếm lịch hẹn theo tên khách, ngày, giờ hoặc chi nhánh.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tên khách hàng cần tìm (ví dụ: 'Vy', 'Thảo')." },
        date: { type: "string", description: "Ngày hẹn định dạng YYYY-MM-DD. Mặc định là hôm nay nếu không nói rõ." },
        time: { type: "string", description: "Giờ hẹn HH:MM để lọc theo giờ." },
        branch_id: { type: "string" }
      }
    }
  },
  {
    name: "create_booking",
    description: "Tạo một hoặc nhiều lịch hẹn mới sau khi đã kiểm tra thông tin.",
    parameters: {
      type: "object",
      properties: {
        temporary_name: { type: "string", description: "Tên khách kèm tiền tố chuẩn hóa (ví dụ: 'Chị Vy', 'Anh Nam')." },
        booking_date: { type: "string", description: "Ngày đặt lịch dạng YYYY-MM-DD." },
        start_time: { type: "string", description: "Giờ bắt đầu dạng HH:MM (24h format)." },
        num_guests: { type: "integer", default: 1, description: "Số lượng khách đi cùng nhóm (ví dụ: '3ng', '3 khách', '3 người', '3yvv', '3cb17' -> 3)"},
        service_id: { type: "string", description: "UUID của dịch vụ chính." },
        extra_service_ids: { 
          type: "array", 
          items: { type: "string" },
          description: "UUID của các dịch vụ bổ sung (nếu có). Ví dụ: ['uuid2', 'uuid3']" 
        },
        employee_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUID nhân viên theo thứ tự khách. Bỏ qua hoặc dùng null nếu khách không chọn thợ. Ví dụ: 2 khách, chỉ khách 2 chọn Hân → [null, 'uuid-hân']."
        },
        duration_minutes: { type: "integer", description: "Thời lượng tùy chỉnh tính bằng phút." },
        is_walk_in: { type: "boolean", description: "True nếu khách đến trực tiếp không đặt trước." },
        notes: { type: "string", description: "Ghi chú bổ sung." }
      },
      required: ["temporary_name", "booking_date", "start_time", "service_id"]
    }
  },
  {
    name: "update_booking",
    description: "Cập nhật hoặc điều chỉnh một lịch hẹn hiện có qua ID. Nếu lịch thuộc một nhóm khách đi cùng (đặt chung nhiều người) và lệnh là dời giờ/ngày, chỉ cần truyền 1 booking_id đại diện — hệ thống sẽ tự dời cả nhóm.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "UUID của lịch hẹn cần sửa." },
        booking_ids: {
          type: "array",
          items: { type: "string" },
          description: "Dùng khi cần cập nhật nhiều lịch hẹn cụ thể cùng lúc (ví dụ search_bookings trả về nhiều kết quả trùng tên cần sửa hết)."
        },
        start_time: { type: "string", description: "Giờ mới HH:MM nếu có thay đổi." },
        status: { type: "string", enum: ["confirmed", "arrived", "pending", "cancelled"] },
        branch_id: { type: "string", description: "UUID chi nhánh mới nếu khách muốn đổi chi nhánh." },
        status: { type: "string", enum: ["confirmed", "arrived", "pending", "cancelled", "completed"] },
        employee_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUID nhân viên mới nếu đổi thợ. 1 nhân viên cho 1 khách."
        },
        num_guests: { type: "integer", description: "Số khách mới nếu thay đổi." },
        notes: { type: "string", description: "Ghi chú cập nhật." },
        service_id: { type: "string", description: "UUID dịch vụ mới nếu thay đổi." },
        extra_service_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUID các dịch vụ bổ sung nếu có."
        },
      },
      required: ["booking_id"]
    }
  },
  {
    name: "check_in_booking",
    description: "Cập nhật khách đã đến: tự động set giờ hiện tại làm start_time, tính lại end_time theo dịch vụ, cập nhật status = arrived. Gọi sau search_bookings.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "UUID của lịch hẹn cần check-in." }
      },
      required: ["booking_id"]
    }
  },
  {
    name: "delete_booking",
    description: "Hủy hoặc xóa một lịch hẹn theo ID.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "UUID của lịch hẹn cần hủy." },
        cancel_group: { type: "boolean", description: "True nếu muốn hủy toàn bộ nhóm." }
      },
      required: ["booking_id"]
    }
  },
  {
    name: "get_available_staff",
    description: "Lấy danh sách nhân viên rảnh tại một thời điểm cụ thể. Dùng trước khi tạo hoặc cập nhật lịch để tránh đặt trùng.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Ngày YYYY-MM-DD." },
        start_time: { type: "string", description: "Giờ bắt đầu HH:MM." },
        end_time: { type: "string", description: "Giờ kết thúc HH:MM." },
        duration_minutes: { 
          type: "integer", 
          description: "Thời lượng dịch vụ tính bằng phút. Dùng để tính end_time khi kiểm tra lịch trống." 
        },
        branch_id: { type: "string" }
      },
      required: ["date", "start_time"]
    }
  },
  {
    name: "get_spa_context",
    description: "Lấy danh sách tất cả dịch vụ và nhân viên đang hoạt động tại chi nhánh. Gọi tool này ĐẦU TIÊN nếu lệnh đề cập đến tên dịch vụ hoặc nhân viên cụ thể.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_branches",
    description: "Lấy danh sách tất cả chi nhánh kèm giờ hoạt động đầy đủ theo từng ngày trong tuần. Dùng để kiểm tra giờ mở cửa khi đặt lịch cho ngày không phải hôm nay, hoặc xác định tên/ID chi nhánh.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_daily_summary",
    description: "Lấy tóm tắt lịch hẹn trong ngày tại một chi nhánh: tổng số lịch, số lượng theo trạng thái, nhân viên đang rảnh ngay bây giờ, và các lịch sắp tới. Dùng khi nhân viên hỏi 'hôm nay còn slot nào?', 'hôm nay đông không?'.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Ngày YYYY-MM-DD. Mặc định hôm nay." },
        branch_id: { type: "string" }
      }
    }
  },
  {
    name: "check_conflicts",
    description: "Kiểm tra một nhân viên có bị trùng lịch tại một khung giờ cụ thể hay không. Gọi trước khi xác nhận gán/đổi nhân viên cho lịch hẹn để tránh double-booking.",
    parameters: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID nhân viên cần kiểm tra." },
        date: { type: "string", description: "Ngày YYYY-MM-DD. Mặc định hôm nay." },
        start_time: { type: "string", description: "Giờ bắt đầu HH:MM." },
        end_time: { type: "string", description: "Giờ kết thúc HH:MM." },
        duration_minutes: { type: "integer", description: "Thời lượng phút, dùng để tính end_time nếu không có sẵn." }
      },
      required: ["employee_id", "start_time"]
    }
  },
  {
    name: "reassign_staff_bookings",
    description: "Chuyển toàn bộ lịch hẹn còn hiệu lực trong ngày của một nhân viên sang nhân viên khác đang rảnh. Dùng khi nhân viên A nghỉ đột xuất, hoặc chuyển hẳn sang chi nhánh khác và cần dồn lịch cũ cho người còn lại.",
    parameters: {
      type: "object",
      properties: {
        from_employee_id: { type: "string", description: "UUID nhân viên cần chuyển lịch đi." },
        to_employee_id: { type: "string", description: "UUID nhân viên nhận lịch. Bỏ qua để hệ thống tự chọn người rảnh cho từng lịch." },
        date: { type: "string", description: "Ngày YYYY-MM-DD. Mặc định hôm nay." }
      },
      required: ["from_employee_id"]
    }
  },
  {
    name: "move_staff_to_branch",
    description: "Chuyển một nhân viên từ chi nhánh hiện tại sang chi nhánh khác (cập nhật chi nhánh cố định của nhân viên, đặt về OFF_DUTY). KHÔNG tự động chuyển các lịch hẹn cũ — gọi thêm reassign_staff_bookings nếu cần dồn lịch cho người khác.",
    parameters: {
      type: "object",
      properties: {
        employee_id: { type: "string", description: "UUID nhân viên cần chuyển." },
        new_branch_id: { type: "string", description: "UUID chi nhánh mới." }
      },
      required: ["employee_id", "new_branch_id"]
    }
  }
];

/*2. Tool Execution */
async function executeTool(toolName, params, context) {
  const { supabase, branch_id, todayDateStr, dbBranches } = context;

  switch (toolName) {
    case 'set_staff_duty': {
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});
      const targetBranch = branch_id;

      if (!targetBranch) {
        return { error: 'Không xác định được chi nhánh. Vui lòng chọn chi nhánh trước.' };
      }

      const orderedStaffNames = (params.orderedStaffNames || []).map(n => (n || '').trim()).filter(Boolean);
      if (orderedStaffNames.length === 0) {
        return { error: 'Danh sách nhân viên trống.' };
      }

      const scheduleDate = params.date || todayDateStr;

      // Step 1: Reset ALL employees of this branch to OFF_DUTY
      const { error: resetErr } = await supabase
        .from('employees')
        .update({ status: 'OFF_DUTY', current_tour_order: null })
        .eq('branch_id', targetBranch);
      if (resetErr) return { error: resetErr.message };

      // Step 2: Fetch ALL active employees (every branch) so names from other
      // branches can be matched and transferred in.
      const { data: allActiveEmployees } = await supabase
        .from('employees')
        .select('id, name, branch_id, is_active')
        .eq('is_active', true);

      const branchEmployees = (allActiveEmployees || []).filter(e => e.branch_id === targetBranch);
      const otherBranchEmployees = (allActiveEmployees || []).filter(e => e.branch_id !== targetBranch);

      const findByName = (pool, normalizedInput) => pool.find(emp => {
        const empNorm = stripDiacritics(emp.name);
        const empParts = empNorm.split(/\s+/);
        const firstName = empParts[empParts.length - 1];
        return firstName === normalizedInput || empNorm === normalizedInput;
      });

      const matchedIds = [];
      const matchedNames = [];
      const unmatchedNames = [];
      const transferredEmployees = []; // { id, name, fromBranchId }
      let updatedCount = 0;

      for (let i = 0; i < orderedStaffNames.length; i++) {
        const inputName = orderedStaffNames[i];
        const normalizedInput = stripDiacritics(inputName);

        // Prefer a match already in this branch; only fall back to other
        // branches when the name isn't found locally.
        let matched = findByName(branchEmployees, normalizedInput);
        let isTransfer = false;
        if (!matched) {
          matched = findByName(otherBranchEmployees, normalizedInput);
          isTransfer = !!matched;
        }

        if (!matched) {
          unmatchedNames.push(inputName);
          continue;
        }

        const updatePayload = { status: 'ON_DUTY', current_tour_order: i + 1 };
        if (isTransfer) updatePayload.branch_id = targetBranch;

        const { error: updErr } = await supabase
          .from('employees')
          .update(updatePayload)
          .eq('id', matched.id);

        if (updErr) {
          console.error(`Error updating employee ${matched.name}:`, updErr);
          continue;
        }

        matchedIds.push(matched.id);
        matchedNames.push(matched.name);
        updatedCount++;

        if (isTransfer) {
          transferredEmployees.push({ id: matched.id, name: matched.name, fromBranchId: matched.branch_id });
          // Reflect the move locally so the schedule upsert below picks them up too
          matched.branch_id = targetBranch;
          branchEmployees.push(matched);
        }
      }

      // Step 3: Upsert employee_schedules for scheduleDate (doesn't touch branch_id —
      // this table has no branch column, so the "Lịch NV" page is unaffected).
      const d = new Date(scheduleDate + 'T00:00:00');
      const day = d.getDay();
      const defaultStart = (day === 0 || day === 6) ? '09:00' : '10:00';
      const defaultEnd = '22:00';

      const scheduleRecords = branchEmployees.map(emp => {
        const isOnDuty = matchedIds.includes(emp.id);
        return {
          employee_id: emp.id,
          date: scheduleDate,
          start_time: isOnDuty ? defaultStart : null,
          end_time: isOnDuty ? defaultEnd : null,
          is_day_off: !isOnDuty,
          note: isOnDuty ? 'Trực theo tour' : 'Nghỉ theo tour'
        };
      });

      if (scheduleRecords.length > 0) {
        const { error: schedErr } = await supabase
          .from('employee_schedules')
          .upsert(scheduleRecords, { onConflict: 'employee_id,date' });
        if (schedErr) console.error('Error upserting employee schedules in set_staff_duty:', schedErr);
      }

      // Step 4: Persist tour order into settings
      let updatedSettings = null;
      const { data: upsertData, error: settingsErr } = await supabase
        .from('settings')
        .upsert({ key: `tour_order_${targetBranch}`, value: matchedIds }, { onConflict: 'key' })
        .select()
        .single();
      if (!settingsErr) updatedSettings = upsertData;

      // Step 5: Fetch updated employee list + broadcast
      const { data: updatedEmployees } = await supabase
        .from('employees')
        .select('id, name, status, current_tour_order, branch_id, is_active')
        .eq('branch_id', targetBranch)
        .order('current_tour_order', { ascending: true, nullsFirst: false });

      if (updatedSettings) broadcast('settings.updated', updatedSettings);
      broadcast('staff.duty_updated', { branch_id: targetBranch, employees: updatedEmployees });

      // Notify branches that just lost a transferred employee, so their staff lists stay in sync
      const affectedOldBranchIds = [...new Set(
        transferredEmployees.map(t => t.fromBranchId).filter(id => id && id !== targetBranch)
      )];
      for (const oldBranchId of affectedOldBranchIds) {
        const { data: oldBranchEmployees } = await supabase
          .from('employees')
          .select('id, name, status, current_tour_order, branch_id, is_active')
          .eq('branch_id', oldBranchId)
          .order('current_tour_order', { ascending: true, nullsFirst: false });

        broadcast('staff.duty_updated', { branch_id: oldBranchId, employees: oldBranchEmployees });
      }

      // Step 6: Build summary
      let summary = `Đã cập nhật ${updatedCount}/${orderedStaffNames.length} nhân viên trực.`;
      if (transferredEmployees.length > 0) {
        const branchNameOf = (id) => (dbBranches || []).find(b => b.id === id)?.name || 'chi nhánh khác';
        const transferSummary = transferredEmployees
          .map(t => `${t.name} (từ ${branchNameOf(t.fromBranchId)})`)
          .join(', ');
        summary += ` Đã chuyển ${transferredEmployees.length} nhân viên sang chi nhánh này: ${transferSummary}.`;
      }
      if (unmatchedNames.length > 0) {
        summary += ` Không tìm thấy: ${unmatchedNames.join(', ')}.`;
      }

      return {
        success: true,
        updatedCount,
        totalNames: orderedStaffNames.length,
        matchedNames,
        transferredEmployees,
        unmatchedNames,
        summary,
        employees: updatedEmployees
      };
    }

    case 'get_spa_context': {
      const [services, employees, branches] = await Promise.all([
        supabase.from('services').select('id, name, duration_minutes, shortcodes').eq('is_active', true),
        supabase.from('employees').select('id, name, branch_id').eq('is_active', true),
        supabase.from('branches').select('id, name, opening_hours')
      ]);

      // Group employees by branch so AI knows who belongs where
      const employeesByBranch = {};
      employees.data?.forEach(e => {
        if (!employeesByBranch[e.branch_id]) employeesByBranch[e.branch_id] = [];
        employeesByBranch[e.branch_id].push({ id: e.id, name: e.name });
      });

      return {
        services: services.data,
        current_branch_employees: employeesByBranch[branch_id] || [],
        other_branches: branches.data
          ?.filter(b => b.id !== branch_id)
          .map(b => ({
            id: b.id,
            name: b.name,
            employees: employeesByBranch[b.id] || []
          }))
      };
    }

    case 'search_bookings': {
      const targetDate = params.date || todayDateStr;
      const targetBranch = params.branch_id || branch_id;

      let query = supabase
        .from('bookings')
        .select(`
          id,
          temporary_name,
          booking_date,
          start_time,
          end_time,
          status,
          num_guests,
          group_booking_id,
          notes,
          customers(name, phone),
          employees(id, name),
          services(id, name, duration_minutes),
          branches(id, name)
        `)
        .eq('booking_date', targetDate)
        .eq('branch_id', targetBranch)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });

      const { data: allBookings, error } = await query;
      if (error) return { error: error.message };
      if (!allBookings || allBookings.length === 0) return { found: 0, bookings: [] };

      // Filter by time if provided
      let filtered = allBookings;
      if (params.time) {
        filtered = allBookings.filter(b => b.start_time && b.start_time.startsWith(params.time));
      }

      // Filter by name if provided
      if (params.name) {
        const stripPrefix = (str) => str
          .toLowerCase()
          .replace(/^(chị|anh|c\.|a\.)\s+/i, '')
          .trim();

        const searchNorm = stripPrefix(params.name);

        const exactMatches = filtered.filter(b => {
          const bName = stripPrefix(b.temporary_name || b.customers?.name || '');
          return bName === searchNorm;
        });

        const partialMatches = exactMatches.length === 0
          ? filtered.filter(b => {
              const bName = stripPrefix(b.temporary_name || b.customers?.name || '');
              return bName.includes(searchNorm);
            })
          : [];

        filtered = exactMatches.length > 0 ? exactMatches : partialMatches;
      }

      // Fetch group siblings
      const groupIds = [...new Set(filtered
        .filter(b => b.group_booking_id)
        .map(b => b.group_booking_id))];

      let siblings = [];
      if (groupIds.length > 0) {
        const { data: groupBookings } = await supabase
          .from('bookings')
          .select('id, temporary_name, start_time, status, group_booking_id, employees(id, name)')
          .in('group_booking_id', groupIds)
          .neq('status', 'cancelled');
        siblings = groupBookings || [];
      }

      return {
        found: filtered.length,
        exact: params.name ? filtered.some(b => {
          const stripPrefix = (str) => str.toLowerCase().replace(/^(chị|anh|c\.|a\.)\s+/i, '').trim();
          return stripPrefix(b.temporary_name || '') === stripPrefix(params.name);
        }) : true,
        bookings: filtered,
        group_siblings: siblings
      };
    }



    case 'create_booking': {
      const { num_guests = 1, ...bookingParams } = params;
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});

      // Walk-in: round to nearest 5 minutes
      if (params.is_walk_in && params.start_time) {
        const [h, m] = params.start_time.split(':').map(Number);
        const totalMinutes = h * 60 + m;
        const rounded = Math.ceil(totalMinutes / 5) * 5;
        bookingParams.start_time = `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
      }

      // Look up service durations from DB
      let duration = params.duration_minutes || 0;
      let serviceNames = [];

      if (!params.duration_minutes) {
        const allServiceIds = [params.service_id, ...(params.extra_service_ids || [])].filter(Boolean);
        const { data: services } = await supabase
          .from('services')
          .select('id, name, duration_minutes')
          .in('id', allServiceIds);

        const foundIds = new Set((services || []).map(s => s.id));
        const missingIds = allServiceIds.filter(id => !foundIds.has(id));
        if (missingIds.length > 0) {
          return {
            error: `service_id không hợp lệ hoặc không tồn tại: ${missingIds.join(', ')}. Hãy gọi get_spa_context để lấy đúng UUID dịch vụ rồi thử lại, KHÔNG tự đoán UUID.`
          };
        }

        if (services?.length) {
          duration = services.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
          serviceNames = services.map(s => s.name);
        }
      }

      if (serviceNames.length > 1 && !bookingParams.notes) {
        bookingParams.notes = serviceNames.join(' + ');
      }

      if (!duration) duration = 60;
      delete bookingParams.extra_service_ids;
      delete bookingParams.employee_ids;

      // Compute end_time
      if (bookingParams.start_time) {
        const [h, m] = bookingParams.start_time.split(':').map(Number);
        const endMinutes = h * 60 + m + duration;
        bookingParams.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      }

      // Normalize requested IDs to ensure it's always an array structure
      const requestedIds = Array.isArray(params.employee_ids)
        ? params.employee_ids
        : (params.employee_ids ? [params.employee_ids] : []);
        
      const lockedIds = new Set(requestedIds.filter(Boolean));

      // Fetch available staff excluding locked and busy
      const { data: onDutyStaff } = await supabase
        .from('employee_schedules')
        .select('employee_id, employees!inner(id, name, branch_id)')
        .eq('date', bookingParams.booking_date)
        .eq('is_day_off', false)
        .eq('employees.branch_id', branch_id)
        .eq('employees.is_active', true);

      const { data: overlapping } = await supabase
        .from('bookings')
        .select('employee_id')
        .eq('booking_date', bookingParams.booking_date)
        .eq('branch_id', branch_id)
        .neq('status', 'cancelled')
        .lt('start_time', bookingParams.end_time)
        .gt('end_time', bookingParams.start_time);

      const busyIds = new Set(overlapping?.map(b => b.employee_id) || []);
      const availableStaff = onDutyStaff
        ?.filter(s => !busyIds.has(s.employee_id) && !lockedIds.has(s.employee_id))
        .map(s => s.employee_id) || [];

      // ✅ FIX: Check if any explicitly requested employee is already busy at this time slot
      const busyLockedStaff = [...lockedIds].filter(id => busyIds.has(id));
      if (busyLockedStaff.length > 0) {
        // Get names of conflicting employees for a helpful error message
        const { data: conflictEmps } = await supabase
          .from('employees')
          .select('name')
          .in('id', busyLockedStaff);
        const names = conflictEmps?.map(e => e.name).join(', ') || 'Nhân viên đã được chỉ định';
        return {
          success: false,
          blocked: true,
          reason: `${names} đang có lịch hẹn trùng giờ (${bookingParams.start_time} - ${bookingParams.end_time}). Vui lòng chọn nhân viên khác hoặc đổi khung giờ.`
        };
      }

      // Block if not enough staff for auto-assignment
      const autoNeeded = num_guests - lockedIds.size;
      if (availableStaff.length < autoNeeded) {
        return {
          success: false,
          blocked: true,
          reason: `Không đủ nhân viên rảnh. Cần ${autoNeeded} nhân viên tự động nhưng chỉ còn ${availableStaff.length} trống.`
        };
      }

      // Build rows guaranteeing distinct staff members per guest slot
      const group_booking_id = num_guests > 1 ? crypto.randomUUID() : null;
      const assignedGroupStaff = new Set();
      let autoIndex = 0;

      const rows = Array.from({ length: num_guests }, (_, i) => {
        let empId = requestedIds[i];

        // If no specific staff requested, or if the requested person is already 
        // assigned to someone else in this group, assign the next unique free staff member
        if (!empId || assignedGroupStaff.has(empId)) {
          empId = availableStaff[autoIndex++] || null;
        }

        if (empId) {
          assignedGroupStaff.add(empId);
        }

        return {
          ...bookingParams,
          branch_id,
          group_booking_id,
          employee_id: empId
        };
      });

      const { data: inserted, error } = await supabase
        .from('bookings')
        .insert(rows)
        .select('*, employees(name), services(name), branches(name)');

      if (error) return { error: error.message };
      inserted.forEach(b => broadcast('booking.created', b));

      return { success: true, count: inserted.length, bookings: inserted };
    }

    // case 'create_booking': {
    //   const { num_guests = 1, ...bookingParams } = params;
    //   const broadcast = context.req.app.get('broadcastSSE') || (() => {});

    //   // Better handle for edge cases like 3cb17, 2ng, 3kh
    //   // if (bookingParams.notes) {
    //   //   bookingParams.notes = bookingParams.notes.replace(/^\d+(ng|kh|khách)?\s*/i, '');
    //   // }

    //   // Walk-in: round to nearest 5 minutes
    //   if (params.is_walk_in && params.start_time) {
    //     const [h, m] = params.start_time.split(':').map(Number);
    //     const totalMinutes = h * 60 + m;
    //     const rounded = Math.ceil(totalMinutes / 5) * 5;
    //     bookingParams.start_time = `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
    //   }

    //   // Look up service durations from DB
    //   let duration = params.duration_minutes || 0;
    //   let serviceNames = [];

    //   if (!params.duration_minutes) {
    //     const allServiceIds = [params.service_id, ...(params.extra_service_ids || [])].filter(Boolean);
    //     const { data: services } = await supabase
    //       .from('services')
    //       .select('id, name, duration_minutes')
    //       .in('id', allServiceIds);

    //     if (services?.length) {
    //       duration = services.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
    //       serviceNames = services.map(s => s.name);
    //     }
    //   }

    //   if (serviceNames.length > 1 && !bookingParams.notes) {
    //     bookingParams.notes = serviceNames.join(' + ');
    //   }

    //   if (!duration) duration = 60;
    //   delete bookingParams.extra_service_ids;
    //   delete bookingParams.employee_ids;

    //   // Compute end_time
    //   if (bookingParams.start_time) {
    //     const [h, m] = bookingParams.start_time.split(':').map(Number);
    //     const endMinutes = h * 60 + m + duration;
    //     bookingParams.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
    //   }

    //   // Resolve requested staff
    //   const requestedIds = params.employee_ids || [];
    //   const lockedIds = new Set(requestedIds.filter(Boolean));

    //   // Fetch available staff excluding locked and busy
    //   const { data: onDutyStaff } = await supabase
    //     .from('employee_schedules')
    //     .select('employee_id, employees!inner(id, name, branch_id)')
    //     .eq('date', bookingParams.booking_date)
    //     .eq('is_day_off', false)
    //     .eq('employees.branch_id', branch_id)
    //     .eq('employees.is_active', true);

    //   const { data: overlapping } = await supabase
    //     .from('bookings')
    //     .select('employee_id')
    //     .eq('booking_date', bookingParams.booking_date)
    //     .eq('branch_id', branch_id)
    //     .neq('status', 'cancelled')
    //     .lt('start_time', bookingParams.end_time)
    //     .gt('end_time', bookingParams.start_time);

    //   const busyIds = new Set(overlapping?.map(b => b.employee_id) || []);
    //   const availableStaff = onDutyStaff
    //     ?.filter(s => !busyIds.has(s.employee_id) && !lockedIds.has(s.employee_id))
    //     .map(s => s.employee_id) || [];

    //   // Block if not enough staff for auto-assignment
    //   const autoNeeded = num_guests - lockedIds.size;
    //   if (availableStaff.length < autoNeeded) {
    //     return {
    //       success: false,
    //       blocked: true,
    //       reason: `Không đủ nhân viên rảnh. Cần ${autoNeeded} nhân viên tự động nhưng chỉ còn ${availableStaff.length} trống.`
    //     };
    //   }

    //   // Build rows
    //   const group_booking_id = num_guests > 1 ? crypto.randomUUID() : null;
    //   let autoIndex = 0;
    //   const rows = Array.from({ length: num_guests }, (_, i) => ({
    //     ...bookingParams,
    //     branch_id,
    //     group_booking_id,
    //     employee_id: requestedIds[i] || availableStaff[autoIndex++]
    //   }));

    //   const { data: inserted, error } = await supabase
    //     .from('bookings')
    //     .insert(rows)
    //     .select('*, employees(name), services(name), branches(name)');

    //   if (error) return { error: error.message };
    //   inserted.forEach(b => broadcast('booking.created', b));

    //   return { success: true, count: inserted.length, bookings: inserted };
    // }

   case 'update_booking': {
      const { booking_id, booking_ids, ...updateParams } = params;
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});

      let targetIds = Array.isArray(booking_ids) && booking_ids.length
        ? booking_ids
        : [booking_id].filter(Boolean);

      if (!targetIds.length) return { error: 'Thiếu booking_id để cập nhật.' };

      // Rescheduling date/time should move the whole group together, since
      // num_guests > 1 bookings from create_booking share one group_booking_id.
      const isReschedule = Boolean(updateParams.start_time || updateParams.booking_date);
      if (targetIds.length === 1 && isReschedule) {
        const { data: originBooking } = await supabase
          .from('bookings')
          .select('group_booking_id')
          .eq('id', targetIds[0])
          .single();

        if (originBooking?.group_booking_id) {
          const { data: siblings } = await supabase
            .from('bookings')
            .select('id')
            .eq('group_booking_id', originBooking.group_booking_id)
            .neq('status', 'cancelled');
          if (siblings?.length > 1) targetIds = siblings.map(s => s.id);
        }
      }

      const updatedBookings = [];
      const oldBookings = [];

      for (let i = 0; i < targetIds.length; i++) {
        const id = targetIds[i];

        // Snapshot for undo
        const { data: oldBooking } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', id)
          .single();
        if (!oldBooking) continue;

        const rowUpdate = { ...updateParams };

        if (rowUpdate.duration_minutes && !rowUpdate.service_id) {
          const [h, m] = (rowUpdate.start_time || oldBooking.start_time).split(':').map(Number);
          const endMinutes = h * 60 + m + rowUpdate.duration_minutes;
          rowUpdate.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
          delete rowUpdate.duration_minutes;
        }

        if (rowUpdate.start_time && !rowUpdate.service_id && !rowUpdate.duration_minutes) {
          const duration = oldBooking.end_time && oldBooking.start_time
            ? (() => {
                const [oh, om] = oldBooking.start_time.split(':').map(Number);
                const [eh, em] = oldBooking.end_time.split(':').map(Number);
                return (eh * 60 + em) - (oh * 60 + om);
              })()
            : 60;
          const [h, m] = rowUpdate.start_time.split(':').map(Number);
          const endMinutes = h * 60 + m + duration;
          rowUpdate.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
        }

        // Recalculate duration if service changed or extra services are provided
        if (rowUpdate.service_id || rowUpdate.extra_service_ids?.length) {
          const primaryServiceId = rowUpdate.service_id || oldBooking.service_id;

          const allServiceIds = [
            primaryServiceId,
            ...(rowUpdate.extra_service_ids || [])
          ].filter(Boolean);

          const { data: services } = await supabase
            .from('services')
            .select('id, name, duration_minutes')
            .in('id', allServiceIds);

          const foundIds = new Set((services || []).map(s => s.id));
          const missingIds = allServiceIds.filter(id => !foundIds.has(id));
          if (missingIds.length > 0) {
            return {
              error: `service_id không hợp lệ hoặc không tồn tại: ${missingIds.join(', ')}. Hãy gọi get_spa_context để lấy đúng UUID dịch vụ rồi thử lại, KHÔNG tự đoán UUID.`
            };
          }

          if (services?.length) {
            const duration = services.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
            const [h, m] = (rowUpdate.start_time || oldBooking.start_time).split(':').map(Number);
            const endMinutes = h * 60 + m + duration;
            rowUpdate.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

            if (services.length > 1) {
              rowUpdate.notes = services.map(s => s.name).join(' + ');
            }
          }
        }

        // If branch changed, clear old employee unless new one specified AND they belong to new branch
        if (rowUpdate.branch_id && rowUpdate.branch_id !== oldBooking.branch_id) {
          const requestedEmpId = params.employee_ids?.[i] ?? params.employee_ids?.[0];
          if (!requestedEmpId) {
            rowUpdate.employee_id = null;
          } else {
            // Verify the requested employee actually belongs to the new branch
            const { data: empCheck } = await supabase
              .from('employees')
              .select('id')
              .eq('id', requestedEmpId)
              .eq('branch_id', rowUpdate.branch_id)
              .single();
            rowUpdate.employee_id = empCheck ? requestedEmpId : null; // Employee not in new branch, clear it
          }
        }

        // Remove extra_service_ids / employee_ids (plural) before sending to Supabase —
        // the bookings table only has singular employee_id/service_id columns.
        delete rowUpdate.extra_service_ids;
        delete rowUpdate.employee_ids;

        // Map employee_ids to employee_id. For a single booking, take the first id.
        // For a whole group, only assign per-guest if the array lines up 1:1 with the
        // group — otherwise leave employee_id untouched to avoid double-booking the
        // same staff member across the group.
        if (!('employee_id' in rowUpdate) && params.employee_ids?.length > 0) {
          if (targetIds.length === 1) {
            rowUpdate.employee_id = params.employee_ids[0];
          } else if (params.employee_ids.length === targetIds.length) {
            rowUpdate.employee_id = params.employee_ids[i];
          }
        }

        // NOW update Supabase with correct end_time
        const { data: updated, error } = await supabase
          .from('bookings')
          .update(rowUpdate)
          .eq('id', id)
          .select('*, employees(name), services(name), branches(name)')
          .single();

        if (error) return { error: error.message };

        broadcast('booking.updated', updated);
        updatedBookings.push(updated);
        oldBookings.push(oldBooking);
      }

      if (updatedBookings.length === 1) {
        return {
          success: true,
          booking: updatedBookings[0],
          snapshot: oldBookings[0]
        };
      }

      return {
        success: true,
        bookings: updatedBookings,
        count: updatedBookings.length,
        snapshot: oldBookings
      };
    }

    
    case 'check_in_booking': {
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});

      // Round current VN time to nearest 5 min
      const now = new Date();
      const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60000);
      const totalMinutes = vnNow.getHours() * 60 + vnNow.getMinutes();
      const rounded = Math.ceil(totalMinutes / 5) * 5;
      const newStartTime = `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;

      // Fetch the booking
      const { data: booking, error: fetchError } = await supabase
        .from('bookings')
        .select('*, services(duration_minutes)')
        .eq('id', params.booking_id)
        .single();

      if (fetchError || !booking) return { error: 'Không tìm thấy lịch hẹn.' };

      // Collect all booking IDs to update (group or single)
      let bookingsToUpdate = [booking];
      if (booking.group_booking_id) {
        const { data: siblings } = await supabase
          .from('bookings')
          .select('*, services(duration_minutes)')
          .eq('group_booking_id', booking.group_booking_id)
          .neq('status', 'cancelled');
        if (siblings?.length) bookingsToUpdate = siblings;
      }

      // Update each booking with same start_time but individual end_time
      const updates = await Promise.all(
        bookingsToUpdate.map(async (b) => {
          const duration = b.services?.duration_minutes || 60;
          const [h, m] = newStartTime.split(':').map(Number);
          const endMinutes = h * 60 + m + duration;
          const newEndTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

          const { data: updated, error } = await supabase
            .from('bookings')
            .update({
              status: 'arrived',
              start_time: newStartTime,
              end_time: newEndTime
            })
            .eq('id', b.id)
            .select('*, employees(name), services(name), branches(name)')
            .single();

          if (!error) broadcast('booking.updated', updated);
          return updated;
        })
      );

      return {
        success: true,
        checked_in: updates.length,
        start_time: newStartTime,
        bookings: updates
      };
    }


    case 'delete_booking': {
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});

      // Snapshot for undo
      const { data: oldBooking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', params.booking_id)
        .single();

      let bookingIds = [params.booking_id];

      // Cancel whole group if requested
      if (params.cancel_group && oldBooking?.group_booking_id) {
        const { data: groupBookings } = await supabase
          .from('bookings')
          .select('id')
          .eq('group_booking_id', oldBooking.group_booking_id);
        bookingIds = groupBookings.map(b => b.id);
      }

      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .in('id', bookingIds);

      if (error) return { error: error.message };

      bookingIds.forEach(id => broadcast('booking.updated', { id, status: 'cancelled' }));

      return { success: true, cancelled: bookingIds, snapshot: oldBooking };
    }

    case 'get_available_staff': {
      const targetDate = params.date || todayDateStr;
      const targetBranch = params.branch_id || branch_id;
      const bookingStart = params.start_time;
      let bookingEnd = params.end_time;

      // Step 0: Calculate end time of booking if available      
      if (!bookingEnd && params.duration_minutes) {
        const [h, m] = bookingStart.split(':').map(Number);
        const endMinutes = h * 60 + m + params.duration_minutes;
        bookingEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      } else {
        bookingEnd = bookingEnd || bookingStart;
      }
      // Step 1: Get active staff who are working today and their shift covers the booking time
      const { data: onDutyStaff, error: scheduleError } = await supabase
        .from('employee_schedules')
        .select('employee_id, start_time, end_time, employees!inner(id, name, branch_id)')  // add branch_id to select
        .eq('date', targetDate)
        .eq('is_day_off', false)
        .eq('employees.branch_id', targetBranch)
        .eq('employees.is_active', true);

      // Temporary logging
      console.log('[get_available_staff] params:', { targetDate, targetBranch, bookingStart, bookingEnd });
      console.log('[get_available_staff] onDutyStaff:', JSON.stringify(onDutyStaff));
      console.log('[get_available_staff] scheduleError:', scheduleError);


      if (!onDutyStaff || onDutyStaff.length === 0) {
        return { available: [], message: 'Không có nhân viên nào trực trong khung giờ này.' };
      }

      // Step 2: Find who's already booked during that time
      const { data: overlapping } = await supabase
        .from('bookings')
        .select('employee_id')
        .eq('booking_date', targetDate)
        .neq('status', 'cancelled')
        .lt('start_time', bookingEnd)
        .gt('end_time', bookingStart);

      const busyIds = new Set(overlapping?.map(b => b.employee_id) || []);

      // Step 3: Filter out busy staff
      const available = onDutyStaff
        .filter(s => !busyIds.has(s.employee_id))
        .map(s => ({ id: s.employee_id, name: s.employees.name }));

      return { available, busy_count: busyIds.size };
    }


    case 'get_branches': {
      const { data: branches, error } = await supabase
        .from('branches')
        .select('id, name, opening_hours');
      if (error) return { error: error.message };
      return { branches: branches || [] };
    }

    case 'get_daily_summary': {
      const targetDate = params.date || todayDateStr;
      const targetBranch = params.branch_id || branch_id;

      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, employee_id, temporary_name, start_time, end_time, status, employees(name), services(name)')
        .eq('booking_date', targetDate)
        .eq('branch_id', targetBranch)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });
      if (error) return { error: error.message };

      const { data: onDutyStaff } = await supabase
        .from('employee_schedules')
        .select('employee_id, employees!inner(id, name, branch_id)')
        .eq('date', targetDate)
        .eq('is_day_off', false)
        .eq('employees.branch_id', targetBranch)
        .eq('employees.is_active', true);

      const statusCounts = {};
      (bookings || []).forEach(b => {
        statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
      });

      const now = new Date();
      const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60000);
      const nowStr = `${String(vnNow.getHours()).padStart(2, '0')}:${String(vnNow.getMinutes()).padStart(2, '0')}`;

      const busyNowIds = new Set(
        (bookings || [])
          .filter(b => b.start_time && b.end_time && b.start_time <= nowStr && b.end_time > nowStr)
          .map(b => b.employee_id)
      );

      const staffFreeNow = (onDutyStaff || [])
        .filter(s => !busyNowIds.has(s.employee_id))
        .map(s => ({ id: s.employee_id, name: s.employees.name }));

      return {
        date: targetDate,
        total_bookings: bookings?.length || 0,
        status_counts: statusCounts,
        on_duty_staff_count: onDutyStaff?.length || 0,
        staff_free_now: staffFreeNow,
        upcoming: (bookings || [])
          .filter(b => !b.start_time || b.start_time >= nowStr)
          .slice(0, 10)
          .map(b => ({
            id: b.id,
            name: b.temporary_name,
            time: b.start_time,
            status: b.status,
            employee: b.employees?.name,
            service: b.services?.name
          }))
      };
    }

    case 'check_conflicts': {
      const targetDate = params.date || todayDateStr;
      const startTime = params.start_time;
      let endTime = params.end_time;

      if (!params.employee_id || !startTime) {
        return { error: 'Thiếu employee_id hoặc start_time để kiểm tra.' };
      }

      if (!endTime && params.duration_minutes) {
        const [h, m] = startTime.split(':').map(Number);
        const endMinutes = h * 60 + m + params.duration_minutes;
        endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      }
      endTime = endTime || startTime;

      const { data: overlapping, error } = await supabase
        .from('bookings')
        .select('id, temporary_name, start_time, end_time, status')
        .eq('booking_date', targetDate)
        .eq('employee_id', params.employee_id)
        .neq('status', 'cancelled')
        .lt('start_time', endTime)
        .gt('end_time', startTime);

      if (error) return { error: error.message };

      return {
        has_conflict: (overlapping?.length || 0) > 0,
        conflicts: overlapping || []
      };
    }

    case 'reassign_staff_bookings': {
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});
      const targetDate = params.date || todayDateStr;
      const fromId = params.from_employee_id;
      if (!fromId) return { error: 'Thiếu from_employee_id.' };

      const { data: bookingsToMove, error: fetchErr } = await supabase
        .from('bookings')
        .select('id, start_time, end_time, employee_id, branch_id')
        .eq('booking_date', targetDate)
        .eq('employee_id', fromId)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });

      if (fetchErr) return { error: fetchErr.message };
      if (!bookingsToMove || bookingsToMove.length === 0) {
        return { success: true, moved: 0, message: 'Nhân viên này không có lịch hẹn nào cần chuyển trong ngày.' };
      }

      const targetBranchForBookings = bookingsToMove[0].branch_id;

      const { data: onDutyStaff } = await supabase
        .from('employee_schedules')
        .select('employee_id, employees!inner(id, name, branch_id, is_active)')
        .eq('date', targetDate)
        .eq('is_day_off', false)
        .eq('employees.branch_id', targetBranchForBookings)
        .eq('employees.is_active', true)
        .neq('employee_id', fromId);

      const { data: allBookingsThatDay } = await supabase
        .from('bookings')
        .select('employee_id, start_time, end_time')
        .eq('booking_date', targetDate)
        .eq('branch_id', targetBranchForBookings)
        .neq('status', 'cancelled');

      const moved = [];
      const unassigned = [];
      const workingSchedule = [...(allBookingsThatDay || [])];

      for (const booking of bookingsToMove) {
        let newEmployeeId = params.to_employee_id || null;

        const isFree = (empId) => !workingSchedule.some(b =>
          b.employee_id === empId &&
          b.start_time < booking.end_time && b.end_time > booking.start_time
        );

        if (newEmployeeId && !isFree(newEmployeeId)) {
          newEmployeeId = null;
        }

        if (!newEmployeeId) {
          const candidate = (onDutyStaff || []).find(s => isFree(s.employee_id));
          newEmployeeId = candidate?.employee_id || null;
        }

        if (!newEmployeeId) {
          unassigned.push(booking.id);
          continue;
        }

        const { data: updated, error: updErr } = await supabase
          .from('bookings')
          .update({ employee_id: newEmployeeId })
          .eq('id', booking.id)
          .select('*, employees(name), services(name), branches(name)')
          .single();

        if (updErr) continue;

        broadcast('booking.updated', updated);
        moved.push({ booking_id: booking.id, new_employee_id: newEmployeeId });
        workingSchedule.push({ employee_id: newEmployeeId, start_time: booking.start_time, end_time: booking.end_time });
      }

      return {
        success: true,
        moved: moved.length,
        unassigned_count: unassigned.length,
        unassigned_booking_ids: unassigned,
        details: moved
      };
    }

    case 'move_staff_to_branch': {
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});
      const { employee_id, new_branch_id } = params;
      if (!employee_id || !new_branch_id) {
        return { error: 'Thiếu employee_id hoặc new_branch_id.' };
      }

      const { data: employee, error: fetchErr } = await supabase
        .from('employees')
        .select('id, name, branch_id')
        .eq('id', employee_id)
        .single();

      if (fetchErr || !employee) return { error: 'Không tìm thấy nhân viên.' };

      const oldBranchId = employee.branch_id;

      const { data: updated, error: updErr } = await supabase
        .from('employees')
        .update({ branch_id: new_branch_id, status: 'OFF_DUTY', current_tour_order: null })
        .eq('id', employee_id)
        .select('id, name, branch_id, status')
        .single();

      if (updErr) return { error: updErr.message };

      const { data: oldBranchEmployees } = await supabase
        .from('employees')
        .select('id, name, status, current_tour_order, branch_id, is_active')
        .eq('branch_id', oldBranchId)
        .order('current_tour_order', { ascending: true, nullsFirst: false });
      const { data: newBranchEmployees } = await supabase
        .from('employees')
        .select('id, name, status, current_tour_order, branch_id, is_active')
        .eq('branch_id', new_branch_id)
        .order('current_tour_order', { ascending: true, nullsFirst: false });

      broadcast('staff.duty_updated', { branch_id: oldBranchId, employees: oldBranchEmployees });
      broadcast('staff.duty_updated', { branch_id: new_branch_id, employees: newBranchEmployees });

      return {
        success: true,
        employee: updated,
        from_branch_id: oldBranchId,
        to_branch_id: new_branch_id,
        summary: `Đã chuyển ${employee.name} sang chi nhánh mới.`
      };
    }

    default:
      return { error: `Không tìm thấy tool: ${toolName}` };
  }
}

/*3. AI Execution */
router.post('/', async (req, res) => {
  const { command, current_branch_id, conversation_history = [] } = req.body;

  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset + now.getTimezoneOffset() * 60000);
  const todayDateStr = vnNow.toISOString().split('T')[0];

  const { data: dbBranches } = await supabase
  .from('branches')
  .select('id, name, opening_hours');

  // Fetch and send operating hours to prompt so no need for many API calls
  const todayKey = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][vnNow.getDay()];

  const branchHoursStr = dbBranches?.map(b => {
    const hours = b.opening_hours?.[todayKey];
    return `${b.name}: ${hours?.open || '09:00'} - ${hours?.close || '22:00'}`;
  }).join(', ') || '';

  // Get current time for AI
  const currentTimeStr = `${String(vnNow.getHours()).padStart(2, '0')}:${String(vnNow.getMinutes()).padStart(2, '0')}`;

  

  const systemPrompt = `Bạn là trợ lý AI đặt lịch cho Ý Ơi Spa. Hôm nay: ${todayDateStr}.  Giờ hiện tại: ${currentTimeStr}. Chi nhánh: ${current_branch_id}. Giờ mở cửa: ${branchHoursStr}.

  TOOLS — BẮT BUỘC gọi tool, KHÔNG tự trả lời:
  - Lệnh dạng "Tour" + ngày + danh sách tên nhân viên (VD: "Tour 12/06: 1.Hân 2.Trang 3.Nị"), HOẶC lệnh CHỈ liệt kê tên nhân viên nối tiếp nhau (cách nhau bằng dấu cách/xuống dòng/phẩy) mà KHÔNG có giờ hẹn, tên khách hay dịch vụ → gọi set_staff_duty NGAY, KHÔNG gọi tool nào khác trước. Trích orderedStaffNames theo đúng thứ tự xuất hiện (bỏ số thứ tự "1.", "2." và dòng phân cách "---", "==="). Nhân viên hiện đang ở chi nhánh khác vẫn có thể xuất hiện trong danh sách — hệ thống sẽ tự chuyển họ sang chi nhánh hiện tại, không cần hỏi lại.
  - Tìm lịch → search_bookings
  - Tạo lịch → get_spa_context → get_available_staff → create_booking
  - Sửa lịch hoặc lệnh có tên khách + dịch vụ không có giờ → search_bookings → (get_spa_context nếu đổi dịch vụ) → (get_available_staff nếu đổi giờ) → update_booking. Chỉ tạo mới nếu không tìm thấy lịch.
  - Khách đến/tới/vô/vào spa → search_bookings → check_in_booking. KHÔNG tạo lịch mới.
  - Hủy lịch → search_bookings → delete_booking
  - Cần thông tin nhân viên/dịch vụ → get_spa_context
  - Nếu có reply_to_booking_ids → chỉ gọi get_spa_context → update_booking hoặc delete_booking. KHÔNG gọi get_available_staff. KHÔNG tạo lịch mới.
  - Hỏi "hôm nay còn slot nào?", "hôm nay đông không?" → get_daily_summary
  - Cần giờ mở cửa các chi nhánh cho ngày không phải hôm nay → get_branches
  - Trước khi gán/đổi nhân viên cụ thể vào lịch mà chưa chắc họ rảnh → check_conflicts
  - Nhân viên A nghỉ đột xuất hoặc cần dồn hết lịch của A cho người khác (KHÔNG phải đổi chi nhánh cố định) → reassign_staff_bookings
  - "Chuyển NV A sang CN2/chi nhánh khác" (đổi nơi làm việc cố định của nhân viên) → move_staff_to_branch. Nếu A còn lịch hẹn cũ cần dồn cho người khác, gọi thêm reassign_staff_bookings.

  NOTES:
  - Bất kỳ nội dung nào không phải tên khách, giờ, dịch vụ, số khách, chi nhánh → điền vào notes. Ví dụ: "ydc 1568" → service=ydc, notes="1568". "C An 7h có thẻ" → notes="có thẻ"

  GIÁ TRỊ MẶC ĐỊNH — KHÔNG hỏi lại:
  - Tên khách: "Khách Lạ" nếu có từ "kl/khách lẻ/khách lạ/ko lịch/k lịch"; "Khách Tây" nếu có "tây/nước ngoài/nc ngoài"
  - Nhân viên: gọi get_available_staff và chọn người đầu tiên rảnh; nếu không ai rảnh → báo lại
  - KHÔNG tự thay đổi service_id nếu người dùng không đề cập đến dịch vụ
  

  QUY TẮC GIỜ:
  - Có "sáng" hoặc "AM" → dùng AM
  - Có "tối", "chiều", "đêm" hoặc "PM" → dùng PM

  XỬ LÝ KẾT QUẢ:
  - Nhiều lịch trùng tên → hỏi lại để xác nhận
  - Chỉ hỏi khi thiếu thông tin không thể suy luận chắc chắn (ví dụ: nhân viên được book đang bận hoặc không ở chi nhánh)
  - Kiểm tra chắc chắn không tạo lịch ngoài giờ mở cửa
  - Không reply bằng markdown.
  `;

  const replyToIds = req.body.reply_to_booking_ids;

  const enrichedCommand = `${command}
  [Mặc định đã xác định: dịch vụ="Giữ Chỗ", số khách=1, ngày=${todayDateStr}. Đây là thông tin ĐÃ CÓ, KHÔNG cần hỏi thêm. Hãy gọi tool ngay.]${
    replyToIds?.length
      ? `\n[reply_to_booking_ids: ${replyToIds.join(', ')}. Chỉ gọi get_spa_context → update_booking hoặc delete_booking. KHÔNG gọi get_available_staff. KHÔNG tạo lịch mới.]`
      : ''
  }`;


  let messages = [
    ...conversation_history.map(m => ({
      role: m.role,
      parts: [{ text: m.text }]
    })),
    {
      role: 'user',
      parts: [{ text: enrichedCommand }]
    }
  ];

  let loopCount = 0;
  const maxLoops = 5;
  const toolLog = [];

  while (loopCount < maxLoops) {
    loopCount++;

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: messages,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: spaTools }]
        }
      });

      const candidate = response.candidates[0];
      const parts = candidate.content?.parts || [];
      const functionCallPart = parts.find(p => p.functionCall);

      if (functionCallPart) {
        const toolCall = functionCallPart.functionCall;

        const toolResult = await executeTool(toolCall.name, toolCall.args, {
          supabase,
          branch_id: current_branch_id,
          todayDateStr,
          dbBranches,
          req
        });

        toolLog.push({
          tool: toolCall.name,
          params: toolCall.args,
          result: toolResult
        });

        messages.push({
          role: 'model',
          parts: parts
        });

        messages.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: toolCall.name,
              response: { result: toolResult }
            }
          }]
        });

      } else {
        const textReply = parts.find(p => p.text)?.text || "Em chưa hiểu ý anh/chị lắm, anh/chị nói rõ hơn được không?";
        
        const lastTool = toolLog.at(-1);
        
        return res.json({
          success: true,
          reply: textReply,
          tool_used: lastTool?.tool || null,
          tool_result: lastTool?.result || null,
          tool_log: toolLog
        });
      }

    } catch (err) {
      if (err.status === 503) {
        return res.status(503).json({
          success: false,
          error: 'AI đang bận, vui lòng thử lại sau.'
        });
      }
      if (err.status === 429) {
        return res.status(429).json({
          success: false,
          error: 'AI đang quá tải, vui lòng thử lại sau 1-2 phút.'
        });
      }
      throw err;
    }
  }

  return res.status(500).json({ error: "Vượt quá giới hạn vòng lặp xử lý" });
});

module.exports = router;