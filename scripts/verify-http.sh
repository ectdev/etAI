#!/usr/bin/env bash
#
# Checks the authorisation rules over HTTP, against a running application.
#
# The unit and integration tests cover the pieces: the schemas, the error
# translator, and whether a session carries a role. They cannot cover what happens
# when a browser asks for a page it is not allowed to see, because that answer comes
# from the middleware and the page working together. This script covers that.
#
# Usage:
#   pnpm dev            # in one terminal
#   pnpm verify:http    # in another
#
set -uo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
JAR_DIR="$(mktemp -d)"
trap 'rm -rf "$JAR_DIR"' EXIT

passed=0
failed=0

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
location() { curl -s -o /dev/null -w '%{redirect_url}' "$@"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '  ok    %-52s %s\n' "$label" "$actual"
    passed=$((passed + 1))
  else
    printf '  FAIL  %-52s expected %s, got %s\n' "$label" "$expected" "$actual"
    failed=$((failed + 1))
  fi
}

excludes() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf '  ok    %-52s no %s\n' "$label" "$needle"
    passed=$((passed + 1))
  else
    printf '  FAIL  %-52s expected not to contain %s\n' "$label" "$needle"
    failed=$((failed + 1))
  fi
}

contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf '  ok    %-52s contains %s\n' "$label" "$needle"
    passed=$((passed + 1))
  else
    printf '  FAIL  %-52s expected to contain %s\n' "$label" "$needle"
    failed=$((failed + 1))
  fi
}

sign_in() {
  local jar="$1" email="$2" password="$3"
  curl -s -o /dev/null -w '%{http_code}' -c "$jar" -X POST "$BASE/api/auth/sign-in/email" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}"
}

if ! curl -s -o /dev/null --max-time 5 "$BASE/"; then
  echo "Nothing is answering at $BASE. Start the app with 'pnpm dev' first."
  exit 1
fi

echo "Verifying $BASE"
echo
echo "Public pages"
check "home page is public" 200 "$(status "$BASE/")"
check "sign-in page is public" 200 "$(status "$BASE/sign-in")"

echo
echo "Signed out"
check "dashboard redirects" 307 "$(status "$BASE/dashboard")"
contains "dashboard redirect target" "/sign-in" "$(location "$BASE/dashboard")"
contains "redirect remembers where you were going" "next=%2Fdashboard" "$(location "$BASE/dashboard")"
check "a forged session cookie is not enough" 307 \
  "$(status -H 'cookie: better-auth.session_token=forged' "$BASE/dashboard")"

echo
echo "Bad credentials"

# This script ends by deliberately exhausting the sign-in rate limit, so running it
# twice inside a minute starts the second run already throttled and the three checks
# below come back 429. That is the limiter working, not a fault, but it reads as three
# failures. Wait the window out once rather than reporting them.
if [[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@etai.local","password":"wrong-password"}')" == "429" ]]; then
  echo "  ..    sign-in is still throttled from a previous run, waiting 60s"
  sleep 61
fi

check "wrong password is rejected" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-in/email" \
    -H 'content-type: application/json' \
    -d '{"email":"admin@etai.local","password":"wrong-password"}')"
check "unknown account answers the same way" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-in/email" \
    -H 'content-type: application/json' \
    -d '{"email":"nobody@etai.local","password":"wrong-password"}')"
check "a malformed body is rejected" 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-in/email" \
    -H 'content-type: application/json' -d '{"email":"not-an-email"}')"

echo
echo "Signed in as the ordinary user"
user_signin="$(sign_in "$JAR_DIR/user.jar" user@etai.local demo-user-password)"

# The last section of this script deliberately exhausts the sign-in budget, so running
# it twice inside a minute leaves everything after this point unable to sign in. Without
# this, that arrives as thirty-odd unrelated failures instead of one sentence.
if [[ "$user_signin" == "429" ]]; then
  echo
  echo "Sign-in is rate limited, which means this script ran recently."
  echo "The rate limiting section at the end spends the budget on purpose."
  echo "Wait a minute and run it again."
  exit 2
