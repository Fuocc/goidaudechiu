const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

function getBroadcast(req) {
  return req.app.get('broadcastSSE') || (() => { });
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function fallbackRegexParse(command, current_branch_id, dbBranches, dbServices, dbEmployees) {
  const text = command.trim();
  const lowerText = text.toLowerCase();
  const stripDiacritics = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalizedText = stripDiacritics(text);

  const parsedData = {
    action: 'create',
    is_walk_in: false,
    customer_phone: null,
    short_phone: null,
    temporary_name: 'Khách Lạ',
    service_id: null,
    branch_id: current_branch_id || null,
    booking_date: null,
    start_time: null,
    is_deadline: false,
    employee_id: null,
    num_guests: 1,
    status: 'confirmed',
    notes: ''
  };

  // 1. Phone numbers
  const fullPhoneMatch = text.match(/0\d{9}/);
  const shortPhoneMatch = text.match(/\b(\d{3,4})\b/);
  if (fullPhoneMatch) {
    parsedData.customer_phone = fullPhoneMatch[0];
  } else if (shortPhoneMatch) {
    parsedData.short_phone = shortPhoneMatch[1];
  }

  // 2. Status "tới"
  if (/\btới\b/i.test(text)) {
    parsedData.status = 'arrived';
    parsedData.action = 'update';
  }

  // 3. Walk-in "kl"
  parsedData.is_walk_in = /\b(?:kl|khách lẻ)\b/i.test(normalizedText);

  // 4. Update action matching keywords
  const updateRegex = /(?:đổi|chỉnh|chuyển)(?:\s+(?:thành|sang|lịch))?/i;
  const updateMatch = lowerText.match(/(.*?)đổi thành(.*)/i) || normalizedText.match(/(.*?)doi thanh(.*)/i);
  let targetServiceText = lowerText;
  if (updateMatch) {
    parsedData.action = 'update';
    targetServiceText = updateMatch[2].trim();
  } else if (updateRegex.test(lowerText)) {
    parsedData.action = 'update';
  }

  // 5. Date parsing
  let targetDate = new Date();
  const isLateNight = targetDate.getHours() > 22 || (targetDate.getHours() === 22 && targetDate.getMinutes() >= 15);
  if (isLateNight) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  const isQuaLien = lowerText.includes('qua liền') || lowerText.includes('qua lien') || normalizedText.includes('qua lien');
  if (!isQuaLien) {
    if (lowerText.includes('mai') || lowerText.includes('ngày mai')) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (lowerText.includes('mốt') || lowerText.includes('ngày kia') || lowerText.includes('ngày mốt')) {
      targetDate.setDate(targetDate.getDate() + 2);
    } else {
      const weekdays = {
        'thứ hai': 1, 'thứ 2': 1, 't2': 1,
        'thứ ba': 2, 'thứ 3': 2, 't3': 2,
        'thứ tư': 3, 'thứ 4': 3, 't4': 3,
        'thứ năm': 4, 'thứ 5': 4, 't5': 4,
        'thứ sáu': 5, 'thứ 6': 5, 't6': 5,
        'thứ bảy': 6, 'thứ 7': 6, 't7': 6,
        'chủ nhật': 0
      };
      let weekdayMatched = false;
      for (const [dayName, dayNum] of Object.entries(weekdays)) {
        const regex = new RegExp(`\\b${dayName}\\b`, 'i');
        if (regex.test(lowerText)) {
          const currentDay = targetDate.getDay();
          let daysToAdd = dayNum - currentDay;
          if (daysToAdd < 0) daysToAdd += 7;
          targetDate.setDate(targetDate.getDate() + daysToAdd);
          weekdayMatched = true;
          break;
        }
      }
      if (!weekdayMatched) {
        const dateRegex = /(\d{1,2})[/\-](\d{1,2})/;
        const match = lowerText.match(dateRegex);
        if (match) {
          const day = parseInt(match[1]);
          const month = parseInt(match[2]) - 1;
          targetDate.setMonth(month);
          targetDate.setDate(day);
        }
      }
    }
  }
  parsedData.booking_date = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

  // 6. Guest count
  const guestMatch = normalizedText.match(/(\d+)\s*ng(?:uoi)?(?:\s|$)/i) || lowerText.match(/(\d+)\s*người/i) || lowerText.match(/(\d+)\s*kl\b/i);
  if (guestMatch) {
    parsedData.num_guests = parseInt(guestMatch[1]) || 1;
  }

  // 7. Name parsing
  if (parsedData.is_walk_in) {
    parsedData.temporary_name = 'Khách Lạ';
  } else {
    const namePatterns = [
      /cho\s+(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)(?=\s+(?:lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|nv|nhân viên|với|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|tới|-|$))/i,
      /cho\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)(?=\s+(?:lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|nv|nhân viên|với|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|tới|-|$))/i,
      /^(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)(?=\s+(?:lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|nv|nhân viên|với|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|\d+ng|tới|-|$))/i,
      /(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)\s+(?:đặt lịch|book|lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|tới|-)/i
    ];
    let matchedName = null;
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        matchedName = match[1].trim();
        break;
      }
    }
    if (matchedName) {
      matchedName = matchedName.replace(/^(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+/i, '');
      matchedName = matchedName.replace(/(?:0\d{9}|\b\d{3,4}\b)/g, '').trim();
      parsedData.temporary_name = matchedName.split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }
  }

  // 8. Branch
  if (dbBranches) {
    const cnMatch = normalizedText.match(/cn\s*(\d+)/i) || lowerText.match(/chi\s*nhánh\s*(\d+)/i);
    if (cnMatch) {
      const cnNum = cnMatch[1];
      const found = dbBranches.find(b => b.name.includes(cnNum));
      if (found) parsedData.branch_id = found.id;
    }
    if (!parsedData.branch_id) {
      for (const b of dbBranches) {
        if (lowerText.includes(b.name.toLowerCase())) {
          parsedData.branch_id = b.id;
          break;
        }
      }
    }
  }
  if (!parsedData.branch_id && dbBranches && dbBranches.length > 0) {
    parsedData.branch_id = dbBranches[0].id;
  }

  // 9. Time
  let hasExplicitTime = false;
  if (isQuaLien) {
    hasExplicitTime = true;
    const now = new Date();
    const min = Math.ceil(now.getMinutes() / 5) * 5;
    now.setMinutes(min, 0, 0);
    parsedData.start_time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else {
    const timeRegex = /(\d{1,2})(?:h|g|:|giờ\s*)\s*(\d{1,2})?(?!\s*(?:ng|kl|kh|n|k|người|khách))/i;
    const timeMatch = lowerText.match(timeRegex);
    if (timeMatch) {
      hasExplicitTime = true;
      let hour = parseInt(timeMatch[1]);
      let minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const isPM = lowerText.includes('chiều') || lowerText.includes('tối') || lowerText.includes('pm');
      const isAM = lowerText.includes('sáng') || lowerText.includes('am');
      if (isPM && hour < 12) hour += 12;
      else if (isAM && hour === 12) hour = 0;
      else if (!isAM && !isPM) {
        if (hour > 0 && hour <= 6) {
          hour += 12;
        } else if (hour > 6 && hour < 12) {
          const d = new Date();
          const currentHour = d.getHours();
          const currentMinute = d.getMinutes();
          if (currentHour > hour || (currentHour === hour && currentMinute > minute)) {
            hour += 12;
          }
        }
      }

      parsedData.start_time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

      const afterTimeText = lowerText.substring(timeMatch.index + timeMatch[0].length);
      const beforeTimeText = lowerText.substring(0, timeMatch.index);
      if (/(?:là\s+)?(?:phải\s+)?xong|ph\s+xong/i.test(afterTimeText) || /xong\s+(?:trước|lúc)\s*$/i.test(beforeTimeText)) {
        parsedData.is_deadline = true;
      }
    } else {
      parsedData.start_time = null;
    }
  }

  // If no time is specified, action defaults to update
  if (!hasExplicitTime) {
    parsedData.action = 'update';
  }

  // 10. Service
  const serviceKeywords = {
    'body': 'ý 17',
    'massage body': 'ý 17',
    'massage': 'ý 17',
    'yvv': 'ý vội vàng',
    'ydc': 'ý dễ chịu',
    'yvn': 'ý vỗ nhẹ',
    'yn1g': 'ý ngủ một giấc',
    'yng': 'ý ngủ một giấc',
    'ynmg': 'ý ngủ một giấc',
    'yph': 'ý phục hồi',
    'y17': 'ý 17',
    'ybb': 'ý bầu bí',
    'cbph': 'combo phục hồi',
    'cbdc': 'combo dễ chịu',
    'cb17': 'combo 17',
    'gddc': 'ý 4 tay gấp đôi dễ chịu',
    'dcdc': 'ý 4 tay đỉnh cao dễ chịu'
  };
  if (dbServices) {
    const normSearch = stripDiacritics(targetServiceText);
    for (const [keyword, targetName] of Object.entries(serviceKeywords)) {
      const regex = new RegExp('(?:^|\\s|\\d)' + keyword + '(?:\\s|\\d|$)', 'i');
      if (regex.test(normSearch) || normSearch === keyword) {
        const normTarget = stripDiacritics(targetName);
        const svc = dbServices.find(s => stripDiacritics(s.name.toLowerCase()) === normTarget);
        if (svc) {
          parsedData.service_id = svc.id;
          break;
        }
      }
    }
    if (!parsedData.service_id) {
      const comboMatch = normSearch.match(/(?:(\d+)\s*)?(?:cb|combo)\s*(\d+)/i);
      if (comboMatch) {
        const comboNum = comboMatch[2];
        const targetComboName = `combo ${comboNum}`;
        const svc = dbServices.find(s => s.name.toLowerCase() === targetComboName);
        if (svc) parsedData.service_id = svc.id;
      }
    }
    if (!parsedData.service_id) {
      for (const s of dbServices) {
        if (lowerText.includes(s.name.toLowerCase())) {
          parsedData.service_id = s.id;
          break;
        }
      }
    }
  }
  if (!parsedData.service_id && dbServices && dbServices.length > 0) {
    const placeholderService = dbServices.find(s => s.name.toLowerCase().includes('giữ chỗ') || s.name.toLowerCase().includes('giu cho'));
    parsedData.service_id = placeholderService ? placeholderService.id : dbServices[0].id;
  }

  // 11. Employee matching (from the end of command)
  if (dbEmployees && dbEmployees.length > 0) {
    const words = text.trim().split(/\s+/);
    if (words.length > 0) {
      const lastWord = stripDiacritics(words[words.length - 1]);
      const secondLastWord = words.length > 1 ? stripDiacritics(words[words.length - 2]) : '';

      for (const emp of dbEmployees) {
        if (emp.branch_id && parsedData.branch_id && emp.branch_id !== parsedData.branch_id) continue;
        const empNorm = stripDiacritics(emp.name);
        const empParts = empNorm.split(/\s+/);
        const firstName = empParts[empParts.length - 1]; // First name in VN, e.g. "yen" from "Nguyen Thi Yen"

        if (lastWord === firstName || lastWord === empNorm) {
          parsedData.employee_id = emp.id;
          break;
        } else if (secondLastWord === firstName || secondLastWord === empNorm) {
          parsedData.employee_id = emp.id;
          break;
        }
      }
    }
  }

  return parsedData;
}

