#include "ExtremeParser.h"

#include <algorithm>
#include <cctype>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <fstream>
#include <iostream>
#include <functional>
#include <exception>
#include <stdexcept>
#include <map>
#include <mutex>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr std::size_t kMaxCarryBytes = 256u * 1024u * 1024u;

[[nodiscard]] bool is_name_char(unsigned char c) noexcept {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' ||
           c == ':' || c == '.';
}

[[nodiscard]] std::string_view read_name(const char* p, const char* end, const char** out_next) noexcept {
    const char* s = p;
    while (p < end && is_name_char(static_cast<unsigned char>(*p)) != 0) {
        ++p;
    }
    *out_next = p;
    return {s, static_cast<std::size_t>(p - s)};
}

[[nodiscard]] bool skip_to_gt(const char*& p, const char* end) noexcept {
    while (p < end && *p != '>') {
        if (*p == '"' || *p == '\'') {
            const char q = *p++;
            while (p < end && *p != q) {
                if (*p == '\\' && p + 1 < end) {
                    p += 2;
                } else {
                    ++p;
                }
            }
            if (p < end) {
                ++p;
            }
        } else {
            ++p;
        }
    }
    if (p >= end) {
        return false;
    }
    ++p;
    return true;
}

[[nodiscard]] bool is_record_open_name(std::string_view name) noexcept {
    static constexpr std::string_view kRoots[] = {"article",      "inproceedings", "proceedings", "book",
                                                  "incollection", "phdthesis",     "mastersthesis", "www"};
    for (const std::string_view r : kRoots) {
        if (name == r) {
            return true;
        }
    }
    return false;
}

[[nodiscard]] std::size_t find_safe_cut_end(const char* data, std::size_t n) noexcept {
    if (n < 4) {
        return 0;
    }
    const std::string_view buf(data, n);
    static constexpr std::string_view kClosers[] = {
        "</article>", "</inproceedings>", "</proceedings>", "</book>",
        "</incollection>", "</phdthesis>", "</mastersthesis>", "</www>"};

    std::size_t best = 0;
    for (const std::string_view closer : kClosers) {
        const std::size_t pos = buf.rfind(closer);
        if (pos != std::string_view::npos) {
            best = std::max(best, pos + closer.size());
        }
    }
    return best;
}

void trim_inplace(std::vector<char>& b) {
    std::size_t first = 0;
    while (first < b.size() && std::isspace(static_cast<unsigned char>(b[first])) != 0) {
        ++first;
    }
    std::size_t last = b.size();
    while (last > first && std::isspace(static_cast<unsigned char>(b[last - 1])) != 0) {
        --last;
    }
    if (first == 0 && last == b.size()) {
        return;
    }
    if (first >= last) {
        b.clear();
        return;
    }
    const std::size_t out_len = last - first;
    std::memmove(b.data(), b.data() + first, out_len);
    b.resize(out_len);
}

[[nodiscard]] std::string_view normalized_span(StringArena& arena, std::string_view raw) {
    const std::vector<std::string_view> toks = Analyzer::normalize_and_tokenize(raw, arena);
    if (toks.empty()) {
        return {};
    }
    const char* const beg = toks.front().data();
    const char* const ed = toks.back().data() + toks.back().size();
    return {beg, static_cast<std::size_t>(ed - beg)};
}

void decode_xml_entities(const std::vector<char>& in, std::vector<char>& out) {
    out.clear();
    out.reserve(in.size());
    std::size_t i = 0;
    while (i < in.size()) {
        if (in[i] != '&') {
            out.push_back(in[i]);
            ++i;
            continue;
        }
        const std::string_view rem(in.data() + i, in.size() - i);
        if (rem.size() >= 5 && rem[1] == 'a' && rem[2] == 'm' && rem[3] == 'p' && rem[4] == ';') {
            out.push_back('&');
            i += 5;
        } else if (rem.size() >= 4 && rem[1] == 'l' && rem[2] == 't' && rem[3] == ';') {
            out.push_back('<');
            i += 4;
        } else if (rem.size() >= 4 && rem[1] == 'g' && rem[2] == 't' && rem[3] == ';') {
            out.push_back('>');
            i += 4;
        } else if (rem.size() >= 6 && rem[1] == 'q' && rem[2] == 'u' && rem[3] == 'o' && rem[4] == 't' && rem[5] == ';') {
            out.push_back('"');
            i += 6;
        } else if (rem.size() >= 6 && rem[1] == 'a' && rem[2] == 'p' && rem[3] == 'o' && rem[4] == 's' && rem[5] == ';') {
            out.push_back('\'');
            i += 6;
        } else {
            out.push_back(in[i]);
            ++i;
        }
    }
}

