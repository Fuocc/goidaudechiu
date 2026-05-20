import React from 'react';

const TimePickerInput = ({ value, onChange }) => {
  const parts = (value || '').split(':');
  const h24 = parseInt(parts[0]);
  const m = parseInt(parts[1]);

  const hDisplay = isNaN(h24) ? '--' : String(h24).padStart(2, '0');
  const mDisplay = isNaN(m) ? '--' : String(m).padStart(2, '0');

  const update24 = (h, min, isBlur = false) => {
    let hh = h;
    let mm = min;

    if (isNaN(hh)) hh = 10;
    if (isNaN(mm)) mm = 0;

    if (isBlur) {
      if (hh < 10) { hh = 10; mm = 0; }
      if (hh > 22) { hh = 22; mm = 0; }
      if (hh === 22 && mm > 0) mm = 0;
    } else {
      if (hh > 22) hh = 22;
    }

    onChange(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  };

  const handleHourKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentH = isNaN(h24) ? 10 : h24;
      const step = e.key === 'ArrowUp' ? 1 : -1;
      update24(currentH + step, isNaN(m) ? 0 : m, true);
    }
  };

  const handleMinuteKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentM = isNaN(m) ? 0 : m;
      const currentH = isNaN(h24) ? 10 : h24;
      let nextM = e.key === 'ArrowUp' ? currentM + 5 : currentM - 5;
      let nextH = currentH;

      if (nextM >= 60) { nextM = 0; nextH++; }
      if (nextM < 0) { nextM = 55; nextH--; }

      update24(nextH, nextM, true);
    }
  };

  return (
    <div className="time-picker-input-group">
      <input
        type="text"
        className="time-part-input"
        value={hDisplay}
        onChange={e => {
          let val = e.target.value.replace(/\D/g, '');
          if (val === '') {
            onChange(`--:${mDisplay}`);
            return;
          }
          let h = parseInt(val) || 0;
          update24(h, isNaN(m) ? 0 : m);
        }}
        onKeyDown={handleHourKeyDown}
        onBlur={e => {
          if (isNaN(h24)) update24(10, isNaN(m) ? 0 : m, true);
          else update24(h24, isNaN(m) ? 0 : m, true);
        }}
        onFocus={e => e.target.select()}
        placeholder="--"
      />
      <span className="time-separator">:</span>
      <input
        type="text"
        className="time-part-input"
        value={mDisplay}
        onChange={e => {
          let val = e.target.value.replace(/\D/g, '');
          if (val === '') {
            onChange(`${hDisplay}:--`);
            return;
          }
          let min = parseInt(val) || 0;
          update24(isNaN(h24) ? 10 : h24, min);
        }}
        onKeyDown={handleMinuteKeyDown}
        onBlur={e => {
          if (isNaN(m)) update24(isNaN(h24) ? 10 : h24, 0, true);
          else update24(isNaN(h24) ? 10 : h24, m, true);
        }}
        onFocus={e => e.target.select()}
        placeholder="--"
      />
    </div>
  );
};

export default TimePickerInput;
