#include "algorithms.h"

#include <vector>
#include <string>

using namespace std;

vector<Metric> runFileAllocation(
    const vector<Request>& trace,
    double elapsedSeconds
) {
    (void)trace;
    (void)elapsedSeconds;

    vector<Metric> results;
    results.reserve(3);

    const string algorithms[] = {
        "Contiguous",
        "Linked",
        "Indexed"
    };

    for (int i = 0; i < 3; ++i) {
        Metric m{};

        m.group = "File allocation";
        m.algorithm = algorithms[i];

        // File allocation benchmarking is pending.
        m.responseTimeMs = 0.0;
        m.throughputRps = 0.0;
        m.overheadBytes = 0;

        m.note = "PENDING: File allocation benchmarking not implemented.";

        // Keep these results out of recommendation comparisons
        // if your recommendation logic checks this field.
        m.valid = false;

        results.push_back(m);
    }

    results[0].baseline = true;

    return results;
}