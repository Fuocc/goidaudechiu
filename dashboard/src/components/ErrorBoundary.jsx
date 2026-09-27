import { Component } from 'react';

// Chặn lỗi render ở một trang để cả app không thành màn hình trắng.
// Đổi `resetKey` (VD đường dẫn trang) sẽ xóa trạng thái lỗi và render lại.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16, padding: 24, textAlign: 'center' }}>
        <p style={{ color: '#57534E' }}>Đã có lỗi xảy ra khi hiển thị trang này.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Tải lại trang</button>
      </div>
    );
  }
}