[[nodiscard]] int parse_year_int(const std::vector<char>& field) {
    std::size_t i = 0;
    while (i < field.size() && std::isspace(static_cast<unsigned char>(field[i])) != 0) {
        ++i;
    }
    if (i >= field.size()) {
        return 0;
    }
    int sign = 1;
    if (field[i] == '-') {
        sign = -1;
        ++i;
    }
    int v = 0;
    bool any = false;
    while (i < field.size() && field[i] >= '0' && field[i] <= '9') {
        any = true;
        const int d = field[i] - '0';
        if (v > (2147483647 - d) / 10) {
            return 0;
        }
        v = v * 10 + d;
        ++i;
    }
    return any ? sign * v : 0;
}

enum class FieldKind : std::uint8_t {
    None,
    Title,
    Author,
    Year,
    Journal,
    Volume,
    Month,
    Cdrom,
    Ee,
    Url
};

class ChunkFsmParser {
public:
    explicit ChunkFsmParser(LocalIndex& out) noexcept : out_(out) {}

    void parse(std::string_view chunk) {
        if (normalized_author_cache_.empty()) {
            normalized_author_cache_.reserve(1u << 15);
        }
        const char* p = chunk.data();
        const char* end = chunk.data() + chunk.size();
        while (p < end) {
            if (!in_doc_) {
                if (*p != '<') {
                    ++p;
                    continue;
                }
                const char* open = p;
                ++p;
                if (p >= end) {
                    break;
                }
                if (*p == '?') {
                    if (!skip_to_gt(p, end)) {
                        break;
                    }
                    continue;
                }
                if (*p == '!') {
                    if (end - open >= 9 && std::memcmp(open, "<![CDATA[", 9) == 0) {
                        p = open;
                        if (!skip_cdata_block(p, end)) {
                            break;
                        }
                        continue;
                    }
                    if (end - open >= 4 && open[1] == '!' && open[2] == '-' && open[3] == '-') {
                        p = open;
                        if (!skip_comment(p, end)) {
                            break;
                        }
                        continue;
                    }
                    if (!skip_to_gt(p, end)) {
                        break;
                    }
                    continue;
                }
                if (*p == '/') {
                    if (!skip_to_gt(p, end)) {
                        break;
                    }
                    continue;
                }
                const char* name_end = nullptr;
                const std::string_view name = read_name(p, end, &name_end);
                p = name_end;
                if (name.empty()) {
                    if (!skip_to_gt(p, end)) {
                        break;
                    }
                    continue;
                }
                if (is_record_open_name(name)) {
                    if (!skip_to_gt(p, end)) {
                        break;
                    }
                    begin_record(name);
                    continue;
                }
                if (!skip_to_gt(p, end)) {
                    break;
                }
                continue;
            }

            if (active_field_ != FieldKind::None && *p != '<') {
                append_text_char(static_cast<unsigned char>(*p));
                ++p;
                continue;
            }

            if (*p != '<') {
                ++p;
                continue;
            }

            if (p + 9 <= end && std::memcmp(p, "<![CDATA[", 9) == 0) {
                if (active_field_ != FieldKind::None) {
                    p += 9;
                    while (p + 3 <= end && std::memcmp(p, "]]>", 3) != 0) {
                        append_text_char(static_cast<unsigned char>(*p));
                        ++p;
                    }
                    if (p + 3 <= end) {
                        p += 3;
                    } else {
                        p = end;
                    }
                } else {
                    if (!skip_cdata_block(p, end)) {
                        break;
                    }
                }
                continue;
            }

            if (p + 4 <= end && p[1] == '!' && p[2] == '-' && p[3] == '-') {
                if (!skip_comment(p, end)) {
                    break;
                }
                continue;
            }

            if (p + 1 < end && p[1] == '/') {
                const char* q = p + 2;
                const char* name_end = nullptr;
                const std::string_view cname = read_name(q, end, &name_end);
                q = name_end;
                while (q < end && std::isspace(static_cast<unsigned char>(*q)) != 0) {
                    ++q;
                }
                if (q >= end || *q != '>') {
                    if (!skip_to_gt(p, end)) {
                        break;
                    }
                    continue;
                }
                if (cname == record_name_) {
                    flush_active_field();
                    end_record();
                    p = q + 1;
                    continue;
                }
                const FieldKind fk = classify_field_close(cname);
                if (fk != FieldKind::None && fk == active_field_) {
                    flush_active_field();
                }
                p = q + 1;
                continue;
            }

            const char* q = p + 1;
            const char* name_end = nullptr;
            const std::string_view name = read_name(q, end, &name_end);
            q = name_end;
            if (q >= end) {
                break;
            }
            const FieldKind open_kind = classify_field_open(name);
            if (open_kind != FieldKind::None) {
                if (active_field_ != FieldKind::None) {
                    flush_active_field();
                }
                active_field_ = open_kind;
                field_buf_.clear();
                if (*q == '/' && q + 1 < end && q[1] == '>') {
                    q += 2;
                    p = q;
                    flush_active_field();
                    active_field_ = FieldKind::None;
                    continue;
                }
                if (!skip_to_gt(q, end)) {
                    break;
                }
                p = q;
                continue;
            }
            if (!skip_to_gt(q, end)) {
                break;
            }
            p = q;
        }
        flush_active_field();
    }

private:
    LocalIndex& out_;
    bool in_doc_ = false;
    std::string_view record_name_{};
    Document cur_{};
    FieldKind active_field_ = FieldKind::None;
    std::vector<char> field_buf_{};
    std::vector<char> decode_buf_{};
    std::vector<char> authors_blob_{};
    std::vector<std::string_view> author_parts_{};
    std::unordered_map<std::string_view, std::string_view> normalized_author_cache_{};

