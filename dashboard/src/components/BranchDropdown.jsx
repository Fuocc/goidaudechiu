import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCheck, FiPlus } from 'react-icons/fi';
import { HiOutlineSelector } from 'react-icons/hi';
import '../styles/BranchDropdown.css';

export default function BranchDropdown({ branches, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const selectedBranch = branches.find((b) => b.id === value) || branches[0];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const getBranchImage = (branch) => {
    if (branch?.image_url) return branch.image_url;
    // Fallback images based on index if no image exists to match the design vibe
    const idx = branches.findIndex(b => b.id === branch?.id);
    const fallbacks = [
      'https://images.unsplash.com/photo-1521590832167-7bfcfaa6362f?w=100&h=100&fit=crop', // A nice spa/salon image
      'https://images.unsplash.com/photo-1600948836101-f9ffda59d250?w=100&h=100&fit=crop',
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=100&h=100&fit=crop'
    ];
    return fallbacks[idx % fallbacks.length] || fallbacks[0];
  };

  return (
    <div className="branch-dropdown-container" ref={dropdownRef}>
      <button
        className="branch-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedBranch && (
          <img
            src={getBranchImage(selectedBranch)}
            alt={selectedBranch.name}
          />
        )}
        <span>{selectedBranch ? selectedBranch.name : 'Chọn chi nhánh'}</span>
        <HiOutlineSelector size={16} color="#6B7280" className="dropdown-icon" />
      </button>

      {isOpen && (
        <div className="branch-dropdown-menu">
          <div className="branch-dropdown-header">
            CHỌN CHI NHÁNH
          </div>
          
          <div className="branch-dropdown-list">
            {branches.map((b) => {
              const isSelected = b.id === value;
              return (
                <div
                  key={b.id}
                  onClick={() => {
                    onChange(b.id);
                    setIsOpen(false);
                  }}
                  className={`branch-dropdown-item ${isSelected ? 'selected' : ''}`}
                >
                  <img
                    src={getBranchImage(b)}
                    alt={b.name}
                  />
                  <span>
                    {b.name}
                  </span>
                  {isSelected && <FiCheck size={18} color="#059669" />}
                </div>
              );
            })}
          </div>

          <div className="branch-dropdown-divider" />

          <div
            onClick={() => {
              setIsOpen(false);
              navigate('/branches?action=add');
            }}
            className="branch-dropdown-add"
          >
            <FiPlus size={20} className="add-icon" />
            <span>Thêm Chi Nhánh</span>
          </div>
        </div>
      )}
    </div>
  );
}