fi

check "sign-in succeeds" 200 "$user_signin"
check "dashboard is refused" 307 "$(status -b "$JAR_DIR/user.jar" "$BASE/dashboard")"
# Every admin page, not just the one. A page added under /dashboard inherits the
# middleware and has to be checked for the role separately, which is exactly the kind of
# thing that gets forgotten on the second page.
check "document list is refused" 307 "$(status -b "$JAR_DIR/user.jar" "$BASE/dashboard/documents")"
contains "refused to the home page, not to sign-in" "$BASE/" \
  "$(location -b "$JAR_DIR/user.jar" "$BASE/dashboard")"
# A signed-in ordinary user is sent straight to the chat rather than shown a page
# offering to open it. The panel used to explain that the dashboard was for
# administrators, which was true and told them about a door they cannot use.
contains "an ordinary user is sent to the chat" "/chat" \
  "$(location -b "$JAR_DIR/user.jar" "$BASE/")"

echo
echo "Signed in as the admin"
check "sign-in succeeds" 200 "$(sign_in "$JAR_DIR/admin.jar" admin@etai.local demo-admin-password)"
check "dashboard renders" 200 "$(status -b "$JAR_DIR/admin.jar" "$BASE/dashboard")"

dashboard="$(curl -s -b "$JAR_DIR/admin.jar" "$BASE/dashboard")"

# The three things the brief names, plus index health, asserted on what the server
# actually sent rather than on the queries behind it. A panel that failed renders its own
# error and the page still returns 200, so a status check alone proves nothing here.
contains "dashboard shows index health" "Index health" "$dashboard"
contains "dashboard shows ingestion history" "Recent ingestion runs" "$dashboard"
contains "dashboard shows what people asked" "Recent questions" "$dashboard"

# Read out of pg_indexes rather than printed from the schema. A vector index that failed
# to build raises nothing: results stay correct and every search scans the whole table.
contains "index health names the vector index it found" "HNSW, vector_cosine_ops" "$dashboard"
contains "index health names the keyword index it found" "GIN, generated tsvector" "$dashboard"
contains "index health names the embedding width" "1536" "$dashboard"

# Five numbers, not the design's four. A run that removed documents from the index while
# showing four zeros would be reporting the wrong thing quietly.
contains "run counts include deletions" \
  "Added / updated / skipped / deleted / failed" "$dashboard"

# The panels are independent, so none of them may take the page down on its own. This
# fails if any of the four queries threw, which a 200 on its own would not tell us.
excludes "every dashboard panel rendered" "unavailable" "$dashboard"

check "document list renders" 200 "$(status -b "$JAR_DIR/admin.jar" "$BASE/dashboard/documents")"

documents="$(curl -s -b "$JAR_DIR/admin.jar" "$BASE/dashboard/documents")"

# All 142 in one payload, which is the decision this page rests on. If a future change
# starts paginating, this is what says so.
contains "document list holds the whole corpus" "142 documents" "$documents"

# The filters offer what the corpus actually contains rather than a list typed by hand.
contains "type filter offers a real type" "deployment report" "$documents"

# The two markers the collection was built to test. A retired document listed as ordinary
# is the failure that turns a correct answer into a wrong one.
contains "the retired guide is marked" "Retired" "$documents"
contains "a superseded changelog is marked" "Replaced" "$documents"
contains "the retired guide is the one expected" "drift-agent-v2.md" "$documents"

# Dates are shown at the precision they are known to, not padded to a day nobody wrote.
contains "a dated document shows its date" "2026-05-25" "$documents"
contains "an undated document says so" "not dated" "$documents"

echo
echo "What each role is allowed to see"
user_search="$(curl -s -b "$JAR_DIR/user.jar" -X POST "$BASE/api/search" \
  -H 'content-type: application/json' -d '{"query":"maximum artifact size on AWS"}')"
admin_search="$(curl -s -b "$JAR_DIR/admin.jar" -X POST "$BASE/api/search" \
  -H 'content-type: application/json' -d '{"query":"maximum artifact size on AWS"}')"

