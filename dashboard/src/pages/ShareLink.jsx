import { useState } from 'react';
import { toast } from 'react-toastify';
import { FiCopy, FiCheck, FiInfo, FiExternalLink } from 'react-icons/fi';

const shareLinks = [
  {
    key: 'booking',
    title: 'Đường dẫn Đặt lịch (Booking Link)',
    description: 'Sao chép đường dẫn đặt lịch dưới đây để gửi cho khách hàng trên Zalo, Facebook, SMS hoặc đính kèm vào các bài viết quảng cáo.',
    url: 'https://goidaudechiu-dev.netlify.app/book',
    type: 'booking',
    theme: { bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B' }
  },
  {
    key: 'zalo',
    title: 'Zalo URL',
    description: 'Liên kết Zalo chính thức của Ý Ơi Spa để khách hàng nhắn tin và gọi điện hỗ trợ trực tiếp.',
    url: 'https://zalo.me/0968241808',
    type: 'zalo',
    theme: { bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B' }
  },
  {
    key: 'facebook',
    title: 'Facebook Fanpage URL',
    description: 'Đường dẫn đến trang Fanpage Facebook chính thức của Ý Ơi Spa để khách hàng theo dõi tin tức.',
    url: 'https://www.facebook.com/p/%C3%9D-%C6%A1i-Spa-G%E1%BB%99i-%C4%91%E1%BA%A7u-d%E1%BB%85-ch%E1%BB%8Bu-61573340536773/',
    type: 'facebook',
    theme: { bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B' }
  },
  {
    key: 'messenger',
    title: 'Messenger Chat URL',
    description: 'Đường dẫn gửi tin nhắn Messenger trực tiếp để trò chuyện cùng tư vấn viên của Ý Ơi Spa.',
    url: 'https://m.me/61573340536773',
    type: 'messenger',
    theme: { bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B' }
  },
  {
    key: 'tiktok',
    title: 'TikTok URL',
    description: 'Kênh TikTok chính thức của Ý Ơi Spa - nơi chia sẻ các mẹo và video thư giãn gội đầu chăm sóc tóc.',
    url: 'https://www.tiktok.com/@dechiuvocungspa',
    type: 'tiktok',
    theme: {
      bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B'
    }
  },
  {
    key: 'maps_cn1',
    title: 'Google Maps - Chi nhánh 1 URL',
    description: 'Địa chỉ Chi nhánh 1: 62/20 Lê Văn Huân, Phường Tân Bình, TP.HCM.',
    url: 'https://maps.app.goo.gl/CHKBaCVmCtAzKqXu8',
    type: 'maps',
    theme: { bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B' }
  },
  {
    key: 'maps_cn2',
    title: 'Google Maps - Chi nhánh 2 URL',
    description: 'Địa chỉ Chi nhánh 2: 31/26 Hoàng Hoa Thám, Phường Tân Bình, TP.HCM.',
    url: 'https://maps.app.goo.gl/GhcwqqUKWatqQB1bA',
    type: 'maps',
    theme: { bg: 'rgba(37, 131, 107, 0.1)', color: '#25836B' }
  }
];

const getLinkIcon = (type) => {
  switch (type) {
    case 'booking':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
      );
    case 'zalo':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>
      );
    case 'facebook':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
        </svg>
      );
    case 'messenger':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      );
    case 'tiktok':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path>
        </svg>
      );
    case 'maps':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      );
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      );
  }
};

function ShareLink() {
  const [copiedKey, setCopiedKey] = useState(null);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success('Đã sao chép liên kết vào bộ nhớ tạm!');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="share-link-container">
      <div className="share-link-header">
        <div>
          <h1 className="share-link-title">
            Bảng Sao Chép Liên Kết
          </h1>
          <p className="share-link-subtitle">
            Danh sách các liên kết tĩnh chính thức của Ý Ơi Spa. Nhấn vào nút để sao chép nhanh và gửi cho khách hàng.
          </p>
        </div>
      </div>

      <div className="share-link-grid">
        {shareLinks.map((item) => (
          <div className="share-link-card" key={item.key} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="share-link-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0, paddingBottom: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="share-link-icon-wrap" style={{ background: item.theme.bg, color: item.theme.color }}>
                  {getLinkIcon(item.type)}
                </div>
                <h3 className="share-link-card-title">{item.title}</h3>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '13px',
                  color: '#878580',
                  textDecoration: 'none',
                  transition: 'color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.color = item.theme.color}
                onMouseOut={(e) => e.currentTarget.style.color = '#878580'}
              >
                Mở link <FiExternalLink size={13} />
              </a>
            </div>

            <div className="card-body" style={{ padding: 0 }}>
              <p className="share-link-description" style={{ margin: '0 0 12px 0', fontSize: '13.5px' }}>
                {item.description}
              </p>

              <div className="share-link-copy-area">
                <div className="share-link-url-display">
                  <code className="share-link-url-code">
                    {item.url}
                  </code>
                </div>
                <button
                  type="button"
                  className="share-link-copy-btn"
                  onClick={() => copyToClipboard(item.url, item.key)}
                  style={{
                    backgroundColor: copiedKey === item.key ? '#25836B' : item.theme.color,
                    transition: 'all 0.2s ease',
                    minWidth: '120px',
                    justifyContent: 'center'
                  }}
                >
                  {copiedKey === item.key ? <FiCheck size={16} /> : <FiCopy size={16} />}
                  {copiedKey === item.key ? 'Đã chép' : 'Sao chép'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ShareLink;
