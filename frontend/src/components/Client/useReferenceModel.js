import { useEffect, useState, useCallback } from 'react';

const API = process.env.REACT_APP_API_URL || '';

// The model solver runs on every request, so share one request per model per day. Components that
// mount together (reference card, projection) reuse the same in-flight promise.
const requests = {};
const dayKey = () => new Date().toISOString().slice(0, 10);

function loadModel(riskProfile) {
  const ck = `${riskProfile}|${dayKey()}`;
  if (!requests[ck]) {
    requests[ck] = fetch(`${API}/api/models/detail?key=${encodeURIComponent(riskProfile)}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .catch(e => { delete requests[ck]; throw e; });
  }
  return requests[ck];
}

// The risk_profile values stored on a client are the same keys the backend uses for its models.
export function useReferenceModel(riskProfile) {
  const [state, setState] = useState({ loading: !!riskProfile, model: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!riskProfile) {
      setState({ loading: false, model: null, error: null });
      return undefined;
    }
    let live = true;
    setState({ loading: true, model: null, error: null });
    loadModel(riskProfile)
      .then(m => { if (live) setState({ loading: false, model: m, error: null }); })
      .catch(e => { if (live) setState({ loading: false, model: null, error: e.message }); });
    return () => { live = false; };
  }, [riskProfile, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { ...state, retry };
}