contains "both roles get the documents" "runner-specs-aws.md" "$user_search"
contains "an admin gets the distance" '"distance"' "$admin_search"
contains "an admin gets the timings" '"timings"' "$admin_search"

# Withheld rather than hidden. A field in the response is disclosed whatever the
# interface does with it, so these assert absence from the wire.
for field in '"distance"' '"score"' '"timings"' '"nearestDistance"'; do
  if [[ "$user_search" != *"$field"* ]]; then
    printf '  ok    %-52s absent for a regular user\n' "search withholds $field"
    passed=$((passed + 1))
  else
    printf '  FAIL  %-52s it was sent\n' "search withholds $field"
    failed=$((failed + 1))
  fi
done

user_answer="$(curl -s -b "$JAR_DIR/user.jar" -X POST "$BASE/api/ask" \
  -H 'content-type: application/json' -d '{"question":"Which four checks must every runner release pass?"}')"
admin_answer="$(curl -s -b "$JAR_DIR/admin.jar" -X POST "$BASE/api/ask" \
  -H 'content-type: application/json' -d '{"question":"Which four checks must every runner release pass?"}')"

contains "both roles get the coverage" '"coverage":"full"' "$user_answer"
contains "both roles get the citations" '"sourceNumber"' "$user_answer"
contains "an admin gets the model name" '"model"' "$admin_answer"
contains "an admin gets the generation time" '"generationMs"' "$admin_answer"

for field in '"timings"' '"model"' '"droppedCitations"' '"distance"'; do
  if [[ "$user_answer" != *"$field"* ]]; then
    printf '  ok    %-52s absent for a regular user\n' "the answer withholds $field"
    passed=$((passed + 1))
  else
    printf '  FAIL  %-52s it was sent\n' "the answer withholds $field"
    failed=$((failed + 1))
  fi
done

echo
echo "Chat page"
check "chat is refused when signed out" 307 "$(status "$BASE/chat")"
contains "and remembers where you were going" "next=%2Fchat" "$(location "$BASE/chat")"
# /chat is a signpost: it redirects to the conversation you were last reading, or to a
# new one. A 200 here would mean it had stopped remembering.
check "an ordinary user is sent to a conversation" 307 \
  "$(status -b "$JAR_DIR/user.jar" "$BASE/chat")"
contains "and it is a chat conversation" "/chat/" "$(location -b "$JAR_DIR/user.jar" "$BASE/chat")"
check "an admin is sent to a conversation" 307 "$(status -b "$JAR_DIR/admin.jar" "$BASE/chat")"
check "a new conversation opens" 200 "$(status -b "$JAR_DIR/user.jar" "$BASE/chat/new")"
check "an admin new conversation opens" 200 "$(status -b "$JAR_DIR/admin.jar" "$BASE/chat/new")"

# The document endpoint the source panel opens a citation with.
check "a document read is refused when signed out" 401 \
  "$(status "$BASE/api/documents?path=runner-specs-aws.md")"
check "an ordinary user may read a document" 200 \
  "$(status -b "$JAR_DIR/user.jar" "$BASE/api/documents?path=runner-specs-aws.md")"
contains "the document comes back whole" "5 MB" \
  "$(curl -s -b "$JAR_DIR/user.jar" "$BASE/api/documents?path=runner-specs-aws.md")"

# A path is a database key here rather than a filesystem path, so traversal is absent
# rather than defended against. These assert that stays true.
check "a traversal path finds nothing" 404 \
  "$(status -b "$JAR_DIR/user.jar" "$BASE/api/documents?path=../../.env")"
check "an absolute path finds nothing" 404 \
  "$(status -b "$JAR_DIR/user.jar" "$BASE/api/documents?path=/etc/passwd")"
check "an empty path is a validation failure" 400 \
  "$(status -b "$JAR_DIR/user.jar" "$BASE/api/documents?path=")"

