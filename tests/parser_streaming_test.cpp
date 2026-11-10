#include "ExtremeParser.h"

#include <chrono>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

class TrackingBuffer : public std::stringbuf {
public:
    explicit TrackingBuffer(const std::string& input) : std::stringbuf(input) {}
    std::size_t bytes_read = 0;
protected:
    std::streamsize xsgetn(char* output, std::streamsize count) override {
        const auto actual = std::stringbuf::xsgetn(output, count);
        bytes_read += static_cast<std::size_t>(actual);
        return actual;
    }
};

std::vector<std::string> parse(const std::string& xml, std::size_t workers, std::size_t pending) {
    constexpr std::size_t chunk = 4096;
    TrackingBuffer buffer(xml);
    std::istream input(&buffer);
    ExtremeParser parser(workers, chunk, pending);
    std::vector<std::string> documents;
    bool first = true;
    parser.parse_stream(input, [&](std::unique_ptr<LocalIndex> local) {
        if (first) {
            require(buffer.bytes_read < xml.size(), "callback must run before the full XML is read");
            require(buffer.bytes_read <= pending * chunk, "pending work exceeded the configured budget");
            first = false;
        }
        // Deliberately make merging slower than parsing to exercise backpressure.
        if (workers > 1) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        for (const auto& doc : local->forward_index) {
            documents.push_back(std::string(doc.title) + '|' + std::string(doc.authors) + '|' + std::to_string(doc.year));
        }
    });
    return documents;
}
}

int main() {
    try {
        std::string xml = "<dblp>";
        std::vector<std::string> expected;
        for (int i = 0; i < 1200; ++i) {
            const std::string title = "Neural study " + std::to_string(i) + ' ' + std::string(240, 'x');
            xml += "<article key=\"test/" + std::to_string(i) + "\"><author>Test Author</author><title>" + title
                + "</title><year>2025</year><journal>Example</journal></article>";
            expected.push_back(title + "|Test Author|2025");
        }
        xml += "</dblp>";
        require(parse(xml, 1, 1) == expected, "serial stream lost or reordered records");
        require(parse(xml, 3, 4) == expected, "parallel stream lost or reordered records");

        ExtremeParser parser(3, 4096, 3);
        std::istringstream input(xml);
        bool caught = false;
        try {
            parser.parse_stream(input, [](std::unique_ptr<LocalIndex>) {
                throw std::runtime_error("intentional callback failure");
            });
        } catch (const std::runtime_error& error) {
            caught = std::string(error.what()) == "intentional callback failure";
        }
        require(caught, "callback exceptions must propagate without a deadlock");
        std::istringstream second(xml);
        std::size_t count = 0;
        parser.parse_stream(second, [&](std::unique_ptr<LocalIndex> local) { count += local->forward_index.size(); });
        require(count == expected.size(), "parser could not be reused after cancellation");
        LocalIndex local;
        require(local.arena.bytes_allocated() == 1024u * 1024u, "chunk arena must use small slabs");
        std::cout << "PASS: early callbacks, bounded read-ahead, serial/parallel ordering, cancellation, and arena size\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
