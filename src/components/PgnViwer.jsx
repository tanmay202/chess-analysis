import React, {
  useState, useEffect, useMemo, useRef, useCallback,
} from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import pgnParser from 'pgn-parser';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

/* ─────────────────────────── constants ─────────────────────────────────── */

const OPENINGS = {
  "1. e4 e5 2. Nf3 Nc6 3. Bb5": "Ruy López",
  "1. e4 e5 2. Nf3 Nc6 3. Bc4": "Italian Game",
  "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6": "Sicilian — Najdorf",
  "1. e4 c5": "Sicilian Defense",
  "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4": "Nimzo-Indian Defense",
  "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7": "King's Indian Defense",
  "1. d4 d5 2. c4 e6": "Queen's Gambit Declined",
  "1. d4 d5 2. c4 dxc4": "Queen's Gambit Accepted",
  "1. d4 d5": "Queen's Pawn Game",
  "1. c4": "English Opening",
  "1. Nf3": "Réti Opening",
  "1. f4": "Bird's Opening",
  "1. e4": "King's Pawn Opening",
  "1. d4": "Queen's Pawn Opening",
};

const CLS = {
  brilliant:  { label: 'Brilliant',  sym: '!!', hex: '#1baaa6' },
  great:      { label: 'Great',      sym: '!',  hex: '#5b8baf' },
  best:       { label: 'Best',       sym: '★',  hex: '#7ec850' },
  good:       { label: 'Good',       sym: '✓',  hex: '#7ec850' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', hex: '#f4bc45' },
  mistake:    { label: 'Mistake',    sym: '?',  hex: '#e68a2e' },
  blunder:    { label: 'Blunder',    sym: '??', hex: '#e04a4a' },
};

const SUMMARY_ROWS = ['brilliant','great','best','inaccuracy','mistake','blunder'];

/* ─────────────────────────── helpers ───────────────────────────────────── */

function detectOpening(moves) {
  let str = '', found = 'Unknown Opening';
  for (let i = 0; i < moves.length; i++) {
    const n = Math.floor(i / 2) + 1;
    str += i % 2 === 0 ? `${n}. ${moves[i].move}` : ` ${moves[i].move}`;
    if (OPENINGS[str]) found = OPENINGS[str];
  }
  return found;
}

function classify(evalBefore, evalAfter, isWhite, playedUci, bestUci) {
  const drop = isWhite ? (evalBefore - evalAfter) : (evalAfter - evalBefore);
  if (playedUci === bestUci) return 'best';
  if (drop > 300)  return 'blunder';
  if (drop > 100)  return 'mistake';
  if (drop > 50)   return 'inaccuracy';
  return 'good';
}

function fmtEval(cp) {
  if (typeof cp !== 'number') return '0.0';
  if (Math.abs(cp) >= 30000) {
    const m = cp > 0
      ? Math.ceil((32000 - cp) / 10)
      : Math.floor((-32000 - cp) / 10);
    return `M${Math.abs(m)}`;
  }
  const v = (cp / 100).toFixed(1);
  return cp > 0 ? `+${v}` : v;
}

/* ─────────────────────────── sub-components ────────────────────────────── */

const PawnAvatar = ({ color = 'white', size = 36 }) => (
  <div style={{
    width: size, height: size, borderRadius: 4, flexShrink: 0,
    background: color === 'white' ? '#b0b0b0' : '#4a4a4a',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: size * 0.55, color: color === 'white' ? '#fff' : '#ccc',
  }}>
    {color === 'white' ? '♙' : '♟'}
  </div>
);

/* Vertical evaluation bar */
const EvalBar = ({ cp = 0, orientation = 'white' }) => {
  const clamped  = Math.max(-1500, Math.min(1500, cp));
  const whitePct = ((clamped + 1500) / 3000) * 100;
  const flip     = orientation === 'black';
  return (
    <div style={{
      width: 20, borderRadius: 4, overflow: 'hidden',
      display: 'flex', flexDirection: flip ? 'column-reverse' : 'column',
      alignSelf: 'stretch',
    }}>
      <div style={{
        flex: whitePct, background: '#e8e6e0',
        transition: 'flex 0.4s ease',
      }} />
      <div style={{
        flex: 100 - whitePct, background: '#1a1a1a',
        transition: 'flex 0.4s ease',
      }} />
    </div>
  );
};

/* Classification circle badge */
const ClsCircle = ({ cls, size = 26 }) => {
  const c = CLS[cls];
  if (!c) return null;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: c.hex,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, color: '#fff', fontWeight: 900, flexShrink: 0,
      lineHeight: 1,
    }}>
      {c.sym}
    </span>
  );
};

