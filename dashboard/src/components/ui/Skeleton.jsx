import React from 'react';

export const Skeleton = ({ className = '', style = {}, width, height, borderRadius, circle = false }) => {
  const customStyle = {
    ...style,
    width: width || style.width,
    height: height || style.height,
    borderRadius: circle ? '50%' : (borderRadius || style.borderRadius || '8px'),
  };

  return (
    <div
      className={`skeleton-shimmer ${circle ? 'circle' : ''} ${className}`}
      style={customStyle}
    />
  );
};

export const CardSkeleton = () => {
  return (
    <div className="card skeleton-card-layout" style={{ flex: '1', minWidth: '300px', maxWidth: '400px' }}>
      <div className="card-body">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
          <Skeleton circle width="60px" height="60px" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width="70%" height="16px" />
            <Skeleton width="90%" height="13px" />
            <Skeleton width="40%" height="12px" />
          </div>
        </div>
        <div style={{ marginTop: 16, borderTop: '1px solid #f0f2f5', paddingTop: 12 }}>
          <Skeleton width="30%" height="11px" style={{ marginBottom: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <Skeleton width="40%" height="12px" />
                <Skeleton width="50%" height="12px" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const TableSkeleton = ({ rows = 5, cols = 5 }) => {
  return (
    <div className="table-container" style={{ width: '100%' }}>
      <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skeleton width="70px" height="16px" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} style={{ padding: '14px 16px' }}>
                  {c === 0 ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <Skeleton circle width="32px" height="32px" />
                      <Skeleton width="120px" height="14px" />
                    </div>
                  ) : (
                    <Skeleton width={c % 2 === 0 ? '60px' : '90px'} height="14px" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const MobileCardSkeleton = () => {
  return (
    <div className="mobile-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="50%" height="15px" />
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton circle width="20px" height="20px" />
          <Skeleton circle width="20px" height="20px" />
        </div>
      </div>
      <Skeleton width="70%" height="13px" />
      <div style={{ display: 'flex', gap: 12, marginTop: 4, alignItems: 'center' }}>
        <Skeleton width="40px" height="18px" borderRadius="10px" />
        <Skeleton width="50px" height="18px" borderRadius="10px" />
      </div>
    </div>
  );
};

export default Skeleton;
