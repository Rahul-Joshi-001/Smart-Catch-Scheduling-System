
#include "algorithms.h"

#include <queue>
#include <algorithm>
#include <string>
#include <vector>

using namespace std;

struct Job {
    int id;
    long long arrival;
    long long burst;
};

static Metric schedule(
    const vector<Job>& jobs,
    const string& name,
    int quantum
) {
    Metric m;
    m.group = "CPU scheduling";
    m.algorithm = name;

    vector<Job> js = jobs;

    sort(js.begin(), js.end(), [](const Job& a, const Job& b) {
        return a.arrival < b.arrival;
    });

    long long now = 0;
    long long totalWait = 0;
    long long totalTurn = 0;

    int n = static_cast<int>(js.size());

    if (n == 0) {
        m.valid = true;
        m.responseTimeMs = 0;
        m.throughputRps = 0;
        m.note = "No jobs to schedule";
        return m;
    }

    if (quantum == 0) {
        // First Come, First Served (FCFS)
        for (const auto& j : js) {
            now = max(now, j.arrival);

            totalWait += now - j.arrival;
            now += j.burst;
            totalTurn += now - j.arrival;
        }
    } else {
        // Round Robin
        queue<int> q;

        vector<long long> remaining(n);
        vector<long long> arrival(n);

        for (int i = 0; i < n; ++i) {
            arrival[i] = js[i].arrival;
            remaining[i] = js[i].burst;
        }

        int i = 0;

        while (i < n || !q.empty()) {
            if (q.empty() && i < n) {
                now = max(now, arrival[i]);
            }

            while (i < n && arrival[i] <= now) {
                q.push(i++);
            }

            if (q.empty()) {
                continue;
            }

            int x = q.front();
            q.pop();

            long long run = min<long long>(quantum, remaining[x]);

            now += run;
            remaining[x] -= run;

            while (i < n && arrival[i] <= now) {
                q.push(i++);
            }

            if (remaining[x] > 0) {
                q.push(x);
            } else {
                totalTurn += now - arrival[x];
                totalWait += now - arrival[x] - js[x].burst;
            }
        }
    }

    m.responseTimeMs = static_cast<double>(totalTurn) / n;

    m.throughputRps = now > 0
        ? static_cast<double>(n) / (now / 1000.0)
        : 0;

    m.hitRatio = -1;

    m.note =
        "Synthetic CPU jobs derived from request trace; "
        "responseTimeMs represents average turnaround time "
        "in simulated milliseconds";

    return m;
}

vector<Metric> runCpuScheduling(
    const vector<Request>& trace,
    double elapsedSeconds
) {
    vector<Job> jobs;
    jobs.reserve(trace.size());

    for (size_t i = 0; i < trace.size(); ++i) {
        long long burst = 1 + (static_cast<long long>(trace[i].key) % 5);

        // Ensure every job has a positive burst time.
        if (burst <= 0) {
            burst += 5;
        }

        jobs.push_back({
            static_cast<int>(i),
            trace[i].at,
            burst
        });
    }

    Metric fcfs = schedule(jobs, "FCFS", 0);
    Metric rr3 = schedule(jobs, "Round Robin (q=3)", 3);
    Metric rr5 = schedule(jobs, "Round Robin (q=5)", 5);

    fcfs.baseline = true;

    return {fcfs, rr3, rr5};
}