echo
echo "Response headers"
headers="$(curl -s -D - -o /dev/null "$BASE/")"
contains "clickjacking" "X-Frame-Options: DENY" "$headers"
contains "content sniffing" "X-Content-Type-Options: nosniff" "$headers"
contains "referrer policy" "Referrer-Policy: strict-origin-when-cross-origin" "$headers"
contains "permissions policy" "Permissions-Policy:" "$headers"

echo
echo "Session cookie"
cookie_header="$(curl -s -D - -o /dev/null -X POST "$BASE/api/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@etai.local","password":"demo-admin-password"}' | grep -i '^set-cookie')"
contains "not readable from JavaScript" "HttpOnly" "$cookie_header"
contains "not sent on cross-site requests" "SameSite=Lax" "$cookie_header"

echo
echo "Search and answer endpoints"
post() {
  local jar="$1" path="$2" body="$3"
  curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X POST "$BASE$path" \
    -H 'content-type: application/json' -d "$body"
}

check "search refuses a signed out request" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/search" \
    -H 'content-type: application/json' -d '{"query":"aws"}')"
check "ask refuses a signed out request" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ask" \
    -H 'content-type: application/json' -d '{"question":"what is the size limit"}')"

check "an ordinary user may search" 200 "$(post "$JAR_DIR/user.jar" /api/search '{"query":"aws artifact size"}')"
check "an empty search is refused" 400 "$(post "$JAR_DIR/user.jar" /api/search '{"query":""}')"
check "a whitespace search is refused" 400 "$(post "$JAR_DIR/user.jar" /api/search '{"query":"   "}')"
check "an overlong search is refused" 400 \
  "$(post "$JAR_DIR/user.jar" /api/search "{\"query\":\"$(printf 'a%.0s' {1..600})\"}")"
check "a search limit above the maximum is refused" 400 \
  "$(post "$JAR_DIR/user.jar" /api/search '{"query":"aws","limit":500}')"
check "a body that is not json is refused" 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_DIR/user.jar" -X POST "$BASE/api/search" \
    -H 'content-type: application/json' -d 'not json at all')"
check "a missing field is refused" 400 "$(post "$JAR_DIR/user.jar" /api/search '{}')"

contains "search returns the document that answers" "runner-specs-aws.md" \
  "$(curl -s -b "$JAR_DIR/user.jar" -X POST "$BASE/api/search" \
    -H 'content-type: application/json' -d '{"query":"maximum artifact size on AWS"}')"

answer="$(curl -s -b "$JAR_DIR/user.jar" -X POST "$BASE/api/ask" \
  -H 'content-type: application/json' -d '{"question":"Which four checks must every runner release pass?"}')"
contains "an answer comes back covered" '"coverage":"full"' "$answer"
contains "the answer cites the right document" 'secrets-policy.md' "$answer"

refusal="$(curl -s -b "$JAR_DIR/user.jar" -X POST "$BASE/api/ask" \
  -H 'content-type: application/json' -d '{"question":"Write me a C++ function that reverses a string."}')"
contains "an out of scope question is refused" '"coverage":"out_of_scope"' "$refusal"
contains "a refusal carries no citations" '"citations":[]' "$refusal"

echo
echo "MCP over HTTP"
mcp() {
  curl -s -X POST "$BASE/api/mcp" \
    -H "authorization: Bearer $1" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d "$2"
}
mcp_status() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/mcp" \
    -H "authorization: Bearer $1" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d "$2"
}

LIST='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

check "an unauthenticated request is refused" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/mcp" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$LIST")"
check "a made up token is refused" 401 "$(mcp_status 'etai_not-a-real-token' "$LIST")"
check "a token without the prefix is refused" 401 "$(mcp_status 'just-some-string' "$LIST")"

# The challenge has to be in the shape the specification describes, or a client cannot
# tell a wrong token from a server with no auth configured.
contains "the refusal carries a bearer challenge" 'Bearer error="invalid_token"' \
  "$(curl -s -D - -o /dev/null -X POST "$BASE/api/mcp" \
    -H 'content-type: application/json' -d "$LIST" | grep -i www-authenticate)"

