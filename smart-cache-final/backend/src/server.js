import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const projectRoot = path.resolve(backendRoot, '..');

dotenv.config({
  path: path.join(backendRoot, '.env')
});

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
}));

app.use(express.json({ limit: '4mb' }));

const enginePath = process.env.ENGINE_PATH
  ? path.resolve(backendRoot, process.env.ENGINE_PATH)
  : path.join(projectRoot, 'engine', 'smart_cache_engine.exe');

const PORT = Number(process.env.PORT || 4000);
const runs = new Map();

console.log('Backend directory:', backendRoot);
console.log('C++ engine path:', enginePath);

// ---------------- VALIDATION ----------------

function validate(body = {}) {
  const readInterval = Number(body.readInterval);
  const writeInterval = Number(body.writeInterval);
  const durationSeconds = Number(body.durationSeconds);
  const objective = body.objective;

  const validIntervals = [0, 0.1, 0.2, 0.3, 0.5, 1];

  if (
    !validIntervals.includes(readInterval) ||
    !validIntervals.includes(writeInterval)
  ) {
    throw new Error(
      'Intervals must be 0, 0.10, 0.20, 0.30, 0.50 or 1.00 seconds.'
    );
  }

  if (![5, 10, 15, 30, 60].includes(durationSeconds)) {
    throw new Error('Duration must be 5, 10, 15, 30 or 60 seconds.');
  }

  if (!['response', 'throughput', 'reliability'].includes(objective)) {
    throw new Error('Invalid optimization objective.');
  }

  return {
    readInterval,
    writeInterval,
    durationSeconds,
    objective
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------- WORKLOAD GENERATION ----------------

async function generateWorkload(run) {
  const start = Date.now();
  const end = start + run.settings.durationSeconds * 1000;

  let nextRead = start;
  let nextWrite = start;

  const trace = [];
  const windows = [];

  let windowStart = start;
  let windowReads = 0;
  let windowWrites = 0;
  let windowNo = 1;

  function addRequest(type, now) {
    const index = trace.length;

    trace.push({
      type,
      key: type === 'R'
        ? (index * 7) % 31
        : (index * 11 + 3) % 31,
      at: now - start
    });

    if (type === 'R') {
      windowReads++;
    } else {
      windowWrites++;
    }
  }

  function closeWindow(now) {
    const total = windowReads + windowWrites;

    windows.push({
      windowNo: windowNo++,
      elapsedMs: now - windowStart,
      readCount: windowReads,
      writeCount: windowWrites,
      readRatio: total ? (windowReads / total) * 100 : 0,
      writeRatio: total ? (windowWrites / total) * 100 : 0,
      requestCount: total
    });

    windowReads = 0;
    windowWrites = 0;
    windowStart = now;
  }

  while (Date.now() < end && !run.stopped) {
    const now = Date.now();

    if (run.settings.readInterval === 0 &&
        run.settings.writeInterval === 0) {
      if (trace.length % 2 === 0) {
        addRequest('R', now);
      } else {
        addRequest('W', now);
      }

      await sleep(10);
    } else {
      if (now >= nextRead) {
        addRequest('R', now);

        nextRead = now + (
          run.settings.readInterval === 0
            ? 100
            : run.settings.readInterval * 1000
        );
      }

      if (now >= nextWrite) {
        addRequest('W', now);

        nextWrite = now + (
          run.settings.writeInterval === 0
            ? 100
            : run.settings.writeInterval * 1000
        );
      }

      await sleep(10);
    }

    const currentTime = Date.now();

    if (
      currentTime - windowStart >= 1000 ||
      currentTime >= end ||
      run.stopped
    ) {
      closeWindow(currentTime);
    }
  }

  if (windowReads > 0 || windowWrites > 0) {
    closeWindow(Date.now());
  }

  return {
    trace,
    windows,
    startedAt: new Date(start).toISOString(),
    stoppedAt: new Date().toISOString(),
    durationMs: Date.now() - start
  };
}

// ---------------- C++ ENGINE ----------------

function executeEngine(trace, settings, durationMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(enginePath, ['--json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let output = '';
    let errorOutput = '';
    let settled = false;

    child.stdout.on('data', data => {
      output += data.toString();
    });

    child.stderr.on('data', data => {
      errorOutput += data.toString();
    });

    child.on('error', error => {
      if (settled) return;
      settled = true;

      reject(new Error(
        `Could not start C++ engine at ${enginePath}. ` +
        `Check that the executable exists. ${error.message}`
      ));
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;

      if (code !== 0) {
        reject(new Error(
          errorOutput || `C++ engine exited with code ${code}.`
        ));
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error(
          'C++ engine returned invalid JSON: ' + output.slice(0, 300)
        ));
      }
    });

    child.stdin.on('error', error => {
      errorOutput += error.message;
    });

    child.stdin.end(JSON.stringify({
      trace,
      objective: settings.objective,
      durationMs
    }));
  });
}

// ---------------- OBJECTIVE-AWARE RECOMMENDATION ----------------

// ---------------- OBJECTIVE-AWARE RECOMMENDATION ----------------

function calculateRecommendation(engineResult, objective) {
  const rows = Array.isArray(engineResult?.results)
    ? engineResult.results
    : [];

  if (!rows.length) {
    return {
      algorithm: 'No recommendation',
      reason: 'The engine returned no algorithm results.',
      objective
    };
  }

  const isNumber = value =>
    value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value));

  const previous = engineResult.recommendation;

  const previousRow = rows.find(
    row => row.algorithm === previous?.algorithm
  );

  const selectedGroup = previousRow?.group;

  let candidates = selectedGroup
    ? rows.filter(row => row.group === selectedGroup)
    : rows;

  // Exclude invalid and pending algorithms.
  candidates = candidates.filter(row => {
    const note = String(row.note || '').toLowerCase();

    return row.valid !== false && !note.includes('pending');
  });

  if (objective === 'throughput') {
    candidates = candidates.filter(
      row => isNumber(row.throughputRps)
    );

    candidates.sort((a, b) => {
      const difference =
        Number(b.throughputRps) - Number(a.throughputRps);

      if (difference !== 0) return difference;

      const aResponse = isNumber(a.responseTimeMs)
        ? Number(a.responseTimeMs)
        : Infinity;

      const bResponse = isNumber(b.responseTimeMs)
        ? Number(b.responseTimeMs)
        : Infinity;

      return aResponse - bResponse;
    });
  } else if (objective === 'reliability') {
    candidates.sort((a, b) => {
      const aHit = isNumber(a.hitRatio)
        ? Number(a.hitRatio)
        : -1;

      const bHit = isNumber(b.hitRatio)
        ? Number(b.hitRatio)
        : -1;

      if (aHit !== bHit) return bHit - aHit;

      const aResponse = isNumber(a.responseTimeMs)
        ? Number(a.responseTimeMs)
        : Infinity;

      const bResponse = isNumber(b.responseTimeMs)
        ? Number(b.responseTimeMs)
        : Infinity;

      return aResponse - bResponse;
    });
  } else {
    // Select the algorithm with the lowest response time.
    candidates = candidates.filter(
      row => isNumber(row.responseTimeMs)
    );

    candidates.sort(
      (a, b) =>
        Number(a.responseTimeMs) - Number(b.responseTimeMs)
    );
  }

  if (!candidates.length) {
    return {
      algorithm: 'No recommendation',
      reason: `No valid comparable metrics were available for the ${objective} objective.`,
      group: selectedGroup,
      objective
    };
  }

  const best = candidates[0];
  const groupText = best.group ? ` in ${best.group}` : '';

  let reason;

  if (objective === 'throughput') {
    reason =
      `Highest reported throughput${groupText}: ` +
      `${Number(best.throughputRps).toFixed(2)} requests/sec.`;
  } else if (objective === 'reliability') {
    reason =
      `Selected using the available hit-ratio metrics${groupText}.`;
  } else {
    reason =
      `Lowest reported response time${groupText}: ` +
      `${Number(best.responseTimeMs).toFixed(2)} ms.`;
  }

  return {
    algorithm: best.algorithm,
    reason,
    group: best.group,
    objective
  };
}

