import { useState, useRef, useEffect } from 'react';
import { FiCheckCircle, FiChevronDown, FiChevronUp, FiCornerUpLeft, FiRotateCcw, FiX } from 'react-icons/fi';
import { request } from '../api';
import '../styles/ai-chat.css';
import geminiLogo from '../assets/gemini-logo.svg';
import { Tooltip } from '../components/ui/tooltip';
import { PLACEHOLDER_SERVICE_NAME } from '../config/business';

const BRANCH_STORAGE_KEY = 'yoi_ai_branch';
const CHAT_STORAGE_KEY = 'yoi_ai_chat_messages';
const LEGACY_CHAT_STORAGE_KEY = 'chatlgbt_messages'; // tên cũ — đọc một lần để không mất lịch sử chat

// Tiêu đề thẻ kết quả dựa trên các thao tác THỰC SỰ đã thay đổi lịch (backend trả về `actions`)
function getActionTitle(actions) {
  const count = (type) => actions
    .filter(a => a.type === type)
    .reduce((sum, a) => sum + (a.booking_ids?.length || 0), 0);
  const parts = [];
  if (count('create')) parts.push(`Đã tạo ${count('create')} lịch`);
  if (count('update')) parts.push(`Đã cập nhật ${count('update')} lịch`);
  if (count('check_in')) parts.push(`Đã báo khách tới`);
  if (count('cancel')) parts.push(`Đã hủy ${count('cancel')} lịch`);
  return parts.join(' · ') || 'Đã thực hiện';
}

