/**
 * Unit tests for extractUrlsFromText regex pattern.
 *
 * The regex was updated in commit b6e5361 to support bare URLs
 * (without http/https/www prefix) such as bilibili.com/video/BV1jJexzNE4i/
 *
 * Run: node patches/snapany-app/tests/extract_urls_test.js
 */

function extractUrlsFromText(text) {
  const regex = /(?:https?:\/\/)?(?:www\.)?[-\w@:%.+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}[-\w()@:%+.~#?&/=]*/g;
  const matches = text.match(regex) || [];
  const uniqueUrls = new Set();
  matches.forEach((url) => {
    url = url.endsWith(".") ? url.slice(0, -1) : url;
    const normalizedUrl = url.startsWith("www.") ? `https://${url}` : url;
    uniqueUrls.add(normalizedUrl);
  });
  return Array.from(uniqueUrls);
}

// ---- test helpers ----
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertIncludes(result, expected, label) {
  const found = result.includes(expected);
  assert(found, `${label} — expected "${expected}" in [${result.join(", ")}]`);
}

function assertNotIncludes(result, unexpected, label) {
  const found = result.includes(unexpected);
  assert(!found, `${label} — did not expect "${unexpected}" in [${result.join(", ")}]`);
}

// ---- tests ----

console.log("\n=== extractUrlsFromText tests ===\n");

// 1. Bilibili bare URL with trailing slash (the key case from the commit)
console.log("Bilibili bare URL:");
{
  const result = extractUrlsFromText("bilibili.com/video/BV1jJexzNE4i/");
  assertIncludes(result, "bilibili.com/video/BV1jJexzNE4i/", "bilibili bare URL with trailing slash");
}

// 2. Bilibili bare URL without trailing slash
{
  const result = extractUrlsFromText("bilibili.com/video/BV1jJexzNE4i");
  assertIncludes(result, "bilibili.com/video/BV1jJexzNE4i", "bilibili bare URL without trailing slash");
}

// 3. Bilibili URL with https scheme
{
  const result = extractUrlsFromText("https://www.bilibili.com/video/BV1jJexzNE4i/");
  assertIncludes(result, "https://www.bilibili.com/video/BV1jJexzNE4i/", "bilibili full URL with https+www");
}

// 4. Standard https URL
console.log("\nStandard URLs:");
{
  const result = extractUrlsFromText("Check out https://example.com/path?q=1&r=2");
  assertIncludes(result, "https://example.com/path?q=1&r=2", "https URL with query params");
}

// 5. www prefix gets normalized to https://
{
  const result = extractUrlsFromText("Visit www.google.com for search");
  assertIncludes(result, "https://www.google.com", "www prefix normalized to https://");
}

// 6. Bare domain without path
{
  const result = extractUrlsFromText("Go to github.com today");
  assertIncludes(result, "github.com", "bare domain without path");
}

// 7. Trailing dot is stripped
console.log("\nEdge cases:");
{
  const result = extractUrlsFromText("See example.com.");
  assertIncludes(result, "example.com", "trailing dot stripped");
}

// 8. Multiple URLs in one string
{
  const result = extractUrlsFromText(
    "Watch https://youtube.com/watch?v=abc and bilibili.com/video/BV1jJexzNE4i/ for fun"
  );
  assert(result.length === 2, `two URLs extracted (got ${result.length})`);
  assertIncludes(result, "https://youtube.com/watch?v=abc", "youtube URL from mixed text");
  assertIncludes(result, "bilibili.com/video/BV1jJexzNE4i/", "bilibili URL from mixed text");
}

// 9. Chinese text surrounding a bare URL
{
  const result = extractUrlsFromText("请看这个视频bilibili.com/video/BV1jJexzNE4i/很好看");
  assertIncludes(result, "bilibili.com/video/BV1jJexzNE4i/", "bilibili URL embedded in Chinese text");
}

// 10. No URLs in plain text
{
  const result = extractUrlsFromText("This is just plain text with no links");
  assert(result.length === 0, "no URLs from plain text");
}

// 11. Deduplication
{
  const result = extractUrlsFromText("https://example.com and https://example.com again");
  assert(result.length === 1, `deduplication works (got ${result.length})`);
}

// 12. URL with port number
{
  const result = extractUrlsFromText("API at https://api.example.com:8080/v1/data");
  assertIncludes(result, "https://api.example.com:8080/v1/data", "URL with port number");
}

// 12b. localhost without TLD is not matched (expected — regex requires a dotted domain)
{
  const result = extractUrlsFromText("Local dev at localhost:3000/api/health");
  assert(result.length === 0, "localhost without TLD is not matched");
}

// 13. YouTube URL
{
  const result = extractUrlsFromText("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assertIncludes(result, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "YouTube URL");
}

// 14. Twitter/X URL with path
{
  const result = extractUrlsFromText("https://x.com/user/status/123456");
  assertIncludes(result, "https://x.com/user/status/123456", "Twitter/X URL with path");
}

// ---- summary ----
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
