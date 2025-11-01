import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';

const MIN_MINIMAP_WIDTH = 12; // even slimmer
const MAX_MINIMAP_WIDTH = 240; // allow a bit wider if user wants

function MiniMap({ content, highlights, highlightTypes, onNavigate, width = 15, onResizeWidth, theme, totalLines = null }) {
  // Map line numbers to highlight type & contiguous span info
  const { highlightMap, spanMap } = useMemo(() => {
    const hMap = {};
    const spanM = {};
    if (!highlights || !highlights.length) return { highlightMap: hMap, spanMap: spanM };
    const sorted = [...highlights].sort((a, b) => a.line - b.line || a.type.localeCompare(b.type));
    let curStart = sorted[0].line;
    let curEnd = sorted[0].line;
    let curType = sorted[0].type;
    const flush = () => {
      for (let l = curStart; l <= curEnd; l++) {
        hMap[l] = curType;
        spanM[l] = { start: curStart, end: curEnd, type: curType };
      }
    };
    for (let i = 1; i < sorted.length; i++) {
      const h = sorted[i];
      if (h.type === curType && h.line === curEnd + 1) {
        curEnd = h.line; // extend span
      } else {
        flush();
        curStart = h.line;
        curEnd = h.line;
        curType = h.type;
      }
    }
    flush();
    return { highlightMap: hMap, spanMap: spanM };
  }, [highlights]);

  const containerRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startWidth: width });
  const [internalWidth, setInternalWidth] = useState(width);
  const [hoverInfo, setHoverInfo] = useState(null); // { line, type, top }

  // Sync external width prop to internal state
  useEffect(() => { setInternalWidth(width); }, [width]);

  const onMouseMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active) return;
    const delta = e.clientX - d.startX;
    // Handle is on LEFT edge: moving mouse left (delta negative) should INCREASE width.
    const newW = Math.min(
      MAX_MINIMAP_WIDTH,
      Math.max(MIN_MINIMAP_WIDTH, d.startWidth - delta)
    );
    setInternalWidth(newW);
    if (onResizeWidth) onResizeWidth(newW);
  }, [onResizeWidth]);

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', endDrag);
  }, [onMouseMove]);

  const startDrag = (e) => {
    dragRef.current = { active: true, startX: e.clientX, startWidth: internalWidth };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  };

  useEffect(() => () => { // cleanup on unmount
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', endDrag);
  }, [onMouseMove, endDrag]);

  // Determine total line count (virtual mode may provide a larger number than loaded content)
  const lineCount = (typeof totalLines === 'number' && totalLines > 0) ? totalLines : (content.length || 1);

  // Decide whether to render every line (only if we actually have those lines in memory and not too many)
  const RENDER_EACH_LINE_THRESHOLD = 5000; // safeguard to avoid creating excessive DOM nodes
  const renderAllLines = content.length > 0 && content.length === lineCount && lineCount <= RENDER_EACH_LINE_THRESHOLD;

  // Precompute safe color lookup
  const getColorForType = (type) => {
    const ht = highlightTypes.find(ht => ht.type === type);
    return ht ? ht.color : (theme === 'light' ? '#dddddd' : 'var(--border)');
  };

  return (
    <div
      className="minimap-container"
      aria-label="Document minimap"
      ref={containerRef}
      style={{ width: internalWidth, minWidth: internalWidth }}
    >
      {/* Resize handle moved to LEFT side */}
      <div
        className="minimap-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize minimap"
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { // expand (move edge left)
            const nw = Math.min(MAX_MINIMAP_WIDTH, internalWidth + 5); setInternalWidth(nw); onResizeWidth && onResizeWidth(nw);
          } else if (e.key === 'ArrowRight') { // contract (move edge right)
            const nw = Math.max(MIN_MINIMAP_WIDTH, internalWidth - 5); setInternalWidth(nw); onResizeWidth && onResizeWidth(nw);
          }
        }}
      />
      <div className="minimap minimap-abs" style={{ flex: '1 1 auto', position: 'relative' }}
        onMouseLeave={() => setHoverInfo(null)}
      >
        {renderAllLines && content.map((_, idx) => {
          const type = highlightMap[idx];
          const baseColor = type ? getColorForType(type) : (theme === 'light' ? '#ffffff' : 'var(--border)');
          const topPct = (idx / lineCount) * 100;
          const heightPct = (1 / lineCount) * 100;
          return (
            <div
              key={idx}
              className="minimap-line"
              style={{
                position: 'absolute', top: `${topPct}%`, height: `${heightPct}%`, left: 0, right: 0,
                background: baseColor, opacity: type ? 0.7 : 0.25
              }}
              onMouseEnter={(e) => {
                if (type && spanMap[idx]) {
                  const s = spanMap[idx];
                  setHoverInfo({ line: idx, type, top: topPct, spanStart: s.start, spanEnd: s.end });
                } else {
                  setHoverInfo({ line: idx, type, top: topPct });
                }
              }}
              onClick={() => {
                if (!onNavigate) return;
                if (type && spanMap[idx]) onNavigate(spanMap[idx].start); else onNavigate(idx);
              }}
              role={onNavigate ? 'button' : undefined}
              tabIndex={onNavigate ? 0 : undefined}
              aria-label={onNavigate ? `Jump to line ${idx + 1}` : undefined}
              onKeyDown={(e) => {
                if (!onNavigate) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (type && spanMap[idx]) onNavigate(spanMap[idx].start); else onNavigate(idx);
                }
              }}
            />
          );
        })}
        {!renderAllLines && (
          // Virtual / large file mode: render only highlight markers for performance
          highlights.filter(h => h.line >= 0 && h.line < lineCount).map(h => {
            const topPct = (h.line / lineCount) * 100;
            const heightPctRaw = (1 / lineCount) * 100;
            const heightPct = Math.max(heightPctRaw, 0.15); // ensure visible even in huge files
            return (
              <div
                key={h.line + ':' + h.type}
                className="minimap-line"
                style={{
                  position: 'absolute', top: `${topPct}%`, height: `${heightPct}%`, left: 0, right: 0,
                  background: getColorForType(h.type), opacity: 0.8, boxShadow: '0 0 1px rgba(0,0,0,0.4)'
                }}
                onMouseEnter={() => {
                  const span = spanMap[h.line];
                  if (span) setHoverInfo({ line: h.line, type: h.type, top: topPct, spanStart: span.start, spanEnd: span.end });
                  else setHoverInfo({ line: h.line, type: h.type, top: topPct });
                }}
                onClick={() => {
                  if (!onNavigate) return;
                  const span = spanMap[h.line];
                  if (span) onNavigate(span.start); else onNavigate(h.line);
                }}
                role={onNavigate ? 'button' : undefined}
                tabIndex={onNavigate ? 0 : undefined}
                aria-label={onNavigate ? `Jump to line ${h.line + 1}` : undefined}
                onKeyDown={(e) => {
                  if (!onNavigate) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const span = spanMap[h.line];
                    if (span) onNavigate(span.start); else onNavigate(h.line);
                  }
                }}
              />
            );
          })
        )}
        {hoverInfo && (
          <div
            className="minimap-tooltip"
            style={{
              position: 'absolute',
              left: '100%',
              top: `${hoverInfo.top}%`,
              transform: 'translateY(-50%)',
              background: 'var(--bg-alt)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '4px 8px',
              fontSize: '0.65rem',
              lineHeight: 1.2,
              borderRadius: 4,
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              zIndex: 10,
              pointerEvents: 'auto',
              whiteSpace: 'nowrap'
            }}
            onMouseLeave={() => setHoverInfo(null)}
            onClick={() => { if (onNavigate) {
              if (hoverInfo.spanStart !== undefined) onNavigate(hoverInfo.spanStart); else onNavigate(hoverInfo.line);
            } setHoverInfo(null); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onNavigate) { e.preventDefault(); if (hoverInfo.spanStart !== undefined) onNavigate(hoverInfo.spanStart); else onNavigate(hoverInfo.line); setHoverInfo(null); } }}
          >
            {hoverInfo.spanStart !== undefined && hoverInfo.spanEnd !== undefined && hoverInfo.spanEnd !== hoverInfo.spanStart
              ? `Lines ${hoverInfo.spanStart + 1}-${hoverInfo.spanEnd + 1}`
              : `Line ${hoverInfo.line + 1}`}
            {hoverInfo.type ? ` • ${hoverInfo.type}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

export default MiniMap;
