
#include "algorithms.h"

#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>
#include <stdexcept>

using namespace std;

static string escapeJson(const string& value) {
    string output;

    for (unsigned char c : value) {
        switch (c) {
            case '"':  output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\n': output += "\\n";  break;
            case '\r': output += "\\r";  break;
            case '\t': output += "\\t";  break;
            default:
                if (c < 0x20) {
                    output += ' ';
                } else {
                    output += static_cast<char>(c);
                }
        }
    }

    return output;
}

static string getValue(const string& object, const string& key) {
    string searchKey = "\"" + key + "\"";
    size_t pos = object.find(searchKey);

    if (pos == string::npos) {
        return "";
    }

    pos = object.find(':', pos + searchKey.size());

    if (pos == string::npos) {
        return "";
    }

    ++pos;

    while (pos < object.size() &&
           isspace(static_cast<unsigned char>(object[pos]))) {
        ++pos;
    }

    if (pos >= object.size()) {
        return "";
    }

    if (object[pos] == '"') {
        size_t end = object.find('"', pos + 1);

        if (end == string::npos) {
            return "";
        }

        return object.substr(pos + 1, end - pos - 1);
    }

    size_t end = pos;

    while (end < object.size() &&
           (isdigit(static_cast<unsigned char>(object[end])) ||
            object[end] == '-')) {
        ++end;
    }

    return object.substr(pos, end - pos);
}

static bool parseInteger(
    const string& value,
    long long& result
) {
    if (value.empty()) {
        return false;
    }

    try {
        size_t used = 0;
        result = stoll(value, &used);
        return used == value.size();
    } catch (...) {
        return false;
    }
}

