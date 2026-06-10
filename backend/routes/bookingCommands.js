const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

// ============================================================
// MULTI-INTENT RESPONSE SCHEMA (Gemini Structured Outputs)
// Guarantees 100% strict JSON return from Gemini 2.5 Flash
// ============================================================
const MULTI_INTENT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    intent: {
      type: SchemaType.STRING,
      enum: ['BOOKING', 'STAFF_DUTY'],
      description: 'BOOKING for spa booking commands, STAFF_DUTY for employee duty roster lists'
    },
    bookingData: {
      type: SchemaType.OBJECT,
      description: 'Parsed booking fields. Populated when intent is BOOKING.',
      properties: {
        action: { type: SchemaType.STRING, enum: ['create', 'update'] },
        is_walk_in: { type: SchemaType.BOOLEAN },
        customer_phone: { type: SchemaType.STRING, nullable: true },
        short_phone: { type: SchemaType.STRING, nullable: true },
        temporary_name: { type: SchemaType.STRING },
        service_id: { type: SchemaType.STRING, nullable: true },
        branch_id: { type: SchemaType.STRING, nullable: true },
        booking_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
        start_time: { type: SchemaType.STRING, nullable: true, description: 'HH:MM 24h' },
        is_deadline: { type: SchemaType.BOOLEAN },
        employee_id: { type: SchemaType.STRING, nullable: true },
        num_guests: { type: SchemaType.INTEGER },
        status: { type: SchemaType.STRING, enum: ['confirmed', 'arrived', 'pending'] },
        notes: { type: SchemaType.STRING, nullable: true }
      },
      required: ['action', 'temporary_name', 'booking_date', 'num_guests', 'status']
    },
    staffDutyData: {
      type: SchemaType.OBJECT,
      description: 'Staff duty roster. Populated when intent is STAFF_DUTY.',
      properties: {
        orderedStaffNames: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'Ordered list of on-duty employee names from top to bottom'
        }
      },
      required: ['orderedStaffNames']
    }
  },
  required: ['intent']
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getBroadcast(req) {
  return req.app.get('broadcastSSE') || (() => { });
}

function getVietnamDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 7)); // GMT+7
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

