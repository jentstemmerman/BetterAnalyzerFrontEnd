import React, { useCallback, useState, useRef, useEffect } from 'react';

function HighlightSelector({ highlightTypes, active, onToggle, onRemove, onCreateGroup, showColorManager, onToggleColors, hitCounts, totalLines, docIntervals, onNavigateToLine, cursorLine, removedSignatures, onRestoreSignature }) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showAddMenu) return;
    const handleClick = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setShowAddMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showAddMenu]);
  // Compute sorted intervals for a given type
  const getSortedIntervals = useCallback((type) => {
    if (!docIntervals) return [];
    return docIntervals
      .filter(iv => iv.type === type)
      .sort((a, b) => a.lineNumber - b.lineNumber);
  }, [docIntervals]);

  // Find the index of the interval the cursor is currently inside or just past
  const findCurrentIndex = useCallback((intervals) => {
    if (!intervals || intervals.length === 0) return -1;
    for (let i = intervals.length - 1; i >= 0; i--) {
      const iv = intervals[i];
      if (cursorLine >= iv.lineNumber && cursorLine < iv.lineNumber + (iv.lineCount || 1)) {
        return i; // cursor is inside this interval
      }
      if (cursorLine >= iv.lineNumber) {
        return i; // cursor is past the start of this interval
      }
    }
    return -1; // cursor is before all intervals
  }, [cursorLine]);

  const navigateInterval = useCallback((type, direction) => {
    if (!docIntervals || !onNavigateToLine) return;
    const intervals = getSortedIntervals(type);
    if (intervals.length === 0) return;

    const currentIdx = findCurrentIndex(intervals);
    let idx;
    if (currentIdx === -1) {
      idx = direction > 0 ? 0 : intervals.length - 1;
    } else {
      idx = currentIdx + direction;
      if (idx < 0) idx = intervals.length - 1;
      if (idx >= intervals.length) idx = 0;
    }
    onNavigateToLine(intervals[idx].lineNumber);
  }, [docIntervals, onNavigateToLine, getSortedIntervals, findCurrentIndex]);

  return (
    <div className="highlight-selector">
      {highlightTypes.map(ht => {
        const isActive = active.includes(ht.type);
        const removable = true;
        const displayLabel = (ht.label || '')
          .replace(/^Simularities_/i, '')
          .replace(/\.dat$/i, '');
        const counts = hitCounts && hitCounts[ht.type];
        const intervalCount = counts ? counts.intervals : 0;
        const lineCount = counts ? counts.lines : 0;
        const pct = totalLines > 0 ? ((lineCount / totalLines) * 100).toFixed(1) : '0.0';
        const sortedIntervals = getSortedIntervals(ht.type);
        const currentIdx = findCurrentIndex(sortedIntervals);
        const positionText = (currentIdx >= 0 && intervalCount > 0)
          ? ` — at ${currentIdx + 1} of ${intervalCount.toLocaleString()}`
          : '';
        const tooltipText = intervalCount > 0
          ? `${displayLabel}${positionText}\n${intervalCount.toLocaleString()} occurrence${intervalCount !== 1 ? 's' : ''}, ${lineCount.toLocaleString()} line${lineCount !== 1 ? 's' : ''} (${pct}% of file)`
          : `${displayLabel} — no hits`;
        return (
          <button
            key={ht.type}
            className={`highlight-btn${isActive ? ' active' : ''}`}
            style={{ '--hl-color': ht.color }}
            onClick={() => onToggle(ht.type)}
            title={tooltipText}
          >
            <span className="highlight-label">{displayLabel}</span>
            {intervalCount > 0 && (
              <span className="hit-count-badge">{intervalCount.toLocaleString()}</span>
            )}
            {intervalCount > 0 && (
              <span className="interval-nav-arrows">
                <span
                  className="interval-nav-arrow"
                  role="button"
                  aria-label={`Previous ${displayLabel} occurrence`}
                  title="Previous occurrence"
                  onClick={(e) => { e.stopPropagation(); navigateInterval(ht.type, -1); }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                    <path d="M2 7 L5 3 L8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </span>
                <span
                  className="interval-nav-arrow"
                  role="button"
                  aria-label={`Next ${displayLabel} occurrence`}
                  title="Next occurrence"
                  onClick={(e) => { e.stopPropagation(); navigateInterval(ht.type, 1); }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                    <path d="M2 3 L5 7 L8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </span>
              </span>
            )}
            {removable && (
              <span
                className="remove-highlight-icon"
                role="button"
                aria-label={`Remove ${ht.label}`}
                onClick={(e) => { e.stopPropagation(); onRemove && onRemove(ht.type); }}
              >
                <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                  <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
      {removedSignatures && removedSignatures.length > 0 && (
        <div className="add-signature-wrapper" ref={addMenuRef}>
          <button
            className="create-group-btn add-signature-btn"
            onClick={() => setShowAddMenu(v => !v)}
            title="Re-add a previously removed signature"
            aria-expanded={showAddMenu}
          >+ Add Signature</button>
          {showAddMenu && (
            <div className="add-signature-dropdown">
              {removedSignatures.map(rs => (
                <button
                  key={rs.signatureName}
                  className="add-signature-item"
                  onClick={() => {
                    onRestoreSignature(rs.signatureName);
                    if (removedSignatures.length <= 1) setShowAddMenu(false);
                  }}
                  title={`Re-add ${rs.cleanName}`}
                >
                  {rs.cleanName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onCreateGroup && (
        <button
          className="create-group-btn"
          onClick={onCreateGroup}
          title="Create a new highlight group from the current selection"
        >+ Create Signature</button>
      )}
      {onToggleColors && (
        <button
          className="toggle-colors-btn"
          aria-expanded={showColorManager}
          onClick={onToggleColors}
          title="Show or hide highlight settings (colors & thresholds)"
        >{showColorManager ? 'Hide Settings' : 'Highlight Settings'}</button>
      )}
    </div>
  );
}

export default HighlightSelector;