int main(int argc, char** argv) {
    if (argc > 1 && string(argv[1]) == "--health") {
        cout << "{\"status\":\"ok\",\"engine\":\"cpp17\"}\n";
        return 0;
    }

    ostringstream input;
    input << cin.rdbuf();

    string raw = input.str();

    size_t tracePos = raw.find("\"trace\"");

    if (tracePos == string::npos) {
        cerr << "Missing trace";
        return 2;
    }

    size_t arrayStart = raw.find('[', tracePos);

    if (arrayStart == string::npos) {
        cerr << "Invalid trace array";
        return 2;
    }

    size_t arrayEnd = raw.find(']', arrayStart);

    if (arrayEnd == string::npos) {
        cerr << "Unclosed trace array";
        return 2;
    }

    string arrayData = raw.substr(
        arrayStart + 1,
        arrayEnd - arrayStart - 1
    );

    vector<Request> trace;

    // This parser supports the project's simple trace objects.
    // Each request should have type, key, and at fields.
    size_t pos = 0;

    while (pos < arrayData.size()) {
        size_t objectStart = arrayData.find('{', pos);

        if (objectStart == string::npos) {
            break;
        }

        size_t objectEnd = arrayData.find('}', objectStart);

        if (objectEnd == string::npos) {
            cerr << "Invalid request object";
            return 2;
        }

        string object = arrayData.substr(
            objectStart,
            objectEnd - objectStart + 1
        );

        string typeValue = getValue(object, "type");
        string keyValue = getValue(object, "key");
        string atValue = getValue(object, "at");

        long long key = 0;
        long long at = 0;

        if (!parseInteger(keyValue, key) ||
            !parseInteger(atValue, at)) {
            cerr << "Invalid key or at value";
            return 2;
        }

        if (key < -2147483647LL - 1 ||
            key > 2147483647LL) {
            cerr << "Request key is out of range";
            return 2;
        }

        char type = 'R';

        if (typeValue == "W") {
            type = 'W';
        } else if (typeValue != "R") {
            cerr << "Invalid request type";
            return 2;
        }

        trace.push_back({
            type,
            static_cast<int>(key),
            at
        });

        pos = objectEnd + 1;
    }

    double durationSeconds = 1.0;

    size_t durationPos = raw.find("\"durationMs\"");

    if (durationPos != string::npos) {
        durationPos = raw.find(':', durationPos);

        if (durationPos != string::npos) {
            try {
                durationSeconds = max(
                    0.001,
                    stod(raw.substr(durationPos + 1)) / 1000.0
                );
            } catch (...) {
                durationSeconds = 1.0;
            }
        }
    }

    string objective = "response";

    size_t objectivePos = raw.find("\"objective\"");

    if (objectivePos != string::npos) {
        objectivePos = raw.find(':', objectivePos);

        if (objectivePos != string::npos) {
            size_t quoteStart = raw.find('"', objectivePos + 1);

            if (quoteStart != string::npos) {
                size_t quoteEnd = raw.find('"', quoteStart + 1);

                if (quoteEnd != string::npos) {
                    objective = raw.substr(
                        quoteStart + 1,
                        quoteEnd - quoteStart - 1
                    );
                }
            }
        }
    }

    vector<Metric> metrics = runCache(trace, durationSeconds);

    auto appendMetrics = [&](vector<Metric> values) {
        metrics.insert(
            metrics.end(),
            values.begin(),
            values.end()
        );
    };

    appendMetrics(runIndexing(trace, durationSeconds));
    appendMetrics(runFileAllocation(trace, durationSeconds));
    appendMetrics(runCpuScheduling(trace, durationSeconds));

    int reads = 0;
    int writes = 0;

    for (const auto& request : trace) {
        if (request.type == 'R') {
            ++reads;
        } else {
            ++writes;
        }
    }

    double averageResponse = 0;

    for (const auto& metric : metrics) {
        averageResponse += metric.responseTimeMs;
    }

    if (!metrics.empty()) {
        averageResponse /= metrics.size();
    }

    // Reliability cannot be ranked without a meaningful
    // correctness/reliability measurement.
    int best = -1;

    if (objective != "reliability") {
        for (size_t i = 0; i < metrics.size(); ++i) {
            if (!metrics[i].valid) {
                continue;
            }

            if (best == -1) {
                best = static_cast<int>(i);
                continue;
            }

            bool better = objective == "throughput"
                ? metrics[i].throughputRps >
                  metrics[best].throughputRps
                : metrics[i].responseTimeMs <
                  metrics[best].responseTimeMs;

            if (better) {
                best = static_cast<int>(i);
            }
        }
    }

    if (best >= 0) {
        metrics[best].recommended = true;
    }

    cout << fixed << setprecision(4);

    cout << "{\"summary\":{"
         << "\"readCount\":" << reads << ","
         << "\"writeCount\":" << writes << ","
         << "\"totalRequests\":" << trace.size() << ","
         << "\"readRatio\":"
         << (trace.empty() ? 0 : 100.0 * reads / trace.size()) << ","
         << "\"writeRatio\":"
         << (trace.empty() ? 0 : 100.0 * writes / trace.size()) << ","
         << "\"avgResponseMs\":" << averageResponse << ","
         << "\"throughputRps\":"
         << (durationSeconds > 0
                 ? trace.size() / durationSeconds
                 : 0)
         << "},\"results\":[";

    for (size_t i = 0; i < metrics.size(); ++i) {
        const auto& m = metrics[i];

        if (i > 0) {
            cout << ',';
        }

        cout << "{"
             << "\"group\":\"" << escapeJson(m.group) << "\","
             << "\"algorithm\":\"" << escapeJson(m.algorithm) << "\","
             << "\"responseTimeMs\":" << m.responseTimeMs << ","
             << "\"throughputRps\":" << m.throughputRps << ","
             << "\"hitRatio\":";

        if (m.hitRatio < 0) {
            cout << "null";
        } else {
            cout << m.hitRatio;
        }

        cout << ",\"hits\":" << m.hits
             << ",\"misses\":" << m.misses
             << ",\"overheadBytes\":" << m.overheadBytes
             << ",\"valid\":" << (m.valid ? "true" : "false")
             << ",\"baseline\":" << (m.baseline ? "true" : "false")
             << ",\"recommended\":"
             << (m.recommended ? "true" : "false")
             << ",\"note\":\"" << escapeJson(m.note) << "\"}";
    }

    cout << "],\"recommendation\":{";

    if (objective == "reliability") {
        cout << "\"algorithm\":\"None\","
             << "\"reason\":\"Reliability cannot be ranked "
                "without a correctness metric\"";
    } else if (best >= 0) {
        cout << "\"algorithm\":\""
             << escapeJson(metrics[best].algorithm) << "\","
             << "\"reason\":\""
             << (objective == "throughput"
                     ? "Highest reported throughput"
                     : "Lowest reported execution or turnaround time")
             << "\"";
    } else {
        cout << "\"algorithm\":\"None\","
             << "\"reason\":\"No valid configuration\"";
    }

    cout << "}}";

    return 0;
}
