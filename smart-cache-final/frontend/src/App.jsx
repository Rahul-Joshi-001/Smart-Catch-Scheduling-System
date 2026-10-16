import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    Database,
    History,
    Play,
    Square,
    Save,
    RefreshCw,
    ChevronRight,
    Clock3,
    Layers,
    CheckCircle2,
    AlertCircle
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const STORAGE_KEY = 'smartcache_saved_tests';

const fmt = (value, digits = 2) =>
    Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';

function readSavedTests() {
    try {
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeSavedTests(tests) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tests));
}

/*
 * Calculate the hit ratio from actual counts when available.
 * Otherwise, use the ratio supplied by the engine.
 */
function getHitRatio(row) {
    const hits = Number(row?.hits);
    const misses = Number(row?.misses);

    if (
        row?.hits != null &&
        row?.misses != null &&
        Number.isFinite(hits) &&
        Number.isFinite(misses) &&
        hits >= 0 &&
        misses >= 0 &&
        hits + misses > 0
    ) {
        return (hits / (hits + misses)) * 100;
    }

    const ratio = Number(row?.hitRatio);

    return row?.hitRatio != null && Number.isFinite(ratio)
        ? ratio
        : null;
}

function isPending(row) {
    return (
        row?.valid === false ||
        String(row?.note || '').toLowerCase().includes('pending')
    );
}

/*
 * Choose a recommendation from valid, completed results.
 * Algorithms are compared within the same group, not across unrelated
 * algorithm families.
 *
 * Objectives:
 * response    -> lowest response time
 * throughput  -> highest throughput
 * reliability -> highest cache hit ratio where available
 *
 * Ties are broken using throughput, then hit ratio.
 */
function calculateRecommendation(result, objective) {
    const rows = Array.isArray(result?.results)
        ? result.results
        : [];

    const candidates = rows.filter(
        row => row.group !== 'File allocation' && !isPending(row)
    );

    if (!candidates.length) {
        return {
            algorithm: 'No recommendation',
            reason: 'No completed, valid algorithm results are available.',
            objective
        };
    }

    const originalAlgorithm = result?.recommendation?.algorithm;
    const originalGroup = result?.recommendation?.group;

    const originalRow = candidates.find(
        row =>
            row.algorithm === originalAlgorithm &&
            (!originalGroup || row.group === originalGroup)
    );

    const groups = [...new Set(candidates.map(row => row.group))];

    // Keep recommendations within one comparable algorithm family.
    const selectedGroup = originalRow?.group || groups[0];

    const groupCandidates = candidates.filter(
        row => row.group === selectedGroup
    );

    const numberOr = (value, fallback) =>
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
            ? Number(value)
            : fallback;

    const ranked = [...groupCandidates].sort((a, b) => {
        if (objective === 'throughput') {
            const difference =
                numberOr(b.throughputRps, -Infinity) -
                numberOr(a.throughputRps, -Infinity);

            if (difference !== 0 && Number.isFinite(difference)) {
                return difference;
            }
        } else if (objective === 'reliability') {
            const aHit = getHitRatio(a) ?? -1;
            const bHit = getHitRatio(b) ?? -1;

            if (aHit !== bHit) {
                return bHit - aHit;
            }
        } else {
            const difference =
                numberOr(a.responseTimeMs, Infinity) -
                numberOr(b.responseTimeMs, Infinity);

            if (difference !== 0 && Number.isFinite(difference)) {
                return difference;
            }
        }

        // Tie-breaker 1: higher throughput.
        const throughputDifference =
            numberOr(b.throughputRps, -Infinity) -
            numberOr(a.throughputRps, -Infinity);

        if (
            throughputDifference !== 0 &&
            Number.isFinite(throughputDifference)
        ) {
            return throughputDifference;
        }

        // Tie-breaker 2: higher hit ratio.
        return (getHitRatio(b) ?? -1) - (getHitRatio(a) ?? -1);
    });

    const best = ranked[0];

    let reason;

    if (objective === 'throughput') {
        reason =
            `Highest reported throughput in ${best.group}: ` +
            `${Number(best.throughputRps).toFixed(2)} requests/sec.`;
    } else if (objective === 'reliability') {
        const hitRatio = getHitRatio(best);

        reason = hitRatio == null
            ? `Selected using available validity checks in ${best.group}; hit-ratio data is unavailable.`
            : `Highest available hit ratio in ${best.group}: ${hitRatio.toFixed(2)}%.`;
    } else {
        reason =
            `Lowest reported response time in ${best.group}: ` +
            `${Number(best.responseTimeMs).toFixed(2)} ms.`;
    }

    return {
        algorithm: best.algorithm,
        reason,
        group: best.group,
        objective
    };
}

