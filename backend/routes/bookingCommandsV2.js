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
        num_guests: { type: "integer", default: 1 },
        service_id: { type: "string", description: "UUID của dịch vụ chính." },
        extra_service_ids: { 
          type: "array", 
          items: { type: "string" },
          description: "UUID của các dịch vụ bổ sung (nếu có). Ví dụ: ['uuid2', 'uuid3']" 
        },
        employee_id: { type: "string", description: "UUID của nhân viên được chỉ định (nếu có)." },
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
        employee_id: { type: "string", description: "UUID nhân viên mới nếu đổi thợ." },
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
        supabase.from('services').select('id, name, duration_minutes').eq('is_active', true),
        supabase.from('employees').select('id, name, branch_id').eq('is_active', true),
        supabase.from('branches').select('id, name, opening_hours')
      ]);
      return {
        services: services.data,
        employees: employees.data,
        branches: branches.data
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
        const allServiceIds = [
          params.service_id,
          ...(params.extra_service_ids || [])
        ].filter(Boolean);

        const { data: services } = await supabase
          .from('services')
          .select('id, name, duration_minutes')
          .in('id', allServiceIds);

        if (services?.length) {
          duration = services.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
          serviceNames = services.map(s => s.name);
        }
      }

      // Add combined service names to notes if multiple services
      if (serviceNames.length > 1 && !bookingParams.notes) {
        bookingParams.notes = serviceNames.join(' + ');
      }

      // Fallback duration
      if (!duration) duration = 60;

      // Remove extra_service_ids before sending to Supabase
      delete bookingParams.extra_service_ids;

      // Compute end_time
      if (bookingParams.start_time) {
        const [h, m] = bookingParams.start_time.split(':').map(Number);
        const endMinutes = h * 60 + m + duration;
        bookingParams.end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      }

      // Generate group_booking_id if multiple guests
      const group_booking_id = num_guests > 1 ? crypto.randomUUID() : null;

      // Fetch available staff for group assignment
      let availableStaff = [];
      if (num_guests > 1 && !params.employee_id) {
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
        availableStaff = onDutyStaff
          ?.filter(s => !busyIds.has(s.employee_id))
          .map(s => s.employee_id) || [];
      }

      // Build rows — assign different staff per guest
      const rows = Array.from({ length: num_guests }, (_, i) => ({
        ...bookingParams,
        branch_id,
        group_booking_id,
        employee_id: num_guests > 1 && availableStaff.length > 0
          ? availableStaff[i % availableStaff.length]
          : bookingParams.employee_id
      }));

      const { data: inserted, error } = await supabase
        .from('bookings')
        .insert(rows)
        .select('*, employees(name), services(name), branches(name)');

      if (error) return { error: error.message };

      inserted.forEach(b => broadcast('booking.created', b));

      return {
        success: true,
        count: inserted.length,
        bookings: inserted
      };
    }

    case 'update_booking': {
      const { booking_id, ...updateParams } = params;
      const broadcast = context.req.app.get('broadcastSSE') || (() => {});

      // Snapshot for undo
      const { data: oldBooking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', booking_id)
        .single();

      // Recalculate duration if service changed
      if (updateParams.service_id) {
        const allServiceIds = [
          updateParams.service_id,
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

      // Remove extra_service_ids before sending to Supabase
      delete updateParams.extra_service_ids;

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
      const bookingEnd = params.end_time || params.start_time;

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
  - Sửa lịch → search_bookings → update_booking
  - Hủy lịch → search_bookings → delete_booking
  - Cần thông tin nhân viên/dịch vụ → get_spa_context

  GIÁ TRỊ MẶC ĐỊNH — KHÔNG hỏi lại:
  - Tên khách: "Khách Lạ" nếu có từ "kl/khách lẻ/khách lạ/ko lịch/k lịch"; "Khách Tây" nếu có "tây/nước ngoài/nc ngoài"
  - Nhân viên: gọi get_available_staff và chọn người đầu tiên rảnh; nếu không ai rảnh → báo lại

  QUY TẮC GIỜ:
  - Có "sáng" hoặc "AM" → dùng AM
  - Có "tối", "chiều", "đêm" hoặc "PM" → dùng PM
  - Không tạo lịch ngoài giờ mở cửa

  XỬ LÝ KẾT QUẢ:
  - Nhiều lịch trùng tên → hỏi lại để xác nhận
  - Chỉ hỏi khi THỰC SỰ thiếu thông tin không thể suy luận`;

  const enrichedCommand = `${command}
[Mặc định đã xác định: dịch vụ="Giữ Chỗ", số khách=1, ngày=${todayDateStr}. Đây là thông tin ĐÃ CÓ, KHÔNG cần hỏi thêm. Hãy gọi tool ngay.]`;


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
        return res.json({ success: true, reply: textReply });
      }

    } catch (err) {
      if (err.status === 503) {
        return res.status(503).json({
          success: false,
          error: 'AI đang bận, vui lòng thử lại sau.'
        });
      }if (err.status === 429) {
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