/* Small inline badge for move list */
const ClsSmall = ({ cls }) => {
  if (!cls || cls === 'good' || cls === 'best') return null;
  const c = CLS[cls];
  return (
    <span style={{
      width: 15, height: 15, borderRadius: '50%',
      background: c.hex,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 8, color: '#fff', fontWeight: 900, flexShrink: 0,
    }}>
      {c.sym}
    </span>
  );
};

/* ─────────────────────────── Evaluation Graph ──────────────────────────── */

const CustomDot = (props) => {
  const { cx, cy, payload } = props;
  const cls = payload?.cls;
  if (!cls || cls === 'good' || cls === 'best') return null;
  const c = CLS[cls];
  return (
    <circle cx={cx} cy={cy} r={5}
      fill={c.hex} stroke="#1a1c20" strokeWidth={1.5} />
  );
};

const GraphTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div style={{
      background: '#2c2f36', border: '1px solid #3d4048',
      borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#e0e0e0',
    }}>
      Move {label}:&nbsp;
      <b style={{ color: v >= 0 ? '#7ec850' : '#e04a4a' }}>
        {v > 0 ? '+' : ''}{v.toFixed(2)}
      </b>
    </div>
  );
};

const EvalGraph = ({ analysisData, totalMoves, currentIndex, onSelect }) => {
  const data = analysisData.slice(0, totalMoves + 1).map((a, i) => ({
    i,
    ev: Math.max(-15, Math.min(15, (a.centipawn || 0) / 100)),
    cls: i > 0 ? analysisData[i - 1]?.classification : null,
  }));

  return (
    <div
      style={{ background: '#262829', borderRadius: 8, padding: '8px 6px 2px', cursor: 'crosshair', position: 'relative' }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct  = (e.clientX - rect.left) / rect.width;
        const idx  = Math.round(pct * totalMoves);
        onSelect(Math.max(0, Math.min(totalMoves, idx)));
      }}
    >
      <ResponsiveContainer width="100%" height={88}>
        <AreaChart data={data} margin={{ top: 6, right: 4, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#d0d0d0" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#d0d0d0" stopOpacity={0.2}  />
            </linearGradient>
          </defs>
          <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
          <XAxis dataKey="i" hide />
          <YAxis domain={[-15, 15]} hide />
          <Tooltip content={<GraphTooltip />} />
          <Area
            type="monotone" dataKey="ev"
            stroke="#a0a0a0" strokeWidth={1.5}
            fill="url(#wg)"
            dot={<CustomDot />}
            activeDot={{ r: 5, fill: '#8ab4f8', stroke: '#1a1c20', strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      {/* Current move vertical line */}
      {totalMoves > 0 && (
        <div style={{
          position: 'absolute',
          left: `${(currentIndex / totalMoves) * 100}%`,
          top: 8, bottom: 2, width: 2,
          background: 'rgba(138,180,248,0.7)',
          borderRadius: 2,
          transition: 'left 0.15s ease',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
};

/* ─────────────────────────── Analysis progress bar ─────────────────────── */

const AnalysisProgress = ({ progress, total }) => {
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#9aa0a6' }}>
        <span>Analyzing positions…</span>
        <span>{progress} / {total} ({pct}%)</span>
      </div>
      <div style={{ height: 6, background: '#2e3140', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: 'linear-gradient(90deg,#5c8a3c,#7ec850)',
          borderRadius: 99, transition: 'width 0.3s ease',
        }} />
      </div>
      <p style={{ fontSize: 11, color: '#5f6368', marginTop: 8, textAlign: 'center' }}>
        Stockfish depth {18} — please wait
      </p>
    </div>
  );
};

/* ─────────────────────────── PRE-REVIEW (Summary) ──────────────────────── */

const SummaryPanel = ({ headers, accuracies, report, analysisData, moveList, onStartReview, onSelect }) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

    {/* Panel header */}
    <div style={{
      padding: '14px 18px', borderBottom: '1px solid #2e3140',
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    }}>
      <span style={{ fontSize: 18 }}>⭐</span>
      <span style={{ fontWeight: 700, fontSize: 15, color: '#e8eaed' }}>Game Review</span>
    </div>

    {/* Graph */}
    <div style={{ padding: '14px 14px 0', flexShrink: 0 }}>
      <EvalGraph
        analysisData={analysisData}
        totalMoves={moveList.length}
        currentIndex={0}
        onSelect={onSelect}
      />
    </div>

    {/* Players + accuracy */}
    <div style={{ padding: '16px 18px', borderBottom: '1px solid #2e3140', flexShrink: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <PawnAvatar color="white" size={48} />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#e8eaed', textAlign: 'center' }}>
            {headers.White || 'White'}
          </span>
          {headers.WhiteElo && <span style={{ fontSize: 11, color: '#9aa0a6' }}>({headers.WhiteElo})</span>}
        </div>
        <span style={{ textAlign: 'center', color: '#5f6368', fontSize: 11, fontWeight: 700 }}>VS</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <PawnAvatar color="black" size={48} />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#e8eaed', textAlign: 'center' }}>
            {headers.Black || 'Black'}
          </span>
          {headers.BlackElo && <span style={{ fontSize: 11, color: '#9aa0a6' }}>({headers.BlackElo})</span>}
        </div>
      </div>

      {/* Accuracy */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', alignItems: 'center', gap: 8 }}>
        <div style={{
          background: '#fff', color: '#111', borderRadius: 6,
          padding: '8px 0', textAlign: 'center',
          fontWeight: 800, fontSize: 22, fontFamily: 'monospace',
        }}>
          {accuracies?.white}
        </div>
        <span style={{ textAlign: 'center', fontSize: 11, color: '#9aa0a6', fontWeight: 600 }}>Accuracy</span>
        <div style={{
          background: '#fff', color: '#111', borderRadius: 6,
          padding: '8px 0', textAlign: 'center',
          fontWeight: 800, fontSize: 22, fontFamily: 'monospace',
        }}>
          {accuracies?.black}
        </div>
      </div>
    </div>

    {/* Classification breakdown */}
    <div style={{ padding: '12px 18px', flex: 1, overflowY: 'auto' }}>
      {SUMMARY_ROWS.map(cls => {
        const c  = CLS[cls];
        const wv = report?.white?.[cls] || 0;
        const bv = report?.black?.[cls] || 0;
        if (wv === 0 && bv === 0) return null;
        return (
          <div key={cls} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 70px 1fr',
            alignItems: 'center',
            marginBottom: 12,
          }}>
            <span style={{
              fontSize: 15, fontWeight: 700, color: '#e8eaed',
              textAlign: 'right', paddingRight: 12,
            }}>{wv}</span>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <ClsCircle cls={cls} size={28} />
              <span style={{ fontSize: 9, color: '#9aa0a6', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {c.label}
              </span>
            </div>

            <span style={{
              fontSize: 15, fontWeight: 700, color: '#e8eaed',
              textAlign: 'left', paddingLeft: 12,
            }}>{bv}</span>
          </div>
        );
      })}
    </div>

    {/* Start Review CTA */}
    <div style={{ padding: '14px 18px', flexShrink: 0 }}>
      <button
        onClick={onStartReview}
        style={{
          width: '100%', padding: '14px 0',
          background: 'linear-gradient(180deg,#7fa650 0%,#5c8a3c 100%)',
          color: '#fff', fontSize: 15, fontWeight: 800,
          border: 'none', borderRadius: 8, cursor: 'pointer',
          letterSpacing: 0.3, boxShadow: '0 3px 10px rgba(92,138,60,0.5)',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        ⭐ Start Review
      </button>
    </div>
  </div>
);

/* ─────────────────────────── REVIEW PANEL ──────────────────────────────── */

const MoveFeedback = ({ analysis, move }) => {
  const cls = analysis?.classification;
  const c   = cls ? CLS[cls] : null;
  if (!c || !move) return null;
  return (
    <div style={{
      margin: '8px 12px',
      background: c.hex + '18',
      border: `1px solid ${c.hex}40`,
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ClsCircle cls={cls} size={24} />
        <span style={{ fontWeight: 700, color: '#e8eaed', fontSize: 14 }}>{move}</span>
        <span style={{ color: c.hex, fontSize: 13, fontWeight: 600 }}>— {c.label}</span>
        <span style={{
          marginLeft: 'auto', fontWeight: 700, fontSize: 13,
          color: (analysis.centipawn || 0) >= 0 ? '#7ec850' : '#e04a4a',
        }}>
          {fmtEval(analysis.centipawn)}
        </span>
      </div>
      {cls !== 'best' && cls !== 'good' && analysis?.bestMove && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9aa0a6' }}>
          Best was{' '}
          <span style={{ color: '#c8cdd3', fontFamily: 'monospace', fontWeight: 700 }}>
            {analysis.bestMove}
          </span>
        </p>
      )}
    </div>
  );
};

const MoveChip = ({ move, cls, isSelected, onClick }) => {
  const [hov, setHov] = useState(false);
  return (
    <button
      data-sel={String(isSelected)}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 8px', borderRadius: 5, border: 'none',
        background: isSelected ? '#3d4452' : hov ? '#2c2f36' : 'transparent',
        color: isSelected ? '#fff' : '#c8cdd3',
        cursor: 'pointer', fontSize: 13, fontWeight: isSelected ? 700 : 500,
        textAlign: 'left', transition: 'background 0.1s',
        minWidth: 0,
      }}
    >
      <ClsSmall cls={cls} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {move}
      </span>
    </button>
  );
};

const ReviewPanel = ({ headers, accuracies, analysisData, moveList, currentIndex, onSelect, onBack }) => {
  const moveListRef = useRef(null);

  useEffect(() => {
    if (moveListRef.current) {
      const el = moveListRef.current.querySelector('[data-sel="true"]');
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex]);

  const prevAnalysis = currentIndex > 0 && analysisData.length >= currentIndex
    ? analysisData[currentIndex - 1] : null;
  const curMove = currentIndex > 0 ? moveList[currentIndex - 1]?.move : null;

  const movePairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < moveList.length; i += 2)
      pairs.push({ num: i / 2 + 1, wi: i, bi: i + 1 });
    return pairs;
  }, [moveList]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '11px 14px', borderBottom: '1px solid #2e3140',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', color: '#9aa0a6',
            cursor: 'pointer', fontSize: 20, padding: '0 4px', lineHeight: 1,
          }}
          title="Back to summary"
        >←</button>
        <span style={{ fontSize: 17 }}>⭐</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#e8eaed' }}>Game Review</span>
      </div>

      {/* Graph */}
      <div style={{ padding: '12px 12px 0', flexShrink: 0 }}>
        <EvalGraph
          analysisData={analysisData}
          totalMoves={moveList.length}
          currentIndex={currentIndex}
          onSelect={onSelect}
        />
      </div>

      {/* Accuracy row */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '1px solid #2e3140', flexShrink: 0 }}>
        {['white', 'black'].map(p => (
          <div key={p} style={{
            flex: 1, background: '#262829', borderRadius: 6,
            padding: '7px 10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PawnAvatar color={p} size={20} />
              <span style={{ fontSize: 11, color: '#b0b0b0', fontWeight: 600 }}>
                {p === 'white' ? (headers.White || 'White') : (headers.Black || 'Black')}
              </span>
            </div>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#e8eaed' }}>
              {accuracies?.[p]}%
            </span>
          </div>
        ))}
      </div>

      {/* Move feedback */}
      <div style={{ flexShrink: 0 }}>
        {prevAnalysis && curMove
          ? <MoveFeedback analysis={prevAnalysis} move={curMove} />
          : (
            <p style={{
              fontSize: 12, color: '#5f6368', textAlign: 'center',
              padding: '10px 0 4px',
            }}>
              Select a move to see analysis
            </p>
          )
        }
      </div>

      {/* Move list */}
      <div
        ref={moveListRef}
        style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 8px' }}
      >
        {movePairs.map(({ num, wi, bi }) => (
          <div key={num} style={{ display: 'flex', alignItems: 'center', marginBottom: 1 }}>
            <span style={{
              width: 26, textAlign: 'right', fontSize: 11,
              color: '#5f6368', marginRight: 3, flexShrink: 0,
            }}>
              {num}.
            </span>

            <MoveChip
              move={moveList[wi]?.move}
              cls={analysisData[wi]?.classification}
              isSelected={currentIndex === wi + 1}
              onClick={() => onSelect(wi + 1)}
            />

            {moveList[bi] && (
              <MoveChip
                move={moveList[bi]?.move}
                cls={analysisData[bi]?.classification}
                isSelected={currentIndex === bi + 1}
                onClick={() => onSelect(bi + 1)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─────────────────────────── Nav buttons ───────────────────────────────── */

const NavControls = ({ current, total, onNav, onFlip }) => {
  const Btn = ({ label, action, disabled, title }) => {
    const [hov, setHov] = useState(false);
    return (
      <button
        onClick={action}
        disabled={disabled}
        title={title}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          flex: 1, height: 42,
          background: hov && !disabled ? '#2e3140' : '#262829',
          border: '1px solid #2e3140', borderRadius: 6,
          color: disabled ? '#3a3f4a' : '#c8cdd3',
          fontSize: 16, cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.1s',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
      <Btn label="⏮" action={() => onNav(0)}           disabled={current <= 0}            title="First" />
      <Btn label="◀"  action={() => onNav(current - 1)} disabled={current <= 0}            title="Previous (←)" />
      <button
        onClick={onFlip}
        title="Flip board"
        style={{
          flex: 1, height: 42, background: '#262829',
          border: '1px solid #2e3140', borderRadius: 6,
          color: '#c8cdd3', fontSize: 14, cursor: 'pointer',
        }}
      >⇄</button>
      <Btn label="▶"  action={() => onNav(current + 1)} disabled={current >= total - 1}   title="Next (→)" />
      <Btn label="⏭" action={() => onNav(total - 1)}   disabled={current >= total - 1}   title="Last" />
    </div>
  );
};

/* ─────────────────────────── MAIN ──────────────────────────────────────── */

export default function PgnViewer() {
  const [pgnInput,     setPgnInput]     = useState('');
  const [headers,      setHeaders]      = useState({});
  const [fens,         setFens]         = useState([]);
  const [moveList,     setMoveList]     = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [analysisData, setAnalysisData] = useState([]);
  const [accuracies,   setAccuracies]   = useState(null);
  const [report,       setReport]       = useState(null);
  const [opening,      setOpening]      = useState('');
  const [arrow,        setArrow]        = useState([]);
  const [orientation,  setOrientation]  = useState('white');
  const [error,        setError]        = useState('');
  const [phase,        setPhase]        = useState('input');   // input | analyzing | summary | review
  const [progress,     setProgress]     = useState(0);
  const DEPTH = 18;

  /* keyboard nav */
  useEffect(() => {
    if (phase !== 'review') return;
    const h = (e) => {
      if (e.key === 'ArrowLeft')  setCurrentIndex(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setCurrentIndex(i => Math.min(fens.length - 1, i + 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, fens.length]);

  /* parse PGN */
  const handleParse = useCallback(() => {
    if (!pgnInput.trim()) return;
    setError('');
    setAnalysisData([]);
    setAccuracies(null);
    setReport(null);
    setArrow([]);
    setProgress(0);

    try {
      const parsed = pgnParser.parse(pgnInput);
      if (!parsed.length) throw new Error('No valid games found in PGN.');
      const game = parsed[0];

      const hdr = {};
      game.headers?.forEach(h => { hdr[h.name] = h.value; });
      setHeaders(hdr);

      const chess = new Chess();
      const fensArr = [new Chess().fen()];
      for (const m of game.moves) {
        if (!chess.move(m.move)) throw new Error(`Invalid move: ${m.move}`);
        fensArr.push(chess.fen());
      }
      setFens(fensArr);
      setMoveList(game.moves);
      setCurrentIndex(0);
      setOpening(detectOpening(game.moves));
      if (fensArr.length > 1) runAnalysis(fensArr, game.moves);

    } catch (err) {
      setError(`Parse error: ${err.message}`);
    }
  }, [pgnInput]);

  /* Stockfish analysis — sequential so progress bar is live */
  const runAnalysis = async (fensArr, moves) => {
    setPhase('analyzing');
    setProgress(0);
    const evals = [];

    try {
      for (let i = 0; i < fensArr.length; i++) {
        const res = await fetch('http://localhost:5001/evaluate-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: fensArr[i], depth: DEPTH }),
        });
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = await res.json();
        evals.push({ ...data, centipawn: data.centipawn ?? 0 });
        setProgress(i + 1);
      }

      const classified = [];
      for (let i = 0; i < moves.length; i++) {
        const isWhite  = i % 2 === 0;
        const before   = evals[i].centipawn;
        const after    = evals[i + 1]?.centipawn ?? 0;
        const bestMove = evals[i].bestMove;

        const tmp    = new Chess(fensArr[i]);
        const played = tmp.move(moves[i].move);
        const uci    = played ? played.from + played.to + (played.promotion || '') : '';
        const cls    = classify(before, after, isWhite, uci, bestMove);

        classified.push({ ...evals[i], classification: cls });
      }
      classified.push(evals[evals.length - 1]);

      setAnalysisData(classified);
      buildReport(classified, moves);
      setPhase('summary');

    } catch (err) {
      setError(`Analysis failed: ${err.message} — Is the Stockfish server running on :5001?`);
      setPhase('input');
    }
  };

  const buildReport = (classified, moves) => {
    const mk = () => ({ brilliant:0, great:0, best:0, good:0, inaccuracy:0, mistake:0, blunder:0, total:0 });
    const rpt = { white: mk(), black: mk() };
    let wa = 0, ba = 0;

    for (let i = 0; i < moves.length; i++) {
      const pl  = i % 2 === 0 ? 'white' : 'black';
      const key = classified[i].classification;
      const drop = pl === 'white'
        ? (classified[i].centipawn - (classified[i + 1]?.centipawn ?? 0))
        : ((classified[i + 1]?.centipawn ?? 0) - classified[i].centipawn);
      const acc = 100 * Math.exp(-0.04 * Math.max(0, drop));

      if (rpt[pl][key] !== undefined) rpt[pl][key]++;
      rpt[pl].total++;
      if (pl === 'white') wa += acc; else ba += acc;
    }

    setReport(rpt);
    setAccuracies({
      white: rpt.white.total > 0 ? (wa / rpt.white.total).toFixed(1) : '100.0',
      black: rpt.black.total > 0 ? (ba / rpt.black.total).toFixed(1) : '100.0',
    });
  };

  /* derived */
  const boardFen = useMemo(() => fens[currentIndex] || new Chess().fen(), [fens, currentIndex]);
  const curEval  = useMemo(() =>
    analysisData.length > currentIndex ? analysisData[currentIndex]?.centipawn ?? 0 : 0,
    [analysisData, currentIndex]);

  const showBestMove = () => {
    const bm = currentIndex > 0 ? analysisData[currentIndex - 1]?.bestMove : null;
    if (bm && bm.length >= 4)
      setArrow([[bm.slice(0, 2), bm.slice(2, 4), 'rgba(59,130,246,0.85)']]);
  };

  const nav = (to) => { setCurrentIndex(to); setArrow([]); };
  const showBoard = phase === 'summary' || phase === 'review';

  const boardWidth = 480;

  /* ── right panel switch ── */
  const RightPanel = () => {
    if (phase === 'summary') return (
      <SummaryPanel
        headers={headers}
        accuracies={accuracies}
        report={report}
        analysisData={analysisData}
        moveList={moveList}
        onStartReview={() => { setPhase('review'); setCurrentIndex(0); }}
        onSelect={nav}
      />
    );
    if (phase === 'review') return (
      <ReviewPanel
        headers={headers}
        accuracies={accuracies}
        analysisData={analysisData}
        moveList={moveList}
        currentIndex={currentIndex}
        onSelect={nav}
        onBack={() => setPhase('summary')}
      />
    );
    return null;
  };

  /* ── render ── */
  return (
    <div style={{
      minHeight: '100vh',
      background: '#1a1c20',
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      color: '#e8eaed',
    }}>

      {/* Top bar */}
      <div style={{
        background: '#262829',
        borderBottom: '1px solid #2e3140',
        padding: '0 20px', height: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>♟</span>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>Chess Analyzer</span>
          {opening && phase !== 'input' && (
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 99,
              background: '#2e3140', color: '#9aa0a6', fontWeight: 600,
            }}>
              {opening}
            </span>
          )}
        </div>
        {phase !== 'input' && phase !== 'analyzing' && (
          <button
            onClick={() => {
              setPhase('input');
              setFens([]); setMoveList([]);
              setAnalysisData([]); setHeaders({});
            }}
            style={{
              background: '#2e3140', border: 'none', color: '#9aa0a6',
              padding: '6px 14px', borderRadius: 6,
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            ← New Game
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: '#3a1a1a', color: '#f28b82',
          padding: '10px 20px', fontSize: 13,
          borderBottom: '1px solid #7a2020',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Input phase ── */}
      {phase === 'input' && (
        <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 20px' }}>
          <div style={{
            background: '#262829', borderRadius: 12,
            border: '1px solid #2e3140',
          }}>
            <div style={{ padding: '22px 24px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 22 }}>⭐</span>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>
                  Game Review
                </h2>
              </div>
              <p style={{ margin: '0 0 18px', fontSize: 13, color: '#9aa0a6' }}>
                Paste your PGN below to get a deep game analysis powered by Stockfish
              </p>
            </div>
            <div style={{ padding: '0 24px 22px' }}>
              <textarea
                value={pgnInput}
                onChange={e => setPgnInput(e.target.value)}
                rows={9}
                placeholder={`[Event "Casual"]\n[White "Player1"]\n[Black "Player2"]\n[WhiteElo "1200"]\n[BlackElo "1350"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 ...`}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#1a1c20', color: '#c8cdd3',
                  border: '1px solid #2e3140', borderRadius: 8,
                  padding: '12px', fontFamily: 'monospace', fontSize: 12,
                  resize: 'vertical', outline: 'none',
                  lineHeight: 1.6,
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#5c8a3c'}
                onBlur={e => e.currentTarget.style.borderColor = '#2e3140'}
              />
              <button
                onClick={handleParse}
                disabled={!pgnInput.trim()}
                style={{
                  marginTop: 12, width: '100%', padding: '13px 0',
                  background: pgnInput.trim()
                    ? 'linear-gradient(180deg,#7fa650,#5c8a3c)'
                    : '#2e3140',
                  color: pgnInput.trim() ? '#fff' : '#5f6368',
                  border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 800,
                  cursor: pgnInput.trim() ? 'pointer' : 'default',
                  boxShadow: pgnInput.trim() ? '0 3px 10px rgba(92,138,60,0.4)' : 'none',
                  transition: 'opacity 0.15s',
                }}
              >
                ⭐ Analyze Game
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Analyzing phase ── */}
      {phase === 'analyzing' && (
        <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 20px' }}>
          <div style={{
            background: '#262829', borderRadius: 12,
            border: '1px solid #2e3140', textAlign: 'center',
          }}>
            <div style={{ padding: '28px 24px 0' }}>
              <div style={{
                fontSize: 44, marginBottom: 12,
                animation: 'spin 2s linear infinite',
              }}>⚙️</div>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              <h3 style={{ margin: 0, color: '#e8eaed', fontWeight: 700, fontSize: 17 }}>
                Analyzing your game…
              </h3>
              <p style={{ color: '#9aa0a6', fontSize: 13, marginTop: 6 }}>
                {headers.White || 'White'} vs {headers.Black || 'Black'}
              </p>
            </div>
            <AnalysisProgress progress={progress} total={fens.length} />
          </div>
        </div>
      )}

      {/* ── Board + right panel ── */}
      {showBoard && (
        <div style={{
          maxWidth: 1100, margin: '0 auto',
          padding: '20px 16px',
          display: 'flex', gap: 14, alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}>

          {/* Board column */}
          <div style={{ flexShrink: 0 }}>

            {/* Opponent */}
            <div style={{
              background: '#262829', border: '1px solid #2e3140',
              borderRadius: 6, padding: '7px 12px', marginBottom: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: boardWidth, boxSizing: 'border-box',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PawnAvatar color={orientation === 'white' ? 'black' : 'white'} size={26} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {orientation === 'white' ? (headers.Black || 'Black') : (headers.White || 'White')}
                </span>
                {(orientation === 'white' ? headers.BlackElo : headers.WhiteElo) && (
                  <span style={{ color: '#9aa0a6', fontSize: 11 }}>
                    ({orientation === 'white' ? headers.BlackElo : headers.WhiteElo})
                  </span>
                )}
              </div>
              {accuracies && (
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  background: '#2e3140', padding: '2px 9px', borderRadius: 99, color: '#7ec850',
                }}>
                  {orientation === 'white' ? accuracies.black : accuracies.white}%
                </span>
              )}
            </div>

            {/* Board + eval bar side by side */}
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{
                borderRadius: 4, overflow: 'hidden',
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
              }}>
                <Chessboard
                  position={boardFen}
                  boardWidth={boardWidth}
                  arePiecesDraggable={false}
                  customArrows={arrow}
                  boardOrientation={orientation}
                  customDarkSquareStyle={{ backgroundColor: '#779952' }}
                  customLightSquareStyle={{ backgroundColor: '#edeed1' }}
                />
              </div>
              <EvalBar cp={curEval} orientation={orientation} />
            </div>

            {/* Own player */}
            <div style={{
              background: '#262829', border: '1px solid #2e3140',
              borderRadius: 6, padding: '7px 12px', marginTop: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: boardWidth, boxSizing: 'border-box',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PawnAvatar color={orientation} size={26} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {orientation === 'white' ? (headers.White || 'White') : (headers.Black || 'Black')}
                </span>
                {(orientation === 'white' ? headers.WhiteElo : headers.BlackElo) && (
                  <span style={{ color: '#9aa0a6', fontSize: 11 }}>
                    ({orientation === 'white' ? headers.WhiteElo : headers.BlackElo})
                  </span>
                )}
              </div>
              {accuracies && (
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  background: '#2e3140', padding: '2px 9px', borderRadius: 99, color: '#7ec850',
                }}>
                  {orientation === 'white' ? accuracies.white : accuracies.black}%
                </span>
              )}
            </div>

            {/* Nav */}
            <NavControls
              current={currentIndex}
              total={fens.length}
              onNav={nav}
              onFlip={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
            />

            {/* Eval + best move */}
            {analysisData.length > 0 && (
              <div style={{
                marginTop: 8, display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 12, fontSize: 12, color: '#9aa0a6',
              }}>
                <span>
                  Eval:{' '}
                  <span style={{
                    fontWeight: 700,
                    color: curEval >= 0 ? '#7ec850' : '#e04a4a',
                  }}>
                    {fmtEval(curEval)}
                  </span>
                </span>
                {phase === 'review' && currentIndex > 0 && analysisData[currentIndex - 1]?.bestMove && (
                  <>
                    <span style={{ color: '#3a3f4a' }}>|</span>
                    <button
                      onClick={showBestMove}
                      style={{
                        background: 'none', border: 'none',
                        color: '#8ab4f8', cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, padding: 0,
                      }}
                    >
                      Show best move
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div style={{
            flex: 1, minWidth: 290, maxWidth: 340,
            background: '#1e2023',
            border: '1px solid #2e3140',
            borderRadius: 10, overflow: 'hidden',
            height: boardWidth + 118,   /* match board height including player bars */
            display: 'flex', flexDirection: 'column',
          }}>
            <RightPanel />
          </div>
        </div>
      )}
    </div>
  );
}