    [[nodiscard]] static FieldKind classify_field_open(std::string_view name) noexcept {
        if (name == "title") {
            return FieldKind::Title;
        }
        if (name == "author") {
            return FieldKind::Author;
        }
        if (name == "year") {
            return FieldKind::Year;
        }
        if (name == "journal" || name == "booktitle") {
            return FieldKind::Journal;
        }
        if (name == "volume") {
            return FieldKind::Volume;
        }
        if (name == "month") {
            return FieldKind::Month;
        }
        if (name == "cdrom") {
            return FieldKind::Cdrom;
        }
        if (name == "ee") {
            return FieldKind::Ee;
        }
        if (name == "url") {
            return FieldKind::Url;
        }
        return FieldKind::None;
    }

    [[nodiscard]] static FieldKind classify_field_close(std::string_view name) noexcept {
        return classify_field_open(name);
    }

    [[nodiscard]] bool skip_comment(const char*& p, const char* end) noexcept {
        if (end - p < 4) {
            p = end;
            return false;
        }
        if (p[0] != '<' || p[1] != '!' || p[2] != '-' || p[3] != '-') {
            return false;
        }
        p += 4;
        while (p + 2 < end) {
            if (p[0] == '-' && p[1] == '-' && p[2] == '>') {
                p += 3;
                return true;
            }
            ++p;
        }
        p = end;
        return false;
    }

    [[nodiscard]] bool skip_cdata_block(const char*& p, const char* end) noexcept {
        if (end - p < 9) {
            p = end;
            return false;
        }
        if (std::memcmp(p, "<![CDATA[", 9) != 0) {
            return false;
        }
        p += 9;
        while (p + 3 <= end) {
            if (p[0] == ']' && p[1] == ']' && p[2] == '>') {
                p += 3;
                return true;
            }
            ++p;
        }
        p = end;
        return false;
    }

    void begin_record(std::string_view name) noexcept {
        in_doc_ = true;
        record_name_ = name;
        cur_ = Document{};
        active_field_ = FieldKind::None;
        field_buf_.clear();
        authors_blob_.clear();
        author_parts_.clear();
    }

    void append_text_char(unsigned char c) {
        if (active_field_ == FieldKind::None) {
            return;
        }
        field_buf_.push_back(static_cast<char>(c));
    }

    void flush_active_field() {
        if (active_field_ == FieldKind::None) {
            field_buf_.clear();
            return;
        }
        trim_inplace(field_buf_);
        decode_xml_entities(field_buf_, decode_buf_);
        switch (active_field_) {
        case FieldKind::Title:
            cur_.title = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        case FieldKind::Author: {
            const std::string_view av = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            author_parts_.push_back(av);
            break;
        }
        case FieldKind::Year:
            cur_.year = parse_year_int(decode_buf_);
            break;
        case FieldKind::Journal:
            cur_.journal = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        case FieldKind::Volume:
            cur_.volume = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        case FieldKind::Month:
            cur_.month = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        case FieldKind::Cdrom:
            cur_.cdrom = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        case FieldKind::Ee:
            cur_.ee = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        case FieldKind::Url:
            cur_.url = out_.arena.store(std::string_view(decode_buf_.data(), decode_buf_.size()));
            break;
        default:
            break;
        }
        field_buf_.clear();
        active_field_ = FieldKind::None;
    }

