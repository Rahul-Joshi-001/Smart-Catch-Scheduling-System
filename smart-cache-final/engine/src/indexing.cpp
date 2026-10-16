#include "algorithms.h"

#include <vector>
#include <string>

using namespace std;

vector<Metric> runIndexing(
    const vector<Request>& trace,
    double elapsedSeconds
) {
    (void)trace;
    (void)elapsedSeconds;

    vector<Metric> results;
    results.reserve(3);

    const string algorithms[] = {
        "B-Tree (ordered map proxy)",
        "B+ Tree (ordered map proxy)",
        "Hash"
    };

    for (const string& algorithm : algorithms) {
        Metric m{};

        m.group = "Indexing";
        m.algorithm = algorithm;
        m.responseTimeMs = 0.0;
        m.throughputRps = 0.0;
        m.overheadBytes = 0;

        m.note =
            "PENDING: Indexing implementation and benchmarking "
            "not completed.";

        m.valid = false;
        m.baseline = false;

        results.push_back(m);
    }

    return results;
}