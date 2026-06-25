const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = 'gemini-3.1-flash-lite'; //250 requests/day

/*1. AI Tools*/
const spaTools = [
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
    description: "Cập nhật hoặc điều chỉnh một lịch hẹn hiện có qua ID.",
    parameters: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "UUID của lịch hẹn cần sửa." },
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
  }
];

/*2. Tool Execution */
async function executeTool(toolName, params, context) {
  const { supabase, branch_id, todayDateStr } = context;

  switch (toolName) {
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
      const { booking_id, ...updateParams } = params;
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});

      // Snapshot for undo
      const { data: oldBooking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', booking_id)
        .single();

      if (updateParams.duration_minutes && !updateParams.service_id) {
        const [h, m] = (updateParams.start_time || oldBooking.start_time).split(':').map(Number);
        const endMinutes = h * 60 + m + updateParams.duration_minutes;
        updateParams.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
        delete updateParams.duration_minutes;
      }

      if (updateParams.start_time && !updateParams.service_id && !updateParams.duration_minutes) {
        const duration = oldBooking.end_time && oldBooking.start_time
          ? (() => {
              const [oh, om] = oldBooking.start_time.split(':').map(Number);
              const [eh, em] = oldBooking.end_time.split(':').map(Number);
              return (eh * 60 + em) - (oh * 60 + om);
            })()
          : 60;
        const [h, m] = updateParams.start_time.split(':').map(Number);
        const endMinutes = h * 60 + m + duration;
        updateParams.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      }

      // Recalculate duration if service changed or extra services are provided
      if (updateParams.service_id || updateParams.extra_service_ids?.length) {
        const primaryServiceId = updateParams.service_id || oldBooking.service_id;

        const allServiceIds = [
          primaryServiceId,
          ...(updateParams.extra_service_ids || [])
        ].filter(Boolean);

        const { data: services } = await supabase
          .from('services')
          .select('id, name, duration_minutes')
          .in('id', allServiceIds);

        if (services?.length) {
          const duration = services.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
          const [h, m] = (updateParams.start_time || oldBooking.start_time).split(':').map(Number);
          const endMinutes = h * 60 + m + duration;
          updateParams.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

          if (services.length > 1) {
            updateParams.notes = services.map(s => s.name).join(' + ');
          }
        }
      }

      // If branch changed, clear old employee unless new one specified
      if (updateParams.branch_id && updateParams.branch_id !== oldBooking.branch_id) {
        if (!params.employee_ids?.length) {
          updateParams.employee_id = null;
        }
      }

      // Remove extra_service_ids before sending to Supabase
      delete updateParams.extra_service_ids;

      // Map employee_ids to employee_id for single booking update
      if (params.employee_ids?.length > 0) {
        updateParams.employee_id = params.employee_ids[0];
      }
      delete updateParams.employee_ids;

      // NOW update Supabase with correct end_time
      const { data: updated, error } = await supabase
        .from('bookings')
        .update(updateParams)
        .eq('id', booking_id)
        .select('*, employees(name), services(name), branches(name)')
        .single();

      if (error) return { error: error.message };

      broadcast('booking.updated', updated);

      return {
        success: true,
        booking: updated,
        snapshot: oldBooking
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
  - Tìm lịch → search_bookings
  - Tạo lịch → get_spa_context → get_available_staff → create_booking
  - Sửa lịch hoặc lệnh có tên khách + dịch vụ không có giờ → search_bookings → (get_spa_context nếu đổi dịch vụ) → (get_available_staff nếu đổi giờ) → update_booking. Chỉ tạo mới nếu không tìm thấy lịch.
  - Khách đến/tới/vô/vào spa → search_bookings → check_in_booking. KHÔNG tạo lịch mới.
  - Hủy lịch → search_bookings → delete_booking
  - Cần thông tin nhân viên/dịch vụ → get_spa_context
  - Nếu có reply_to_booking_ids → chỉ gọi get_spa_context → update_booking hoặc delete_booking. KHÔNG gọi get_available_staff. KHÔNG tạo lịch mới.

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