// ---------------- RUN A SIMULATION ----------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'smart-cache-api',
    storage: 'browser-localStorage',
    enginePath
  });
});

app.post('/api/simulations/start', (req, res) => {
  let settings;

  try {
    settings = validate(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const runId = randomUUID();

  const run = {
    runId,
    settings,
    stopped: false,
    done: false,
    result: null,
    error: null,
    promise: null
  };

  runs.set(runId, run);

  run.promise = (async () => {
    try {
      const generated = await generateWorkload(run);

      const engineResult = await executeEngine(
        generated.trace,
        settings,
        generated.durationMs
      );

      const readCount = generated.trace.filter(
        request => request.type === 'R'
      ).length;

      const writeCount = generated.trace.length - readCount;
      const total = generated.trace.length;

      const summary = {
        ...(engineResult.summary || {}),
        readCount,
        writeCount,
        totalRequests: total,
        readRatio: total ? (readCount / total) * 100 : 0,
        writeRatio: total ? (writeCount / total) * 100 : 0,
        durationMs: generated.durationMs,
        throughputRps: generated.durationMs
          ? total / (generated.durationMs / 1000)
          : 0
      };

      const result = {
        runId,
        name: '',
        settings,
        startedAt: generated.startedAt,
        stoppedAt: generated.stoppedAt,
        durationMs: generated.durationMs,
        windows: generated.windows,
        summary,
        results: Array.isArray(engineResult.results)
          ? engineResult.results
          : [],
        recommendation: null,
        traceCount: generated.trace.length
      };

      result.recommendation = calculateRecommendation(
        result,
        settings.objective
      );

      run.result = result;
      run.done = true;
    } catch (error) {
      run.error = error.message;
      run.done = true;
    }
  })();

  return res.status(202).json({
    runId,
    status: 'running'
  });
});

// ---------------- POLL A SIMULATION ----------------

app.get('/api/simulations/:id', (req, res) => {
  const run = runs.get(req.params.id);

  if (!run) {
    return res.status(404).json({
      error: 'Simulation not found or expired.'
    });
  }

  if (run.error) {
    return res.status(500).json({ error: run.error });
  }

  return res.json({
    runId: run.runId,
    status: run.done
      ? 'completed'
      : run.stopped
        ? 'stopping'
        : 'running',
    result: run.result
  });
});

// ---------------- STOP A SIMULATION ----------------

app.post('/api/simulations/stop', async (req, res) => {
  const run = runs.get(req.body?.runId);

  if (!run) {
    return res.status(404).json({
      error: 'Simulation not found or expired.'
    });
  }

  run.stopped = true;

  await run.promise;

  if (run.error) {
    return res.status(500).json({ error: run.error });
  }

  if (!run.result) {
    return res.status(500).json({
      error: 'Simulation stopped before a result was produced.'
    });
  }

  return res.json({
    status: 'stopped',
    result: run.result
  });
});

// ---------------- START SERVER ----------------

app.listen(PORT, () => {
  console.log(`Smart Cache API listening at http://localhost:${PORT}`);
  console.log(`Using C++ engine: ${enginePath}`);
});