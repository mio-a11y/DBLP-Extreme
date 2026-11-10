#pragma once

#include "Analyzer.h"
#include "Document.h"
#include "Infrastructure.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <istream>
#include <memory>
#include <string_view>
#include <vector>

struct LocalIndex {
    // Chunk arenas survive merging because Documents contain string_views.
    // Small slabs avoid retaining 16 MiB for every small XML chunk.
    StringArena arena{1u * 1024u * 1024u};
    std::vector<Document> forward_index;
    FlatMap<std::string_view, std::vector<Posting>> author_inverted;
    FlatMap<std::string_view, std::vector<Posting>> title_exact_inverted;
    FlatMap<std::string_view, std::vector<Posting>> keyword_inverted;

    LocalIndex() = default;
    LocalIndex(const LocalIndex&) = delete;
    LocalIndex& operator=(const LocalIndex&) = delete;
    LocalIndex(LocalIndex&&) = default;
    LocalIndex& operator=(LocalIndex&&) = default;
};

class ExtremeParser {
public:
    explicit ExtremeParser(std::size_t max_concurrent_consumers = 0,
                           std::size_t chunk_bytes = 8u * 1024u * 1024u,
                           std::size_t max_in_flight = 0) noexcept;

    [[nodiscard]] std::vector<std::unique_ptr<LocalIndex>> parse_file(const char* utf8_path);

    void parse_file_streaming(const char* utf8_path,
                             std::function<void(std::unique_ptr<LocalIndex>)> on_chunk);

    // Consume a caller-owned stream without seeking or retaining completed chunks.
    void parse_stream(std::istream& input,
                      std::function<void(std::unique_ptr<LocalIndex>)> on_chunk);

    [[nodiscard]] std::size_t chunk_bytes() const noexcept { return chunk_bytes_; }
    [[nodiscard]] std::size_t max_concurrent() const noexcept { return max_concurrent_; }
    [[nodiscard]] std::size_t max_in_flight() const noexcept { return max_in_flight_; }

private:
    std::size_t chunk_bytes_;
    std::size_t max_concurrent_;
    std::size_t max_in_flight_;
};
