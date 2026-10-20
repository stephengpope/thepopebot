# Claude chat search checks

After `npm ci`, run these checks with Node.js 22+ (the tests use Node's experimental
module mocking support):

```sh
node --experimental-test-module-mocks --test tests/claude-search.test.js
RUN_CLAUDE_SEARCH_SDK=1 node --experimental-test-module-mocks --test tests/claude-search-sdk.test.js
```

The first command exercises settings persistence, admin authorization and the
maintained adapter/resolver. The second launches the installed Claude SDK and
its real Claude process against a local **scripted model API** and HTTP MCP
fixture. It checks discovery, search, fetch, source consumption, native/disabled
choices, plan permissions, errors, timeouts, consumer cancellation and request
headers. It also verifies existing user MCP URLs and credentials under the
`parallel-search` name survive every built-in search choice. Only the managed
MCP URL is redirected after asserting the production URL.
Temporary settings databases and workspace directories are removed afterward.
These tests do not use model inference or need real model credentials.

To exercise the public anonymous Parallel endpoint through the same SDK caller:

```sh
RUN_CLAUDE_SEARCH_SDK=1 LIVE_PARALLEL_MCP=1 node --experimental-test-module-mocks --test tests/claude-search-sdk.test.js
```

This makes live search/fetch requests using a scripted model and prints tool
results, including service errors or usage-limit responses. Inspect those results;
a passing transport check alone does not establish a successful live search.
The live mode does not run the local fixture assertions. The SDK subprocess
receives a credential whitelist with a dummy local model token and an isolated
HOME; no Parallel credential is supplied.