/*
 * Sort table rows:
 * 1. Selected recommendation first.
 * 2. Keep algorithm families grouped.
 * 3. Rank within each family according to the selected objective.
 * 4. Put pending algorithms after completed algorithms.
 */
function sortResults(rows, recommendation, objective) {
    const groupOrder = {
        Cache: 0,
        Indexing: 1,
        'File allocation': 2,
        'CPU scheduling': 3
    };

    const numberOr = (value, fallback) =>
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
            ? Number(value)
            : fallback;

    const isRecommended = row =>
        recommendation?.algorithm === row.algorithm &&
        recommendation?.group === row.group;

    return [...rows].sort((a, b) => {
        if (isRecommended(a) !== isRecommended(b)) {
            return isRecommended(a) ? -1 : 1;
        }

        const groupDifference =
            (groupOrder[a.group] ?? 99) -
            (groupOrder[b.group] ?? 99);

        if (groupDifference !== 0) {
            return groupDifference;
        }

        if (isPending(a) !== isPending(b)) {
            return isPending(a) ? 1 : -1;
        }

        if (objective === 'throughput') {
            const difference =
                numberOr(b.throughputRps, -Infinity) -
                numberOr(a.throughputRps, -Infinity);

            if (difference !== 0 && Number.isFinite(difference)) {
                return difference;
            }
        } else if (objective === 'reliability') {
            const difference =
                (getHitRatio(b) ?? -1) -
                (getHitRatio(a) ?? -1);

            if (difference !== 0) {
                return difference;
            }
        } else {
            const difference =
                numberOr(a.responseTimeMs, Infinity) -
                numberOr(b.responseTimeMs, Infinity);

            if (difference !== 0 && Number.isFinite(difference)) {
                return difference;
            }
        }

        // Secondary metric: throughput.
        const throughputDifference =
            numberOr(b.throughputRps, -Infinity) -
            numberOr(a.throughputRps, -Infinity);

        if (
            throughputDifference !== 0 &&
            Number.isFinite(throughputDifference)
        ) {
            return throughputDifference;
        }

        // Final tie-breaker: cache hit ratio, when applicable.
        return (getHitRatio(b) ?? -1) - (getHitRatio(a) ?? -1);
    });
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
}

