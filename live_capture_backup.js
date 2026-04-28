// ── LIVE SCREEN DETECTION — removed for performance, restore when needed ──────
// To restore: add these settings back to DEFAULT, add captureRef back to refs,
// add the useEffect below, restore the SCENE DETECTION settings card,
// and restore the callCasa screenshot condition.

// ── DEFAULT settings to add back ──────────────────────────────────────────────
// sceneDetect: false,
// captureRate: '3',

// ── Ref to add back ────────────────────────────────────────────────────────────
// const captureRef = useRef(null);

// ── State to add back ─────────────────────────────────────────────────────────
// const [currentShot, setCurrentShot] = useState(null);

// ── Periodic scene capture useEffect (goes after the hotkey useEffect) ─────────
/*
useEffect(() => {
  if (captureRef.current) { clearInterval(captureRef.current); captureRef.current = null; }
  if (!settings.sceneDetect || !selectedWindow || !_ipc) return;
  const doCapture = async () => {
    try {
      const res = CAP_RES[settings.captureResolution] || CAP_RES.auto;
      const img = await _ipc.invoke('capture-window', selectedWindow.id, res.w, res.h);
      if (img) setCurrentShot(img);
    } catch {}
  };
  doCapture();
  captureRef.current = setInterval(doCapture, parseInt(settings.captureRate) * 1000);
  return () => { if (captureRef.current) clearInterval(captureRef.current); };
}, [settings.sceneDetect, settings.captureRate, settings.captureResolution, selectedWindow]);
*/

// ── callCasa screenshot condition to restore ──────────────────────────────────
// Replace the `if (shot)` block in callCasa with:
/*
if (settings.includeScreenshot && currentShot && settings.sceneDetect) {
  const b64 = currentShot.replace(/^data:image\/\w+;base64,/, '');
  userContent = [
    { type:'image', source:{ type:'base64', media_type:'image/png', data:b64 } },
    { type:'text',  text:msg }
  ];
}
*/

// ── SCENE DETECTION settings card (goes in SettingsPanel return) ───────────────
/*
<SCard title="SCENE DETECTION" icon="👁️" t={t}>
  <SRow label="Auto Scene Analysis" hint="Captures your game screen in real-time" t={t}>
    <SToggle checked={settings.sceneDetect} onChange={e => setSettings(s => ({ ...s, sceneDetect:e.target.checked }))} t={t} />
  </SRow>
  <SRow label="Capture Resolution" hint="Lower = less GPU/CPU load" t={t}>
    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
      <select style={{ ...si, cursor:'pointer' }} value={settings.captureResolution}
        onChange={e => setSettings(s => ({ ...s, captureResolution:e.target.value }))}>
        <option value="auto">Auto (640×360)</option>
        <option value="low">Low (320×180) — lightest</option>
        <option value="medium">Medium (640×360)</option>
        <option value="high">High (1280×720)</option>
      </select>
      <button onClick={autoDetectCapture} style={{ ... }}>Auto-Detect</button>
    </div>
  </SRow>
  <SRow label="Capture Interval" t={t}>
    <select style={{ ...si, cursor:'pointer' }} value={settings.captureRate}
      onChange={e => setSettings(s => ({ ...s, captureRate:e.target.value }))}>
      <option value="1">Every 1 sec</option>
      <option value="3">Every 3 sec</option>
      <option value="5">Every 5 sec</option>
      <option value="10">Every 10 sec</option>
    </select>
  </SRow>
  <SRow label="Send Screenshot with Questions" t={t}>
    <SToggle checked={settings.includeScreenshot} onChange={e => setSettings(s => ({ ...s, includeScreenshot:e.target.checked }))} t={t} />
  </SRow>
</SCard>
*/