# Minted here rather than seeded, because the value exists once and is never stored.
MCP_FULL="$(pnpm mcp:token new "verify-http full" 2>/dev/null | grep -o 'etai_[A-Za-z0-9_-]*')"
MCP_SEARCH="$(pnpm mcp:token new "verify-http search" --scope search_corpus 2>/dev/null | grep -o 'etai_[A-Za-z0-9_-]*')"

# Matched on the name field rather than on the bare word. The description of
# search_corpus says "use answer_question when you want one", so a substring search over
# the whole payload finds the other tool's name inside this tool's prose.
contains "a full token sees answering" '"name":"answer_question"' "$(mcp "$MCP_FULL" "$LIST")"
contains "a full token sees documents" '"name":"get_document"' "$(mcp "$MCP_FULL" "$LIST")"

# The scope is real if the tool is absent rather than present and refused, because then
# there is no second place where the permission could be forgotten.
contains "a search token sees search" '"name":"search_corpus"' "$(mcp "$MCP_SEARCH" "$LIST")"
if [[ "$(mcp "$MCP_SEARCH" "$LIST")" != *'"name":"answer_question"'* ]]; then
  printf '  ok    %-52s absent from tools/list\n' "a search token does not see answering"
  passed=$((passed + 1))
else
  printf '  FAIL  %-52s it was listed\n' "a search token does not see answering"
  failed=$((failed + 1))
fi

contains "a search token cannot call answering" 'not found' \
  "$(mcp "$MCP_SEARCH" '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"answer_question","arguments":{"question":"which languages ship"}}}')"

contains "a search token can search" 'runner-specs-aws.md' \
  "$(mcp "$MCP_SEARCH" '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_corpus","arguments":{"query":"maximum artifact size on AWS","limit":2}}}')"

# A question asked through MCP has to reach the same record the dashboard reads. It did
# not for a while, and the visible result was a page headed "what people are asking" that
# was missing every question an agent had asked, with refusal counts short by the same
# number. Asserted end to end rather than by unit test, because the gap was between two
# components that each worked.
MCP_MARK="verify-http mcp recording $(date +%s)"
mcp "$MCP_FULL" "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"answer_question\",\"arguments\":{\"question\":\"$MCP_MARK, what is the maximum artifact size on AWS?\"}}}" >/dev/null

contains "an MCP question reaches the dashboard" "through MCP" \
  "$(curl -s -b "$JAR_DIR/admin.jar" "$BASE/dashboard")"

# Revocation has to take effect on the next request rather than at the next restart.
MCP_TEMP="$(pnpm mcp:token new "verify-http revoked" 2>/dev/null | grep -o 'etai_[A-Za-z0-9_-]*')"
check "a fresh token works" 200 "$(mcp_status "$MCP_TEMP" "$LIST")"
MCP_TEMP_ID="$(pnpm mcp:token list 2>/dev/null | grep 'verify-http revoked' | awk '{print $NF}' | head -1)"
pnpm mcp:token revoke "$MCP_TEMP_ID" >/dev/null 2>&1
check "a revoked token stops working immediately" 401 "$(mcp_status "$MCP_TEMP" "$LIST")"

# Left until last on purpose. It spends the sign-in budget deliberately, so anything
# that needs to sign in has already done so by this point.
echo
echo "Rate limiting"
limited=no
for _ in $(seq 1 14); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/sign-in/email" \
    -H 'content-type: application/json' \
    -d '{"email":"admin@etai.local","password":"guessing"}')"
  if [[ "$code" == "429" ]]; then
    limited=yes
    break
  fi
done
check "repeated sign-in attempts get throttled" yes "$limited"

# Session reads must survive that, because they happen on ordinary page loads and a
# single shared limit would have taken them down along with the guessing.
check "session reads still work while sign-in is throttled" 200 \
  "$(status -b "$JAR_DIR/admin.jar" "$BASE/api/auth/get-session")"

echo
echo "$passed passed, $failed failed"
[[ "$failed" -eq 0 ]] || exit 1