const stripDiacritics = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function parseReplacementCommand(commandText, dbEmployees) {
  const normText = stripDiacritics(commandText).toLowerCase();
  const splitPattern = /\s+(?:thế|the)\s+/i;
  if (!splitPattern.test(normText)) return null;

  const parts = commandText.split(/\s+(?:thế|the)\s+/i);
  if (parts.length < 2) return null;

  const leftText = parts[0].trim();
  const rightText = parts[1].trim();

  let staffA = null;
  let staffB = null;
  let customerName = null;

  // Let's find staff A in leftText
  // Tokenize leftText
  const leftTokens = leftText.split(/\s+/);
  // Find employee matching left tokens from right to left
  for (let i = leftTokens.length - 1; i >= 0; i--) {
    const token = stripDiacritics(leftTokens[i]).toLowerCase();
    const matchedEmp = dbEmployees.find(emp => {
      const empNorm = stripDiacritics(emp.name).toLowerCase();
      const empParts = empNorm.split(/\s+/);
      const firstName = empParts[empParts.length - 1];
      return token === firstName || token === empNorm;
    });
    if (matchedEmp) {
      staffA = matchedEmp;
      // The remaining tokens on the left form the customer name if any
      const remainingTokens = leftTokens.slice(0, i);
      if (remainingTokens.length > 0) {
        customerName = remainingTokens.join(' ');
      }
      break;
    }
  }

  // Tokenize rightText
  const rightTokens = rightText.split(/\s+/);
  // Find employee matching right tokens from left to right
  for (let i = 0; i < rightTokens.length; i++) {
    const token = stripDiacritics(rightTokens[i]).toLowerCase();
    const matchedEmp = dbEmployees.find(emp => {
      const empNorm = stripDiacritics(emp.name).toLowerCase();
      const empParts = empNorm.split(/\s+/);
      const firstName = empParts[empParts.length - 1];
      return token === firstName || token === empNorm;
    });
    if (matchedEmp) {
      staffB = matchedEmp;
      // If customerName wasn't found in leftText, look for it in rightText
      if (!customerName) {
        const remainingTokens = rightTokens.slice(i + 1);
        if (remainingTokens.length > 0) {
          customerName = remainingTokens.join(' ');
        }
      }
      break;
    }
  }

  if (staffA && staffB) {
    // Format customer name if found
    if (customerName) {
      customerName = customerName.replace(/^(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+/i, '');
      customerName = customerName.replace(/(?:0\d{9}|\b\d{3,4}\b)/g, '').trim();
      customerName = customerName.split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      
      const lowerOriginal = leftText.toLowerCase() + ' ' + rightText.toLowerCase();
      if (/\b(?:chị|c\.?)\b/i.test(lowerOriginal)) {
        customerName = 'Chị ' + customerName;
      } else if (/\b(?:anh|a\.?)\b/i.test(lowerOriginal)) {
        customerName = 'Anh ' + customerName;
      }
    }

    return {
      staffA,
      staffB,
      customerName
    };
  }

  return null;
}

// ============================================================
// FALLBACK REGEX PARSER (Order-Insensitive, Multi-Intent)
// Each entity (phone, time, service, name, employee) is
// extracted independently via standalone regex scans,
// so input token order does not matter.
// ============================================================
function fallbackRegexParse(command, current_branch_id, dbBranches, dbServices, dbEmployees) {
  const text = command.trim();

  // ──────────────────────────────────────────────
  // STAFF DUTY DETECTION
  // If input has ≥2 short lines without booking keywords → STAFF_DUTY
  // ──────────────────────────────────────────────
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  // A command is STAFF_DUTY if it has NO booking keywords AND consists of names
  // It can be multi-line or single-line separated by spaces
  const hasBookingKeywords = /(?:\d+\s*[hg:]\s*\d*|\b(?:yvv|ydc|yvn|yph|y17|ybb|yn1g|yng|ynmg|cbph|cbdc|cb17|gddc|dcdc|body|massage|combo|goi|giu cho|kl|khách lẻ|qua liền)\b)/i.test(stripDiacritics(text));
  
  if (!hasBookingKeywords) {
    let names = [];
    if (lines.length >= 2) {
      const allShortLines = lines.every(l => l.length <= 30);
      if (allShortLines) {
        names = lines.filter(l => !/^[-=_.*#>]+$/.test(l));
      }
    } else {
      // Single line space-separated
      // e.g. "Ngân Mai Tuyết Đào"
      names = text.split(/\s+/).filter(w => w.length > 0 && !/^[-=_.*#>]+$/.test(w));
    }
    
    if (names.length >= 1) {
      return {
        intent: 'STAFF_DUTY',
        bookingData: null,
        staffDutyData: { orderedStaffNames: names }
      };
    }
  }

  // ──────────────────────────────────────────────
  // BOOKING PARSE (Order-Insensitive)
  // ──────────────────────────────────────────────
  const lowerText = text.toLowerCase();
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

  // ── 1. Phone (standalone scan) ──
  const fullPhoneMatch = text.match(/0\d{9}/);
  const shortPhoneMatch = text.match(/\b(\d{3,4})\b/);
  if (fullPhoneMatch) {
    parsedData.customer_phone = fullPhoneMatch[0];
  } else if (shortPhoneMatch) {
    parsedData.short_phone = shortPhoneMatch[1];
  }

  // ── 2. Status "tới" (standalone scan) ──
  if (/\btới\b/i.test(text)) {
    parsedData.status = 'arrived';
    parsedData.action = 'update';
  }

  // ── 3. Walk-in (standalone scan) ──
  parsedData.is_walk_in = /\b(?:kl|khách lẻ)\b/i.test(normalizedText);

  // ── 4. Update action keywords (standalone scan) ──
  const updateRegex = /(?:đổi|chỉnh|chuyển|dời|thế|the|hủy|huy)(?:\s+(?:thành|sang|qua|lịch))?/i;
  const updateMatch = lowerText.match(/(.*?)đổi thành(.*)/i) || normalizedText.match(/(.*?)doi thanh(.*)/i) || lowerText.match(/(.*?)(?:chuyển qua|dời sang)(.*)/i) || normalizedText.match(/(.*?)(?:chuyen qua|doi sang)(.*)/i);
  let targetServiceText = lowerText;
  if (updateMatch) {
    parsedData.action = 'update';
    targetServiceText = updateMatch[2].trim();
  } else if (updateRegex.test(lowerText)) {
    parsedData.action = 'update';
  }

  // ── 5. Time (standalone scan — works regardless of position) ──
  let hasExplicitTime = false;
  const isQuaLien = lowerText.includes('qua liền') || lowerText.includes('qua lien') || normalizedText.includes('qua lien');
  if (isQuaLien) {
    hasExplicitTime = true;
    parsedData.is_walk_in = true;
    const now = getVietnamDate();
    const min = Math.ceil(now.getMinutes() / 5) * 5;
    now.setMinutes(min, 0, 0);
    parsedData.start_time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else {
    const timeRegex = /(\d{1,2})(?:h|g|:|giờ\s*)(\d{1,2})?(?!\s*(?:ng|kl|kh|n|k|người|khách))/i;
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
          const d = getVietnamDate();
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

  // If no time specified
  const hasUpdateKeyword = /(?:đổi|chỉnh|dời|chuyển|thế|hủy|doi|chinh|doi|chuyen|the|huy)/i.test(normalizedText);
  if (!hasExplicitTime) {
    if (hasUpdateKeyword) {
      parsedData.action = 'update';
    } else {
      parsedData.action = 'create';
      const vnNow = getVietnamDate();
      const currentMinutes = vnNow.getHours() * 60 + vnNow.getMinutes();
      const roundedMinutes = Math.ceil(currentMinutes / 5) * 5;
      const startH = String(Math.floor(roundedMinutes / 60) % 24).padStart(2, '0');
      const startM = String(roundedMinutes % 60).padStart(2, '0');
      parsedData.start_time = `${startH}:${startM}`;
    }
  }

  // ── 6. Date (standalone scan) ──
  let targetDate = getVietnamDate();
  const isLateNight = targetDate.getHours() > 22 || (targetDate.getHours() === 22 && targetDate.getMinutes() >= 15);
  if (isLateNight) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  // "Mai" ambiguity: first word capitalized "Mai" → name, not date
  const words = text.trim().split(/\s+/);
  const firstWordIsMai = words.length > 0 && /^Mai$/i.test(words[0]) && words[0].charAt(0) === 'M';
  // "mai" is a date reference ONLY if preceded by "ngày" or appears after other tokens (not as first word capitalized)
  const maiAsDate = !firstWordIsMai && (lowerText.includes('ngày mai') || /\bmai\b/.test(lowerText));

  if (!isQuaLien) {
    if (maiAsDate) {
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

  // ── 7. Guest count (standalone scan) ──
  const guestMatch = normalizedText.match(/(\d+)\s*ng(?:uoi)?(?:\s|$)/i) || lowerText.match(/(\d+)\s*người/i) || lowerText.match(/(\d+)\s*kl\b/i);
  if (guestMatch) {
    parsedData.num_guests = parseInt(guestMatch[1]) || 1;
  }

  // ── 8. Name (standalone scan — scans anywhere in text) ──
  if (parsedData.is_walk_in) {
    parsedData.temporary_name = 'Khách Lạ';
  } else if (firstWordIsMai) {
    // "Mai 5h yvv" → name is Mai
    parsedData.temporary_name = 'Mai';
  } else {
    const namePatterns = [
      // "cho chị/anh/c. Tên ..." — anywhere in text
      /cho\s+(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)(?=\s+(?:lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|nv|nhân viên|với|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|tới|-|$))/i,
      // "cho Tên ..." — anywhere in text
      /cho\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)(?=\s+(?:lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|nv|nhân viên|với|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|tới|-|$))/i,
      // "chị/anh/c. Tên ..." — anywhere (removed ^ anchor for order-insensitivity)
      /(?:^|\s)(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)(?=\s+(?:lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|nv|nhân viên|với|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|\d+ng|tới|-|$))/i,
      // "chị/anh Tên đặt lịch/book/lúc..." — anywhere
      /(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+([A-ZÀ-ỹa-zà-ỹ\s]+?)\s+(?:đặt lịch|book|lúc|vào|ngày|ở|cn|chi nhánh|gội|massage|gói|\d{1,2}h|\d{1,2}:\d{2}|\d{1,2}\s*giờ|tới|-)/i
    ];
    let matchedName = null;
    let detectedPrefix = '';
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        matchedName = match[1].trim();
        const fullMatch = match[0].toLowerCase();
        if (/\b(?:chị|c\.?)\b/i.test(fullMatch)) {
          detectedPrefix = 'Chị ';
        } else if (/\b(?:anh|a\.?)\b/i.test(fullMatch)) {
          detectedPrefix = 'Anh ';
        }
        break;
      }
    }
    if (matchedName) {
      matchedName = matchedName.replace(/^(?:chị|anh|khách|bạn|em|cô|chú|c\.?|a\.?|kh\.?)\s+/i, '');
      matchedName = matchedName.replace(/(?:0\d{9}|\b\d{3,4}\b)/g, '').trim();
      const formattedName = matchedName.split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      parsedData.temporary_name = detectedPrefix + formattedName;
    }
  }

  // ── 9. Branch (standalone scan) ──
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

  // ── 10. Service (standalone scan — scans full text independently) ──
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
  if (!parsedData.service_id && parsedData.action !== 'update' && dbServices && dbServices.length > 0) {
    const placeholderService = dbServices.find(s => s.name.toLowerCase().includes('giữ chỗ') || s.name.toLowerCase().includes('giu cho'));
    parsedData.service_id = placeholderService ? placeholderService.id : dbServices[0].id;
  }

  // ── 11. Employee (standalone scan — scans from end of text backward) ──
  if (dbEmployees && dbEmployees.length > 0) {
    const tokens = text.trim().split(/\s+/);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = stripDiacritics(tokens[i]);
      for (const emp of dbEmployees) {
        if (emp.branch_id && parsedData.branch_id && emp.branch_id !== parsedData.branch_id) continue;
        const empNorm = stripDiacritics(emp.name);
        const empParts = empNorm.split(/\s+/);
        const firstName = empParts[empParts.length - 1];
        if (token === firstName || token === empNorm) {
          parsedData.employee_id = emp.id;
          break;
        }
      }
      if (parsedData.employee_id) break;
    }
  }

  // Capture notes in parentheses
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    parsedData.notes = parenMatch[1].trim();
  }

  return {
    intent: 'BOOKING',
    bookingData: parsedData,
    staffDutyData: null
  };
}

// ============================================================
// STAFF DUTY HANDLER
// Resets all branch employees then sets on-duty + tour order
// Also updates settings.tour_order_{branchId} for backward compat
// ============================================================
async function handleStaffDuty(req, res, staffDutyData, currentBranchId, dbBranches, dbEmployees) {
  const broadcast = getBroadcast(req);
  const branchId = currentBranchId || (dbBranches && dbBranches[0]?.id);

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Không xác định được chi nhánh. Vui lòng chọn chi nhánh trước.' });
  }

  const { orderedStaffNames } = staffDutyData || {};
  if (!orderedStaffNames || orderedStaffNames.length === 0) {
    return res.status(400).json({ success: false, error: 'Danh sách nhân viên trống.' });
  }

  // Extract date from the command, e.g. "Tour 01/06 1.Tí 2.Yến..."
  const commandText = req.body.command || '';
  const dateMatch = commandText.match(/(\d{1,2})[/\-](\d{1,2})/);
  let scheduleDate = null;
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1;
    const year = new Date().getFullYear();
    const d = new Date(year, month, day);
    scheduleDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } else {
    // Default to today in Vietnam timezone
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const vnNow = new Date(utc + (3600000 * 7));
    scheduleDate = `${vnNow.getFullYear()}-${String(vnNow.getMonth() + 1).padStart(2, '0')}-${String(vnNow.getDate()).padStart(2, '0')}`;
  }

  // Step 1: Reset ALL employees of this branch to OFF_DUTY
  const { error: resetErr } = await supabase
    .from('employees')
    .update({ status: 'OFF_DUTY', current_tour_order: null })
    .eq('branch_id', branchId);

  if (resetErr) {
    console.error('Error resetting employee duty status:', resetErr);
    throw resetErr;
  }

  // Step 2: Match names and set ON_DUTY with tour order
  const branchEmployees = (dbEmployees || []).filter(e => e.branch_id === branchId);
  const matchedIds = [];
  const matchedNames = [];
  let updatedCount = 0;

  for (let i = 0; i < orderedStaffNames.length; i++) {
    const inputName = orderedStaffNames[i].trim();
    if (!inputName) continue;

    const normalizedInput = stripDiacritics(inputName);

    // Find matching employee: compare against Vietnamese first name (last word of full name)
    let matched = null;
    for (const emp of branchEmployees) {
      const empNorm = stripDiacritics(emp.name);
      const empParts = empNorm.split(/\s+/);
      const firstName = empParts[empParts.length - 1];

      if (firstName === normalizedInput || empNorm === normalizedInput) {
        matched = emp;
        break;
      }
    }

    if (matched) {
      const { error: updateErr } = await supabase
        .from('employees')
        .update({ status: 'ON_DUTY', current_tour_order: i + 1 })
        .eq('id', matched.id);

      if (!updateErr) {
        matchedIds.push(matched.id);
        matchedNames.push(matched.name);
        updatedCount++;
      } else {
        console.error(`Error updating employee ${matched.name}:`, updateErr);
      }
    } else {
      console.warn(`STAFF_DUTY: No employee match found for name "${inputName}" in branch ${branchId}`);
    }
  }

  // Step 2.5: Upsert employee schedules for this branch for scheduleDate
  if (scheduleDate) {
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

      if (schedErr) {
        console.error('Error upserting employee schedules in staff duty:', schedErr);
      }
    }
  }

  // Step 3: Update settings tour_order and save it
  let updatedSettings = null;
  try {
    const { data: upsertData, error: settingsErr } = await supabase
      .from('settings')
      .upsert({ key: `tour_order_${branchId}`, value: matchedIds }, { onConflict: 'key' })
      .select()
      .single();
      
    if (!settingsErr && upsertData) {
      updatedSettings = upsertData;
    }
  } catch (settingsErr) {
    console.error('Error updating tour_order setting:', settingsErr);
  }

  // Step 4: Fetch updated employee list
  const { data: updatedEmployees } = await supabase
    .from('employees')
    .select('id, name, status, current_tour_order, branch_id, is_active')
    .eq('branch_id', branchId)
    .order('current_tour_order', { ascending: true, nullsFirst: false });

  // Step 5: Broadcast SSE events
  if (updatedSettings) {
    broadcast('settings.updated', updatedSettings);
  }
  broadcast('staff.duty_updated', {
    branch_id: branchId,
    employees: updatedEmployees
  });

  // Step 6: Return response
  return res.json({
    success: true,
    intent: 'STAFF_DUTY',
    updatedCount,
    totalNames: orderedStaffNames.length,
    matchedNames,
    summary: `Đã cập nhật ${updatedCount}/${orderedStaffNames.length} nhân viên trực.`,
    employees: updatedEmployees
  });
}

// ============================================================
// POST /api/bookings/command
// Parse natural language Vietnamese commands to create/update
// bookings or set employee duty roster.
// ============================================================
router.post('/', async (req, res) => {
  try {
    const { command, current_branch_id, reply_to_booking_ids } = req.body;
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

    const now = getVietnamDate();
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Weekdays label map for prompt context
    const weekdaysVN = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const currentDayOfWeekStr = weekdaysVN[now.getDay()];

    // Cancellation logic for "Hủy" command when replying to a booking
    const normalizedCmd = command.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (reply_to_booking_ids && reply_to_booking_ids.length > 0 && (normalizedCmd === 'huy' || normalizedCmd === 'xoa' || normalizedCmd === 'huy lich' || normalizedCmd === 'xoa lich')) {
      const { data: deletedBookings, error: deleteErr } = await supabase
        .from('bookings')
        .delete()
        .in('id', reply_to_booking_ids)
        .select();

      if (deleteErr) throw deleteErr;

      const broadcast = getBroadcast(req);
      reply_to_booking_ids.forEach(id => {
        broadcast('booking.deleted', { id });
      });

      const customerName = deletedBookings.length > 0 ? (deletedBookings[0].temporary_name || 'Khách') : 'Khách';
      const numDeleted = deletedBookings.length;
      const countLabel = numDeleted > 1 ? `${numDeleted} lịch hẹn` : `lịch hẹn`;

      return res.json({
        success: true,
        intent: 'BOOKING_DELETE',
        summary: `Đã hủy ${countLabel} của khách ${customerName} thành công và xóa khỏi hệ thống.`,
        bookings: reply_to_booking_ids
      });
    }

    // Fetch reply booking details if reply_to_booking_ids is provided
    let replyBookingContext = null;
    if (reply_to_booking_ids && reply_to_booking_ids.length > 0) {
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
          .eq('id', reply_to_booking_ids[0])
          .single();

        if (!replyErr && replyBooking) {
          replyBookingContext = replyBooking;
        }
      } catch (err) {
        console.error('Error fetching reply booking context:', err);
      }
    }

    // ──────────────────────────────────────────────
    // SYSTEM PROMPT (Multi-Intent, Order-Insensitive)
    // JSON schema is enforced by responseSchema — prompt focuses on business rules only
    // ──────────────────────────────────────────────
    const systemPrompt = `You are an AI assistant for YOi Spa booking system.
Parse Vietnamese natural language commands from a spa receptionist and return structured data.

## INTENT DETECTION
- "STAFF_DUTY": The command is a list of employee names. This list can be MULTI-LINE (separated by line breaks) OR SINGLE-LINE separated by spaces (e.g., "Ngân Mai Tuyết Đào"). Use your natural language understanding of common Vietnamese names to accurately separate them into individual elements in the \`orderedStaffNames\` array, preserving their exact left-to-right or top-to-bottom priority order. Extract only the names, skip separator lines ("---", "===", "***") and non-name notes. Leave bookingData empty/default.
- "BOOKING": Any single-line command or non-list text about booking a spa service. Parse into bookingData fields. Leave staffDutyData empty/default.

## CRITICAL: ORDER INSENSITIVITY
Booking command tokens can appear in ANY chaotic order. You MUST act as a keyword scanner — extract each entity independently regardless of position.
ALL of these MUST produce the SAME booking result:
"8h yvv c Mai" = "yvv c Mai 8h" = "c Mai 8h yvv" = "c Mai yvv 8h"

## CRITICAL: "MAI" AMBIGUITY RESOLUTION
- If "Mai" is the FIRST WORD of a booking command (e.g., "Mai 5h yvv"), it is a PERSON'S NAME → set temporary_name: "Mai". Booking date defaults to TODAY (${todayDateStr}).
- If "Mai" is found inside a STAFF_DUTY name list (e.g., "Ngân Mai Tuyết Đào"), it must be treated strictly as the name of an employee on-duty.
- "Mai" means TOMORROW only when explicitly preceded by "ngày" (i.e., "ngày mai") or when it clearly functions as a time reference embedded after other booking tokens.

${replyBookingContext ? `## CRITICAL: REPLY CONTEXT
The receptionist is replying to an existing booking. You MUST set bookingData.action to "update".
Reply booking: ${JSON.stringify({
  id: replyBookingContext.id,
  booking_date: replyBookingContext.booking_date,
  start_time: replyBookingContext.start_time,
  end_time: replyBookingContext.end_time,
  customer_name: replyBookingContext.customers?.name || replyBookingContext.temporary_name || 'Khách',
  customer_phone: replyBookingContext.customers?.phone || replyBookingContext.customer_phone || '',
  service_name: replyBookingContext.services?.name || '',
  branch_name: replyBookingContext.branches?.name || '',
  employee_name: replyBookingContext.employees?.name || ''
})}` : ''}

## Context
- Current Server Date: ${todayDateStr} (${currentDayOfWeekStr})
- Current Local Server Time (Vietnam GMT+7): ${now.toLocaleTimeString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'})} (Hour: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')})
- Branches: ${JSON.stringify(dbBranches || [])}
- Services: ${JSON.stringify(dbServices || [])}
- Active Employees: ${JSON.stringify(dbEmployees || [])}
- Current Branch ID: ${current_branch_id || 'null'}

## BOOKING FIELD RULES

1. **action**: "create" if this is a new booking command. "update" if the command has update/check-in keywords ("đổi thành", "chỉnh", "chuyển sang", "chuyển qua", "dời sang", "thế", "tới", "đã tới").
   ${replyBookingContext ? `FORCED: action MUST be "update" (reply context).` : 'If the command has NO update/check-in keywords → action MUST be "create".'}

2. **is_walk_in**: true if "kl", "khách lẻ", "qua liền", "qua lien".

3. **customer_phone**: Exactly 10 digits starting with 0. Null if not found.

4. **short_phone**: 3-4 digit string (e.g., "6557", "488"). Null if not found.

5. **temporary_name**: Capitalized first name. Clean prefixes ("chị", "c.", "c", "anh", "a.", "bạn", "em", "khách", "kh.").
   PREFIX INJECTION: If the user types "C [Name]" or "Chị [Name]", make sure to prepend "Chị " (e.g. "C Tú" -> "Chị Tú"). If the user types "A [Name]" or "Anh [Name]", prepend "Anh " (e.g. "A Văn" -> "Anh Văn"). Walk-in → "Khách Lạ". Default "Khách Lạ".

6. **service_id**: Match abbreviations to service UUIDs:
   "yvv" → "Ý vội vàng" | "ydc" → "Ý dễ chịu" | "yvn" → "Ý vỗ nhẹ"
   "yn1g"/"yng"/"ynmg" → "Ý ngủ một giấc" | "yph" → "Ý phục hồi"
   "y17"/"body"/"massage body" → "Ý 17" | "ybb" → "Ý bầu bí"
   "cbph" → "Combo phục hồi" | "cbdc" → "Combo dễ chịu" | "cb17" → "Combo 17"
   "gddc" → "Ý 4 tay gấp đôi dễ chịu" | "dcdc" → "Ý 4 tay đỉnh cao dễ chịu"
   Map to the closest service UUID. If no match → null.

7. **branch_id**: Default to ${current_branch_id || 'null'}. Only change if command mentions branch ("cn1"/"cn 1" → Branch 1, "cn2"/"cn 2" → Branch 2, "dời sang cn2", "chuyển qua Lê Văn Huân"). Match branch names from Branches list.

8. **booking_date**: "YYYY-MM-DD". Default TODAY ${todayDateStr}.
   LATE NIGHT: If hour > 22:15 and no explicit date → TOMORROW.
   "ngày mai" → tomorrow. "mốt"/"ngày mốt" → day after tomorrow. "t2" → next Monday. Similar for other weekdays. "dd/mm" format supported.

9. **start_time**: "HH:MM" 24h. Apply these STRICT TIME RULES:
   - **Spa Operating Hours**: Mon-Fri: 10:00 to 22:00, Sat-Sun: 09:00 to 22:00.
   - **Smart AM/PM Deduction**: Commands specifying early hours like "7h", "8h", "9h" (on weekdays) MUST automatically resolve to PM (19:00, 20:00, 21:00) since the spa opens at 10:00.
   - **The 12 o'clock Rule**: "12h" MUST always resolve to "12:00" PM (noon), NEVER 00:00 AM (midnight).
   - **No Past Bookings (Anti-Past Logic)**: If the parsed appointment hour has ALREADY passed relative to the Current Local Server Time on TODAY, you MUST intelligently assume the appointment is for the FUTURE evening or next valid slot. For example, if it's 22:20 and the user types "10h c Mai", do NOT resolve to 10:00 AM in the past. Resolve to "22:00" TODAY (or flip to tomorrow if closing).
   - **Immediate default when creating**: If NO time is mentioned in the command AND action is "create", you MUST set start_time to the Current Local Server Time rounded UP to the nearest 5 minutes (e.g. if current time is 12:30, set to 12:30. If current time is 16:11, set to 16:15). If action is "update", start_time should be null.
   - "qua liền" → round up to nearest 5 min.

10. **is_deadline**: true if "phải xong", "ph xong", "xong trước".

11. **employee_id**: Match employee name (often at end of command) to UUID. Null if no match.

12. **num_guests**: "2kl" → 2, "3 người" → 3. Default 1.

13. **status**: "arrived" if "tới"/"đến". Default "confirmed".

14. **notes**: If there is text inside parentheses in the command (e.g., "(khách gấp vô liền)" or "(có việc bận)"), extract the text inside (e.g., "khách gấp vô liền", "có việc bận") and set it as the notes. Combine with short phone details if present. Null if none.`;

    // ──────────────────────────────────────────────
    // GEMINI CALL (with responseSchema for guaranteed JSON)
    // ──────────────────────────────────────────────
    let geminiResult;
    let isFallbackUsed = false;
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: MULTI_INTENT_SCHEMA
        }
      });

      const response = await model.generateContent([
        { text: systemPrompt },
        { text: `Parse this command: "${command}"` }
      ]);

      const resultText = response.response.text();
      geminiResult = JSON.parse(resultText);
    } catch (apiErr) {
      console.warn("Gemini API Error (experiencing high demand or offline). Falling back to offline local parser:", apiErr.message);
      geminiResult = fallbackRegexParse(command, current_branch_id, dbBranches, dbServices, dbEmployees);
      isFallbackUsed = true;
    }

    // ──────────────────────────────────────────────
    // INTENT BRANCHING
    // ──────────────────────────────────────────────
    if (geminiResult.intent === 'STAFF_DUTY') {
      if (!geminiResult.staffDutyData || !geminiResult.staffDutyData.orderedStaffNames || geminiResult.staffDutyData.orderedStaffNames.length === 0) {
        return res.status(400).json({ success: false, error: 'Không nhận diện được danh sách nhân viên.' });
      }
      return handleStaffDuty(req, res, geminiResult.staffDutyData, current_branch_id, dbBranches, dbEmployees);
    }

    // ========== BOOKING INTENT — all existing logic preserved ==========
    const parsedData = geminiResult.bookingData || {};

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
      is_update: parsedData.action === 'update' || !!(reply_to_booking_ids && reply_to_booking_ids.length > 0)
    };

    // Make sure prefix is added
    if (parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ') {
      const cleanName = parsed.temporary_name.replace(/^(?:Chị|Anh|chị|anh|c\.|a\.|c|a)\s+/i, '').trim();
      const normCmd = command.toLowerCase();
      // Check if command has prefix for this name
      const nameEscaped = cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const prefixRegex = new RegExp(`(?:\\b(?:chị|c\\.?)\\s+${nameEscaped})|(?:\\b(?:chị|c\\.?)${nameEscaped})`, 'i');
      const malePrefixRegex = new RegExp(`(?:\\b(?:anh|a\\.?)\\s+${nameEscaped})|(?:\\b(?:anh|a\\.?)${nameEscaped})`, 'i');
      
      if (prefixRegex.test(normCmd)) {
        parsed.temporary_name = 'Chị ' + cleanName;
      } else if (malePrefixRegex.test(normCmd)) {
        parsed.temporary_name = 'Anh ' + cleanName;
      } else {
        parsed.temporary_name = cleanName;
      }
    }

    // Therapist replacement command handling
    const replacement = parseReplacementCommand(command, dbEmployees);
    if (replacement) {
      let { data: matchingBookings, error: findErr } = await supabase
        .from('bookings')
        .select('*, customers(name, phone)')
        .eq('booking_date', parsed.booking_date)
        .eq('employee_id', replacement.staffB.id)
        .neq('status', 'cancelled');

      if (findErr) throw findErr;

      let bookingToUpdate = null;
      if (matchingBookings && matchingBookings.length > 0) {
        if (replacement.customerName) {
          const searchCustName = stripDiacritics(replacement.customerName).toLowerCase();
          bookingToUpdate = matchingBookings.find(b => {
            const bName = stripDiacritics(b.temporary_name || b.customers?.name || '').toLowerCase();
            return bName.includes(searchCustName);
          });
        }
        if (!bookingToUpdate) {
          bookingToUpdate = matchingBookings[0];
        }
      }

      if (bookingToUpdate) {
        const { data: updated, error: updErr } = await supabase
          .from('bookings')
          .update({ employee_id: replacement.staffA.id })
          .eq('id', bookingToUpdate.id)
          .select(`
            *,
            customers(name, phone),
            services(name, duration_minutes),
            employees(name),
            beds(name),
            branches(name)
          `)
          .single();

        if (updErr) throw updErr;

        const broadcast = getBroadcast(req);
        broadcast('booking.updated', updated);

        const custDisplayName = updated.temporary_name || updated.customers?.name || 'Khách';
        return res.json({
          success: true,
          count: 1,
          duration: updated.services?.duration_minutes || 60,
          summary: `Đã đổi nhân viên từ ${replacement.staffB.name} sang ${replacement.staffA.name} cho lịch hẹn của ${custDisplayName}`,
          bookings: [updated.id]
        });
      } else {
        return res.status(404).json({
          success: false,
          error: `Không tìm thấy lịch hẹn nào của nhân viên ${replacement.staffB.name} vào ngày ${parsed.booking_date} để thay thế.`
        });
      }
    }

    const isWalkIn = parsedData.is_walk_in || false;

    // Check if service exists, default to "Giữ chỗ" if null AND it's a new booking
    let targetService = dbServices?.find(s => s.id === parsed.service_id);
    if (!targetService && !parsed.is_update && dbServices && dbServices.length > 0) {
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
    if (parsed.is_update) {
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

      let matchedBookings = [];

      // If user is explicitly replying to a booking context, prioritize it
      if (reply_to_booking_ids && reply_to_booking_ids.length > 0) {
        try {
          const { data: directBookings, error: directErr } = await supabase
            .from('bookings')
            .select('*, customers(name, phone)')
            .in('id', reply_to_booking_ids);
          if (!directErr && directBookings) {
            matchedBookings = directBookings;
          }
        } catch (directLookupErr) {
          console.error('Error looking up direct reply booking:', directLookupErr);
        }
      }

      if (matchedBookings.length === 0 && recentBookings && recentBookings.length > 0) {
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
            matchedBookings = [b];
            break;
          }
        }
      }

      // Fallback for "đổi thành" without name or phone (update the most recent booking)
      if (matchedBookings.length === 0 && parsed.is_update && recentBookings && recentBookings.length > 0) {
        matchedBookings = [recentBookings[0]];
      }

      // If we matched exactly one booking (e.g. via fallback match) and it's part of a group, fetch the rest of the group so they move together
      if (matchedBookings.length === 1 && matchedBookings[0].group_booking_id) {
        try {
          const { data: groupBookings } = await supabase
            .from('bookings')
            .select('*, customers(name, phone)')
            .eq('group_booking_id', matchedBookings[0].group_booking_id);
          
          if (groupBookings && groupBookings.length > 1) {
             matchedBookings = groupBookings;
          }
        } catch (err) {
          console.error("Error fetching group bookings:", err);
        }
      }

      if (matchedBookings.length > 0) {
        // FOUND -> UPDATE ALL
        const updateData = {};
        if (parsed.service_id) updateData.service_id = parsed.service_id;
        if (parsed.status === 'arrived') updateData.status = 'arrived';
        if (parsed.notes) updateData.notes = parsed.notes;
        // Update time if user specified a time (especially deadline)
        if (parsed.start_time) updateData.start_time = parsed.start_time;
        if (parsed.end_time) updateData.end_time = parsed.end_time;
        if (parsed.booking_date) updateData.booking_date = parsed.booking_date;
        if (parsed.employee_id) updateData.employee_id = parsed.employee_id;
        if (parsed.branch_id) {
          updateData.branch_id = parsed.branch_id;
        }

        const updatedIds = [];
        const broadcast = getBroadcast(req);
        
        for (const mb of matchedBookings) {
          // branch_id needs special care: only update if changed
          const mbUpdateData = { ...updateData };
          if (mbUpdateData.branch_id === mb.branch_id) {
            delete mbUpdateData.branch_id;
          }
          
          // Do not group multiple bookings into a single employee when updating a group
          if (matchedBookings.length > 1) {
            delete mbUpdateData.employee_id;
          }

          const { data: updated, error: updErr } = await supabase
            .from('bookings')
            .update(mbUpdateData)
            .eq('id', mb.id)
            .select('*, services(name, duration_minutes)')
            .single();

          if (updErr) throw updErr;

          updatedIds.push(updated.id);
          broadcast('booking.updated', updated);
        }

        const firstMatched = matchedBookings[0];
        let sumName = parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ' ? parsed.temporary_name : firstMatched.temporary_name || firstMatched.customers?.name || 'Khách';
        
        const numUpdated = matchedBookings.length;
        let sumAction = numUpdated > 1 ? `Đã cập nhật ${numUpdated} lịch` : `Đã cập nhật 1 lịch`;
        if (parsed.status === 'arrived') {
           sumAction = numUpdated > 1 ? `Đã báo khách tới và cập nhật ${numUpdated} lịch` : `Đã báo khách tới và cập nhật 1 lịch`;
        }
        
        let serviceStr = '';
        if (updateData.service_id && matched.serviceName) {
            serviceStr = ` thành dịch vụ ${matched.serviceName}`;
        }
        
        let timeStr = '';
        if (updateData.start_time) {
            timeStr = ` lúc ${updateData.start_time.replace(/^0/, '')}`;
        }

        return res.json({
          success: true,
          count: numUpdated,
          duration: matched.duration || 60,
          summary: `${sumAction} của ${sumName}${serviceStr}${timeStr}`,
          matched,
          bookings: updatedIds
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
      const vnNow = getVietnamDate();
      const currentMinutes = vnNow.getHours() * 60 + vnNow.getMinutes();
      const roundedMinutes = Math.ceil(currentMinutes / 5) * 5;
      const startH = String(Math.floor(roundedMinutes / 60) % 24).padStart(2, '0');
      const startM = String(roundedMinutes % 60).padStart(2, '0');
      parsed.start_time = `${startH}:${startM}`;
      
      const totalMinutes = roundedMinutes + duration;
      const endH = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
      const endM = String(totalMinutes % 60).padStart(2, '0');
      parsed.end_time = `${endH}:${endM}`;
    }

    const startMinutes = timeToMinutes(parsed.start_time);
    const endMinutes = timeToMinutes(parsed.end_time);

    const createdBookings = [];
    const allBookings = [...(dayBookings || [])];

    const crypto = require('crypto');
    const groupBookingId = parsed.num_guests > 1 ? crypto.randomUUID() : null;

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
        return res.status(409).json({ error: "Hiện tại lịch của anh/chị đang bị trùng lịch, vui lòng lựa chọn khung giờ khác hoặc nhân viên/chi nhánh khác." });
      }

      // ASSIGN EMPLOYEE (Prioritize the explicitly specified one)
      let assignedEmployee = null;
      if (parsed.employee_id) {
        assignedEmployee = availableEmployees.find(e => e.id === parsed.employee_id);
        if (!assignedEmployee) {
          return res.status(409).json({ error: "Hiện tại lịch của anh/chị đang bị trùng lịch, vui lòng lựa chọn khung giờ khác hoặc nhân viên/chi nhánh khác." });
        }
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
        return res.status(409).json({ error: "Hiện tại lịch của anh/chị đang bị trùng lịch, vui lòng lựa chọn khung giờ khác hoặc nhân viên/chi nhánh khác." });
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
        num_guests: parsed.num_guests,
        booking_date: parsed.booking_date,
        start_time: parsed.start_time,
        end_time: parsed.end_time,
        status: parsed.status,
        total_price: 0,
        notes: parsed.notes || null,
        internal_note: null,
        group_booking_id: groupBookingId
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