    void end_record() {
        in_doc_ = false;

        authors_blob_.clear();
        for (std::size_t i = 0; i < author_parts_.size(); ++i) {
            if (i != 0) {
                authors_blob_.push_back('|');
                authors_blob_.push_back(' ');
            }
            const std::string_view a = author_parts_[i];
            authors_blob_.insert(authors_blob_.end(), a.begin(), a.end());
        }
        if (!authors_blob_.empty()) {
            cur_.authors = out_.arena.store(std::string_view(authors_blob_.data(), authors_blob_.size()));
        }

        const DocID doc_id = static_cast<DocID>(out_.forward_index.size());
        cur_.id = doc_id;

        std::vector<std::string_view> title_tokens;
        std::string_view normalized_title{};
        if (!cur_.title.empty()) {
            title_tokens = Analyzer::normalize_and_tokenize(cur_.title, out_.arena);
            if (!title_tokens.empty()) {
                const char* const tbeg = title_tokens.front().data();
                const char* const ted = title_tokens.back().data() + title_tokens.back().size();
                normalized_title = std::string_view(tbeg, static_cast<std::size_t>(ted - tbeg));
            }
        }
        cur_.doc_length = static_cast<std::uint32_t>(title_tokens.size());

        for (const std::string_view a : author_parts_) {
            const auto it = normalized_author_cache_.find(a);
            std::string_view na{};
            if (it != normalized_author_cache_.end()) {
                na = it->second;
            } else {
                na = normalized_span(out_.arena, a);
                normalized_author_cache_.emplace(a, na);
            }
            if (!na.empty()) {
                out_.author_inverted[na].push_back(Posting{doc_id, 1u});
            }
        }

        if (!normalized_title.empty()) {
            out_.title_exact_inverted[normalized_title].push_back(Posting{doc_id, 1u});
        }

        std::unordered_map<std::string_view, std::uint32_t> tf_counts;
        tf_counts.reserve(title_tokens.size());
        for (const std::string_view tok : title_tokens) {
            ++tf_counts[tok];
        }
        for (const auto& kv : tf_counts) {
            out_.keyword_inverted[kv.first].push_back(Posting{doc_id, kv.second});
        }

        out_.forward_index.push_back(cur_);
        cur_ = Document{};
        author_parts_.clear();
        authors_blob_.clear();
    }
};

[[nodiscard]] std::unique_ptr<LocalIndex> parse_chunk_worker(std::vector<char> buffer) {
    auto idx = std::make_unique<LocalIndex>();
    ChunkFsmParser parser(*idx);
    parser.parse(std::string_view(buffer.data(), buffer.size()));
    return idx;
}

} // namespace

ExtremeParser::ExtremeParser(std::size_t max_concurrent_consumers,
                             std::size_t chunk_bytes,
                             std::size_t max_in_flight) noexcept
    : chunk_bytes_(std::max<std::size_t>(4096, chunk_bytes)), max_concurrent_(1), max_in_flight_(1) {
    const std::size_t hw = std::max<std::size_t>(1u, std::thread::hardware_concurrency());
    if (max_concurrent_consumers == 0) {
        max_concurrent_ = std::max<std::size_t>(1, std::min<std::size_t>(8, hw > 2 ? hw - 1 : hw));
    } else {
        max_concurrent_ = std::max<std::size_t>(1, max_concurrent_consumers);
    }
    max_in_flight_ = max_in_flight == 0 ? max_concurrent_ * 2 : std::max<std::size_t>(1, max_in_flight);
    max_concurrent_ = std::min(max_concurrent_, max_in_flight_);
}

std::vector<std::unique_ptr<LocalIndex>> ExtremeParser::parse_file(const char* utf8_path) {
    // This convenience API deliberately retains all results. Large datasets should
    // use parse_file_streaming with a consuming callback instead.
    std::vector<std::unique_ptr<LocalIndex>> results;
    parse_file_streaming(utf8_path, [&](std::unique_ptr<LocalIndex> local) {
        results.push_back(std::move(local));
    });
    return results;
}

void ExtremeParser::parse_file_streaming(const char* utf8_path,
                                        std::function<void(std::unique_ptr<LocalIndex>)> on_chunk) {
    std::ifstream in(utf8_path, std::ios::binary);
    if (!in) throw std::runtime_error("Cannot open XML input");
    parse_stream(in, std::move(on_chunk));
}

