const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = 'gemini-2.5-flash';

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
        service_id: { type: "string", description: "UUID của dịch vụ (VD: yvv, ydc, ynmg)." },
        employee_id: { type: "string", description: "UUID của nhân viên được chỉ định (nếu có)." },
        notes: { type: "string", description: "Ghi chú bổ sung hoặc thời lượng tùy chỉnh." }
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
        employee_id: { type: "string", description: "UUID nhân viên mới nếu đổi thợ." }
      },
      required: ["booking_id"]
    }
  },
  {
    name: "get_spa_context",
    description: "Lấy danh sách ID/Tên của tất cả dịch vụ (yvv, ydc, ynmg) và nhân viên đang hoạt động.",
    parameters: { type: "object", properties: {} }
  }
];






/*2. Tool Config*/
async function executeTool(toolName, params, context) {
  const { supabase, branch_id } = context;

  switch (toolName) {
    case 'get_spa_context':
      // Fetch fresh lists so Gemini matches keywords (yvv -> UUID) correctly
      const [services, employees] = await Promise.all([
        supabase.from('services').select('id, name, duration_minutes'),
        supabase.from('employees').select('id, name').eq('branch_id', branch_id).eq('is_active', true)
      ]);
      return { services: services.data, employees: employees.data };

    case 'search_bookings':
      let query = supabase.from('bookings').select('id, temporary_name, start_time, status').eq('branch_id', branch_id);
      if (params.date) query = query.eq('booking_date', params.date);
      if (params.name) query = query.ilike('temporary_name', `%${params.name}%`);
      const searchResult = await query;
      return searchResult.data;

    case 'create_booking':
      const insertResult = await supabase.from('bookings').insert([{
        ...params,
        branch_id: branch_id
      }]).select();
      // Trigger SSE update here via context.broadcast if needed
      return { success: true, booking: insertResult.data };

    // Add update_booking, delete_booking details here...
    default:
      return { error: `Không tìm thấy tool: ${toolName}` };
  }
}


/*3. AI Execution  */
router.post('/', async (req, res) => {
  const { command, current_branch_id } = req.body;
  
  const now = new Date();
  const todayDateStr = now.toISOString().split('T')[0];

  const systemPrompt = `Bạn là trợ lý AI cho Ý Ơi Spa...`;

  // >>> 1. FIXED INITIAL MESSAGES STRUCTURE <<<
  let messages = [
    { 
      role: 'user', 
      parts: [{ text: command }] 
    }
  ];

  let loopCount = 0;
  const maxLoops = 5;

  while (loopCount < maxLoops) {
    loopCount++;
    
    // Call Gemini API using the tools parameter
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: messages, // Now perfectly structured for all loop iterations
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: spaTools }]
      }
    });

    const candidate = response.candidates[0];
    
    // Check if Gemini wants to talk back to the user
    if (candidate.content && !candidate.functionCalls) {
      const textReply = candidate.content.parts?.[0]?.text || "Em chưa hiểu ý anh/chị lắm, anh/chị nói rõ hơn được không?";
      return res.json({ success: true, reply: textReply });
    }

    // Check if Gemini wants to call a tool
    if (candidate.functionCalls) {
      const toolCall = candidate.functionCalls[0];
      
      // Execute the database function securely on your backend
      const toolResult = await executeTool(toolCall.name, toolCall.args, {
        supabase,
        branch_id: current_branch_id,
        req
      });

      // Append Gemini's tool call intent as an assistant turn
      messages.push({ 
        role: 'assistant', 
        parts: candidate.content.parts 
      });
      
      // Append the database result using the official SDK format for function responses
      messages.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: toolCall.name,
              response: { result: toolResult }
            }
          }
        ]
      });
    }
  }

  return res.status(500).json({ error: "Vượt quá giới hạn vòng lặp xử lý" });
});



module.exports = router;