/**
 * POST /api/bookings/command
 * Parse natural language Vietnamese commands to create booking drafts or update existing bookings.
 */
router.post('/', async (req, res) => {
  try {
    const { command, current_branch_id, reply_to_booking_id } = req.body;
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        success: false,
        error: 'Chưa cấu hình GEMINI_API_KEY trong file .env ở thư mục backend.'
      });
    }

    // 1. Fetch current branches, services, and active employees from DB
    const [
      { data: dbBranches },
      { data: dbServices },
      { data: dbEmployees }
    ] = await Promise.all([
      supabase.from('branches').select('id, name'),
      supabase.from('services').select('id, name, duration_minutes'),
      supabase.from('employees').select('id, name, is_active, branch_id').eq('is_active', true)
    ]);

    const now = new Date();
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Weekdays label map for prompt context
    const weekdaysVN = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const currentDayOfWeekStr = weekdaysVN[now.getDay()];

    // Fetch reply booking details if reply_to_booking_id is provided
    let replyBookingContext = null;
    if (reply_to_booking_id) {
      try {
        const { data: replyBooking, error: replyErr } = await supabase
          .from('bookings')
          .select(`
            *,
            customers(name, phone),
            services(name),
            branches(name),
            employees(name)
          `)
          .eq('id', reply_to_booking_id)
          .single();

        if (!replyErr && replyBooking) {
          replyBookingContext = replyBooking;
        }
      } catch (err) {
        console.error('Error fetching reply booking context:', err);
      }
    }

    const systemPrompt = `You are an AI assistant for a Spa booking system named YOi Spa.
Your job is to parse a Vietnamese natural language booking command from a spa receptionist and output a structured JSON representing the booking intent.

Context:
- Current date and time: ${now.toString()} (Today is ${currentDayOfWeekStr}, local time on Windows)
- Today's date: ${todayDateStr}
- Available Branches: ${JSON.stringify(dbBranches || [])}
- Available Services: ${JSON.stringify(dbServices || [])}
- Available Employees: ${JSON.stringify(dbEmployees || [])}
- Current Chi Nhánh (Branch) ID: ${current_branch_id || 'null'}
- Replied-To Booking Context (The receptionist is explicitly replying to this booking slot): ${replyBookingContext ? JSON.stringify({
    id: replyBookingContext.id,
    booking_date: replyBookingContext.booking_date,
    start_time: replyBookingContext.start_time,
    end_time: replyBookingContext.end_time,
    customer_name: replyBookingContext.customers?.name || replyBookingContext.temporary_name || 'Khách',
    customer_phone: replyBookingContext.customers?.phone || replyBookingContext.customer_phone || '',
    service_name: replyBookingContext.services?.name || '',
    branch_name: replyBookingContext.branches?.name || '',
    employee_name: replyBookingContext.employees?.name || ''
  }) : 'None'}

Strict rules for mapping attributes:
1. "action": Choose "update" if the user wants to reschedule, change services ("đổi thành", "chỉnh thành", "chuyển sang", "đổi sang"), check-in ("tới", "đã tới"), or alter an existing booking. 
   CRITICAL RULE: If the command does NOT contain a specific time/hour of the day (e.g. no "4h", "5h", "1h40", "15:30", "qua liền" etc. - ignore relative day terms like "mai", "ngày mai" unless accompanied by a specific hour), you MUST assume the receptionist is modifying an existing booking, so set "action" to "update" by default. If a specific time is present, default "action" to "create" (unless specific update/check-in words are present).
   ${replyBookingContext ? `CRITICAL REPLY-TO RULE: The user is explicitly replying to booking ID "${replyBookingContext.id}". Any edit command (like "dời 8h", "đổi sang ydc", "chuyển sang thứ 5") MUST be treated as "action": "update" on this booking.` : ''}
2. "is_walk_in": Boolean. true if the command mentions "kl", "khách lẻ", or "qua liền", "qua lien".
3. "customer_phone": String of exactly 10 digits starting with 0. If not found, null.
4. "short_phone": String of 3-4 digits (e.g., 6557, 488). These are short phone numbers receptionists type as notes.
5. "temporary_name": Extract the capitalized first name of the client (e.g. "Giang", "Lan", "Hương"). Clean any prefix titles (like 'chị', 'c.', 'c', 'anh', 'a.', 'a', 'bạn', 'em', 'khách'). If the receptionist says "kl" (khách lẻ) or walk-in, set this to "Khách Lạ". Default to "Khách Lạ" if no name is given.
6. "service_id": String (UUID) | null. Match abbreviations to these specific services in the database:
   - "yvv" -> "Ý vội vàng"
   - "ydc" -> "Ý dễ chịu"
   - "yvn" -> "Ý vỗ nhẹ"
   - "yn1g" or "yng" or "ynmg" -> "Ý ngủ một giấc"
   - "yph" -> "Ý phục hồi"
   - "y17" -> "Ý 17"
   - "ybb" -> "Ý bầu bí"
   - "cbph" -> "Combo phục hồi"
   - "cbdc" -> "Combo dễ chịu"
   - "cb17" -> "Combo 17"
   - "gddc" -> "Ý 4 tay gấp đôi dễ chịu"
   - "dcdc" -> "Ý 4 tay đỉnh cao dễ chịu"
   - "body", "massage body" -> "Ý 17"
   Always map to the closest matching service's ID. If absolutely no match, use null or the first service's ID.
7. "branch_id": String (UUID). Crucially, this must be one of the IDs from the "Available Branches" list. 
   - Default to "Current Chi Nhánh (Branch) ID" (${current_branch_id}).
   - If the command explicitly mentions a branch name (e.g. matching name of Branch 1 or Branch 2, or "cn1", "cn 1" -> Branch 1 UUID; "cn2", "cn 2" -> Branch 2 UUID), output that branch's UUID. Otherwise, you MUST default to ${current_branch_id || 'null'}.
8. "booking_date": String "YYYY-MM-DD".
   - Default to TODAY's date: ${todayDateStr}
   - CRITICAL LATE NIGHT RULE: If current local hour is after 22:15 (10:15 PM) and the user does not specify a date (like "ngày mai", "t2", etc.), default to TOMORROW'S date.
   - Relative terms: "mai" / "ngày mai" -> tomorrow's date. "mốt" -> day after tomorrow. "thứ hai" / "t2" -> next Monday.
9. "start_time": String "HH:MM" (24-hour) if a specific time is specified in the command. If user specifies a deadline time (e.g. "1g30 là phải xong", "2h xong", "xong trước 2h"), output that target time as "start_time" and set "is_deadline" to true.
   CRITICAL PM DEFAULT RULE: Spas only operate during day/evening hours. 
   - If the hour is between 1 and 6 (e.g. 1h, 4h, 4h45, 5h, 1h40), unless "sáng" (morning) or "am" is explicitly mentioned, you MUST interpret it as PM (afternoon/evening) by adding 12 (e.g., "5h" -> "17:00", "1h40" -> "13:40", "4h" -> "16:00", "4h45" -> "16:45").
   - If the hour is between 7 and 11 (e.g., 8h, 9h, 10h), unless "sáng" or "am" is explicitly mentioned, compare it to the current time of today (${now.getHours()}:${now.getMinutes()}). If that AM time has already passed today, you MUST interpret it as PM (evening) by adding 12 (e.g., if current time is 11:11 AM, "8h" must be interpreted as "20:00", and "10h" must be interpreted as "22:00", rather than placing the booking in the past).
   CRITICAL RULE: If no specific time of day is mentioned or implied, you MUST output null for "start_time" (do NOT default to 1 hour from now or any time).
10. "is_deadline": Boolean. Set to true if the receptionist specifies a completion/end time deadline (e.g., "phải xong", "ph xong", "xong trước").
11. "employee_id": String (UUID) | null. If the user specifies an employee name (often at the end of the command, e.g. "C Tuyết 5h 1ng Yến" -> "Yến" is the employee), match it to one of the Available Employees' ID. If no employee name is specified or no match is found, output null.
12. "num_guests": Integer. Parse guest counts like "2kl" -> 2, "3 người" -> 3. Default to 1.
13. "status": "confirmed", "arrived", or "pending". Set to "arrived" if check-in word is present ("tới", "đến"). Default is "confirmed".
14. "notes": String. Put short phone text ("Số điện thoại XXXX") or other special instructions here.

Return ONLY a valid JSON object matching the following schema. No other text or markdown block.

Schema:
{
  "action": "create" | "update",
  "is_walk_in": boolean,
  "customer_phone": string | null,
  "short_phone": string | null,
  "temporary_name": string,
  "service_id": string | null,
  "branch_id": string | null,
  "booking_date": "YYYY-MM-DD",
  "start_time": "HH:MM" | null,
  "is_deadline": boolean,
  "employee_id": string | null,
  "num_guests": number,
  "status": "confirmed" | "arrived" | "pending",
  "notes": string | null
}`;

    let parsedData;
    let isFallbackUsed = false;
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const response = await model.generateContent([
        { text: systemPrompt },
        { text: `Parse this command: "${command}"` }
      ]);

      const resultText = response.response.text();
      parsedData = JSON.parse(resultText);
    } catch (apiErr) {
      console.warn("Gemini API Error (experiencing high demand or offline). Falling back to offline local parser:", apiErr.message);
      parsedData = fallbackRegexParse(command, current_branch_id, dbBranches, dbServices, dbEmployees);
      isFallbackUsed = true;
    }

    // 2. Prepare structured data compatible with downstream logic
    const parsed = {
      temporary_name: parsedData.temporary_name || 'Khách Lạ',
      customer_phone: parsedData.customer_phone || null,
      short_phone: parsedData.short_phone || null,
      booking_date: parsedData.booking_date,
      start_time: parsedData.start_time,
      branch_id: parsedData.branch_id || current_branch_id || (dbBranches && dbBranches[0]?.id) || null,
      service_id: parsedData.service_id || null,
      employee_id: parsedData.employee_id || null,
      num_guests: parsedData.num_guests || 1,
      notes: parsedData.notes || '',
      status: parsedData.status || 'confirmed',
      is_update: parsedData.action === 'update' || !!reply_to_booking_id
    };

    const isWalkIn = parsedData.is_walk_in || false;

    // Check if service exists, default to "Giữ chỗ" if null
    let targetService = dbServices?.find(s => s.id === parsed.service_id);
    if (!targetService && dbServices && dbServices.length > 0) {
      const placeholderService = dbServices.find(s => s.name.toLowerCase().includes('giữ chỗ') || s.name.toLowerCase().includes('giu cho'));
      targetService = placeholderService ? placeholderService : dbServices[0];
      parsed.service_id = targetService.id;
    }
    
    // CUSTOM RULE: If command matches "body", set duration to 90 minutes
    let duration = targetService?.duration_minutes || 60;
    if (/body/i.test(command)) {
      duration = 90;
    }

    // Compute smart deadline times
    if (parsedData.is_deadline && parsed.start_time) {
      const [deadH, deadM] = parsed.start_time.split(':').map(Number);
      const deadlineMinutes = deadH * 60 + deadM;
      const newStartMinutes = deadlineMinutes - duration;
      if (newStartMinutes >= 0) {
        const startH = String(Math.floor(newStartMinutes / 60)).padStart(2, '0');
        const startM = String(newStartMinutes % 60).padStart(2, '0');
        parsed.end_time = parsed.start_time;
        parsed.start_time = `${startH}:${startM}`;
      } else {
        const [h, m] = parsed.start_time.split(':').map(Number);
        const totalMinutes = h * 60 + m + duration;
        parsed.end_time = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
      }
    } else if (parsed.start_time) {
      const [h, m] = parsed.start_time.split(':').map(Number);
      const totalMinutes = h * 60 + m + duration;
      const endH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const endM = String(totalMinutes % 60).padStart(2, '0');
      parsed.end_time = `${endH}:${endM}`;
    }

    const matchedBranch = dbBranches?.find(b => b.id === parsed.branch_id);
    const matched = {
      branchName: matchedBranch ? matchedBranch.name : null,
      serviceName: targetService ? targetService.name : null,
      duration: duration
    };

    // If short phone is specified, make sure notes reflects it
    if (parsed.short_phone && !parsed.notes.includes(parsed.short_phone)) {
      parsed.notes = parsed.notes ? `Số điện thoại ${parsed.short_phone} | ${parsed.notes}` : `Số điện thoại ${parsed.short_phone}`;
    }

    // ========== 6.5 HANDLE UPDATE LỊCH (CHỈNH LỊCH DỰA THEO TÊN/SĐT) ==========
    if (!isWalkIn || parsed.is_update) {
      // Lấy các lịch từ hôm nay + 7 ngày tới để tìm lịch cần update
      const today = new Date();
      const strFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      const dateTo = new Date(today);
      dateTo.setDate(dateTo.getDate() + 7);
      const strTo = `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, '0')}-${String(dateTo.getDate()).padStart(2, '0')}`;

      const { data: recentBookings } = await supabase
        .from('bookings')
        .select('*, customers(name, phone)')
        .gte('booking_date', strFrom)
        .lte('booking_date', strTo)
        .eq('branch_id', parsed.branch_id)
        .order('created_at', { ascending: false });

      let matchedBooking = null;

      // If user is explicitly replying to a booking context, prioritize it
      if (reply_to_booking_id) {
        try {
          const { data: directBooking, error: directErr } = await supabase
            .from('bookings')
            .select('*, customers(name, phone)')
            .eq('id', reply_to_booking_id)
            .single();
          if (!directErr && directBooking) {
            matchedBooking = directBooking;
          }
        } catch (directLookupErr) {
          console.error('Error looking up direct reply booking:', directLookupErr);
        }
      }

      if (!matchedBooking && recentBookings && recentBookings.length > 0) {
        for (const b of recentBookings) {
          const bPhone = b.customer_phone || b.customers?.phone || '';
          const bName = (b.temporary_name || b.customers?.name || '').toLowerCase();
          const bNotes = (b.notes || '').toLowerCase();
          
          let phoneMatch = false;
          let nameMatch = false;
          let notePhoneMatch = false;

          if (parsed.customer_phone && bPhone.includes(parsed.customer_phone)) {
            phoneMatch = true;
          }

          // Match short phone number in notes (e.g. "Số điện thoại 6557")
          if (parsed.short_phone && bNotes.includes(parsed.short_phone)) {
            notePhoneMatch = true;
          }

          if (parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ') {
            const searchName = parsed.temporary_name.toLowerCase();
            // Match if name is partially included
            if (bName.includes(searchName)) {
              nameMatch = true;
            }
          }

          // If phone matches, note phone matches, or name matches
          if (phoneMatch || notePhoneMatch || nameMatch) {
            matchedBooking = b;
            break;
          }
        }
      }

      // Fallback for "đổi thành" without name or phone (update the most recent booking)
      if (!matchedBooking && parsed.is_update && recentBookings && recentBookings.length > 0) {
        matchedBooking = recentBookings[0];
      }

      if (matchedBooking) {
        // FOUND -> UPDATE
        const updateData = {};
        if (parsed.service_id) updateData.service_id = parsed.service_id;
        if (parsed.status === 'arrived') updateData.status = 'arrived';
        if (parsed.notes) updateData.notes = parsed.notes;
        // Update time if user specified a time (especially deadline)
        if (parsed.start_time) updateData.start_time = parsed.start_time;
        if (parsed.end_time) updateData.end_time = parsed.end_time;
        if (parsed.employee_id) updateData.employee_id = parsed.employee_id;

        const { data: updated, error: updErr } = await supabase
          .from('bookings')
          .update(updateData)
          .eq('id', matchedBooking.id)
          .select('*, services(name, duration_minutes)')
          .single();

        if (updErr) throw updErr;

        const broadcast = getBroadcast(req);
        broadcast('booking.updated', updated);

        let sumName = parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ' ? parsed.temporary_name : matchedBooking.temporary_name || matchedBooking.customers?.name || 'Khách';
        let sumAction = 'Đã cập nhật lịch';
        if (parsed.status === 'arrived') sumAction = 'Đã báo khách tới và cập nhật lịch';

        return res.json({
          success: true,
          count: 1,
          duration: matched.duration,
          summary: `${sumAction} của ${sumName} thành dịch vụ ${matched.serviceName}`,
          matched,
          bookings: [updated.id]
        });
      }
    }

    // ========== 7. AUTO-CREATE BOOKINGS ==========
    const [
      { data: employees },
      { data: beds },
      { data: dayBookings },
      { data: settingsData }
    ] = await Promise.all([
      supabase.from('employees').select('id, name, is_active').eq('is_active', true).eq('branch_id', parsed.branch_id),
      supabase.from('beds').select('id, name, branch_id').eq('branch_id', parsed.branch_id),
      supabase.from('bookings').select('employee_id, bed_id, start_time, end_time, status')
        .eq('branch_id', parsed.branch_id)
        .eq('booking_date', parsed.booking_date)
        .in('status', ['confirmed', 'pending', 'arrived']),
      supabase.from('settings').select('*')
    ]);

    if (!employees || employees.length === 0) {
      return res.status(409).json({ error: 'Không có nhân viên nào hoạt động.' });
    }
    if (!beds || beds.length === 0) {
      return res.status(409).json({ error: 'Không có giường nào tại chi nhánh này.' });
    }

    const settings = (settingsData || []).reduce((acc, curr) => { acc[curr.key] = curr.value; return acc; }, {});
    const bufferTime = parseInt(settings.buffer_time) || 15;
    const tourOrder = settings[`tour_order_${parsed.branch_id}`] || [];

    // Fallback default time for auto-create if no time was specified
    if (!parsed.start_time) {
      const d = new Date();
      d.setHours(d.getHours() + 1);
      parsed.start_time = `${String(d.getHours()).padStart(2, '0')}:00`;
      
      const totalMinutes = d.getHours() * 60 + duration;
      const endH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const endM = String(totalMinutes % 60).padStart(2, '0');
      parsed.end_time = `${endH}:${endM}`;
    }

    const startMinutes = timeToMinutes(parsed.start_time);
    const endMinutes = timeToMinutes(parsed.end_time);

    const createdBookings = [];
    const allBookings = [...(dayBookings || [])];

    for (let g = 0; g < parsed.num_guests; g++) {
      const busyEmployeeIds = new Set();
      const allRelevant = [...allBookings, ...createdBookings.map(b => ({
        employee_id: b.employee_id,
        bed_id: b.bed_id,
        start_time: b.start_time,
        end_time: b.end_time
      }))];

      for (const booking of allRelevant) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time) + bufferTime;
        if (startMinutes < bEnd && bStart < endMinutes) {
          busyEmployeeIds.add(booking.employee_id);
        }
      }

      const availableEmployees = employees.filter(e => !busyEmployeeIds.has(e.id));
      if (availableEmployees.length === 0) {
        if (createdBookings.length > 0) break;
        return res.status(409).json({ error: `Không có nhân viên trống lúc ${parsed.start_time}.` });
      }

      // ASSIGN EMPLOYEE (Prioritize the explicitly specified one)
      let assignedEmployee = null;
      if (parsed.employee_id) {
        assignedEmployee = availableEmployees.find(e => e.id === parsed.employee_id);
      }
      if (!assignedEmployee) {
        availableEmployees.sort((a, b) => {
          const idxA = tourOrder.indexOf(a.id);
          const idxB = tourOrder.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
        assignedEmployee = availableEmployees[0];
      }

      const busyBedIds = new Set();
      for (const booking of allRelevant) {
        const bStart = timeToMinutes(booking.start_time);
        const bEnd = timeToMinutes(booking.end_time);
        if (startMinutes < bEnd && bStart < endMinutes) {
          busyBedIds.add(booking.bed_id);
        }
      }
      const availableBeds = beds.filter(b => !busyBedIds.has(b.id));
      if (availableBeds.length === 0) {
        if (createdBookings.length > 0) break;
        return res.status(409).json({ error: `Không còn giường trống lúc ${parsed.start_time}.` });
      }

      const bedBookingCount = {};
      for (const bed of beds) bedBookingCount[bed.id] = 0;
      for (const booking of allRelevant) {
        if (bedBookingCount[booking.bed_id] !== undefined) bedBookingCount[booking.bed_id]++;
      }
      availableBeds.sort((a, b) => (bedBookingCount[a.id] || 0) - (bedBookingCount[b.id] || 0));
      const assignedBed = availableBeds[0];

      const insertPayload = {
        customer_id: null,
        temporary_name: parsed.temporary_name || (isWalkIn ? '' : 'Khách Lạ'),
        service_id: parsed.service_id || null,
        employee_id: assignedEmployee.id,
        bed_id: assignedBed.id,
        branch_id: parsed.branch_id,
        num_guests: 1,
        booking_date: parsed.booking_date,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        status: parsed.status,
        total_price: 0,
        notes: parsed.notes || null,
        internal_note: null
      };

      const { data: booking, error: bookErr } = await supabase
        .from('bookings')
        .insert([insertPayload])
        .select(`
          *,
          services(name, duration_minutes, price),
          employees(name),
          beds(name),
          branches(name)
        `)
        .single();

      if (bookErr) throw bookErr;
      createdBookings.push(booking);
    }

    const broadcast = getBroadcast(req);
    createdBookings.forEach(b => {
      broadcast('booking.created', b);
    });

    const branchShort = matched.branchName ? matched.branchName.split(' - ')[1] || matched.branchName : 'chi nhánh mặc định';
    
    let nameLabel = 'Khách lạ';
    if (isWalkIn) nameLabel = 'Khách lẻ';
    else if (parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ') nameLabel = `Chị ${parsed.temporary_name}`;
    
    if (parsed.customer_phone) nameLabel += ` (${parsed.customer_phone})`;

    const actionText = parsed.status === 'arrived' ? ' đã tới' : '';
    const timeLabel = parsed.start_time ? parsed.start_time.replace(/^0/, '') : '';

    const summary = `${nameLabel}${actionText} lúc ${timeLabel}, hôm nay ở chi nhánh ${branchShort}`;

    res.json({
      success: true,
      count: createdBookings.length,
      duration: matched.duration || null,
      summary,
      matched,
      bookings: createdBookings.map(b => b.id)
    });
  } catch (err) {
    console.error('Command booking error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