function AIChatPanel({ onClose, currentBranchId }) {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY) || localStorage.getItem(LEGACY_CHAT_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load chat history', e);
    }
    return [
      {
        id: 'welcome',
        sender: 'ai',
        text: 'Xin chào! Mình là Ý Chatbot, trợ lý đặt lịch nhanh của bạn. 🌟',
        isWelcome: true
      }
    ];
  });
  const [inputText, setInputText] = useState('');
  const [selectedBranch, setSelectedBranch] = useState(currentBranchId);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Command History States
  const [commandHistory, setCommandHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('yoi_command_history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load command history', e);
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [unfinishedText, setUnfinishedText] = useState('');

  // States for Custom UI and Actions
  const [isBranchSelectOpen, setIsBranchSelectOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // { bookingId, label }
  const [undoLoadingId, setUndoLoadingId] = useState(null); // Message ID currently performing undo

  const branchDropdownRef = useRef(null);
  const textareaRef = useRef(null);

  // Click outside listener to close custom dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target)) {
        setIsBranchSelectOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [inputText]);

  // Focus textarea when clicking anywhere on the card
  useEffect(() => {
    const card = textareaRef.current?.closest('.ai-chat-input-card');
    if (!card) return;

    const handleCardClick = (e) => {
      if (!e.target.closest('button, select, .custom-branch-select-container')) {
        textareaRef.current?.focus();
      }
    };

    card.addEventListener('click', handleCardClick);
    return () => card.removeEventListener('click', handleCardClick);
  }, []);

  // Save chat history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
      localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY); // đã chuyển sang khóa mới
    } catch (e) {
      console.error('Failed to save chat history', e);
    }
  }, [messages]);

  // Load branches
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    const loadBranches = async () => {
      try {
        const b = await request('/branches');
        const list = b || [];
        setBranches(list);
        // Ưu tiên: chi nhánh truyền vào → chi nhánh đã chọn lần trước → chi nhánh đầu tiên
        let saved = '';
        try { saved = localStorage.getItem(BRANCH_STORAGE_KEY) || ''; } catch (e) { /* ignore */ }
        const savedValid = list.some(br => br.id === saved) ? saved : '';
        setSelectedBranch(currentBranchId || savedValid || list[0]?.id || '');
      } catch (err) {
        console.error(err);
      }
    };
    loadBranches();
  }, [currentBranchId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const getNowTime = () => {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getReplyLabel = (text) => {
    if (!text) return 'LỊCH HẸN';
    const parts = text.split(',');
    let base = parts[0] || text;
    // Format 24h time parts "XX:XX" into "XX:XX AM/PM"
    base = base.replace(/lúc\s+(\d{1,2}):(\d{2})/i, (match, h, m) => {
      let hour = parseInt(h);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12;
      hour = hour ? hour : 12;
      return `LÚC ${hour}:${m} ${ampm}`;
    });
    return `LỊCH ${base.toUpperCase()}`;
  };

  const handleSend = async (e) => {
  if (e) e.preventDefault();
  if (!inputText.trim() || loading) return;

  const commandText = inputText;
  setInputText('');
  setLoading(true);

  // 1. Append User Message
  const userMsg = {
    id: Date.now().toString(),
    sender: 'user',
    text: commandText,
    time: getNowTime()
  };
  setMessages(prev => [...prev.filter(m => m.id !== 'welcome'), userMsg].slice(-50));

  // 2. Manage Input History tracking
  if (commandText.trim() && commandText !== commandHistory[0]) {
    setCommandHistory(prev => {
      const newHistory = [commandText, ...prev].slice(0, 50);
      try { localStorage.setItem('yoi_command_history', JSON.stringify(newHistory)); } catch (e) {}
      return newHistory;
    });
  }
  setHistoryIndex(-1);
  setUnfinishedText('');

  const replyContextIds = replyingTo ? replyingTo.bookingIds : undefined;
  setReplyingTo(null);

  try {
    const data = await request('/bookings/command-v2', {
      method: 'POST',
      body: JSON.stringify({
        command: commandText,
        current_branch_id: selectedBranch,
        reply_to_booking_ids: replyContextIds,
        // Chỉ gửi hội thoại thật (bỏ tin lỗi / hoàn tác / chào) để AI không bị nhiễu ngữ cảnh
        conversation_history: messages
          .filter(m => m.id !== 'welcome' && !m.isError && !m.isUndoSuccess && !m.isUndoNote && m.text)
          .slice(-10)
          .map(m => ({
            role: m.sender === 'user' ? 'user' : 'model',
            text: m.text
          }))
      })
    });

    if (!data || !data.success) {
      throw new Error(data?.error || 'Không xử lý được yêu cầu.');
    }

    const actions = Array.isArray(data.actions) ? data.actions : [];
    const bookingIds = [...new Set(actions.flatMap(a => a.booking_ids || []))];

    const aiMsg = {
      id: (Date.now() + 1).toString(),
      sender: 'ai',
      time: getNowTime(),
      text: data.reply,
      toolLog: data.tool_log || [],
      // Chỉ hiện thẻ "thành công" + nút Hoàn tác khi thật sự có lịch bị thay đổi.
      // AI hỏi lại / chỉ tìm kiếm → hiện tin nhắn thường, không có nút nguy hiểm.
      isSuccess: actions.length > 0,
      title: actions.length > 0 ? getActionTitle(actions) : undefined,
      actions,
      bookings: bookingIds
    };

    // Auto-set replyingTo if checked-in a "Giữ chỗ" booking
    const checkIn = actions.find(a => a.type === 'check_in');
    if (checkIn && data.tool_result?.bookings) {
      const hasGiuCho = data.tool_result.bookings.some(b => b?.services?.name === PLACEHOLDER_SERVICE_NAME);
      if (hasGiuCho) {
        setReplyingTo({
          bookingIds: checkIn.booking_ids,
          label: getReplyLabel(data.reply)
        });
      }
    }

    setMessages(prev => [...prev, aiMsg].slice(-50));
    
    // Trigger calendars to refresh data
    window.dispatchEvent(new CustomEvent('refresh-bookings'));

  } catch (err) {
    console.error('AI Command Error:', err);
    setMessages(prev => [...prev, {
      id: (Date.now() + 1).toString(),
      sender: 'ai',
      text: `Lỗi: ${err.message}`,
      isError: true,
      time: getNowTime()
    }].slice(-50));
  } finally {
    setLoading(false);
  }
};

  // Hoàn tác được thực hiện ở server dựa trên danh sách `actions` (tạo → xóa lịch vừa tạo,
  // sửa / check-in / hủy → khôi phục đầy đủ dữ liệu cũ kể cả trạng thái).
  const handleUndo = async (msg) => {
    if (!msg.actions || msg.actions.length === 0) return;
    setUndoLoadingId(msg.id);
    const messageId = msg.id;
    try {
      const result = await request('/bookings/undo', {
        method: 'POST',
        body: JSON.stringify({ actions: msg.actions })
      });

      // Append a system message confirming the undo
      const newMsgs = [{
        id: (Date.now() + 2).toString(),
        sender: 'ai',
        text: 'Hoàn tác đặt lịch thành công!',
        isUndoSuccess: true,
        time: getNowTime()
      }];
      const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
      if (skippedCount > 0) {
        newMsgs.push({
          id: (Date.now() + 3).toString(),
          sender: 'ai',
          text: `Có ${skippedCount} lịch đã được chỉnh sửa sau thao tác của AI nên được giữ nguyên, không hoàn tác.`,
          isUndoNote: true,
          time: getNowTime()
        });
      }
      // Đánh dấu `undone` ngay trên tin nhắn (được lưu localStorage) → tải lại trang nút Hoàn tác không hiện lại
      setMessages(prev => [...prev.map(m => (m.id === messageId ? { ...m, undone: true } : m)), ...newMsgs].slice(-50));

      // Dispatch global refresh-bookings event
      window.dispatchEvent(new CustomEvent('refresh-bookings'));
    } catch (err) {
      console.error('Undo booking error:', err);
      alert(`Không thể hoàn tác đặt lịch: ${err.message}`);
    } finally {
      setUndoLoadingId(null);
    }
  };

  const showWelcomeScreen = messages.length <= 1 && !loading;

  // Custom Branch Trigger label calculation
  const activeBranchObj = branches.find(b => b.id === selectedBranch);
  const activeBranchShortName = activeBranchObj
    ? (activeBranchObj.name.split(' - ')[0] || activeBranchObj.name)
    : 'Chọn CN';

  return (
    <div className="ai-chat-panel">
      {/* Header */}
      <div className="ai-chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="ai-chat-close-btn" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path stroke="#44403C" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m15 18-6-6 6-6" />
          </svg> Trở về
        </button>
        <Tooltip content="Tắt trợ lí AI">
          <img src={geminiLogo} alt="Gemini logo" onClick={onClose} style={{ cursor: 'pointer' }} />
        </Tooltip>
      </div>

      {/* Main Area */}
      <div className="ai-chat-body-container">
        {showWelcomeScreen ? (
          <div className="ai-chat-welcome-screen">
            <h2 className="welcome-title">Xin chào!</h2>
            <p className="welcome-subtitle">Bạn muốn chỉnh lịch gì nào?</p>
          </div>
        ) : (
          <div className="ai-chat-messages">
            {messages.map((msg) => {
              const isUndone = !!msg.undone;
              return (
                <div key={msg.id} className={`ai-chat-message-row ${msg.sender} ${isUndone ? 'undone' : ''}`}>
                  {/* Welcome message */}
                  {msg.sender === 'ai' && msg.isWelcome && (
                    <div className="ai-chat-bubble ai">
                      <p className="ai-chat-text">{msg.text}</p>
                    </div>
                  )}

                  {/* User message */}
                  {msg.sender === 'user' && (
                    <div className="ai-chat-bubble user">
                      <p className="ai-chat-text">{msg.text}</p>
                      {msg.time && <span className="ai-chat-time">{msg.time}</span>}
                    </div>
                  )}

                  {/* AI response */}
                  {msg.sender === 'ai' && !msg.isWelcome && (
                    <div className="ai-chat-bubble ai">
                      {msg.isSuccess ? (
                        <div className="ai-success-card">
                          <div className="ai-success-header">
                            <FiCheckCircle className="ai-success-icon" />
                            <strong>{msg.title}</strong>
                          </div>
                          <p className="ai-success-summary">{msg.text}</p>

                          {/* AI Tool used logs */}
                          {msg.toolLog?.length > 0 && (
                            <div className="ai-tool-log">
                              {msg.toolLog.map((t, i) => (
                                <span key={i} className="ai-tool-badge">
                                  ⚙ {t.tool}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Reply / Undo Buttons — chỉ cho tin nhắn có thao tác thật (actions từ server) */}
                          {!isUndone && msg.actions?.length > 0 && msg.bookings?.length > 0 && (
                            <div className="ai-action-buttons-row">
                              <button
                                type="button"
                                className="ai-action-btn reply"
                                onClick={() => {
                                  setReplyingTo({
                                    bookingIds: msg.bookings,
                                    label: getReplyLabel(msg.text)
                                  });
                                }}
                                disabled={loading || undoLoadingId}
                              >
                                <FiCornerUpLeft size={13} /> Trả lời
                              </button>
                              <button
                                type="button"
                                className="ai-action-btn undo"
                                onClick={() => handleUndo(msg)}
                                disabled={loading || undoLoadingId === msg.id}
                              >
                                <FiRotateCcw size={12} className={undoLoadingId === msg.id ? 'spin' : ''} />
                                {undoLoadingId === msg.id ? 'Đang hoàn...' : 'Hoàn tác'}
                              </button>
                            </div>
                          )}

                          {isUndone && (
                            <div className="ai-undone-badge">
                              <FiRotateCcw size={12} /> Đã hoàn tác lịch hẹn
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="ai-chat-text" style={msg.isUndoSuccess || msg.text?.includes('Hoàn tác đặt lịch thành công!') ? { display: 'flex', alignItems: 'center', gap: '6px' } : undefined}>
                          {(msg.isUndoSuccess || msg.text?.includes('Hoàn tác đặt lịch thành công!')) ? (
                            <>
                              <svg width="11" height="9" viewBox="0 0 11 9" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                                <path d="M1.16667 8.10623e-05V2.33341C1.16667 2.81953 1.33681 3.23272 1.67708 3.573C2.01736 3.91328 2.43056 4.08341 2.91667 4.08341H8.26875L6.16875 1.98341L7 1.16675L10.5 4.66675L7 8.16675L6.16875 7.35008L8.26875 5.25008H2.91667C2.10972 5.25008 1.42187 4.96571 0.853124 4.39696C0.284374 3.82821 -9.53674e-07 3.14036 -9.53674e-07 2.33341V8.10623e-05H1.16667Z" fill="#A8A29E" />
                              </svg>
                              <span>Hoàn tác đặt lịch thành công!</span>
                            </>
                          ) : (
                            msg.text
                          )}
                        </p>
                      )}
                      {msg.time && <span className="ai-chat-time">{msg.time}</span>}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Loading dots */}
            {loading && (
              <div className="ai-chat-message-row ai">
                <div className="ai-chat-bubble ai loading-bubble">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="ai-chat-input-wrapper">
        {/* Reply Context Bar */}
        {replyingTo && (
          <div className="ai-reply-context-bar">
            <div className="ai-reply-context-content">
              <span className="ai-reply-context-arrow"><svg width="11" height="9" viewBox="0 0 11 9" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1.16667 8.10623e-05V2.33341C1.16667 2.81953 1.33681 3.23272 1.67708 3.573C2.01736 3.91328 2.43056 4.08341 2.91667 4.08341H8.26875L6.16875 1.98341L7 1.16675L10.5 4.66675L7 8.16675L6.16875 7.35008L8.26875 5.25008H2.91667C2.10972 5.25008 1.42187 4.96571 0.853124 4.39696C0.284374 3.82821 -9.53674e-07 3.14036 -9.53674e-07 2.33341V8.10623e-05H1.16667Z" fill="#A8A29E" />
              </svg>
              </span>
              <span>{replyingTo.label}</span>
            </div>
            <button
              type="button"
              className="ai-reply-close-btn"
              onClick={() => setReplyingTo(null)}
              title="Hủy phản hồi"
            >
              <FiX size={14} />
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="ai-chat-input-card">
          <textarea
            ref={textareaRef}
            className="ai-chat-textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Hãy nói Ý nghe..."
            disabled={loading}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              } else if (e.key === 'ArrowUp') {
                if (commandHistory.length > 0) {
                  e.preventDefault();
                  if (historyIndex === -1) {
                    setUnfinishedText(inputText);
                  }
                  const nextIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
                  setHistoryIndex(nextIndex);
                  setInputText(commandHistory[nextIndex]);
                }
              } else if (e.key === 'ArrowDown') {
                if (historyIndex > -1) {
                  e.preventDefault();
                  const nextIndex = historyIndex - 1;
                  setHistoryIndex(nextIndex);
                  if (nextIndex === -1) {
                    setInputText(unfinishedText);
                  } else {
                    setInputText(commandHistory[nextIndex]);
                  }
                }
              }
            }}
          />
          <div className="ai-chat-input-bottom">
            {/* Custom Branch Dropdown */}
            <div className="custom-branch-select-container" ref={branchDropdownRef}>
              <button
                type="button"
                className="custom-branch-select-trigger"
                onClick={() => setIsBranchSelectOpen(!isBranchSelectOpen)}
                disabled={loading}
              >
                <span>{activeBranchShortName}</span>
                {isBranchSelectOpen ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
              </button>
              {isBranchSelectOpen && (
                <div className="custom-branch-dropdown">
                  {branches.map(b => {
                    const parts = b.name.split(' - ');
                    const shortName = parts[0] || b.name;
                    const address = parts[1] || '';
                    const isActive = b.id === selectedBranch;
                    return (
                      <div
                        key={b.id}
                        className={`custom-branch-option ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedBranch(b.id);
                          try { localStorage.setItem(BRANCH_STORAGE_KEY, b.id); } catch (e) { /* ignore */ }
                          setIsBranchSelectOpen(false);
                        }}
                      >
                        <div className="branch-option-short">{shortName}</div>
                        {address && <div className="branch-option-address">{address}</div>}
                      </div>
                    );
                  })}
                  {messages.length > 1 && (
                    <>
                      <div className='option-divider' style={{ backgroundColor: '#E7E5E4', margin: '8px auto', height: 1, width: 'calc(100% - 16px)' }}>
                      </div>
                      <button
                        onClick={() => {
                          if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử chat?')) {
                            const welcomeMsg = [
                              {
                                id: 'welcome',
                                sender: 'ai',
                                text: 'Xin chào! Mình là Ý Chatbot, trợ lý đặt lịch nhanh của bạn. 🌟',
                                isWelcome: true
                              }
                            ];
                            setMessages(welcomeMsg);
                            setReplyingTo(null);
                            localStorage.removeItem(CHAT_STORAGE_KEY);
                          }
                        }}
                        style={{
                          backgroundColor: 'transparent',
                          border: 'none',
                          color: '#78716C',
                          fontSize: '12px',
                          cursor: 'pointer',
                          padding: '8px',
                          borderRadius: '5px',
                          transition: 'all 0.2s ease-out',
                          textAlign: 'left'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = '#F4F2F0'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                      >
                        Xóa lịch sử chat
                      </button>
                    </>
                  )}
                </div>

              )}
            </div>

            <button type="submit" className="ai-chat-arrow-btn" aria-label="Gửi" disabled={!inputText.trim() || loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}

export default AIChatPanel;

