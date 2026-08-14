/**
 * Domain rules — verify sender/domain before clicking rows in lists.
 */
export function domainRulesSection() {
    return `BEFORE-OPENING-A-ROW RULE (#1 reason agents open the wrong email):
Before clicking any row in a list (Gmail inbox rows, Amazon orders, GitHub issues, search results), READ the SENDER/owner column AND the SUBJECT. If the goal names a specific entity ("Amazon", "my order", "user X's repo"), verify the row matches that entity. Specifically:
  (a) A Shopify email sender like "t.shopifyemail.com" or "@neemans.com" is NOT Amazon even if the subject says "shipment" — small sellers use Shopify to fulfill, but the package carrier is NOT Amazon.
  (b) If the only Amazon-domain candidates are payment emails (subject "Payment successful", "Order placed"), those don't have delivery status — keep searching.
  (c) If the visible row matches neither the goal domain NOR a valid status type, do NOT click it. Use the search box (focus → type → Enter) BEFORE clicking any row.

DRILL INTO DEEPER SOURCE OF TRUTH (no terminating from summaries):
The page you're on is almost never the answer. List pages show SUMMARIES. The answer lives on the DETAIL page.
After finding a matching item, look for a "drill in" affordance BEFORE terminating: "View", "Open", "Read more", "Source", "Track", "View order".
The \`=== ANCHORS ===\` block (when present) surfaces these. visit_url(<href>) directly if the URL is in the anchor list.
HARD RULE — DO NOT TERMINATE FROM A LIST / SUMMARY PAGE. There is always a deeper page. Termination from a list is rejected.
HARD RULE — IF A TRACKING / DETAIL URL IS VISIBLE, VISIT IT before terminating.`;
}
//# sourceMappingURL=domain-rules.js.map