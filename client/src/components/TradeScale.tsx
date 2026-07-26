interface TradeScaleProps {
  scale: number; // -100 to 100
  verdict: string;
}

export default function TradeScale({ scale, verdict }: TradeScaleProps) {
  // scale: negative favors Team 1, positive favors Team 2
  const needlePos = ((scale + 100) / 200) * 100; // 0-100%

  const isLandslide = verdict.includes('Landslide');
  const isClear = verdict.includes('Clear');
  const isSlight = verdict.includes('Slight');

  let verdictClass = 'trade-verdict--fair';
  if (isLandslide) verdictClass = 'trade-verdict--landslide';
  else if (isClear) verdictClass = 'trade-verdict--clear';
  else if (isSlight) verdictClass = 'trade-verdict--slight';

  return (
    <div className="trade-scale">
      <div className="trade-scale__labels">
        <span className="trade-scale__label">TEAM 1</span>
        <span className="trade-scale__label">TEAM 2</span>
      </div>
      <div className="trade-scale__track">
        <div className="trade-scale__zone trade-scale__zone--left" />
        <div className="trade-scale__zone trade-scale__zone--center" />
        <div className="trade-scale__zone trade-scale__zone--right" />
        <div
          className="trade-scale__needle"
          style={{ left: `${needlePos}%` }}
        />
        <div className="trade-scale__center-mark" />
      </div>
      <div className={`trade-verdict ${verdictClass}`}>
        {verdict}
      </div>
    </div>
  );
}
