import { useState, useRef, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/clerk-react';
import { toast } from 'react-toastify';
import '../styles/user-settings.css';
import { FiEdit2, FiLogOut, FiLoader } from 'react-icons/fi';
import userPlaceholder from '../assets/userPlaceholder.jpg';
import { getBranches, updateNotificationPreferences } from '../api';
import { getMutedBranchIds, getCurrentPushEndpoint } from '../utils/notificationPrefs';

const UserSettings = () => {
  const { user } = useUser();
  const { signOut } = useAuth();

  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUpdatingInfo, setIsUpdatingInfo] = useState(false);

  const [formData, setFormData] = useState({
    name: user?.fullName || '',
    email: user?.primaryEmailAddress?.emailAddress || '',
    phone: user?.unsafeMetadata?.phone || user?.phoneNumbers?.[0]?.phoneNumber || ''
  });

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      toast.error('Kích thước ảnh không được vượt quá 3MB');
      return;
    }

    try {
      setIsUploading(true);
      await user.setProfileImage({ file });
      toast.success('Cập nhật ảnh đại diện thành công!');
    } catch (error) {
      console.error('Lỗi khi tải ảnh:', error);
      toast.error('Có lỗi xảy ra khi tải ảnh lên.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUpdateUserInfo = async () => {
    if (!formData.name.trim()) {
      toast.error('Tên không được để trống');
      return;
    }

    try {
      setIsUpdatingInfo(true);
      const nameParts = formData.name.trim().split(' ');
      const lastName = nameParts.length > 1 ? nameParts.pop() : '';
      const firstName = nameParts.join(' ');

      await user.update({
        firstName: firstName || formData.name.trim(),
        lastName: lastName || undefined,
        unsafeMetadata: {
          ...user.unsafeMetadata,
          phone: formData.phone
        }
      });

      const originalEmail = user.primaryEmailAddress?.emailAddress || '';
      if (formData.email !== originalEmail) {
        toast.info('Tên và SĐT đã lưu. Đổi Email yêu cầu xác thực qua Clerk Portal.', { autoClose: 5000 });
      } else {
        toast.success('Cập nhật thông tin thành công!');
      }
    } catch (error) {
      console.error('Lỗi khi cập nhật:', error);
      toast.error('Có lỗi xảy ra khi cập nhật thông tin.');
    } finally {
      setIsUpdatingInfo(false);
    }
  };

  // Công tắc thông báo theo từng chi nhánh thật (theo ID), lưu danh sách chi nhánh đã TẮT
  const [branches, setBranches] = useState([]);
  const [branchesState, setBranchesState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [mutedIds, setMutedIds] = useState(() => getMutedBranchIds(user));

  useEffect(() => {
    getBranches()
      .then(list => { setBranches(list || []); setBranchesState('ready'); })
      .catch(err => { console.error('Không tải được chi nhánh:', err); setBranchesState('error'); });
  }, []);

  const toggleBranch = (branchId, enabled) => {
    setMutedIds(prev => (enabled ? prev.filter(id => id !== branchId) : [...new Set([...prev, branchId])]));
  };

  const [isUpdatingNotifs, setIsUpdatingNotifs] = useState(false);

  const handleUpdateNotifications = async () => {
    try {
      setIsUpdatingNotifs(true);
      // Chỉ giữ ID của chi nhánh còn tồn tại
      const muted = branches.length ? mutedIds.filter(id => branches.some(b => b.id === id)) : mutedIds;
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          notifications: { muted_branch_ids: muted }
        }
      });

      // Báo server để lọc thông báo đẩy khi gửi (mọi thiết bị của tài khoản + thiết bị này)
      let serverApplied = true;
      try {
        const endpoint = await getCurrentPushEndpoint();
        const result = await updateNotificationPreferences({ muted_branch_ids: muted, endpoint });
        serverApplied = result?.applied !== false;
      } catch (err) {
        console.warn('[push] Không lưu được cài đặt trên máy chủ:', err.message);
        serverApplied = false;
      }
      toast.success(serverApplied
        ? 'Cài đặt thông báo đã được lưu đồng bộ!'
        : 'Đã lưu cài đặt. Thông báo đẩy trên thiết bị sẽ áp dụng sau khi máy chủ được cập nhật.');
    } catch (error) {
      console.error('Lỗi khi lưu cài đặt thông báo:', error);
      toast.error('Có lỗi xảy ra khi lưu cài đặt.');
    } finally {
      setIsUpdatingNotifs(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    localStorage.removeItem('sb_access_token');
  };

  return (
    <div className="user-settings-page">

      {/* SECTION 1: User Info */}
      <div className="user-settings-section">
        <h2 className="user-settings-title">Thông tin của bạn</h2>

        <div className="user-info-grid">
          <div className="user-info-form">
            <div className="us-form-group">
              <label className="us-label">TÊN<span className="us-label-req">*</span></label>
              <input
                type="text"
                className="us-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="us-form-group">
              <label className="us-label">EMAIL<span className="us-label-req">*</span></label>
              <input
                type="email"
                className="us-input"
                value={formData.email}
                disabled
                title="Email không thể thay đổi tại đây"
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="us-form-group">
              <label className="us-label">SĐT (KHÔNG BẮT BUỘC)</label>
              <input
                type="tel"
                className="us-input"
                placeholder="Ví dụ: 0335581831"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <button 
              className="us-btn us-btn-primary" 
              style={{ marginTop: '10px' }}
              onClick={handleUpdateUserInfo}
              disabled={isUpdatingInfo}
            >
              {isUpdatingInfo ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FiLoader size={16} className="icon-spin" />
                  <span>Đang cập nhật...</span>
                </div>
              ) : (
                'Cập nhật'
              )}
            </button>
          </div>

          <div className="user-avatar-section">
            <div className="us-form-group" style={{ marginBottom: '8px' }}>
              <label className="us-label">HÌNH ĐẠI DIỆN</label>
            </div>

            <div className="us-avatar-container">
              <img
                src={user?.imageUrl || userPlaceholder}
                alt="Avatar"
                className="us-avatar-img"
              />
              <button 
                className="us-avatar-edit-btn" 
                title="Chỉnh sửa hình đại diện"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <FiLoader size={14} className="icon-spin" />
                ) : (
                  <FiEdit2 size={14} />
                )}
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept="image/png, image/jpeg, image/jpg" 
                onChange={handleImageChange}
              />
            </div>

            <p className="us-avatar-hint">
              Bạn có thể tải hình gốc JPG hoặc PNG với kích thước tối đa 1024x1024, và dung lượng tối đa 3MB.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 2: Notifications */}
      <div className="user-settings-section">
        <h2 className="user-settings-title">Thông báo cá nhân</h2>
        <p className="user-settings-subtitle">
          Cài đặt này sẽ chỉ áp dụng cho tài khoản cá nhân này. Nếu bạn chia sẻ tài khoản cá nhân với nhiều người khác, hãy thay đổi thông báo trên thiết bị của bạn.
        </p>

        <div className="us-toggle-list">
          {branchesState === 'loading' && <p className="user-settings-subtitle">Đang tải danh sách chi nhánh...</p>}
          {branchesState === 'error' && <p className="user-settings-subtitle">Không tải được danh sách chi nhánh. Vui lòng tải lại trang.</p>}
          {branches.map(branch => (
            <div className="us-toggle-item" key={branch.id}>
              <span className="us-toggle-label">{branch.name}</span>
              <label className="us-switch">
                <input
                  type="checkbox"
                  checked={!mutedIds.includes(branch.id)}
                  onChange={(e) => toggleBranch(branch.id, e.target.checked)}
                />
                <span className="us-slider"></span>
              </label>
            </div>
          ))}
        </div>

        <button
          className="us-btn us-btn-primary"
          onClick={handleUpdateNotifications}
          disabled={isUpdatingNotifs || branchesState !== 'ready'}
        >
          {isUpdatingNotifs ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiLoader size={16} className="icon-spin" />
              <span>Đang lưu...</span>
            </div>
          ) : (
            'Cập nhật'
          )}
        </button>
      </div>

      {/* SECTION 3: Logout */}
      <div className="user-settings-section">
        <div className="us-logout-section">
          <h2 className="user-settings-title" style={{ marginBottom: 0 }}>Đăng xuất tài khoản</h2>
          <button className="us-btn us-btn-outline" onClick={handleLogout}>
            <FiLogOut size={16} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </div>

    </div>
  );
};

export default UserSettings;
