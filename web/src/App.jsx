import { useCallback, useEffect, useRef, useState } from 'react';
import { api, TERMINAL } from './lib/api.js';
import Intake from './components/Intake.jsx';
import Progress from './components/Progress.jsx';
import Results from './components/Results.jsx';
import History from './components/History.jsx';

export default function App() {
  const [view, setView] = useState('intake');   // intake | progress | results | history
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);
  const poll = useRef(null);

  useEffect(() => { api.health().then(setHealth); }, []);

  const stopPolling = () => { if (poll.current) { clearInterval(poll.current); poll.current = null; } };

  const openRun = useCallback(async (id) => {
    setRunId(id);
    setError(null);
    setCampaign(null);
    try {
      const s = await api.status(id);
      setStatus(s);
      if (TERMINAL.includes(s.status)) {
        setCampaign(await api.campaign(id));
        setView('results');
      } else {
        setView('progress');
      }
    } catch (e) {
      setError(e.message);
      setView('intake');
    }
  }, []);

  // Polls only while a run is live, and stops the moment it is terminal.
  useEffect(() => {
    if (view !== 'progress' || !runId) return stopPolling;
    let cancelled = false;

    const tick = async () => {
      try {
        const s = await api.status(runId);
        if (cancelled) return;
        setStatus(s);
        if (TERMINAL.includes(s.status)) {
          stopPolling();
          const c = await api.campaign(runId);
          if (cancelled) return;
          setCampaign(c);
          setView('results');
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };

    tick();
    poll.current = setInterval(tick, 2000);
    return () => { cancelled = true; stopPolling(); };
  }, [view, runId]);

  const start = async (brandUrl, file) => {
    setError(null);
    try {
      const { run_id } = await api.createCampaign(brandUrl, file);
      setRunId(run_id);
      setStatus({
        run_id, status: 'CREATED', stage: 'Run created',
        progress: { generated: 0, total: 6, accepted: 0, blocked: 0 },
        created_at: new Date().toISOString(), events: [],
      });
      setView('progress');
    } catch (e) {
      setError(e.message);
    }
  };

  const home = () => {
    stopPolling();
    setView('intake'); setRunId(null); setStatus(null); setCampaign(null); setError(null);
  };

  const keysReady = health?.keys?.gemini && health?.keys?.openai;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={home}>
          <span className="mark" aria-hidden="true">B</span>
          BrandForge
        </button>

        {health && (
          <div className={`keystate${keysReady ? '' : ' off'}`}>
            <span className="led" aria-hidden="true" />
            {keysReady
              ? 'Models connected'
              : `Missing ${[!health.keys.gemini && 'Gemini', !health.keys.openai && 'OpenAI'].filter(Boolean).join(' + ')} key`}
          </div>
        )}

        <nav>
          <button
            className="navlink"
            aria-current={view === 'intake' ? 'page' : undefined}
            onClick={home}
          >
            New campaign
          </button>
          <button
            className="navlink"
            aria-current={view === 'history' ? 'page' : undefined}
            onClick={() => setView('history')}
          >
            History
          </button>
        </nav>
      </header>

      <main className="main">
        {view === 'intake' && <Intake onSubmit={start} error={error} keysReady={keysReady} />}
        {view === 'progress' && <Progress status={status} error={error} />}
        {view === 'results' && campaign && <Results campaign={campaign} onNew={home} />}
        {view === 'history' && <History onOpen={openRun} onNew={home} />}
      </main>
    </div>
  );
}