void ExtremeParser::parse_stream(std::istream& in,
                                 std::function<void(std::unique_ptr<LocalIndex>)> on_chunk) {

    struct WorkItem {
        std::size_t seq = 0;
        std::vector<char> chunk;
    };
    struct Result {
        std::unique_ptr<LocalIndex> index;
        std::exception_ptr error;
    };
    std::deque<WorkItem> work_queue;
    std::mutex work_mu;
    std::condition_variable work_cv;
    bool producer_done = false;
    bool stopping = false;
    std::map<std::size_t, Result> completed;
    std::mutex completed_mu;
    std::condition_variable completed_cv;
    std::vector<std::thread> workers;
    const std::size_t num_workers = std::min(max_concurrent_, max_in_flight_);
    workers.reserve(num_workers);

    // Construct before launching any worker. On read/parse/callback/thread-start
    // failure, stop queued work and join every running worker before state dies.
    struct WorkerGuard {
        std::vector<std::thread>& workers;
        std::mutex& mutex;
        std::condition_variable& cv;
        std::deque<WorkItem>& queue;
        bool& stopping;
        ~WorkerGuard() {
            {
                std::lock_guard<std::mutex> lock(mutex);
                stopping = true;
                queue.clear();
            }
            cv.notify_all();
            for (auto& worker : workers) if (worker.joinable()) worker.join();
        }
    } guard{workers, work_mu, work_cv, work_queue, stopping};

    for (std::size_t i = 0; i < num_workers; ++i) {
        workers.emplace_back([&]() {
            for (;;) {
                WorkItem item;
                {
                    std::unique_lock<std::mutex> lock(work_mu);
                    work_cv.wait(lock, [&]() { return stopping || producer_done || !work_queue.empty(); });
                    if (stopping || work_queue.empty()) return;
                    item = std::move(work_queue.front());
                    work_queue.pop_front();
                }
                Result result;
                try { result.index = parse_chunk_worker(std::move(item.chunk)); }
                catch (...) { result.error = std::current_exception(); }
                {
                    std::lock_guard<std::mutex> lock(completed_mu);
                    completed.emplace(item.seq, std::move(result));
                }
                completed_cv.notify_one();
            }
        });
    }

    std::size_t submitted = 0;
    std::size_t emitted = 0;
    auto emit_next = [&]() {
        Result result;
        {
            std::unique_lock<std::mutex> lock(completed_mu);
            completed_cv.wait(lock, [&]() { return completed.find(emitted) != completed.end(); });
            auto item = completed.find(emitted);
            result = std::move(item->second);
            completed.erase(item);
        }
        if (result.error) std::rethrow_exception(result.error);
        on_chunk(std::move(result.index));
        ++emitted;
    };

    std::vector<char> carry;
    bool exhausted = false;
    for (;;) {
        // Bound the TOTAL pending work, including queued, parsing and completed
        // chunks. Bounding only work_queue leaves completed results unbounded.
        while (submitted - emitted >= max_in_flight_) emit_next();

        // Read into the eventual worker buffer instead of keeping read_block,
        // work and chunk copies of the same XML bytes alive simultaneously.
        std::vector<char> chunk = std::move(carry);
        if (!exhausted) {
            const std::size_t offset = chunk.size();
            chunk.resize(offset + chunk_bytes_);
            in.read(chunk.data() + offset, static_cast<std::streamsize>(chunk_bytes_));
            if (in.bad()) throw std::runtime_error("Failed reading XML input");
            chunk.resize(offset + static_cast<std::size_t>(in.gcount()));
            exhausted = in.eof();
        }
        if (chunk.empty()) break;
        std::size_t safe_end = find_safe_cut_end(chunk.data(), chunk.size());
        if (safe_end == 0 && !exhausted) {
            if (chunk.size() > kMaxCarryBytes) {
                throw std::runtime_error("XML record exceeds the parser carry limit");
            }
            carry = std::move(chunk);
            continue;
        }
        if (safe_end == 0) safe_end = chunk.size();
        carry.assign(chunk.begin() + static_cast<std::ptrdiff_t>(safe_end), chunk.end());
        chunk.resize(safe_end);
        {
            std::lock_guard<std::mutex> lock(work_mu);
            work_queue.push_back(WorkItem{submitted++, std::move(chunk)});
        }
        work_cv.notify_one();
        if (exhausted && carry.empty()) break;
    }
    {
        std::lock_guard<std::mutex> lock(work_mu);
        producer_done = true;
    }
    work_cv.notify_all();
    while (emitted < submitted) emit_next();
}