export default function App() {
    const [view, setView] = useState('simulation');
    const [readInterval, setReadInterval] = useState('0.10');
    const [writeInterval, setWriteInterval] = useState('0.20');
    const [objective, setObjective] = useState('response');
    const [duration, setDuration] = useState(10);

    const [running, setRunning] = useState(false);
    const [runId, setRunId] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const [tests, setTests] = useState(() => readSavedTests());
    const [selected, setSelected] = useState(null);
    const [testName, setTestName] = useState('');

    const recommendation = useMemo(
        () => calculateRecommendation(result, objective),
        [result, objective]
    );

    const metrics = result?.summary || {};

    useEffect(() => {
        if (!running || !runId) return undefined;

        let active = true;

        const poll = async () => {
            try {
                const data = await apiRequest(`/simulations/${runId}`);

                if (!active) return;

                if (data.result) setResult(data.result);

                if (data.status === 'completed') setRunning(false);
            } catch (err) {
                if (active) {
                    setError(err.message);
                    setRunning(false);
                }
            }
        };

        poll();
        const timer = setInterval(poll, 500);

        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [running, runId]);

    async function start() {
        setError('');
        setBusy(true);
        setResult(null);
        setRunId(null);

        try {
            const data = await apiRequest('/simulations/start', {
                method: 'POST',
                body: JSON.stringify({
                    readInterval: Number(readInterval),
                    writeInterval: Number(writeInterval),
                    objective,
                    durationSeconds: Number(duration)
                })
            });

            setRunId(data.runId);
            setResult(data.result || null);
            setRunning(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    async function stop() {
        if (!runId || busy) return;

        setBusy(true);
        setError('');

        try {
            const data = await apiRequest('/simulations/stop', {
                method: 'POST',
                body: JSON.stringify({ runId })
            });

            setResult(data.result);
            setRunning(false);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    function save() {
        if (!result || running || busy) return;

        setError('');

        try {
            const existing = readSavedTests();

            const saved = {
                ...result,
                recommendation,
                id: globalThis.crypto?.randomUUID
                    ? globalThis.crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: testName.trim() || 'SmartCache test',
                createdAt: new Date().toISOString(),
                settings: result.settings || {
                    readInterval: Number(readInterval),
                    writeInterval: Number(writeInterval),
                    objective,
                    durationSeconds: Number(duration)
                },
                readInterval: Number(
                    result.settings?.readInterval ?? readInterval
                ),
                writeInterval: Number(
                    result.settings?.writeInterval ?? writeInterval
                ),
                objective
            };

            const updated = [saved, ...existing];

            writeSavedTests(updated);
            setTests(updated);
            setSelected(saved);
            setTestName('');
            setView('history');
        } catch (err) {
            setError(`Could not save results in browser storage: ${err.message}`);
        }
    }

    function openHistory() {
        setTests(readSavedTests());
        setSelected(null);
        setView('history');
        setError('');
    }

    function refreshHistory() {
        setTests(readSavedTests());
        setSelected(null);
        setError('');
    }

    function selectTest(id) {
        const saved = readSavedTests();
        setTests(saved);
        setSelected(saved.find(test => test.id === id) || null);
    }

    function deleteTest(id) {
        try {
            const updated = readSavedTests().filter(test => test.id !== id);

            writeSavedTests(updated);
            setTests(updated);

            if (selected?.id === id) setSelected(null);
        } catch (err) {
            setError(`Could not delete saved test: ${err.message}`);
        }
    }

    return (
        <div className="layout">
            <aside className="sidebar">
                <div className="brand">
                    <div className="logo"><Database /></div>
                    <div>
                        <b>SmartCache</b>
                        <small>OPTIMIZATION LAB</small>
                    </div>
                </div>

                <div className="nav-title">WORKSPACE</div>

                <button
                    className={`nav ${view === 'simulation' ? 'active' : ''}`}
                    onClick={() => setView('simulation')}
                >
                    <Activity size={18} /> Simulation
                </button>

                <button
                    className={`nav ${view === 'history' ? 'active' : ''}`}
                    onClick={openHistory}
                >
                    <History size={18} /> Previous Tests
                </button>

                <div className="side-bottom">
                    <span className="green-dot" />
                    Local engine
                    <small>Node + C++ + Browser Storage</small>
                </div>
            </aside>

            <main className="main">
                <header>
                    <div>
                        <div className="eyebrow">PERFORMANCE WORKSPACE</div>
                        <h1>
                            {view === 'simulation'
                                ? 'Smart Cache Optimization'
                                : 'Previous Tests'}
                        </h1>
                        <p>
                            {view === 'simulation'
                                ? 'Generate a controlled workload and compare algorithms fairly.'
                                : 'Saved test runs stored in this browser.'}
                        </p>
                    </div>

                    <span className={`pill ${running ? 'running' : ''}`}>
                        <i />
                        {running ? 'SIMULATION RUNNING' : 'SYSTEM READY'}
                    </span>
                </header>

                {error && (
                    <div className="error">
                        <AlertCircle size={17} />
                        {error}
                        <button onClick={() => setError('')}>Dismiss</button>
                    </div>
                )}

                {view === 'simulation' ? (
                    <>
                        <section className="hero">
                            <div>
                                <span className="tag">SIMULATION CONTROL</span>
                                <h2>
                                    Measure the workload.
                                    <br />
                                    Compare the algorithms.
                                </h2>
                                <p>
                                    Run the same generated trace through the algorithms
                                    and rank results according to your selected objective.
                                </p>
                            </div>
                            <div className="hero-symbol"><Layers size={54} /></div>
                        </section>

                        <div className="section-head">
                            <div>
                                <h3>Workload configuration</h3>
                                <p>Intervals are delays between requests, not percentages.</p>
                            </div>
                            <span className="step">01 / CONFIGURE</span>
                        </div>

                        <div className="config-grid">
                            <div className="panel">
                                <label>READ INTERVAL <em>READ</em></label>
                                <select
                                    disabled={running}
                                    value={readInterval}
                                    onChange={e => setReadInterval(e.target.value)}
                                >
                                    {['0', '0.10', '0.20', '0.30', '0.50', '1.00'].map(v => (
                                        <option key={v} value={v}>{v} sec</option>
                                    ))}
                                </select>
                                <small>Delay between read requests</small>
                            </div>

                            <div className="panel">
                                <label>WRITE INTERVAL <em>WRITE</em></label>
                                <select
                                    disabled={running}
                                    value={writeInterval}
                                    onChange={e => setWriteInterval(e.target.value)}
                                >
                                    {['0', '0.10', '0.20', '0.30', '0.50', '1.00'].map(v => (
                                        <option key={v} value={v}>{v} sec</option>
                                    ))}
                                </select>
                                <small>Delay between write requests</small>
                            </div>

                            <div className="panel">
                                <label>OPTIMIZATION OBJECTIVE</label>
                                <select
                                    disabled={running}
                                    value={objective}
                                    onChange={e => setObjective(e.target.value)}
                                >
                                    <option value="response">Fast Response</option>
                                    <option value="throughput">High Throughput</option>
                                    <option value="reliability">Accuracy / Reliability</option>
                                </select>
                                <small>Changes how comparable results are ranked.</small>
                            </div>

                            <div className="panel">
                                <label>TEST DURATION</label>
                                <select
                                    disabled={running}
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                >
                                    {[5, 10, 15, 30, 60].map(v => (
                                        <option key={v} value={v}>{v} seconds</option>
                                    ))}
                                </select>
                                <small>Simulation window</small>
                            </div>
                        </div>

                        <div className="section-head">
                            <div>
                                <h3>Live measurement</h3>
                                <p>Metrics returned by the engine and workload generator.</p>
                            </div>
                            <span className="step">02 / MEASURE</span>
                        </div>

                        <div className="metrics">
                            <Metric
                                label="READ REQUESTS"
                                value={metrics.readCount ?? '—'}
                                hint="Observed reads"
                            />
                            <Metric
                                label="WRITE REQUESTS"
                                value={metrics.writeCount ?? '—'}
                                hint="Observed writes"
                            />
                            <Metric
                                label="AVG. RESPONSE"
                                value={
                                    metrics.avgResponseMs == null
                                        ? '—'
                                        : `${fmt(metrics.avgResponseMs)} ms`
                                }
                                hint="Engine-reported metric"
                            />
                            <Metric
                                label="THROUGHPUT"
                                value={
                                    metrics.throughputRps == null
                                        ? '—'
                                        : `${fmt(metrics.throughputRps)} req/s`
                                }
                                hint="Requests per second"
                            />
                        </div>

                        {result && (
                            <>
                                <div className="section-head">
                                    <div>
                                        <h3>Algorithm comparison</h3>
                                        <p>
                                            Recommended algorithm first; remaining results
                                            ranked by your selected objective.
                                        </p>
                                    </div>
                                    <span className="step">03 / RESULTS</span>
                                </div>

                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>GROUP</th>
                                                <th>ALGORITHM</th>
                                                <th>RESPONSE</th>
                                                <th>THROUGHPUT</th>
                                                <th>HIT RATIO</th>
                                                <th>VALID</th>
                                            </tr>
                                        </thead>

                                        <tbody>
                                            {sortResults(
                                                result.results || [],
                                                recommendation,
                                                objective
                                            ).map((row, index) => {
                                                const recommended =
                                                    recommendation.algorithm === row.algorithm &&
                                                    recommendation.group === row.group;

                                                const hitRatio = getHitRatio(row);
                                                const pending = isPending(row);

                                                return (
                                                    <tr key={`${row.group}-${row.algorithm}-${index}`}>
                                                        <td>{row.group || '—'}</td>

                                                        <td>
                                                            <b>{row.algorithm || 'Unknown'}</b>

                                                            {recommended && (
                                                                <span className="recommend">
                                                                    RECOMMENDED
                                                                </span>
                                                            )}

                                                            {row.baseline && (
                                                                <span className="baseline">
                                                                    BASELINE
                                                                </span>
                                                            )}
                                                        </td>

                                                        <td>
                                                            {row.group === 'Indexing'
                                                                ? `${fmt(row.responseTimeMs, 8)} ms/lookup`
                                                                : `${fmt(row.responseTimeMs)} ms`}
                                                        </td>

                                                        <td>{fmt(row.throughputRps)} req/s</td>

                                                        <td>
                                                            {hitRatio == null
                                                                ? 'N/A'
                                                                : `${hitRatio.toFixed(2)}%`}
                                                        </td>

                                                        <td>
                                                            <span className={pending ? 'invalid' : 'valid'}>
                                                                {pending ? 'CHECK' : 'PASS'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="recommendation">
                                    <CheckCircle2 />
                                    <div>
                                        <b>
                                            Recommendation: {recommendation.algorithm || 'No recommendation'}
                                        </b>
                                        <p>
                                            {recommendation.reason || 'No explanation was returned.'}
                                        </p>
                                        <small>
                                            Ranking objective: {objective}. This recommendation
                                            is based on returned metrics, not a production
                                            performance guarantee.
                                        </small>
                                    </div>
                                </div>

                                <div className="save-row">
                                    <input
                                        value={testName}
                                        onChange={e => setTestName(e.target.value)}
                                        placeholder="Optional test name"
                                        disabled={running || busy}
                                    />

                                    <button
                                        className="btn primary"
                                        onClick={save}
                                        disabled={running || busy}
                                    >
                                        <Save size={16} /> Save Results
                                    </button>
                                </div>
                            </>
                        )}

                        <div className="actions">
                            <div className="hint">
                                <Clock3 size={15} />
                                {running
                                    ? 'Workload is running. Stop it to finalize results.'
                                    : 'Start a run; saving is manual.'}
                            </div>

                            <div className="action-buttons">
                                {running ? (
                                    <button
                                        className="btn danger"
                                        onClick={stop}
                                        disabled={busy}
                                    >
                                        <Square size={15} /> Stop simulation
                                    </button>
                                ) : (
                                    <button
                                        className="btn primary"
                                        onClick={start}
                                        disabled={busy}
                                    >
                                        <Play size={15} />
                                        {busy ? 'Please wait...' : 'Start simulation'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="section-head">
                            <div>
                                <h3>Saved runs</h3>
                                <p>History is saved in this browser and does not require MySQL.</p>
                            </div>
                            <button className="btn secondary" onClick={refreshHistory}>
                                <RefreshCw size={15} /> Refresh
                            </button>
                        </div>

                        <div className="history-layout">
                            <div className="history-list">
                                {tests.length === 0 ? (
                                    <div className="empty">
                                        <History size={27} />
                                        <b>No saved tests yet</b>
                                        <p>Run a simulation and choose Save Results.</p>
                                    </div>
                                ) : tests.map(test => (
                                    <div className="history-item" key={test.id}>
                                        <button
                                            className="history-select"
                                            onClick={() => selectTest(test.id)}
                                        >
                                            <span>
                                                <b>{test.name}</b>
                                                <small>
                                                    {new Date(test.createdAt).toLocaleString()}
                                                </small>
                                            </span>
                                            <span className="history-count">
                                                {test.summary?.totalRequests ?? test.traceCount ?? 0} req
                                                <ChevronRight size={16} />
                                            </span>
                                        </button>

                                        <button
                                            className="delete-test"
                                            onClick={() => deleteTest(test.id)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="history-detail">
                                {selected ? (
                                    <>
                                        <div className="detail-head">
                                            <div>
                                                <span className="tag">
                                                    SAVED TEST #{String(selected.id).slice(0, 8)}
                                                </span>
                                                <h3>{selected.name}</h3>
                                            </div>
                                            <span className="valid">SAVED LOCALLY</span>
                                        </div>

                                        <div className="detail-grid">
                                            <Detail
                                                label="Read interval"
                                                value={`${selected.readInterval ?? selected.settings?.readInterval ?? '—'} sec`}
                                            />
                                            <Detail
                                                label="Write interval"
                                                value={`${selected.writeInterval ?? selected.settings?.writeInterval ?? '—'} sec`}
                                            />
                                            <Detail
                                                label="Duration"
                                                value={`${fmt((selected.durationMs ?? 0) / 1000)} sec`}
                                            />
                                            <Detail
                                                label="Read ratio"
                                                value={`${fmt(selected.summary?.readRatio)}%`}
                                            />
                                            <Detail
                                                label="Write ratio"
                                                value={`${fmt(selected.summary?.writeRatio)}%`}
                                            />
                                            <Detail
                                                label="Objective"
                                                value={selected.objective || selected.settings?.objective || 'response'}
                                            />
                                        </div>

                                        <h4>Algorithm results</h4>
                                        <div className="table-wrap">
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>GROUP</th>
                                                        <th>ALGORITHM</th>
                                                        <th>RESPONSE</th>
                                                        <th>THROUGHPUT</th>
                                                        <th>HIT RATIO</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {sortResults(
                                                        selected.results || [],
                                                        selected.recommendation,
                                                        selected.objective || selected.settings?.objective || 'response'
                                                    ).map((row, index) => {
                                                        const hitRatio = getHitRatio(row);

                                                        return (
                                                            <tr key={`${row.algorithm}-${index}`}>
                                                                <td>{row.group || '—'}</td>
                                                                <td>{row.algorithm || '—'}</td>
                                                                <td>
                                                                    {row.group === 'Indexing'
                                                                        ? `${fmt(row.responseTimeMs, 8)} ms/lookup`
                                                                        : `${fmt(row.responseTimeMs)} ms`}
                                                                </td>
                                                                <td>{fmt(row.throughputRps)} req/s</td>
                                                                <td>
                                                                    {hitRatio == null
                                                                        ? 'N/A'
                                                                        : `${hitRatio.toFixed(2)}%`}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        <h4>Workload windows</h4>
                                        {(selected.windows || []).length === 0 ? (
                                            <p>No workload window details were saved.</p>
                                        ) : selected.windows.map(window => (
                                            <div className="window-row" key={window.windowNo}>
                                                Window {window.windowNo}: {window.readCount} reads / {window.writeCount} writes
                                                {' — '}{fmt(window.readRatio)}% / {fmt(window.writeRatio)}%
                                            </div>
                                        ))}
                                    </>
                                ) : (
                                    <div className="empty">
                                        <Database size={28} />
                                        <b>Select a saved test</b>
                                        <p>Its settings, metrics and algorithm results appear here.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                <footer>
                    SMARTCACHE <span>•</span> REPRODUCIBLE ALGORITHM COMPARISONS
                </footer>
            </main>
        </div>
    );
}

function Metric({ label, value, hint }) {
    return (
        <div className="metric">
            <div className="metric-top">
                {label}
                <Activity size={16} />
            </div>
            <strong>{value}</strong>
            <small>{hint}</small>
        </div>
    );
}

function Detail({ label, value }) {
    return (
        <div className="detail">
            <small>{label}</small>
            <b>{value}</b>
        </div>
    );
}