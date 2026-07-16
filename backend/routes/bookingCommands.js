const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini (new @google/genai SDK)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'dummy_key' });
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// ============================================================
// MULTI-INTENT RESPONSE SCHEMA (Gemini Structured Outputs)
// Guarantees 100% strict JSON return from gemini-3.1-flash-lite
// ============================================================
const MULTI_INTENT_SCHEMA = {
  type: "object",
  required: ["intent"],
  properties: {
    intent: {
      type: "string",
      enum: ["BOOKING", "STAFF_DUTY"]
    },
    bookingData: {
      type: "object",
      required: ["action", "temporary_name", "num_guests", "status"],
      properties: {
        action: {
          type: "string",
          enum: ["create", "update"]
        },
        is_walk_in: {
          type: "boolean"
        },
        customer_phone: {
          type: "string"
        },
        short_phone: {
          type: "string"
        },
        temporary_name: {
          type: "string"
        },
        service_id: {
          type: "string"
        },
        service_ids: {
          type: "array",
          items: {
            type: "string"
          }
        },
        branch_id: {
          type: "string"
        },
        employee_id: {
          type: "string"
        },
        employee_ids: {
          type: "array",
          items: {
            type: "string"
          }
        },
        booking_date: {
          type: "string"
        },
        start_time: {
          type: "string"
        },
        is_deadline: {
          type: "boolean"
        },
        num_guests: {
          type: "integer"
        },
        status: {
          type: "string",
          enum: ["confirmed", "arrived", "pending"]
        },
        notes: {
          type: "string"
        },
        duration_minutes: {
          type: "integer"
        }
      }
    },
    staffDutyData: {
      type: "object",
      required: ["orderedStaffNames"],
      properties: {
        orderedStaffNames: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    }
  }
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
  const hasUpdateKeyword = /(?:đổi|đoi|chỉnh|dời|chuyển|thế|hủy|doi|chinh|chuyen|the|huy)/i.test(normalizedText) || parsedData.action === 'update';
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
  let dateExplicitlySet = false;

  if (isLateNight && parsedData.action !== 'update') {
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
      dateExplicitlySet = true;
    } else if (lowerText.includes('mốt') || lowerText.includes('ngày kia') || lowerText.includes('ngày mốt')) {
      targetDate.setDate(targetDate.getDate() + 2);
      dateExplicitlySet = true;
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
          dateExplicitlySet = true;
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
          dateExplicitlySet = true;
        }
      }
    }
  }

  if (parsedData.action === 'update' && !dateExplicitlySet) {
    parsedData.booking_date = null;
  } else {
    parsedData.booking_date = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  }

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
    const matchedServices = [];
    for (const [keyword, targetName] of Object.entries(serviceKeywords)) {
      const regex = new RegExp(`(?:^|\\s|\\d)(${keyword})(?:\\s|\\d|$)`, 'ig');
      let match;
      while ((match = regex.exec(normSearch)) !== null) {
        const normTarget = stripDiacritics(targetName);
        const svc = dbServices.find(s => stripDiacritics(s.name.toLowerCase()) === normTarget);
        if (svc) {
          matchedServices.push({ index: match.index, id: svc.id });
        }
      }
    }
    if (matchedServices.length > 0) {
      matchedServices.sort((a, b) => a.index - b.index);
      parsedData.service_ids = matchedServices.map(m => m.id);
      parsedData.service_id = parsedData.service_ids[0];
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
    const tokens = text.trim().split(/[\s,+&]+/);
    const matchedEmployeeIds = [];
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = stripDiacritics(tokens[i]);
      for (const emp of dbEmployees) {
        if (emp.branch_id && parsedData.branch_id && emp.branch_id !== parsedData.branch_id) continue;
        const empNorm = stripDiacritics(emp.name);
        const empParts = empNorm.split(/\s+/);
        const firstName = empParts[empParts.length - 1];
        if (token === firstName || token === empNorm) {
          if (!matchedEmployeeIds.includes(emp.id)) {
            matchedEmployeeIds.unshift(emp.id); // Add to beginning to preserve order
          }
        }
      }
    }
    if (matchedEmployeeIds.length > 0) {
      parsedData.employee_ids = matchedEmployeeIds;
      parsedData.employee_id = matchedEmployeeIds[0];
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

  // Step 2: Match names and set ON_DUTY with tour order.
  // Prefer a match already in this branch; if a name isn't found locally, fall back
  // to searching other branches — this covers staff being transferred in for the tour.
  const branchEmployees = (dbEmployees || []).filter(e => e.branch_id === branchId);
  const otherBranchEmployees = (dbEmployees || []).filter(e => e.branch_id !== branchId);
  const matchedIds = [];
  const matchedNames = [];
  const transferredEmployees = []; // { id, name, fromBranchId }
  let updatedCount = 0;

  const findByName = (pool, normalizedInput) => pool.find(emp => {
    const empNorm = stripDiacritics(emp.name);
    const empParts = empNorm.split(/\s+/);
    const firstName = empParts[empParts.length - 1];
    return firstName === normalizedInput || empNorm === normalizedInput;
  });

  for (let i = 0; i < orderedStaffNames.length; i++) {
    const inputName = orderedStaffNames[i].trim();
    if (!inputName) continue;

    const normalizedInput = stripDiacritics(inputName);

    let matched = findByName(branchEmployees, normalizedInput);
    let isTransfer = false;

    if (!matched) {
      matched = findByName(otherBranchEmployees, normalizedInput);
      isTransfer = !!matched;
    }

    if (matched) {
      const updatePayload = { status: 'ON_DUTY', current_tour_order: i + 1 };
      if (isTransfer) updatePayload.branch_id = branchId;

      const { error: updateErr } = await supabase
        .from('employees')
        .update(updatePayload)
        .eq('id', matched.id);

      if (!updateErr) {
        matchedIds.push(matched.id);
        matchedNames.push(matched.name);
        updatedCount++;

        if (isTransfer) {
          transferredEmployees.push({ id: matched.id, name: matched.name, fromBranchId: matched.branch_id });
          // Reflect the move locally so the schedule upsert below (Step 2.5) picks them up too
          matched.branch_id = branchId;
          branchEmployees.push(matched);
        }
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

  // Also notify branches that just lost a transferred employee, so their staff lists stay in sync
  const affectedOldBranchIds = [...new Set(
    transferredEmployees.map(t => t.fromBranchId).filter(id => id && id !== branchId)
  )];
  for (const oldBranchId of affectedOldBranchIds) {
    const { data: oldBranchEmployees } = await supabase
      .from('employees')
      .select('id, name, status, current_tour_order, branch_id, is_active')
      .eq('branch_id', oldBranchId)
      .order('current_tour_order', { ascending: true, nullsFirst: false });

    broadcast('staff.duty_updated', {
      branch_id: oldBranchId,
      employees: oldBranchEmployees
    });
  }

  // Step 6: Return response
  let summary = `Đã cập nhật ${updatedCount}/${orderedStaffNames.length} nhân viên trực.`;
  if (transferredEmployees.length > 0) {
    const branchNameOf = (id) => (dbBranches || []).find(b => b.id === id)?.name || 'chi nhánh khác';
    const transferSummary = transferredEmployees
      .map(t => `${t.name} (từ ${branchNameOf(t.fromBranchId)})`)
      .join(', ');
    summary += ` Đã chuyển ${transferredEmployees.length} nhân viên sang chi nhánh này: ${transferSummary}.`;
  }

  return res.json({
    success: true,
    intent: 'STAFF_DUTY',
    updatedCount,
    totalNames: orderedStaffNames.length,
    matchedNames,
    transferredEmployees,
    summary,
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

    const now = getVietnamDate();
    const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // 1. Fetch current branches, services, active employees, and bookings from DB
    const [
      { data: dbBranches },
      { data: dbServices },
      { data: dbEmployees },
      { data: dbBookings }
    ] = await Promise.all([
      supabase.from('branches').select('id, name, opening_hours'),
      supabase.from('services').select('id, name, duration_minutes'),
      supabase.from('employees').select('id, name, is_active, branch_id').eq('is_active', true),
      supabase
        .from('bookings')
        .select(`
          id,
          booking_date,
          start_time,
          end_time,
          temporary_name,
          employee_id,
          service_id,
          branch_id,
          status,
          num_guests,
          customers(name, phone),
          branches(name),
          employees(name),
          services(name)
        `)
        .gte('booking_date', todayDateStr)
        .neq('status', 'cancelled')
        .order('booking_date', { ascending: true })
        .order('start_time', { ascending: true })
    ]);
    
    // Weekdays label map for prompt context
    const weekdaysVN = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const currentDayOfWeekStr = weekdaysVN[now.getDay()];

    // Date label helper
    const getDateLabel = (dateStr) => {
      if (!dateStr) return 'hôm nay';
      if (dateStr === todayDateStr) return 'hôm nay';

      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      if (dateStr === tomorrowStr) return 'ngày mai';

      const date = new Date(dateStr + 'T00:00:00');
      const dayName = weekdaysVN[date.getDay()];
      const day = date.getDate();
      const month = date.getMonth() + 1;
      return `${dayName}, ${day}/${month}`;
    };

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

    // Compute earliest opening time in minutes across all branches
    const earliestOpenMinutes = dbBranches?.reduce((earliest, branch) => {
      const hours = branch.opening_hours || {};
      const todayKey = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
      const todayHours = hours[todayKey];
      if (todayHours?.isOpen && todayHours?.open) {
        const [h, m] = todayHours.open.split(':').map(Number);
        const totalMinutes = h * 60 + m;
        return Math.min(earliest, totalMinutes);
      }
      return earliest;
    }, 23 * 60);

    const earliestOpenHour = Math.floor(earliestOpenMinutes / 60);
    const earliestOpenMinute = earliestOpenMinutes % 60;
    const earliestOpenStr = `${earliestOpenHour}:${String(earliestOpenMinute).padStart(2, '0')}`;

    // ──────────────────────────────────────────────
    // SYSTEM PROMPT (Multi-Intent, Order-Insensitive)
    // JSON schema is enforced by responseSchema — prompt focuses on business rules only
    // ──────────────────────────────────────────────
    const systemPrompt = `Bạn là trợ lý AI cho hệ thống đặt lịch Ý Ơi Spa. Nhiệm vụ của bạn là phân tích các lệnh ngắn gọn bằng tiếng Việt từ lễ tân spa và trả về dữ liệu có cấu trúc chính xác.

## PHÁT HIỆN INTENT

### STAFF_DUTY (Tour trực nhân viên)
Trả về intent "STAFF_DUTY" khi lệnh:
- Dấu hiệu 1: Có từ "Tour" + ngày tháng + chuỗi tên nhân viên (VD: "Tour 12/06: 1.Hân 2.Trang 3.Nị").
- Dấu hiệu 2: CHỈ chứa chuỗi tên nhân viên spa đứng liền nhau (phân tách bằng dấu cách, xuống dòng hoặc dấu phẩy) mà KHÔNG có thông tin giờ giấc hoặc tên khách (VD: "Hân Trang Nị", "Tí\nVy\nAnh").
Khi là STAFF_DUTY: trích xuất mảng orderedStaffNames theo thứ tự xuất hiện (trái→phải, trên→dưới). Bỏ qua dòng phân cách (---, ===, ***) và số thứ tự (1., 2.).

### BOOKING (Đặt/chỉnh lịch)
Mọi lệnh còn lại về dịch vụ spa đều là BOOKING. Phân tích vào các trường của bookingData.

## QUY TẮC BOOKING

**Ngữ cảnh hiện tại:**
- Ngày hôm nay: ${todayDateStr} (${currentDayOfWeekStr})
- Giờ hiện tại (GMT+7): ${now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')})
- Chi nhánh hiện tại ID: ${current_branch_id || 'null'}
- Danh sách chi nhánh và giờ hoạt động: ${JSON.stringify(dbBranches || [])}
- Dịch vụ: ${JSON.stringify(dbServices || [])}
- Nhân viên đang hoạt động: ${JSON.stringify(dbEmployees || [])}
- Lịch hẹn hiện tại và sắp tới: ${JSON.stringify(dbBookings || [])}

**Quy tắc giờ:**
- KHÔNG tạo lịch ngoài giờ mở cửa của chi nhánh.
- Giờ mở cửa sớm nhất hôm nay: ${earliestOpenStr}.
- Nếu giờ không có AM/PM và giờ đó < ${earliestOpenStr} → tự động chuyển sang PM (cộng 12). Ví dụ: "8h" → 20:00.
- CHỈ dùng AM nếu có từ "sáng" hoặc "AM" trong lệnh.

**Phân biệt giờ và thời lượng:**
- "Xh" hoặc "X giờ" = giờ hẹn. Ví dụ: "1h" → 13:00, "3h" → 15:00.
- Thời lượng PHẢI có từ "phút", "p", "tiếng", hoặc "ph" đi kèm. Ví dụ: "90p", "90 phút", "1 tiếng" = 90 phút dịch vụ.
- Nếu lệnh có CẢ HAI: "2h 90p" = giờ hẹn 2h (→ 14:00) VÀ thời lượng 90 phút.
- "1h" một mình KHÔNG phải thời lượng — là giờ hẹn 1:00 (→ 13:00).
- Nếu lệnh có "chừa", "chua", "để dành", "de danh" trước số + h/p → số đó là thời lượng cần chừa/để trống. Ví dụ: "2h chừa 90p" = giờ hẹn 14:00, chừa 90 phút = end_time 15:30.

**Phân biệt tên khách**
- Khi lệnh nói "Thảo", tìm lịch hẹn có temporary_name LÀ ĐÚNG "Thảo" hoặc "Chị Thảo" TRƯỚC.
- CHỈ khớp "Thảo Mai" nếu KHÔNG TÌM THẤY bất kỳ lịch nào có tên "Thảo" hoặc "Chị Thảo".
- Quy tắc: tên NGẮN HƠN không bao giờ được khớp với tên DÀI HƠN nếu tên ngắn hơn tồn tại trong lịch hẹn.
- Ví dụ: "Thảo" → khớp "Thảo", KHÔNG khớp "Thảo Mai". "Thảo Mai" → khớp "Thảo Mai", KHÔNG khớp "Thảo".

${replyBookingContext ? `**REPLY CONTEXT (BẮT BUỘC action="update"):**
Lễ tân đang trả lời lịch hẹn này:
${JSON.stringify({
      id: replyBookingContext.id,
      booking_date: replyBookingContext.booking_date,
      start_time: replyBookingContext.start_time,
      customer_name: replyBookingContext.customers?.name || replyBookingContext.temporary_name || 'Khách',
      service_name: replyBookingContext.services?.name || '',
      branch_name: replyBookingContext.branches?.name || '',
      employee_name: replyBookingContext.employees?.name || ''
    })}` : ''}

**1. action:**
- "create": lịch mới.
- "update": khi có từ khóa chỉnh sửa ("đổi thành", "chỉnh", "chuyển", "chuyển sang", "chuyển qua", "dời sang", "thế", "tới", "dời", "đổi", "đã tới", "hủy bớt", "giảm").
${replyBookingContext ? '- BẮT BUỘC: action phải là "update" (đang reply context).' : ''}

**2. is_walk_in:** true nếu có "kl", "khách lẻ", "qua liền".

**3. customer_phone:** Chuỗi 10 chữ số bắt đầu bằng 0. Null nếu không có.

**4. short_phone:** Chuỗi 3-4 chữ số (VD: "6557"). Null nếu không có.

**5. temporary_name:** Tên khách (viết hoa chữ cái đầu).
- Làm sạch tiền tố: "chị", "c.", "c", "anh", "a.", "bạn", "em".
- Giữ lại tiền tố trong tên: nếu lệnh gõ "C Tú" hoặc "Chị Tú" → "Chị Tú". "A Văn" → "Anh Văn".
- Khách walk-in → "Khách Lạ". Mặc định → "Khách Lạ".
- **Xử lý "Mai" mơ hồ:** Nếu "Mai" là TỪ ĐẦU TIÊN (viết hoa) của lệnh đặt lịch → là tên người (temporary_name: "Mai"), ngày mặc định là HÔM NAY. Chỉ hiểu "mai" là ngày mai khi được đứng trước bởi "ngày" hoặc rõ ràng là mốc thời gian.

**6. service_id và service_ids:** Đối chiếu với UUID từ danh sách dịch vụ thực tế ở trên.
- NẾU có nhiều khách sử dụng các dịch vụ KHÁC NHAU (VD: "2ng 1ybb 1ynmg"): BẮT BUỘC trả về mảng UUID của TẤT CẢ các dịch vụ đó vào trường "service_ids" (theo đúng thứ tự khách, VD: [UUID_ybb, UUID_ynmg]).
- NẾU chỉ có 1 dịch vụ chung cho tất cả khách: trả về UUID vào "service_id" và cả "service_ids" dưới dạng mảng 1 phần tử.
Bảng viết tắt dịch vụ Ý Ơi Spa:
- yvv → Ý vội vàng (Gội nhanh, 69k)
- ydc → Ý dễ chịu (Gội + massage đầu, 60 phút, 179k)
- yn1g / yng / ynmg → Ý ngủ một giấc (Gội + massage sâu, 90 phút, 279k)
- yvn → Ý vỗ nhẹ (Massage 1 vùng, 40 phút, 179k)
- yph → Ý phục hồi (Massage sâu, 60 phút, 279k)
- y17 / body / massage body → Ý 17 (Massage toàn thân, 90 phút, 379k)
- ybb → Ý bầu bí (Massage bầu, 60 phút, 329k)
- cbph → Combo phục hồi (60' massage + 20' gội, 80 phút, 339k)
- cbdc → Combo dễ chịu (60' gội/massage đầu + 40' massage vùng, 100 phút, 349k)
- cb17 → Combo 17 (90' massage + 30' gội đầu, 120 phút, 439k)
- gddc → Ý 4 tay gấp đôi dễ chịu (2 KTV, 60 phút, 379k)
- dcdc → Ý 4 tay đỉnh cao dễ chịu (2 KTV, 100 phút, 579k)
Nếu không khớp → null.

**7. branch_id:** Mặc định ${current_branch_id || 'null'}. Chỉ thay đổi khi lệnh đề cập chi nhánh ("cn1"/"cn 1" → nhánh 1, "cn2"/"cn 2" → nhánh 2). Đối chiếu từ danh sách branches ở trên.

**8. booking_date:** Định dạng "YYYY-MM-DD".
- Với action="create": Mặc định là HÔM NAY (${todayDateStr}) nếu không nhắc đến ngày. Nếu giờ > 22:15 → NGÀY MAI.
- Với action="update": Nếu lệnh KHÔNG nhắc đến việc đổi ngày/thứ, BẮT BUỘC trả về null (để hệ thống giữ nguyên ngày cũ).
- "ngày mai" → ngày mai. "mốt"/"ngày mốt" → ngày kia. "t2" → thứ 2 tới. Định dạng "dd/mm" cũng được hỗ trợ.
- Tuyệt đối KHÔNG trả về chuỗi "hôm nay" hay "ngày mai", chỉ trả YYYY-MM-DD hoặc null.

**9. start_time:** Định dạng "HH:MM" 24 giờ.
- Spa mở cửa: Thứ 2-6: 10:00-22:00, Thứ 7-CN: 09:00-22:00.
- Giờ sáng sớm (7h, 8h, 9h ngày thường) → tự động đẩy sang giờ tối (19:00, 20:00, 21:00) vì spa chưa mở.
- "12h" → luôn là 12:00 (trưa), KHÔNG BAO GIỜ là 00:00.
- Chống đặt lịch quá khứ: nếu giờ đã qua so với giờ thực tế hôm nay → đẩy sang chiều/tối hoặc ngày mai.
- Nếu KHÔNG có giờ trong lệnh VÀ action là "create" → đặt giờ hiện tại làm tròn lên 5 phút gần nhất.
- Nếu action là "update" và không nhắc tới giờ → null.
- "qua liền" → làm tròn lên 5 phút gần nhất.

**10. is_deadline:** true nếu có "phải xong", "ph xong", "xong trước".

**11. employee_id và employee_ids:** Đối chiếu tên nhân viên (thường ở cuối lệnh) với UUID trong danh sách.
- NẾU CÓ TỪ 2 NHÂN VIÊN TRỞ LÊN (VD: "Hân Nị", "Tí Vy", "Trang Châu"): BẮT BUỘC trả về mảng tất cả UUID của các nhân viên đó vào trường "employee_ids" (theo đúng thứ tự). Phải tách riêng từng tên (VD: "Hân", "Nị") để đối chiếu.
- BẮT BUỘC quét kỹ toàn bộ câu lệnh, đặc biệt là phần cuối, để không bỏ sót nhân viên nào.
- Nếu chỉ có 1 nhân viên: trả về UUID vào "employee_id".
- "chuyển sang nhân viên Hân" / "chuyển qua Trang" → cập nhật employee_id.
- Nếu không khớp → null.

**12. num_guests:** "2kl" → 2, "3 người" → 3. Mặc định 1.
- "hủy 1ng" hoặc "giảm 1ng" khi reply context → action "update", giảm num_guests.

**13. status:** "arrived" nếu "tới"/"đến". Mặc định "confirmed".

**14. notes:** Nếu có văn bản trong dấu ngoặc đơn VD: "(khách gấp)", trích xuất nội dung bên trong. Kết hợp với short_phone nếu có. Null nếu không có.`;

    // ──────────────────────────────────────────────
    // GEMINI CALL (new @google/genai SDK with thinkingConfig)
    // ──────────────────────────────────────────────
    let geminiResult;
    let isFallbackUsed = false;
    try {
      const genaiConfig = {
        thinkingConfig: { thinkingBudget: 512 },
        responseMimeType: 'application/json',
        responseSchema: MULTI_INTENT_SCHEMA
      };

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt },
              { text: `Parse this command: "${command}"` }
            ]
          }
        ],
        config: genaiConfig
      });

      const resultText = response.text;
      geminiResult = JSON.parse(resultText);

      if (geminiResult && geminiResult.bookingData) {
        let bDate = geminiResult.bookingData.booking_date;

        if (bDate) {
          bDate = bDate.toLowerCase().trim();
          if (bDate.includes("hôm nay") || bDate.includes("hom nay") || bDate === "nay") {
            geminiResult.bookingData.booking_date = todayDateStr; // Ép về YYYY-MM-DD thực tế
          } else if (bDate.includes("ngày mai") || bDate.includes("ngay mai") || bDate.includes("mai") || bDate === "ngày mai") {
            // Tính ngày mai chuẩn bằng code backend
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            geminiResult.bookingData.booking_date = tomorrowStr;
          } else if (!/^\d{4}-\d{2}-\d{2}$/.test(bDate)) {
            // Nếu không phải định dạng ngày hợp lệ (YYYY-MM-DD)
            if (geminiResult.bookingData.action === 'create') {
              geminiResult.bookingData.booking_date = todayDateStr;
            } else {
              geminiResult.bookingData.booking_date = null;
            }
          }
        }
        // If bDate is null, we do NOTHING. Let it remain null.
        // We already have a global fallback for create actions further down!
      }
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
      employee_ids: parsedData.employee_ids || (parsedData.employee_id ? [parsedData.employee_id] : []),
      service_ids: parsedData.service_ids || (parsedData.service_id ? [parsedData.service_id] : []),
      num_guests: parsedData.num_guests || 1,
      notes: parsedData.notes || '',
      status: (parsedData.status || 'confirmed').toLowerCase().trim() === 'arrived' ? 'confirmed' : (parsedData.status || 'confirmed').toLowerCase().trim(),
      is_update: parsedData.action === 'update' || !!(reply_to_booking_ids && reply_to_booking_ids.length > 0)
    };

    // --- MANUAL EMPLOYEE EXTRACTION AUGMENTATION ---
    // Gemini sometimes misses multiple names if they are written together without spaces or commas (e.g. "Hân Nị").
    // We scan the last 6 tokens of the command to confidently catch employee names.
    if (!parsed.is_update && dbEmployees && dbEmployees.length > 0) {
      const tokens = command.trim().split(/[\s,+&()]+/);
      const matchedEmployeeIds = [];
      for (let i = tokens.length - 1; i >= 0; i--) {
        const token = stripDiacritics(tokens[i]).toLowerCase();
        if (!token) continue;
        if (tokens.length - i > 6) break; // Only scan the last 6 tokens
        for (const emp of dbEmployees) {
          if (emp.branch_id && parsed.branch_id && emp.branch_id !== parsed.branch_id) continue;
          const empNorm = stripDiacritics(emp.name).toLowerCase();
          const empParts = empNorm.split(/\s+/);
          const firstName = empParts[empParts.length - 1];
          if (token === firstName || token === empNorm) {
            if (!matchedEmployeeIds.includes(emp.id)) {
              matchedEmployeeIds.unshift(emp.id);
            }
          }
        }
      }

      if (matchedEmployeeIds.length > 0) {
        // Merge them, preserving order
        const mergedIds = [...new Set([...parsed.employee_ids, ...matchedEmployeeIds])];
        parsed.employee_ids = mergedIds;
        parsed.employee_id = mergedIds[0];
      }
    }

    // Make sure create action always has a date
    if (!parsed.is_update && !parsed.booking_date) {
      parsed.booking_date = todayDateStr;
    }

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
        
        // Exact match first
        bookingToUpdate = matchingBookings.find(b => {
          const bName = stripDiacritics(b.temporary_name || b.customers?.name || '').toLowerCase();
          return bName === searchCustName;
        });

        // Fall back to partial only if no exact match
        if (!bookingToUpdate) {
          bookingToUpdate = matchingBookings.find(b => {
            const bName = stripDiacritics(b.temporary_name || b.customers?.name || '').toLowerCase();
            return bName.includes(searchCustName);
          });
        }
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

    const placeholderService = dbServices?.find(s =>
      s.name.toLowerCase().includes('giữ chỗ') ||
      s.name.toLowerCase().includes('giu cho')
    );
    const defaultDuration = placeholderService?.duration_minutes || 60;

    let duration = parsedData.duration_minutes || targetService?.duration_minutes || defaultDuration;
    // Custom rule: If booking for body then reserve 90p
    if (/body/i.test(command)) {
      duration = 90;
    }

    // Compute smart deadline times (ONLY FOR CREATION - Updates are handled dynamically in the update loop)
    if (!parsed.is_update) {
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
      const vnNow = getVietnamDate();
      const strFrom = `${vnNow.getFullYear()}-${String(vnNow.getMonth() + 1).padStart(2, '0')}-${String(vnNow.getDate()).padStart(2, '0')}`;

      const dateTo = new Date(vnNow);
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
        let exactMatch = null;
        let partialMatch = null;

        for (const b of recentBookings) {
          const bPhone = b.customer_phone || b.customers?.phone || '';
          const bName = stripDiacritics(b.temporary_name || b.customers?.name || '').toLowerCase();
          const bNotes = (b.notes || '').toLowerCase();

          let phoneMatch = false;
          let notePhoneMatch = false;

          if (parsed.customer_phone && bPhone.includes(parsed.customer_phone)) {
            phoneMatch = true;
          }

          if (parsed.short_phone && bNotes.includes(parsed.short_phone)) {
            notePhoneMatch = true;
          }

          if (phoneMatch || notePhoneMatch) {
            matchedBookings = [b];
            break;
          }

          if (parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ') {
            const searchName = stripDiacritics(parsed.temporary_name).toLowerCase();
            if (bName === searchName) {
              exactMatch = exactMatch || b;
            } else if (bName.includes(searchName)) {
              partialMatch = partialMatch || b;
            }
          }
        }

        if (matchedBookings.length === 0) {
          if (exactMatch) {
            matchedBookings = [exactMatch];
          } else if (partialMatch) {
            matchedBookings = [partialMatch];
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
        // Prevent setting status to arrived as it violates check constraint
        // if (parsed.status === 'arrived') updateData.status = 'arrived';
        if (parsed.notes) updateData.notes = parsed.notes;
        // Update time if user specified a time (especially deadline)
        if (parsed.start_time) updateData.start_time = parsed.start_time;
        // Do not use global parsed.end_time for updates, we compute it dynamically per booking!
        if (parsed.booking_date) updateData.booking_date = parsed.booking_date;
        if (parsed.employee_id) updateData.employee_id = parsed.employee_id;
        if (parsed.branch_id) {
          updateData.branch_id = parsed.branch_id;
        }

        const updatedIds = [];
        const broadcast = getBroadcast(req);

        for (let i = 0; i < matchedBookings.length; i++) {
          const mb = matchedBookings[i];
          // branch_id needs special care: only update if changed
          const mbUpdateData = { ...updateData };
          if (mbUpdateData.branch_id === mb.branch_id) {
            delete mbUpdateData.branch_id;
          }

          // Support mapping multiple employees to multiple bookings
          if (parsed.employee_ids && parsed.employee_ids.length >= matchedBookings.length) {
            mbUpdateData.employee_id = parsed.employee_ids[i];
          } else if (matchedBookings.length > 1) {
            // Do not group multiple bookings into a single employee to avoid collision
            delete mbUpdateData.employee_id;
          }

          // Support mapping multiple services to multiple bookings
          if (parsed.service_ids && parsed.service_ids.length >= matchedBookings.length) {
            mbUpdateData.service_id = parsed.service_ids[i];
          }

          // --- DYNAMIC DURATION & TIME COMPUTATION FOR UPDATE ---
          const effectiveServiceId = mbUpdateData.service_id || mb.service_id;
          const effectiveService = dbServices?.find(s => s.id === effectiveServiceId);
          let effectiveDuration = effectiveService?.duration_minutes || 60;
          if (/body/i.test(command)) effectiveDuration = 90;

          // If a new start_time is provided, OR if the service changed (which changes duration), recalculate end_time
          if (parsed.start_time || mbUpdateData.service_id) {
            const baseStartTime = parsed.start_time || mb.start_time;
            if (baseStartTime) {
              if (parsedData.is_deadline && parsed.start_time) {
                // User explicitly specified a deadline time for the update
                const [deadH, deadM] = parsed.start_time.split(':').map(Number);
                const deadlineMinutes = deadH * 60 + deadM;
                const newStartMinutes = deadlineMinutes - effectiveDuration;
                if (newStartMinutes >= 0) {
                  const startH = String(Math.floor(newStartMinutes / 60)).padStart(2, '0');
                  const startM = String(newStartMinutes % 60).padStart(2, '0');
                  mbUpdateData.end_time = parsed.start_time; // the given time is the end_time
                  mbUpdateData.start_time = `${startH}:${startM}`;
                } else {
                  const [h, m] = parsed.start_time.split(':').map(Number);
                  const totalMinutes = h * 60 + m + effectiveDuration;
                  mbUpdateData.end_time = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
                }
              } else {
                const [h, m] = baseStartTime.split(':').map(Number);
                const totalMinutes = h * 60 + m + effectiveDuration;
                const endH = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
                const endM = String(totalMinutes % 60).padStart(2, '0');
                mbUpdateData.end_time = `${endH}:${endM}`;
              }
            }
          }

          let updated = mb;
          if (Object.keys(mbUpdateData).length > 0) {
            const { data: updatedData, error: updErr } = await supabase
              .from('bookings')
              .update(mbUpdateData)
              .eq('id', mb.id)
              .select('*, services(name, duration_minutes)')
              .single();

            if (updErr) throw updErr;
            updated = updatedData;
          }

          updatedIds.push(updated.id);
          broadcast('booking.updated', updated);
        }

        const firstMatched = matchedBookings[0];
        let sumName = parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ' ? parsed.temporary_name : firstMatched.temporary_name || firstMatched.customers?.name || 'Khách';

        const numUpdated = matchedBookings.length;
        let sumAction = numUpdated > 1 ? `Đã cập nhật ${numUpdated} lịch` : `Đã cập nhật 1 lịch`;
        if ((parsedData.status || '').toLowerCase().trim() === 'arrived') {
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
          bookings: updatedIds,
          oldBookings: matchedBookings || [],
        });
      }
    }

    // ========== 7. AUTO-CREATE BOOKINGS ==========
    const [
      { data: employees },
      { data: beds },
      { data: dayBookings },
      { data: settingsData },
      { data: onDutySchedules }
    ] = await Promise.all([
      supabase.from('employees').select('id, name, is_active').eq('is_active', true).eq('branch_id', parsed.branch_id),
      supabase.from('beds').select('id, name, branch_id').eq('branch_id', parsed.branch_id),
      supabase.from('bookings').select('employee_id, bed_id, start_time, end_time, status')
        .eq('branch_id', parsed.branch_id)
        .eq('booking_date', parsed.booking_date)
        .in('status', ['confirmed', 'pending', 'arrived']),
      supabase.from('settings').select('*'),
      supabase.from('employee_schedules').select('employee_id').eq('date', parsed.booking_date).eq('is_day_off', false)
    ]);

    const onDutyEmployeeIds = new Set((onDutySchedules || []).map(s => s.employee_id));

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
      let currentServiceId = parsed.service_ids[g] || parsed.service_id;
      let currentService = dbServices?.find(s => s.id === currentServiceId);
      if (!currentService && dbServices && dbServices.length > 0) {
        const placeholderService = dbServices.find(s => s.name.toLowerCase().includes('giữ chỗ') || s.name.toLowerCase().includes('giu cho'));
        currentService = placeholderService ? placeholderService : dbServices[0];
        currentServiceId = currentService.id;
      }
      
      let currentDuration = currentService?.duration_minutes || 60;
      if (/body/i.test(command)) currentDuration = 90;
      
      let currentStartTime = parsed.start_time;
      let currentEndTime = parsed.end_time;
      
      if (!parsed.is_update) {
        if (parsedData.is_deadline && currentStartTime) {
          const [deadH, deadM] = currentStartTime.split(':').map(Number);
          const deadlineMinutes = deadH * 60 + deadM;
          const newStartMinutes = deadlineMinutes - currentDuration;
          if (newStartMinutes >= 0) {
            const startH = String(Math.floor(newStartMinutes / 60)).padStart(2, '0');
            const startM = String(newStartMinutes % 60).padStart(2, '0');
            currentEndTime = currentStartTime;
            currentStartTime = `${startH}:${startM}`;
          } else {
            const [h, m] = currentStartTime.split(':').map(Number);
            const totalMinutes = h * 60 + m + currentDuration;
            currentEndTime = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
          }
        } else if (currentStartTime) {
          const [h, m] = currentStartTime.split(':').map(Number);
          const totalMinutes = h * 60 + m + currentDuration;
          const endH = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
          const endM = String(totalMinutes % 60).padStart(2, '0');
          currentEndTime = `${endH}:${endM}`;
        }
      }
      
      const currentStartMinutes = timeToMinutes(currentStartTime);
      const currentEndMinutes = timeToMinutes(currentEndTime);

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
        if (currentStartMinutes < bEnd && bStart < currentEndMinutes) {
          busyEmployeeIds.add(booking.employee_id);
        }
      }

      const availableEmployees = employees.filter(e => !busyEmployeeIds.has(e.id));
      if (availableEmployees.length === 0) {
        if (createdBookings.length > 0) {
          const idsToDelete = createdBookings.map(b => b.id);
          await supabase.from('bookings').delete().in('id', idsToDelete);
        }
        return res.status(409).json({ error: "Hiện tại lịch của anh/chị đang bị trùng lịch, vui lòng lựa chọn khung giờ khác hoặc nhân viên/chi nhánh khác." });
      }

      // ASSIGN EMPLOYEE (Prioritize the explicitly specified ones)
      let assignedEmployee = null;
      if (parsed.employee_ids && parsed.employee_ids.length > 0) {
        // Find the requested employee for this specific guest index
        const reqEmpId = parsed.employee_ids[g];

        // If we specifically requested an employee for THIS guest but they are off/have no shift that day, MUST FAIL
        if (reqEmpId && !onDutyEmployeeIds.has(reqEmpId)) {
          if (createdBookings.length > 0) {
            const idsToDelete = createdBookings.map(b => b.id);
            await supabase.from('bookings').delete().in('id', idsToDelete);
          }
          const reqEmpName = employees.find(e => e.id === reqEmpId)?.name || 'Nhân viên đã chỉ định';
          return res.status(409).json({ error: `${reqEmpName} không có lịch làm việc ngày ${parsed.booking_date} (nghỉ hoặc chưa có ca). Vui lòng chọn nhân viên khác hoặc kiểm tra lại lịch làm việc.` });
        }

        if (reqEmpId) {
          assignedEmployee = availableEmployees.find(e => e.id === reqEmpId);
        }

        // If we specifically requested an employee for THIS guest but they are busy, MUST FAIL
        if (!assignedEmployee && reqEmpId) {
          if (createdBookings.length > 0) {
            // Delete previously created bookings from this loop if we fail halfway
            const idsToDelete = createdBookings.map(b => b.id);
            await supabase.from('bookings').delete().in('id', idsToDelete);
          }
          return res.status(409).json({ error: "Hiện tại nhân viên yêu cầu đang kẹt lịch, vui lòng lựa chọn khung giờ khác hoặc nhân viên khác." });
        }
      }

      // If we didn't assign an employee (e.g. no specific employee requested, or we exceeded requested employee count and they just need ANY employee for the remaining guests)
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
        if (currentStartMinutes < bEnd && bStart < currentEndMinutes) {
          busyBedIds.add(booking.bed_id);
        }
      }
      const availableBeds = beds.filter(b => !busyBedIds.has(b.id));
      if (availableBeds.length === 0) {
        if (createdBookings.length > 0) {
          const idsToDelete = createdBookings.map(b => b.id);
          await supabase.from('bookings').delete().in('id', idsToDelete);
        }
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
        service_id: currentServiceId,
        employee_id: assignedEmployee.id,
        bed_id: assignedBed.id,
        branch_id: parsed.branch_id,
        num_guests: parsed.num_guests,
        booking_date: parsed.booking_date,
        start_time: currentStartTime,
        end_time: currentEndTime,
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
    else if (parsed.temporary_name && parsed.temporary_name !== 'Khách Lạ') nameLabel = parsed.temporary_name;

    if (parsed.customer_phone) nameLabel += ` (${parsed.customer_phone})`;

    const actionText = parsed.status === 'arrived' ? ' đã tới' : '';
    const timeLabel = parsed.start_time ? parsed.start_time.replace(/^0/, '') : '';
    const bookingDateLabel = getDateLabel(parsed.booking_date);

    const summary = `${nameLabel}${actionText} lúc ${timeLabel}, ${bookingDateLabel} ở chi nhánh ${branchShort}`;


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
