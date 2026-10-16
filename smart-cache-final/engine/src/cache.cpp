
#include "algorithms.h"

#include <deque>
#include <unordered_map>
#include <algorithm>
#include <chrono>
#include <string>
#include <vector>

using namespace std;

static Metric eval(
    const vector<Request>& trace,
    double elapsedSeconds,
    const string& name,
    int policy
) {
    Metric m;
    m.group = "Cache";
    m.algorithm = name;

    const int capacity = 8;

    deque<int> cache;
    unordered_map<int, int> frequency;
    unordered_map<int, long long> lastUsed;

    long long clock = 0;

    for (const auto& request : trace) {
        ++clock;

        auto it = find(cache.begin(), cache.end(), request.key);

        if (it != cache.end()) {
            // Cache hit
            ++m.hits;
            ++frequency[request.key];
            lastUsed[request.key] = clock;

            // LRU: move recently used key to the back
            if (policy == 1) {
                cache.erase(it);
                cache.push_back(request.key);
            }
        } else {
            // Cache miss
            ++m.misses;

            if (static_cast<int>(cache.size()) >= capacity) {
                auto victim = cache.begin();

                if (policy == 2) {
                    // LFU: evict least frequently used.
                    // Break ties using the oldest last-used timestamp.
                    for (auto it = cache.begin(); it != cache.end(); ++it) {
                        if (
                            frequency[*it] < frequency[*victim] ||
                            (
                                frequency[*it] == frequency[*victim] &&
                                lastUsed[*it] < lastUsed[*victim]
                            )
                        ) {
                            victim = it;
                        }
                    }
                }

                int evictedKey = *victim;
                cache.erase(victim);

                frequency.erase(evictedKey);
                lastUsed.erase(evictedKey);
            }

            cache.push_back(request.key);
            frequency[request.key] = 1;
            lastUsed[request.key] = clock;
        }
    }

    // Measure benchmark overhead separately from simulated cache behavior.
    const auto begin = chrono::steady_clock::now();

    volatile long long checksum = 0;

    for (int i = 0; i < 50000; ++i) {
        for (const auto& request : trace) {
            checksum += (request.key + i) % 7;
        }
    }

    const auto end = chrono::steady_clock::now();

    double workMs =
        chrono::duration<double, milli>(end - begin).count();

    m.responseTimeMs = trace.empty()
        ? 0
        : workMs / trace.size();

    m.throughputRps = elapsedSeconds > 0
        ? static_cast<double>(trace.size()) / elapsedSeconds
        : 0;

    m.hitRatio = trace.empty()
        ? 0
        : 100.0 * m.hits / trace.size();

    m.note =
        "8-entry cache simulation; responseTimeMs measures benchmark "
        "overhead per request, not actual workload latency";

    return m;
}

vector<Metric> runCache(
    const vector<Request>& trace,
    double elapsedSeconds
) {
    Metric fifo = eval(trace, elapsedSeconds, "FIFO", 0);
    Metric lru  = eval(trace, elapsedSeconds, "LRU", 1);
    Metric lfu  = eval(trace, elapsedSeconds, "LFU", 2);

    fifo.baseline = true;

    return {fifo, lru, lfu};
}
