#pragma once

#include <string>
#include <vector>
#include <cstdint>

struct Request {
    char type;       // 'R' = Read, 'W' = Write
    int key;         // Requested key
    long long at;    // Request arrival time
};

struct Metric {
    std::string group;
    std::string algorithm;

    double responseTimeMs = 0;
    double throughputRps = 0;
    double hitRatio = -1;

    long long hits = 0;
    long long misses = 0;
    long long overheadBytes = 0;

    bool valid = true;
    bool baseline = false;
    bool recommended = false;

    std::string note;
};

std::vector<Metric> runCache(
    const std::vector<Request>& trace,
    double elapsedSeconds
);

std::vector<Metric> runIndexing(
    const std::vector<Request>& trace,
    double elapsedSeconds
);

std::vector<Metric> runFileAllocation(
    const std::vector<Request>& trace,
    double elapsedSeconds
);

std::vector<Metric> runCpuScheduling(
    const std::vector<Request>& trace,
    double elapsedSeconds
);