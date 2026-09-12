import { useEffect, useState } from 'react';

/**
 * The metadata band under the header. Every value is real: it comes from the
 * api's /health payload or the live run. It exists because the head of these
 * pages was empty, and because an operator should be able to see which
 * workflow revision and which orchestrator produced a result without
 * opening a manifest.
 */
export default function Telemetry({ health, status }) {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const keys = health?.keys;
  const modelsUp = keys?.gemini && keys?.openai;

  const cells = [
    ['SYS', health ? 'ONLINE' : 'LINKING', !health],
    ['REV', health?.workflow_version?.replace('brandforge-', 'v') ?? '—', false],
    ['ORCH', health?.orchestrator ?? '—', false],
    ['MODELS', health ? (modelsUp ? 'LINKED' : 'NO KEY') : '—', Boolean(health) && !modelsUp],
    ['RUN', status?.run_id ? status.run_id.replace('run_', '') : 'IDLE', false],
    ['UTC', clock.toISOString().slice(11, 19), false],
  ];

  return (
    <dl className="telemetry">
      {cells.map(([k, v, hot]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={hot ? 'hot' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
