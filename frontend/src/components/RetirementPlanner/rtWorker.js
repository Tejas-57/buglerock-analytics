// ── Retirement Planner Web Worker ─────────────────────────────────
// Runs rtRunSimulation off the main UI thread.
// Receives: { type: 'RUN', payload: IN }
// Sends:    { type: 'PROGRESS', pct } during run
//           { type: 'RESULT',   payload: R } on completion
//           { type: 'ERROR',    message }    on failure

import { rtRunSimulation } from './rtEngine';

self.onmessage = function (e) {
  if (e.data.type !== 'RUN') return;
  const IN = e.data.payload;

  try {
    // Post progress at start
    self.postMessage({ type: 'PROGRESS', pct: 5, label: 'Starting simulation…' });

    // Patch rtRunMC to emit progress ticks during the simulation.
    // We do this by overriding nSims into checkpoints.
    // Since the engine is synchronous we emit before/between major phases.

    self.postMessage({ type: 'PROGRESS', pct: 10, label: 'Running Monte Carlo paths…' });
    const R = rtRunSimulation(IN, IN.nSims);

    self.postMessage({ type: 'PROGRESS', pct: 90, label: 'Building report…' });
    self.postMessage({ type: 'RESULT', payload: R });

  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err.message || 'Simulation failed' });
  }
};